-- Migración 0007: extiende `mentions` para soportar imports manuales.
--
-- Cambios:
--   • bw_resource_id, bw_query_id pasan a NULLable (Excel/URL no traen
--     resourceId de Brandwatch ni queryId)
--   • Drop UNIQUE constraint en bw_resource_id, reemplazado por índice
--     parcial UNIQUE WHERE bw_resource_id IS NOT NULL (permite múltiples
--     NULLs sin colisión)
--   • Nuevas columnas:
--       url_canonical    — llave de dedup compartida entre Brandwatch y manual
--       ingestion_source — 'brandwatch' (default) | 'manual_excel' | 'manual_url'
--       source_import_id — FK a mention_imports.id (nullable)
--   • Índice parcial UNIQUE (agency_id, url_canonical) WHERE url_canonical
--     IS NOT NULL para que ON CONFLICT pueda hacer upsert.
--
-- IMPORTANTE: el backfill de url_canonical para los ~100k rows existentes
-- corre via action 'backfill-url-canonical' del lambda eco-migration (no en
-- este DDL, porque la canonicalización vive en JS/TS, no en SQL).
--
-- Idempotente: cada ALTER chequea estado antes de ejecutar.

ALTER TABLE "mentions" ALTER COLUMN "bw_resource_id" DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE "mentions" ALTER COLUMN "bw_query_id" DROP NOT NULL;
--> statement-breakpoint

-- El constraint Drizzle se llamó mentions_bw_resource_id_unique. Lo dropeamos
-- (si existe) y lo reemplazamos por un índice parcial UNIQUE que respeta
-- NULLs múltiples.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'mentions_bw_resource_id_unique'
      AND table_name = 'mentions'
  ) THEN
    ALTER TABLE "mentions" DROP CONSTRAINT "mentions_bw_resource_id_unique";
  END IF;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "mentions_bw_resource_id_partial_unique"
  ON "mentions" ("bw_resource_id")
  WHERE "bw_resource_id" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "mentions" ADD COLUMN IF NOT EXISTS "url_canonical" varchar(1000);
--> statement-breakpoint

ALTER TABLE "mentions" ADD COLUMN IF NOT EXISTS "ingestion_source" varchar(20) NOT NULL DEFAULT 'brandwatch';
--> statement-breakpoint

ALTER TABLE "mentions" ADD COLUMN IF NOT EXISTS "source_import_id" uuid;
--> statement-breakpoint

-- FK condicional (no se añade si ya existe). Sin ON DELETE CASCADE: si se
-- borra un import, las mentions quedan huérfanas pero conservadas — el
-- contenido es lo importante, el linkback es metadata.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'mentions_source_import_id_fkey'
      AND table_name = 'mentions'
  ) THEN
    ALTER TABLE "mentions"
      ADD CONSTRAINT "mentions_source_import_id_fkey"
      FOREIGN KEY ("source_import_id") REFERENCES "mention_imports"("id")
      ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_mentions_url_canonical"
  ON "mentions" ("url_canonical");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_mentions_source_import_id"
  ON "mentions" ("source_import_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_mentions_ingestion_source"
  ON "mentions" ("ingestion_source");
--> statement-breakpoint

-- Dedup canónica: una mención por (agencia, URL canonicalizada). El processor
-- usa este target en ON CONFLICT ... DO UPDATE para upserts seguros contra
-- race conditions cuando un commit envía rows en paralelo via SQS.
CREATE UNIQUE INDEX IF NOT EXISTS "mentions_url_canonical_agency_unique"
  ON "mentions" ("agency_id", "url_canonical")
  WHERE "url_canonical" IS NOT NULL;
