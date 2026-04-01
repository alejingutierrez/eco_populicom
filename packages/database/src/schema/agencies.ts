import { pgTable, uuid, varchar, bigint, jsonb, boolean, timestamp } from 'drizzle-orm/pg-core';

export const agencies = pgTable('agencies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  brandwatchProjectId: bigint('brandwatch_project_id', { mode: 'number' }),
  brandwatchQueryIds: jsonb('brandwatch_query_ids').$type<number[]>(),
  logoUrl: varchar('logo_url', { length: 500 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});
