import { pgTable, uuid, text, jsonb, integer, boolean, timestamp, numeric, smallint, bigserial, serial, date, index, primaryKey } from 'drizzle-orm/pg-core';
import { agencies } from './agencies';
import { chatConversations } from './chat';

/**
 * Asesor de crisis (spec §10.1). Espejo de packages/database/src/migrations/0012_advisor.sql:
 * la migración manda; este archivo sirve para tipos y consultas.
 */
export const advisorRuns = pgTable(
  'advisor_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id),
    userSub: text('user_sub').notNull(),
    userEmail: text('user_email'),
    conversationId: uuid('conversation_id').references(() => chatConversations.id),
    question: text('question').notNull(),
    camino: smallint('camino').notNull(),
    forced: text('forced'),
    status: text('status').notNull(),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    knowledgeVersion: jsonb('knowledge_version').notNull().$type<{ manual: string; legal: string; templates: string }>(),
    triageJson: jsonb('triage_json'),
    factSheetJson: jsonb('fact_sheet_json'),
    deliberacionJson: jsonb('deliberacion_json').notNull().default({}),
    memoJson: jsonb('memo_json'),
    redLineHits: jsonb('red_line_hits').notNull().default([]),
    citationsTotal: integer('citations_total'),
    citationsInvalid: integer('citations_invalid'),
    choice: text('choice'),
    choiceNote: text('choice_note'),
    chosenAt: timestamp('chosen_at', { withTimezone: true }),
    usageJson: jsonb('usage_json').notNull().default({}),
    costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
    durationMs: integer('duration_ms'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_advisor_runs_agency_created').on(t.agencyId, t.createdAt.desc()),
  ],
);

export const advisorEvents = pgTable(
  'advisor_events',
  {
    runId: uuid('run_id').notNull().references(() => advisorRuns.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.seq] })],
);

export const advisorToolCalls = pgTable('advisor_tool_calls', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  runId: uuid('run_id').references(() => advisorRuns.id, { onDelete: 'cascade' }),
  turn: smallint('turn'),
  tool: text('tool').notNull(),
  args: jsonb('args').notNull(),
  ok: boolean('ok').notNull(),
  resultTokens: integer('result_tokens'),
  latencyMs: integer('latency_ms'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const advisorForecasts = pgTable('advisor_forecasts', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').references(() => advisorRuns.id),
  agencyId: uuid('agency_id').notNull().references(() => agencies.id),
  author: text('author').notNull(),
  camino: text('camino').notNull(),
  metric: text('metric').notNull(),
  horizonH: smallint('horizon_h').notNull(),
  resolutionRule: text('resolution_rule').notNull(),
  rangeMin: numeric('range_min'),
  rangeMax: numeric('range_max'),
  probability: numeric('probability'),
  referenceRate: numeric('reference_rate'),
  visible: boolean('visible').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  observed: numeric('observed'),
  inRange: boolean('in_range'),
  brier: numeric('brier'),
  supersedes: uuid('supersedes'),
});

export const advisorLegalCalendar = pgTable('advisor_legal_calendar', {
  id: serial('id').primaryKey(),
  kind: text('kind').notNull(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on'),
  reference: text('reference'),
  municipalities: text('municipalities').array(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
