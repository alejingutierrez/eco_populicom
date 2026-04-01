import { pgTable, serial, varchar, text, integer, boolean, unique } from 'drizzle-orm/pg-core';

export const topics = pgTable('topics', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  description: text('description'),
  displayOrder: integer('display_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
});

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
