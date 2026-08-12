import { pgTable, uuid, integer, date, text, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { agencies } from './agencies';
import { topics } from './topics';

/**
 * Caché de descripciones IA por tópico × período. Antes vivían en
 * `topics.description` (un único string), lo que sobrescribía la descripción
 * cada vez que cambiaba el rango. Esto rompía la promesa al usuario: pedir
 * "abril 2026" y "marzo 2026" debe devolver descripciones distintas (cada una
 * fiel a sus datos), y volver a pedir un periodo ya visto debe servirse del
 * caché sin re-invocar Bedrock.
 *
 * Patrón idéntico a `metric_insights_cache`:
 *  - Histórico (period_end_date < ayer AST): inmutable
 *  - Rolling (period_end_date = ayer AST): refresca por cron
 *
 * Lookup por (topic_id, period_start_date, period_end_date). Un mismo tópico
 * tiene una fila por cada par único de fechas; varias agencias del mismo
 * tópico son imposibles porque topic_id ya pertenece a una agencia.
 */
export const topicDescriptionsCache = pgTable(
  'topic_descriptions_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id, { onDelete: 'cascade' }),
    topicId: integer('topic_id').notNull().references(() => topics.id, { onDelete: 'cascade' }),
    periodStartDate: date('period_start_date').notNull(),
    periodEndDate: date('period_end_date').notNull(),
    description: text('description').notNull(),
    modelUsed: text('model_used').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_topic_descriptions_topic_range').on(t.topicId, t.periodStartDate, t.periodEndDate),
    index('idx_topic_descriptions_topic_recent').on(t.topicId, t.periodEndDate),
  ],
);
