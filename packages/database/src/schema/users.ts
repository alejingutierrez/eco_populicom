import { pgTable, uuid, varchar, boolean, timestamp, pgEnum, jsonb } from 'drizzle-orm/pg-core';
import { agencies } from './agencies';

// Tiers (de más a menos privilegio): admin > editor > analyst > viewer.
// 'editor' puede gestionar plantillas de correo y reglas de alerta pero NO
// usuarios; analyst/viewer son de lectura. La autorización de la app lee este
// rol de la DB (fuente de verdad), no los grupos de Cognito (ver requireRole).
export const userRoleEnum = pgEnum('user_role', ['admin', 'editor', 'analyst', 'viewer']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  cognitoSub: varchar('cognito_sub', { length: 255 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }),
  role: userRoleEnum('role').notNull(),
  agencyId: uuid('agency_id').notNull().references(() => agencies.id),
  // Staff que puede ver TODAS las agencias activas (presentes y futuras) sin
  // listarlas en user_agencies. Para clientes externos déjalo en false y
  // asigna agencias explícitas en user_agencies.
  allAgencies: boolean('all_agencies').notNull().default(false),
  // Visibilidad de páginas por usuario (array de claves de nav). NULL = todas
  // las páginas que el rol permita (sin override por-usuario). El admin puede
  // restringir páginas a un usuario concreto desde Configuración.
  allowedPages: jsonb('allowed_pages').$type<string[]>(),
  isActive: boolean('is_active').notNull().default(true),
  lastLogin: timestamp('last_login', { withTimezone: true }),
  /**
   * Correo de BIENVENIDA (el que llega al activar la cuenta, no la invitación).
   * NULL = todavía no se le ha mandado. Se estampa al RECLAMARLO —antes de
   * llamar a SES— para que dos peticiones simultáneas no manden dos correos; si
   * el envío falla se vuelve a poner en NULL y se reintenta en el próximo
   * ingreso. La migración 0007 lo estampó para todas las filas que ya existían:
   * el automatismo solo alcanza a quien se cree de ahí en adelante.
   */
  welcomeEmailSentAt: timestamp('welcome_email_sent_at', { withTimezone: true }),
  /**
   * Recibe el reporte SEMANAL aunque no esté en `report_configs.recipients`.
   * Existe porque esa lista es UNA sola para el diario y el semanal: a quien
   * solo debe recibir el de los viernes se le monta una regla EventBridge
   * dirigida, invisible para la app. Esta columna deja constancia en la DB de
   * esa suscripción fuera de banda — el correo de bienvenida la lee para no
   * prometer de más ni de menos. NO dispara el envío: la regla sigue siendo la
   * que manda.
   */
  weeklyReportOptin: boolean('weekly_report_optin').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
