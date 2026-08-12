import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  integer,
  bigint,
  doublePrecision,
  timestamp,
  boolean,
  primaryKey,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { agencies } from './agencies';
import { mentions } from './mentions';

/**
 * Narrativas: clusters emergentes de menciones que comparten un eje
 * conversacional, con identidad propia y ciclo de vida. Complementario a
 * `topics` (categorías editoriales estáticas).
 *
 * El centroide y centroid_at_naming son vectores pgvector (1024 dims),
 * representados como `text` en Drizzle porque el ORM no tiene tipo nativo.
 * Los queries de similitud se hacen vía raw pg con sintaxis `<=>` (distancia
 * coseno) o `1 - (a <=> b)` para similitud.
 */
export const narratives = pgTable(
  'narratives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 140 }).notNull(),
    summary: text('summary'),
    keywords: jsonb('keywords').$type<string[]>().default([]),
    centroid: text('centroid'),
    centroidAtNaming: text('centroid_at_naming'),
    status: varchar('status', { length: 16 }).notNull().default('emerging'),
    firstMentionId: uuid('first_mention_id').references(() => mentions.id, { onDelete: 'set null' }),
    initiatorFirst: jsonb('initiator_first').$type<{
      author?: string;
      platform?: string;
      publishedAt?: string;
      url?: string;
      snippet?: string;
    } | null>(),
    initiatorInfluencer: jsonb('initiator_influencer').$type<{
      author?: string;
      reach?: number;
      engagement?: number;
      publishedAt?: string;
      url?: string;
    } | null>(),
    mentionCount: integer('mention_count').notNull().default(0),
    totalEngagement: bigint('total_engagement', { mode: 'number' }).notNull().default(0),
    totalReach: bigint('total_reach', { mode: 'number' }).notNull().default(0),
    velocity24h: doublePrecision('velocity_24h').notNull().default(0),
    engagementVelocity24h: doublePrecision('engagement_velocity_24h').notNull().default(0),
    driftScore: doublePrecision('drift_score').notNull().default(0),
    bornAt: timestamp('born_at', { withTimezone: true }).notNull().defaultNow(),
    lastMentionAt: timestamp('last_mention_at', { withTimezone: true }),
    peakedAt: timestamp('peaked_at', { withTimezone: true }),
    lastRenamedAt: timestamp('last_renamed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_narratives_agency_slug').on(t.agencyId, t.slug),
    index('idx_narratives_agency_status').on(t.agencyId, t.status),
    index('idx_narratives_last_mention').on(t.agencyId, t.lastMentionAt),
  ],
);

/**
 * Asignación mention → narrative. 1:N — una mención puede pertenecer hasta
 * a 3 narrativas (top-3 por similitud). `is_primary = true` marca la de mayor
 * similitud, para conteos simples y referencias canónicas.
 */
export const narrativeMentions = pgTable(
  'narrative_mentions',
  {
    narrativeId: uuid('narrative_id').notNull().references(() => narratives.id, { onDelete: 'cascade' }),
    mentionId: uuid('mention_id').notNull().references(() => mentions.id, { onDelete: 'cascade' }),
    similarity: doublePrecision('similarity').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.narrativeId, t.mentionId] }),
    index('idx_narrative_mentions_mention').on(t.mentionId),
  ],
);

/**
 * Conexiones entre narrativas. Tres tipos:
 *   - co_occurrence: comparten ≥5 menciones (jaccard de menciones)
 *   - author_overlap: comparten ≥3 autores (jaccard de autores)
 *   - semantic: similitud coseno entre centroides > 0.6
 *
 * Convención undirected: source_narrative_id < target_narrative_id (orden
 * lexicográfico de UUID). El check constraint en DDL lo garantiza.
 */
export const narrativeEdges = pgTable(
  'narrative_edges',
  {
    agencyId: uuid('agency_id').notNull().references(() => agencies.id, { onDelete: 'cascade' }),
    sourceNarrativeId: uuid('source_narrative_id').notNull().references(() => narratives.id, { onDelete: 'cascade' }),
    targetNarrativeId: uuid('target_narrative_id').notNull().references(() => narratives.id, { onDelete: 'cascade' }),
    edgeType: varchar('edge_type', { length: 24 }).notNull(),
    strength: doublePrecision('strength').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sourceNarrativeId, t.targetNarrativeId, t.edgeType] }),
    index('idx_narrative_edges_agency').on(t.agencyId, t.edgeType),
  ],
);

/**
 * Pool de candidatos: menciones que no matchearon ninguna narrativa activa
 * arriba del threshold. Cuando se acumulan suficientes con embeddings cercanos
 * entre sí (DBSCAN minPts=10), spawnean una narrativa nueva y se vacían de
 * esta tabla.
 */
export const narrativeCandidates = pgTable(
  'narrative_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id, { onDelete: 'cascade' }),
    mentionId: uuid('mention_id').notNull().references(() => mentions.id, { onDelete: 'cascade' }),
    embedding: text('embedding').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_narrative_candidates_mention').on(t.mentionId),
    index('idx_narrative_candidates_agency_created').on(t.agencyId, t.createdAt),
  ],
);
