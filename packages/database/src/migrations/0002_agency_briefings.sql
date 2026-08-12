-- Migración 0002: tabla agency_briefings para resúmenes ejecutivos IA del Scorecard.
--
-- Genera el lambda eco-ai-tasks (acción "briefing") cada 6h por agencia activa.
-- /api/eco-data lee el más reciente; si > 12h sin generar, cae a un resumen
-- de reglas determinístico para no dejar la UI en blanco.

CREATE TABLE IF NOT EXISTS "agency_briefings" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id"       UUID NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "generated_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "period_hours"    INTEGER NOT NULL DEFAULT 24,
  "narrative_html"  TEXT NOT NULL,
  "dominant_signal" TEXT NOT NULL,
  "action_label"    TEXT NOT NULL,
  "action_tone"     VARCHAR(10) NOT NULL,
  "reach_label"     TEXT,
  "model_used"      TEXT NOT NULL,
  "source_mentions" INTEGER NOT NULL,
  "fallback"        BOOLEAN NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agency_briefings_recent"
  ON "agency_briefings"("agency_id", "generated_at" DESC);
