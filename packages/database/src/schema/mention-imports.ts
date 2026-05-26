import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import type { ManualMentionInput } from '@eco/shared';
import { agencies } from './agencies';
import { users } from './users';

export type { ManualMentionInput } from '@eco/shared';

// Estados del lifecycle de un import. La columna es VARCHAR (no enum) para
// permitir añadir estados sin migration. Valores válidos:
//   pending       → row creada, lambda preview aún no corre
//   parsing       → preview lambda en ejecución
//   preview_ready → preview_json poblado, admin puede confirmar
//   committing    → admin confirmó, mensajes despachados a SQS
//   completed     → todas las rows procesadas por eco-processor
//   failed        → error en parsing o exceso de filas (>500)
export type MentionImportStatus =
  | 'pending'
  | 'parsing'
  | 'preview_ready'
  | 'committing'
  | 'completed'
  | 'failed';

// Una fila del preview (almacenada en preview_json). Las filas con status
// 'duplicate' no se envían a SQS; las 'update' usan UPSERT en el processor;
// las 'new' insertan; las 'error' quedan en errors_json.
export interface ImportPreviewRow {
  rowIndex: number;
  status: 'new' | 'duplicate' | 'update' | 'error';
  urlCanonical?: string;
  errorMessage?: string;
  conflictMentionId?: string;
  fieldsToFill?: string[]; // columnas que el upsert completará
  mention?: ManualMentionInput; // shape común con el processor
}

export interface ImportErrorRow {
  rowIndex: number;
  errorMessage: string;
  raw?: Record<string, unknown>;
}

export const mentionImports = pgTable(
  'mention_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id),

    // 'excel' (upload de archivo) | 'url' (scraping de un link)
    sourceType: varchar('source_type', { length: 20 }).notNull(),

    // Para sourceType='excel': s3 key relativa al bucket de exports.
    s3Key: text('s3_key'),
    // Para sourceType='url': la URL que el admin pegó (sin canonicalizar).
    sourceUrl: text('source_url'),

    status: varchar('status', { length: 20 }).notNull().default('pending').$type<MentionImportStatus>(),

    totalRows: integer('total_rows'),
    rowsNew: integer('rows_new').default(0),
    rowsDuplicate: integer('rows_duplicate').default(0),
    rowsUpdate: integer('rows_update').default(0),
    rowsError: integer('rows_error').default(0),
    // Incrementado por el processor cada vez que termina de procesar una row
    // de este import. Usado para progress polling.
    rowsProcessed: integer('rows_processed').default(0),

    previewJson: jsonb('preview_json').$type<ImportPreviewRow[]>(),
    errorsJson: jsonb('errors_json').$type<ImportErrorRow[]>(),
    errorMessage: text('error_message'),

    // TZ usada para parsear DATE+TIME del Excel cuando vienen sin offset.
    defaultTimezone: varchar('default_timezone', { length: 50 }).default('America/Puerto_Rico'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_mention_imports_agency_id').on(t.agencyId),
    index('idx_mention_imports_status').on(t.status),
    index('idx_mention_imports_created_at').on(t.createdAt),
  ],
);
