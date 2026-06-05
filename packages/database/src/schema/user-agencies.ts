import { pgTable, uuid, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { users } from './users';
import { agencies } from './agencies';

/**
 * Agencias que un usuario puede ver, además de su agencia primaria
 * (`users.agencyId`). Relación N:N.
 *
 * El switch de agencias del dashboard muestra solo este conjunto (∪ la
 * primaria), y `resolveAgencyId` valida el `?agency=` contra él. Para staff de
 * Populicom que debe ver TODAS las agencias (presentes y futuras) usar el flag
 * `users.allAgencies` en lugar de listar cada una aquí.
 */
export const userAgencies = pgTable(
  'user_agencies',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agencyId: uuid('agency_id')
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.agencyId] }),
  }),
);
