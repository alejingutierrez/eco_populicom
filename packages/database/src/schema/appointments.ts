import { pgTable, uuid, varchar, text, date, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { agencies } from './agencies';
import { users } from './users';

/**
 * agency_appointments — nombramientos registrados en las agencias monitoreadas.
 *
 * Es la FUENTE DE VERDAD del correo "[Nombramiento]": el lambda eco-weekly-report,
 * en su barrido horario, busca filas con `notifiedAt IS NULL` y `coverageStart`
 * ya alcanzado, envía el correo y estampa `notifiedAt` para no repetirlo.
 *
 * Por qué una tabla y no detección automática por NLP: un nombramiento es un
 * hecho verificable con fecha, no una inferencia. Detectarlo por texto daría
 * falsos positivos (rumores, "suena para el cargo", nombramientos de otras
 * jurisdicciones) y un correo de este tipo no puede equivocarse. El alta la
 * hace el analista; el disparo y el contenido son automáticos.
 */
export const agencyAppointments = pgTable(
  'agency_appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id, { onDelete: 'cascade' }),
    /** Nombre de la persona nombrada, como la nombra la prensa. */
    personName: varchar('person_name', { length: 255 }).notNull(),
    /** Cargo que asume, p.ej. "Secretaria de la Gobernación". */
    position: varchar('position', { length: 255 }).notNull(),
    /** A quién sustituye (opcional). */
    predecessor: varchar('predecessor', { length: 255 }),
    /** Fecha del nombramiento — el HECHO. Se muestra en la ficha del correo. */
    announcedOn: date('announced_on').notNull(),
    /**
     * Primer día del resumen. Normalmente = announcedOn, pero se separa para
     * poder incluir el arranque de la conversación cuando el hecho se venía
     * cocinando antes del anuncio formal (caso Burgos: la salida del
     * predecesor movió la conversación el fin de semana previo).
     */
    coverageStart: date('coverage_start').notNull(),
    /**
     * Destinatarios de ESTE correo. NULL = se resuelven en el envío desde los
     * usuarios ECO activos, así que los usuarios nuevos entran sin tocar nada.
     */
    recipients: jsonb('recipients').$type<string[]>(),
    /** Variantes de nombre añadidas al boolean de Brandwatch (traza de por qué el dato existe). */
    queryTerms: jsonb('query_terms').$type<string[]>(),
    /** Contexto libre que registra el analista; se muestra en la ficha y va al prompt. */
    notes: text('notes'),
    /**
     * Retrato de la persona para la ficha del correo. Debe ser una URL ESTABLE
     * servida por nosotros (`{dashboard}/appointments/<slug>.jpg`): las og:image
     * de los medios de PR llevan token firmado (`?auth=…`) que expira y dejaría
     * el correo con la imagen rota. NULL ⇒ se dibuja un monograma de iniciales.
     */
    photoUrl: text('photo_url'),
    /** NULL = pendiente de envío. Estampado tras el envío para no repetirlo. */
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (t) => [
    index('idx_agency_appointments_agency_id').on(t.agencyId),
    index('idx_agency_appointments_pending').on(t.notifiedAt),
  ],
);
