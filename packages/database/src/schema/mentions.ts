import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { agencies } from './agencies';

export const mentions = pgTable(
  'mentions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id),

    // Brandwatch raw identifiers (nullable: las menciones importadas
    // manualmente desde Excel/URL no vienen de un query de Brandwatch).
    // La unicidad de `bw_resource_id` se aplica via índice parcial en SQL
    // (WHERE bw_resource_id IS NOT NULL), no via constraint Drizzle.
    bwResourceId: varchar('bw_resource_id', { length: 255 }),
    bwGuid: varchar('bw_guid', { length: 255 }),
    bwQueryId: bigint('bw_query_id', { mode: 'number' }),
    bwQueryName: varchar('bw_query_name', { length: 255 }),

    // Content
    title: text('title'),
    snippet: text('snippet'),
    url: text('url'),
    originalUrl: text('original_url'),

    // Author
    author: varchar('author', { length: 255 }),
    authorFullname: varchar('author_fullname', { length: 255 }),
    authorGender: varchar('author_gender', { length: 20 }),
    authorAvatarUrl: text('author_avatar_url'),

    // Source
    domain: varchar('domain', { length: 255 }),
    // pageType: requerido para mentions de Brandwatch; en imports manuales se
    // deriva de SOURCE_TYPE del Excel o del scraper de URL. Sigue siendo
    // notNull en SQL — los call sites garantizan un valor (default 'web').
    pageType: varchar('page_type', { length: 50 }).notNull(),
    contentSource: varchar('content_source', { length: 50 }),
    contentSourceName: varchar('content_source_name', { length: 100 }),
    pubType: varchar('pub_type', { length: 50 }),
    subtype: varchar('subtype', { length: 50 }),

    // Engagement
    likes: integer('likes').notNull().default(0),
    comments: integer('comments').notNull().default(0),
    shares: integer('shares').notNull().default(0),
    engagementScore: doublePrecision('engagement_score').notNull().default(0),
    impact: doublePrecision('impact').notNull().default(0),
    reachEstimate: integer('reach_estimate').notNull().default(0),
    potentialAudience: integer('potential_audience').notNull().default(0),
    monthlyVisitors: bigint('monthly_visitors', { mode: 'number' }).notNull().default(0),

    // Brandwatch geo
    bwCountry: varchar('bw_country', { length: 100 }),
    bwCountryCode: varchar('bw_country_code', { length: 10 }),
    bwRegion: varchar('bw_region', { length: 100 }),
    bwCity: varchar('bw_city', { length: 100 }),
    bwCityCode: varchar('bw_city_code', { length: 100 }),

    // Brandwatch sentiment
    bwSentiment: varchar('bw_sentiment', { length: 20 }),

    // NLP results (Claude Opus)
    nlpSentiment: varchar('nlp_sentiment', { length: 20 }),
    nlpEmotions: jsonb('nlp_emotions').$type<string[]>(),
    nlpPertinence: varchar('nlp_pertinence', { length: 10 }),
    nlpSummary: text('nlp_summary'),

    // Embedding (Titan Embed Text v2, 1024-dim cosine). Drizzle no tiene tipo
    // nativo `vector`; el processor y los queries de similitud lo manejan vía
    // SQL raw. Aquí solo lo declaramos para que aparezca en select queries.
    embedding: text('embedding'),
    embeddedAt: timestamp('embedded_at', { withTimezone: true }),

    // Deduplication
    textHash: varchar('text_hash', { length: 64 }),
    isDuplicate: boolean('is_duplicate').notNull().default(false),
    duplicateOfId: uuid('duplicate_of_id'),

    // Media
    mediaUrls: jsonb('media_urls').$type<string[]>(),
    hasImage: boolean('has_image').notNull().default(false),
    hasVideo: boolean('has_video').notNull().default(false),

    // URL canónica para dedup (Brandwatch + manual imports comparten esta
    // llave). Calculada por @eco/shared/url-canonicalizer.canonicalizeUrl.
    // Unicidad (agency_id, url_canonical) via índice parcial en SQL.
    urlCanonical: varchar('url_canonical', { length: 1000 }),

    // Provenance: distingue menciones de Brandwatch (default) de las subidas
    // manualmente vía Excel o URL. Filtrable en UI.
    ingestionSource: varchar('ingestion_source', { length: 20 }).notNull().default('brandwatch'),

    // FK al import batch (mention_imports.id) cuando ingestionSource ≠
    // 'brandwatch'. Permite agrupar y mostrar progreso por import.
    sourceImportId: uuid('source_import_id'),

    // Timestamps
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    language: varchar('language', { length: 10 }).notNull().default('es'),
  },
  (t) => [
    index('idx_mentions_agency_id').on(t.agencyId),
    index('idx_mentions_published_at').on(t.publishedAt),
    index('idx_mentions_nlp_sentiment').on(t.nlpSentiment),
    index('idx_mentions_page_type').on(t.pageType),
    index('idx_mentions_text_hash').on(t.textHash),
    index('idx_mentions_domain').on(t.domain),
    index('idx_mentions_agency_published').on(t.agencyId, t.publishedAt),
    index('idx_mentions_url_canonical').on(t.urlCanonical),
    index('idx_mentions_source_import_id').on(t.sourceImportId),
    index('idx_mentions_ingestion_source').on(t.ingestionSource),
  ],
);
