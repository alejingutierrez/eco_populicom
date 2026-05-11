import { pgTable, uuid, integer, text, timestamp, boolean, varchar, index } from 'drizzle-orm/pg-core';
import { agencies } from './agencies';

/**
 * Briefing ejecutivo generado por IA para el scorecard del dashboard.
 *
 * El lambda `eco-ai-tasks` (acción `briefing`) inserta una fila por agencia
 * activa cada 6 horas (00, 06, 12, 18 hora AST). El endpoint `/api/eco-data`
 * lee el más reciente; si pasó más de 12 horas sin generar uno (lambda caída),
 * cae a un resumen de reglas determinístico para no dejar la UI en blanco.
 *
 * Históricos se conservan (no `DELETE`) — son baratos y permiten auditar/
 * mostrar evolución del resumen ejecutivo a futuro.
 */
export const agencyBriefings = pgTable(
  'agency_briefings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id, { onDelete: 'cascade' }),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    periodHours: integer('period_hours').notNull().default(24),
    narrativeHtml: text('narrative_html').notNull(),
    dominantSignal: text('dominant_signal').notNull(),
    actionLabel: text('action_label').notNull(),
    actionTone: varchar('action_tone', { length: 10 }).notNull(),
    reachLabel: text('reach_label'),
    modelUsed: text('model_used').notNull(),
    sourceMentions: integer('source_mentions').notNull(),
    fallback: boolean('fallback').notNull().default(false),
  },
  (t) => [index('idx_agency_briefings_recent').on(t.agencyId, t.generatedAt)],
);
