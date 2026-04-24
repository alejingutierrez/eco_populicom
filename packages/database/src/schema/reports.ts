import { pgTable, uuid, varchar, text, boolean, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { agencies } from './agencies';
import { users } from './users';

/**
 * report_configs — configuración por agencia del envío automático del reporte
 * semanal. Una fila por agencia. La Lambda eco-weekly-report corre cada hora
 * (EventBridge), itera las configs activas, y envía solo cuando la hora local
 * actual (según `timezone`) coincide con `sendHourLocal`.
 */
export const reportConfigs = pgTable(
  'report_configs',
  {
    agencyId: uuid('agency_id').primaryKey().references(() => agencies.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active').notNull().default(true),
    /** Hora local (0–23) en la que se dispara el envío. Minuto siempre = 0. */
    sendHourLocal: integer('send_hour_local').notNull().default(16),
    /** IANA timezone, default America/Bogota. */
    timezone: varchar('timezone', { length: 64 }).notNull().default('America/Bogota'),
    /** Clave del template. Por ahora solo "weekly-sentiment-summary". */
    templateKey: varchar('template_key', { length: 64 }).notNull().default('weekly-sentiment-summary'),
    recipients: jsonb('recipients').notNull().$type<string[]>().default([]),
    fromEmail: varchar('from_email', { length: 255 }).notNull().default('agutierrez@populicom.com'),
    fromName: varchar('from_name', { length: 255 }).notNull().default('Populicom Radar'),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_report_configs_active').on(t.isActive)],
);

/**
 * report_send_log — histórico de envíos (éxitos y fallos) del reporte
 * automático. Alimenta la tabla del dashboard admin.
 */
export const reportSendLog = pgTable(
  'report_send_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id, { onDelete: 'cascade' }),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    recipients: jsonb('recipients').notNull().$type<string[]>(),
    fromEmail: varchar('from_email', { length: 255 }).notNull(),
    templateKey: varchar('template_key', { length: 64 }).notNull(),
    /** "scheduled" (EventBridge) · "manual" (UI admin) · "test" (dryRun) */
    trigger: varchar('trigger', { length: 32 }).notNull(),
    /** "sent" · "skipped" (fuera de hora) · "failed" · "no_recipients" · "no_data" */
    status: varchar('status', { length: 32 }).notNull(),
    messageId: varchar('message_id', { length: 255 }),
    error: text('error'),
    /** Totales del reporte enviado (útil para la lista histórica). */
    stats: jsonb('stats').$type<{ negative: number; neutral: number; positive: number; total: number }>(),
    triggeredBy: uuid('triggered_by').references(() => users.id),
  },
  (t) => [
    index('idx_report_send_log_agency_id').on(t.agencyId),
    index('idx_report_send_log_sent_at').on(t.sentAt),
  ],
);
