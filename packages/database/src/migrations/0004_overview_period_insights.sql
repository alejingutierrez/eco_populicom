-- Insights por periodo del Overview (espejo del correo diario).
-- Generados por lambda eco-ai-tasks acción "period-insights", servidos por
-- /api/eco-insights con cache-or-202 semantics.

CREATE TABLE IF NOT EXISTS overview_period_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  period_start_date date NOT NULL,
  period_end_date date NOT NULL,
  negative_insights jsonb NOT NULL DEFAULT '[]'::jsonb,
  neutral_insights jsonb NOT NULL DEFAULT '[]'::jsonb,
  positive_insights jsonb NOT NULL DEFAULT '[]'::jsonb,
  daily_summary text,
  model_used text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_overview_period_insights_agency_range UNIQUE (agency_id, period_start_date, period_end_date)
);

CREATE INDEX IF NOT EXISTS idx_overview_period_insights_recent
  ON overview_period_insights (agency_id, period_end_date);
