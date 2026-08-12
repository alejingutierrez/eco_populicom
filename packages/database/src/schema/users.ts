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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
