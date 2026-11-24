-- 0015 — COR-02: episodios de crisis (nov-2026).
--
-- Qué añade (aditivo; ninguna fila existente cambia):
--   crisis_episodes   un episodio por regla de crisis: del primer aviso al día
--                     en que el índice vuelve bajo el umbral. Guarda las
--                     cifras del primer aviso y del último, la lectura más
--                     alta, cuántos avisos salieron y el cierre.
--
-- Para qué: el reaviso dice desde cuándo está abierto el episodio y qué cambió
-- desde el aviso anterior, y al cerrarse sale un correo de cierre.
--
-- Este archivo es el REGISTRO, no el mecanismo: la tabla la crea el propio
-- lambda eco-metrics-calculator en su primer arranque tras el despliegue
-- (`ensureCrisisSchema`, CREATE TABLE IF NOT EXISTS). Idempotente.
--
-- Rollback: fix-forward; la tabla es independiente (el código anterior no la
-- lee ni la escribe). DROP TABLE crisis_episodes si se quisiera deshacer.

CREATE TABLE IF NOT EXISTS crisis_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_day DATE NOT NULL,
  first_values JSONB NOT NULL,
  first_headline TEXT,
  last_alert_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_alert_day DATE NOT NULL,
  last_values JSONB NOT NULL,
  peak_score REAL NOT NULL,
  peak_day DATE NOT NULL,
  alerts_sent INTEGER NOT NULL DEFAULT 1,
  closed_at TIMESTAMPTZ,
  closed_day DATE,
  close_values JSONB,
  close_notified BOOLEAN,
  close_details JSONB
);

-- Un solo episodio abierto por regla.
CREATE UNIQUE INDEX IF NOT EXISTS uq_crisis_episodes_open
  ON crisis_episodes(alert_rule_id) WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_crisis_episodes_agency
  ON crisis_episodes(agency_id, opened_at DESC);
