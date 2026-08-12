import { pgTable, uuid, varchar, date, text, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { agencies } from './agencies';

/**
 * Cache de insights explicativos sobre métricas sintéticas (crisis,
 * polarización, NSS, BHI, volume) por (agency, metric, period). Servido por
 * /api/eco-metric-insight cuando el usuario clickea un KPI clickeable. Cada
 * fila tiene un párrafo descriptivo IA explicando "por qué este número es
 * lo que es para esta agencia en este periodo" — no la fórmula.
 *
 * Mismo patrón de caché que overview_period_insights:
 * - Histórico (period_end < ayer): inmutable
 * - Rolling: refresca cada 1h en background
 */
export const metricInsightsCache = pgTable(
  'metric_insights_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id, { onDelete: 'cascade' }),
    metric: varchar('metric', { length: 24 }).notNull(),
    periodStartDate: date('period_start_date').notNull(),
    periodEndDate: date('period_end_date').notNull(),
    insightText: text('insight_text').notNull(),
    modelUsed: text('model_used').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_metric_insights_agency_metric_range').on(t.agencyId, t.metric, t.periodStartDate, t.periodEndDate),
    index('idx_metric_insights_recent').on(t.agencyId, t.metric, t.periodEndDate),
  ],
);
