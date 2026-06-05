import { pgTable, uuid, varchar, boolean, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { agencies } from './agencies';

export const userRoleEnum = pgEnum('user_role', ['admin', 'analyst', 'viewer']);

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
  isActive: boolean('is_active').notNull().default(true),
  lastLogin: timestamp('last_login', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
