-- Cache de insights por métrica sintética (crisis, polarization, nss, bhi,
-- volume) por (agency, metric, period). Generados por lambda eco-ai-tasks
-- acción "metric-insight", servidos por /api/eco-metric-insight.

CREATE TABLE IF NOT EXISTS metric_insights_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  metric varchar(24) NOT NULL,
  period_start_date date NOT NULL,
  period_end_date date NOT NULL,
  insight_text text NOT NULL,
  model_used text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_metric_insights_agency_metric_range
    UNIQUE (agency_id, metric, period_start_date, period_end_date)
);

CREATE INDEX IF NOT EXISTS idx_metric_insights_recent
  ON metric_insights_cache (agency_id, metric, period_end_date);
