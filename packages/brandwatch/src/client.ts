import type { BrandwatchConfig, MentionsResponse, MentionsQuery } from './types';
import type { BrandwatchMention } from '@eco/shared';
import {
  BrandwatchRateLimitError,
  LONG_RETRY,
  RunBudget,
  decideRetry,
  parseRetryAfterMs,
} from './resilience';
import type { RetryPolicy } from './resilience';

const DEFAULT_BASE_URL = 'https://api.brandwatch.com';
const DEFAULT_PAGE_SIZE = 100;
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

  constructor(config: BrandwatchConfig) {
    this.token = config.token;
    this.projectId = config.projectId;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.retry = config.retry ?? LONG_RETRY;
    this.budget = config.budget ?? new RunBudget();
    this.fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
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
   * retried; 5xx retry with backoff within the same attempt limit.
   */
  private async request<T>(url: string): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      await this.budget.acquire();
      const response = await this.fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      });

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
