import type { BrandwatchConfig, MentionsResponse, MentionsQuery } from './types';
import type { BrandwatchMention } from '@eco/shared';

const DEFAULT_BASE_URL = 'https://api.brandwatch.com';
const DEFAULT_PAGE_SIZE = 100;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

export class BrandwatchClient {
  private token: string;
  private projectId: number;
  private baseUrl: string;

  constructor(config: BrandwatchConfig) {
    this.token = config.token;
    this.projectId = config.projectId;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
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

  private async request<T>(url: string, retries = MAX_RETRIES): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      // Rate limited — wait and retry
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`Rate limited. Waiting ${waitMs}ms before retry ${attempt + 1}/${retries}`);
        await sleep(waitMs);
        continue;
      }

      // Auth error — don't retry
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Brandwatch auth error ${response.status}: ${await response.text()}`);
      }

      // Server error — retry with backoff
      if (response.status >= 500 && attempt < retries) {
        const waitMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`Server error ${response.status}. Retrying in ${waitMs}ms`);
        await sleep(waitMs);
        continue;
      }

      throw new Error(`Brandwatch API error ${response.status}: ${await response.text()}`);
    }

    throw new Error('Max retries exceeded');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
