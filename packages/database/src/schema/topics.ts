import { pgTable, serial, varchar, text, integer, boolean, uuid, unique } from 'drizzle-orm/pg-core';
import { agencies } from './agencies';

export const topics = pgTable(
  'topics',
  {
    id: serial('id').primaryKey(),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    description: text('description'),
    displayOrder: integer('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [unique('uq_topic_agency_slug').on(t.agencyId, t.slug)],
);

export const subtopics = pgTable(
  'subtopics',
  {
    id: serial('id').primaryKey(),
    topicId: integer('topic_id').notNull().references(() => topics.id),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    description: text('description'),
    displayOrder: integer('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [unique('uq_subtopic_topic_slug').on(t.topicId, t.slug)],
);
