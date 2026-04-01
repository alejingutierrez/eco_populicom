import { pgTable, uuid, integer, doublePrecision, varchar, primaryKey } from 'drizzle-orm/pg-core';
import { mentions } from './mentions.js';
import { topics, subtopics } from './topics.js';
import { municipalities } from './municipalities.js';

export const mentionTopics = pgTable(
  'mention_topics',
  {
    mentionId: uuid('mention_id').notNull().references(() => mentions.id, { onDelete: 'cascade' }),
    topicId: integer('topic_id').notNull().references(() => topics.id),
    subtopicId: integer('subtopic_id').references(() => subtopics.id),
    confidence: doublePrecision('confidence').notNull(),
  },
  (t) => [primaryKey({ columns: [t.mentionId, t.topicId] })],
);

export const mentionMunicipalities = pgTable(
  'mention_municipalities',
  {
    mentionId: uuid('mention_id').notNull().references(() => mentions.id, { onDelete: 'cascade' }),
    municipalityId: integer('municipality_id').notNull().references(() => municipalities.id),
    source: varchar('source', { length: 20 }).notNull(), // 'brandwatch' | 'nlp'
  },
  (t) => [primaryKey({ columns: [t.mentionId, t.municipalityId] })],
);
