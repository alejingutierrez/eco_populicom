import type { ScrapePlatform } from '../url-canonicalizer';

/**
 * Resultado de un scrape. Todos los campos opcionales excepto los básicos —
 * cada scraper rellena lo que puede. `scrapeMethod` ayuda al UI a explicar
 * qué tan completo viene el dato; `warnings` muestra advertencias visibles.
 */
export interface ScrapeResult {
  url: string;
  urlCanonical: string;
  platform: ScrapePlatform;
  domain: string;
  scrapeMethod: 'oembed' | 'og_tags' | 'json_api' | 'json_ld' | 'manual_required';
  warnings: string[];

  // Content
  title?: string;
  snippet?: string;
  author?: string;
  authorFullname?: string;
  authorAvatarUrl?: string;
  publishedAt?: Date;
  language?: string;
  mediaUrls?: string[];

  // Engagement (cuando el scraper puede obtenerlo)
  likes?: number;
  comments?: number;
  shares?: number;
  reachEstimate?: number;
}

export type ScrapeError = {
  ok: false;
  error: string;
  url: string;
  partial?: Partial<ScrapeResult>;
};

export type ScrapeOutcome =
  | { ok: true; result: ScrapeResult }
  | ScrapeError;
