import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, index, date, real, integer } from 'drizzle-orm/pg-core';
import { agencies } from './agencies';
import { users } from './users';
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

/**
 * Episodio de crisis (COR-02): del primer aviso de una regla al día en que el
 * índice vuelve bajo el umbral. Lo escribe `eco-metrics-calculator`, que
 * también crea la tabla (CREATE TABLE IF NOT EXISTS en `ensureCrisisSchema`).
 * Un solo episodio abierto por regla (índice único parcial en la base).
 */
export interface CrisisEpisodeStoredValues {
  day: string;
  score: number | null;
  severity: number | null;
  totalMentions: number;
  negativeCount: number;
}

export const crisisEpisodes = pgTable(
  'crisis_episodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    alertRuleId: uuid('alert_rule_id').notNull().references(() => alertRules.id, { onDelete: 'cascade' }),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id, { onDelete: 'cascade' }),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    openedDay: date('opened_day').notNull(),
    firstValues: jsonb('first_values').notNull().$type<CrisisEpisodeStoredValues>(),
    firstHeadline: text('first_headline'),
    lastAlertAt: timestamp('last_alert_at', { withTimezone: true }).notNull().defaultNow(),
    lastAlertDay: date('last_alert_day').notNull(),
    lastValues: jsonb('last_values').notNull().$type<CrisisEpisodeStoredValues>(),
    peakScore: real('peak_score').notNull(),
    peakDay: date('peak_day').notNull(),
    alertsSent: integer('alerts_sent').notNull().default(1),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedDay: date('closed_day'),
    closeValues: jsonb('close_values').$type<CrisisEpisodeStoredValues>(),
    closeNotified: boolean('close_notified'),
    closeDetails: jsonb('close_details'),
  },
  (t) => [index('idx_crisis_episodes_agency').on(t.agencyId, t.openedAt)],
);
