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
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { agencies } from './agencies';

/** Valores de `mentions.mention_kind` (spec 5.1). La columna es varchar(24), no enum de PG. */
export type MentionKind = 'article' | 'agency_post' | 'comment' | 'third_party_post';

export const mentions = pgTable(
  'mentions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id),

    // Brandwatch raw identifiers
    // Único POR AGENCIA (índice mentions_agency_bw_resource_uq abajo): la misma
    // nota puede coincidir con las queries de dos agencias y cada una la guarda.
    bwResourceId: varchar('bw_resource_id', { length: 255 }).notNull(),
    bwGuid: varchar('bw_guid', { length: 255 }),
    bwQueryId: bigint('bw_query_id', { mode: 'number' }).notNull(),
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

    // Interpretación v1 (migración 0013; spec 5.1 y 12.1). Todas NULL hasta
    // que el processor (WP-2) o el backfill (WP-13) las pueble: NULL = fila
    // sin rúbrica v2. `nlpPromptVersion` distingue qué filas ya la tienen.
    /** Tipo de mención: article | agency_post | comment | third_party_post. */
    mentionKind: varchar('mention_kind', { length: 24 }).$type<MentionKind>(),
    /** FK lógica a mentions.id (misma agencia); sin FK física por costo en inserción. */
    parentMentionId: uuid('parent_mention_id'),
    /** Fecha del post padre, desnormalizada para muestras de comentarios. */
    parentPublishedAt: timestamp('parent_published_at', { withTimezone: true }),
    /** Hecho adverso (spec 6.2); NULL = no evaluado por la rúbrica v2. */
    nlpAdverseFact: boolean('nlp_adverse_fact'),
    /** Versión de la rúbrica que clasificó la fila, p. ej. `rubric-v2.0`. */
    nlpPromptVersion: varchar('nlp_prompt_version', { length: 24 }),
    /** Modelo que clasificó la fila. */
    nlpModel: varchar('nlp_model', { length: 64 }),

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
    // Imagen representativa resuelta por el scraper (og:image / thumbnail de
    // YouTube / media directa / avatar). Nullable — se puebla en ingesta y por
    // el backfill de eco-migration.
    resolvedImageUrl: text('resolved_image_url'),

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
    uniqueIndex('mentions_agency_bw_resource_uq').on(t.agencyId, t.bwResourceId),
    // Interpretación v1 (0013). En prod se crean CONCURRENTLY (ver
    // docs/tecnica/migration-0013-actions.md); aquí solo se declaran.
    index('idx_mentions_kind').on(t.agencyId, t.mentionKind, t.publishedAt),
    index('idx_mentions_parent').on(t.parentMentionId),
  ],
);

/**
 * mention_nlp_shadow — clasificación en sombra (WP-12): el processor corre la
 * rúbrica v2 en paralelo a la vigente y guarda aquí el resultado SIN tocar
 * `mentions.nlp_*`, para compararlo contra los umbrales del spec (13.2) antes
 * de activar. Una fila por (mention_id, prompt_version).
 *
 * Sin FK física a mentions (igual que parent_mention_id): una FK exigiría un
 * lock SHARE ROW EXCLUSIVE sobre `mentions` al crearla y un chequeo por cada
 * inserción. Las filas huérfanas (mención borrada) se limpian por SQL.
 */
export const mentionNlpShadow = pgTable(
  'mention_nlp_shadow',
  {
    mentionId: uuid('mention_id').notNull(),
    promptVersion: varchar('prompt_version', { length: 24 }).notNull(),
    model: varchar('model', { length: 64 }).notNull(),
    sentiment: varchar('sentiment', { length: 20 }),
    pertinence: varchar('pertinence', { length: 10 }),
    adverseFact: boolean('adverse_fact'),
    topics: jsonb('topics'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'mention_nlp_shadow_pk', columns: [t.mentionId, t.promptVersion] })],
);
