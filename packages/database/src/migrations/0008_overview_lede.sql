-- Lede del Overview con la forma del correo diario: titular, viñetas, rótulos
-- de los días pico de la tendencia y foto de portada (copia propia en /media).
-- Lo escribe eco-ai-tasks acción period-insights y lo lee /api/eco-insights.
-- El lambda aplica el mismo ALTER como self-heal (ensureOverviewPeriodInsightsSchema).
ALTER TABLE overview_period_insights ADD COLUMN IF NOT EXISTS lede JSONB;
