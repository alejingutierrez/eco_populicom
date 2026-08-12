import { pgTable, uuid, date, text, timestamp, jsonb, unique, index } from 'drizzle-orm/pg-core';
import { agencies } from './agencies';

/**
 * Insights por periodo del Overview (espejo del correo). Una fila por
 * (agency, period_start, period_end). Genera el lambda `eco-ai-tasks` acción
 * `period-insights`; lee el endpoint `/api/eco-insights`.
 *
 * Diseño de caché:
 * - Periodo histórico (period_end < ayer AST): inmutable. Se calcula 1 vez y
 *   se queda. Sirve el mismo JSON indefinidamente.
 * - Periodo que incluye hoy/ayer (rolling): se recalcula si `generated_at <
 *   NOW - 1h` (fresh enough). Mientras tanto, se sirve el viejo + se dispara
 *   recalc async.
 *
 * Históricos se conservan — son baratos y permiten auditar evoluciones.
 */
export const overviewPeriodInsights = pgTable(
  'overview_period_insights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id, { onDelete: 'cascade' }),
    periodStartDate: date('period_start_date').notNull(),
    periodEndDate: date('period_end_date').notNull(),
    // Arrays de strings (hasta 3 cada uno). El prompt INSIGHTS_SYSTEM_PROMPT
    // emite máximo 3 por sentimiento; usamos jsonb por flexibilidad de longitud.
    negativeInsights: jsonb('negative_insights').notNull().default('[]'),
    neutralInsights: jsonb('neutral_insights').notNull().default('[]'),
    positiveInsights: jsonb('positive_insights').notNull().default('[]'),
    dailySummary: text('daily_summary'),
    modelUsed: text('model_used').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_overview_period_insights_agency_range').on(t.agencyId, t.periodStartDate, t.periodEndDate),
    index('idx_overview_period_insights_recent').on(t.agencyId, t.periodEndDate),
  ],
);
