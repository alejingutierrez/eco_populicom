import type { BrandwatchMention } from '@eco/shared';
import type { RetryPolicy, RunBudget } from './resilience';

export interface BrandwatchConfig {
  token: string;
  projectId: number;
  baseUrl?: string;
  /** Política de reintentos. Por defecto LONG_RETRY (la histórica, para backfill). */
  retry?: RetryPolicy;
  /** Presupuesto (tiempo / requests / pacing) de la corrida, compartido entre clientes. */
  budget?: RunBudget;
  /** Para pruebas: sustituto de `fetch`. */
  fetch?: typeof fetch;
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
