// ============================================================
// ManualMentionInput — shape común para imports manuales
// ============================================================
//
// Contrato entre:
//   • eco-import-preview lambda (lo construye desde Excel / scraper)
//   • API route /api/admin/mentions/import/[id]/commit (lo despacha a SQS)
//   • eco-processor lambda (lo consume y persiste)
//
// Análogo a BrandwatchMention pero sin los campos bw_* obligatorios.
// El campo `url` se canonicaliza al construirse y `urlCanonical` es la
// llave de dedup contra `mentions.url_canonical`.

export interface ManualMentionInput {
  url: string;
  urlCanonical: string;
  title?: string;
  snippet?: string;
  author?: string;
  authorFullname?: string;
  authorAvatarUrl?: string;
  domain: string;
  pageType: string;
  contentSource?: string;
  contentSourceName?: string;
  subtype?: string;
  language?: string;

  /** ISO 8601 timestamp, idealmente con offset (`2026-05-23T17:35:26-04:00`). */
  publishedAt: string;

  // Engagement (todos opcionales — scrapers/Excel pueden no traerlos)
  likes?: number;
  comments?: number;
  shares?: number;
  reachEstimate?: number;
  potentialAudience?: number;
  monthlyVisitors?: number;
  engagementScore?: number;
  impact?: number;

  // Sentimiento del Excel (Brandwatch export) si lo trae. Se guarda como
  // `bw_sentiment` para preservar referencia. El NLP de Claude corre encima
  // siempre.
  bwSentiment?: 'positive' | 'neutral' | 'negative';
  bwCountry?: string;
  bwCountryCode?: string;
  bwRegion?: string;
  bwCity?: string;

  mediaUrls?: string[];
}

/**
 * Mensaje SQS para imports manuales. Llega al ingestion queue (mismo que
 * Brandwatch). El processor lo detecta por el campo `__source`.
 *
 * - `__source` discrimina la rama de procesamiento
 * - `agencyId` viene del payload (no se resuelve por queryId)
 * - `sourceImportId` linkea a mention_imports.id para tracking de progreso
 */
export interface ManualMentionSqsMessage {
  __source: 'manual_excel' | 'manual_url';
  sourceImportId: string;
  agencyId: string;
  mention: ManualMentionInput;
}

/** Type guard para identificar mensajes manuales en el handler del processor. */
export function isManualMessage(body: unknown): body is ManualMentionSqsMessage {
  if (!body || typeof body !== 'object') return false;
  const src = (body as Record<string, unknown>).__source;
  return src === 'manual_excel' || src === 'manual_url';
}
