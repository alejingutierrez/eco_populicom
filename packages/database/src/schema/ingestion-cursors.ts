import { pgTable, bigint, timestamp, integer, varchar } from 'drizzle-orm/pg-core';

export const ingestionCursors = pgTable('ingestion_cursors', {
  queryId: bigint('query_id', { mode: 'number' }).primaryKey(),
  lastMentionDate: timestamp('last_mention_date', { withTimezone: true }).notNull(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }).notNull(),
  mentionsFetched: integer('mentions_fetched').notNull().default(0),
  status: varchar('status', { length: 20 }).notNull().default('idle'),
});
