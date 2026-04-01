import type { BrandwatchMention } from '@eco/shared';

export interface BrandwatchConfig {
  token: string;
  projectId: number;
  baseUrl?: string;
}

export interface MentionsResponse {
  results: BrandwatchMention[];
  resultsTotal: number;
  resultsPage: number;
  resultsPageSize: number;
}

export interface MentionsQuery {
  queryId: number;
  startDate: string; // ISO 8601
  endDate: string;   // ISO 8601
  pageSize?: number;
  page?: number;
  orderBy?: 'date' | 'added';
  orderDirection?: 'asc' | 'desc';
}
