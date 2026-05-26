-- Migración 0006: tabla `mention_imports` — registros de imports manuales
-- (Excel y URL) que el admin sube desde /admin/mentions/import.
--
-- Cada row representa un import batch:
--   • sourceType='excel': admin subió un .xlsx, s3Key apunta al archivo
--   • sourceType='url'  : admin pegó una URL, sourceUrl la guarda
--
-- El lambda eco-import-preview parsea + dedupea y popula preview_json.
-- El endpoint /commit despacha mensajes SQS al ingestion queue.
-- El processor (que ya consume ese queue) inserta las mentions y actualiza
-- rows_processed por cada commit exitoso.
--
-- Idempotente: IF NOT EXISTS en tabla e índices.

CREATE TABLE IF NOT EXISTS "mention_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "uploaded_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "source_type" varchar(20) NOT NULL,
  "s3_key" text,
  "source_url" text,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "total_rows" integer,
  "rows_new" integer DEFAULT 0,
  "rows_duplicate" integer DEFAULT 0,
  "rows_update" integer DEFAULT 0,
  "rows_error" integer DEFAULT 0,
  "rows_processed" integer DEFAULT 0,
  "preview_json" jsonb,
  "errors_json" jsonb,
  "error_message" text,
  "default_timezone" varchar(50) DEFAULT 'America/Puerto_Rico',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "committed_at" timestamp with time zone,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_mention_imports_agency_id"
  ON "mention_imports" ("agency_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_mention_imports_status"
  ON "mention_imports" ("status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_mention_imports_created_at"
  ON "mention_imports" ("created_at" DESC);
