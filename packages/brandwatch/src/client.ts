import type { BrandwatchConfig, MentionsResponse, MentionsQuery } from './types';
import type { BrandwatchMention } from '@eco/shared';
import {
  BrandwatchRateLimitError,
  LONG_RETRY,
  RunBudget,
  decideRetry,
  parseQuotaUsed,
  parseRetryAfterMs,
} from './resilience';
import type { RetryPolicy } from './resilience';

const DEFAULT_BASE_URL = 'https://api.brandwatch.com';
const DEFAULT_PAGE_SIZE = 100;
// Tiempo máximo de UNA petición. Sin él, un fetch colgado se comía el
// presupuesto de la corrida (1-nov-2026: 302 s con presupuesto de 180 s). El
// gateway de Brandwatch corta a ~30 s; 45 s deja margen sin esperar de más.
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
// Lo que se le pasa a decideRetry cuando la petición no respondió a tiempo: se
// trata como un 5xx (backoff corto dentro del mismo límite de intentos).
const TIMEOUT_AS_STATUS = 504;

function isTimeoutError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null | undefined)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}
// Brandwatch's quota is ~30 requests per 10 minutes per account, shared with
// biq-ingestion, and 429s consume quota too. How many times to retry, how long
// to wait and how much wall-clock a run may spend is decided by the caller via
// `retry` + `budget` (see ./resilience): incremental runs retry little and
// give up; only manual backfills use the long policy (the default here).

export class BrandwatchClient {
  private token: string;
  private projectId: number;
  private baseUrl: string;
  private retry: RetryPolicy;
  private budget: RunBudget;
  private fetchImpl: typeof fetch;
  private requestTimeoutMs: number;

  constructor(config: BrandwatchConfig) {
    this.token = config.token;
    this.projectId = config.projectId;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.retry = config.retry ?? LONG_RETRY;
    this.budget = config.budget ?? new RunBudget();
    this.fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * Fetch mentions with automatic pagination.
   * Yields pages of mentions for memory efficiency.
   */
  async *fetchMentionPages(
    query: MentionsQuery,
  ): AsyncGenerator<BrandwatchMention[], void, undefined> {
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    let page = query.page ?? 0;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        queryId: String(query.queryId),
        startDate: query.startDate,
        endDate: query.endDate,
        pageSize: String(pageSize),
        page: String(page),
        orderBy: query.orderBy ?? 'date',
        orderDirection: query.orderDirection ?? 'asc',
      });

      const url = `${this.baseUrl}/projects/${this.projectId}/data/mentions?${params}`;
      const data = await this.request<MentionsResponse>(url);

      if (data.results.length > 0) {
        yield data.results;
      }

      // Check if there are more pages
      const totalFetched = (page + 1) * pageSize;
      hasMore = data.results.length === pageSize && totalFetched < data.resultsTotal;
      page++;
    }
  }

  /**
   * Fetch all mentions (loads all pages into memory).
   * Use fetchMentionPages for large datasets.
   */
  async fetchAllMentions(query: MentionsQuery): Promise<BrandwatchMention[]> {
    const all: BrandwatchMention[] = [];
    for await (const page of this.fetchMentionPages(query)) {
      all.push(...page);
    }
    return all;
  }

  /**
   * Get total mention count for a query in a date range.
   */
  async getMentionCount(queryId: number, startDate: string, endDate: string): Promise<number> {
    const params = new URLSearchParams({
      queryId: String(queryId),
      startDate,
      endDate,
    });
    const url = `${this.baseUrl}/projects/${this.projectId}/data/mentions/count?${params}`;
    const data = await this.request<{ mentionsCount: number }>(url);
    return data.mentionsCount;
  }

  /**
   * Each attempt goes through `budget.acquire()` (pacing, request cap, run
   * deadline). A 429 whose retries run out throws BrandwatchRateLimitError so
   * the caller can stop hammering the shared quota; auth errors are not
   * retried; 5xx retry with backoff within the same attempt limit. A request
   * that does not answer within the timeout is treated like a 5xx. Every
   * response reports the account-wide quota (`x-rate-limit-used`) to the
   * budget, which stops the run before the ceiling instead of after a 429.
   */
  private async request<T>(url: string): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      await this.budget.acquire();
      // El tiempo máximo no pasa de lo que le queda a la corrida.
      const timeoutMs = Math.max(1, Math.min(this.requestTimeoutMs, this.budget.remainingMs()));
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (!isTimeoutError(err)) throw err;
        const decision = decideRetry(
          this.retry,
          { status: TIMEOUT_AS_STATUS, attempt, retryAfterMs: null },
          this.budget.remainingMs(),
        );
        if (!decision.retry) {
          throw new Error(`Brandwatch request timed out after ${timeoutMs}ms (attempt ${attempt}/${this.retry.maxAttempts})`);
        }
        console.warn(
          `Request timeout (${timeoutMs}ms). Waiting ${decision.waitMs}ms before retry ${attempt}/${this.retry.maxAttempts - 1}`,
        );
        await this.budget.sleep(decision.waitMs);
        continue;
      }

      // Fallar abierto: sin cabecera (o con una respuesta sin `headers`) no se
      // observa nada y todo sigue como antes.
      let quotaHeader: string | null = null;
      try {
        quotaHeader = response.headers?.get?.('x-rate-limit-used') ?? null;
      } catch {
        quotaHeader = null;
      }
      this.budget.observeQuota(parseQuotaUsed(quotaHeader));
      if (response.status === 429) this.budget.noteRateLimited();

      if (response.ok) {
        return (await response.json()) as T;
      }

      // Auth error — don't retry
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Brandwatch auth error ${response.status}: ${await response.text()}`);
      }

      if (response.status === 429 || response.status >= 500) {
        const retryAfterMs =
          response.status === 429
            ? parseRetryAfterMs(response.headers.get('Retry-After'), this.budget.now())
            : null;
        const decision = decideRetry(
          this.retry,
          { status: response.status, attempt, retryAfterMs },
          this.budget.remainingMs(),
        );

        // Un 429 con la cuenta ya en el techo: dormir y volver a pedir solo
        // gastaría otro request en un 429 seguro. Se cede en el acto.
        if (response.status === 429 && decision.retry && this.budget.quotaBlockedAt(this.budget.now() + decision.waitMs)) {
          await response.text().catch(() => '');
          console.warn(`Rate limited: giving up (quota-ceiling) after ${attempt}/${this.retry.maxAttempts} attempts`);
          throw new BrandwatchRateLimitError('quota-ceiling', attempt, retryAfterMs);
        }

        if (decision.retry) {
          // Drain the body so the connection is released before sleeping.
          await response.text().catch(() => '');
          console.warn(
            `${response.status === 429 ? 'Rate limited' : `Server error ${response.status}`}. ` +
              `Waiting ${decision.waitMs}ms before retry ${attempt}/${this.retry.maxAttempts - 1}`,
          );
          await this.budget.sleep(decision.waitMs);
          continue;
        }

        if (response.status === 429) {
          await response.text().catch(() => '');
          console.warn(
            `Rate limited: giving up (${decision.reason}) after ${attempt}/${this.retry.maxAttempts} attempts`,
          );
          throw new BrandwatchRateLimitError(decision.reason, attempt, retryAfterMs);
        }
      }

      throw new Error(`Brandwatch API error ${response.status}: ${await response.text()}`);
    }
  }
}
