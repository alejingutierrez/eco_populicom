import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { agencies } from './agencies.js';
import { users } from './users.js';
import type { AlertConfig } from '@eco/shared';

export const alertRules = pgTable(
  'alert_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    config: jsonb('config').notNull().$type<AlertConfig>(),
    notifyEmails: jsonb('notify_emails').notNull().$type<string[]>(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [index('idx_alert_rules_agency_id').on(t.agencyId)],
);

export const alertHistory = pgTable(
  'alert_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    alertRuleId: uuid('alert_rule_id').notNull().references(() => alertRules.id),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id),
    triggeredAt: timestamp('triggered_at', { withTimezone: true }).notNull(),
    mentionIds: jsonb('mention_ids').$type<string[]>(),
    details: jsonb('details'),
    notificationSent: boolean('notification_sent').notNull().default(false),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [index('idx_alert_history_agency_id').on(t.agencyId)],
);
