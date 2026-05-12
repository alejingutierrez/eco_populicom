-- Migración 0003: 3 modos de briefing en agency_briefings.
--
-- Antes: una fila por agencia cada 6h con la narrativa única "Señal del día".
-- Después: tres filas por corrida (mode = 'signal' | 'emerging' | 'crisis')
-- para alimentar los 3 chips del Resumen ejecutivo del Scorecard.
--
-- Las filas históricas (sin mode) quedan como 'signal' (lo que eran de facto).
-- Idempotente: IF NOT EXISTS en columna e índice.

ALTER TABLE "agency_briefings"
  ADD COLUMN IF NOT EXISTS "mode" VARCHAR(10) NOT NULL DEFAULT 'signal';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agency_briefings_mode"
  ON "agency_briefings"("agency_id", "mode", "generated_at" DESC);
