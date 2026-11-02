-- 0012 — Asesor de crisis (spec §10.1). Idempotente: lo aplica también
-- ensureAdvisorSchema() en apps/web/src/lib/advisor/store.ts.
--
-- Nota: el spec nombra este archivo 0011_advisor.sql, pero 0011 ya existe en main
-- (0011_mention_import_jobs.sql). Desviación documentada en
-- docs/manejo-de-crisis/investigacion/13-prueba-de-humo.md.
-- agency_id es uuid (agencies.id es uuid), no integer como dice el spec.

CREATE TABLE IF NOT EXISTS advisor_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id         uuid NOT NULL REFERENCES agencies(id),
  user_sub          text NOT NULL,
  user_email        text,
  conversation_id   uuid REFERENCES chat_conversations(id),
  question          text NOT NULL,
  camino            smallint NOT NULL CHECK (camino IN (1,2,3)),
  forced            text,                          -- 'council' | 'quick' | null
  status            text NOT NULL,                 -- queued|r0_running|rounds_queued|running|done|error|error_budget|error_interrupted|cancelled
  cancel_requested  boolean NOT NULL DEFAULT false,
  as_of             timestamptz NOT NULL,
  knowledge_version jsonb NOT NULL,                -- {manual, legal, templates} hashes
  triage_json       jsonb,
  fact_sheet_json   jsonb,
  deliberacion_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  memo_json         jsonb,
  red_line_hits     jsonb NOT NULL DEFAULT '[]'::jsonb,
  citations_total   integer,
  citations_invalid integer,
  choice            text,
  choice_note       text,
  chosen_at         timestamptz,
  usage_json        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- por llamada: modelo devuelto, stop_reason, tokens x4, ms
  cost_usd          numeric(10,4) NOT NULL DEFAULT 0,
  duration_ms       integer,
  error_code        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_advisor_runs_agency_created ON advisor_runs(agency_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_advisor_runs_status ON advisor_runs(status) WHERE status NOT IN ('done','cancelled');

CREATE TABLE IF NOT EXISTS advisor_events (
  run_id     uuid NOT NULL REFERENCES advisor_runs(id) ON DELETE CASCADE,
  seq        integer NOT NULL,
  type       text NOT NULL,
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE IF NOT EXISTS advisor_tool_calls (
  id          bigserial PRIMARY KEY,
  run_id      uuid REFERENCES advisor_runs(id) ON DELETE CASCADE,
  turn        smallint,
  tool        text NOT NULL,
  args        jsonb NOT NULL,
  ok          boolean NOT NULL,
  result_tokens integer,
  latency_ms  integer,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Ledger inmutable (fase 3). Se crea ahora para que el esquema sea uno solo.
CREATE TABLE IF NOT EXISTS advisor_forecasts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid REFERENCES advisor_runs(id),
  agency_id       uuid NOT NULL REFERENCES agencies(id),
  author          text NOT NULL,      -- asiento | moderador | linea_base | modelo_estadistico
  camino          text NOT NULL,      -- A | B | base
  metric          text NOT NULL,      -- crisis_index | nss | neg_velocity | polarization | frame_adoption
  horizon_h       smallint NOT NULL CHECK (horizon_h IN (24,48,72)),
  resolution_rule text NOT NULL,
  range_min       numeric, range_max numeric, probability numeric,
  reference_rate  numeric,
  visible         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz, observed numeric, in_range boolean, brier numeric,
  supersedes      uuid REFERENCES advisor_forecasts(id)
);

CREATE TABLE IF NOT EXISTS advisor_legal_calendar (
  id            serial PRIMARY KEY,
  kind          text NOT NULL,                  -- 'veda' | 'emergencia'
  starts_on     date NOT NULL,
  ends_on       date,
  reference     text,                           -- número de proclama u orden
  municipalities text[],                        -- null = toda la isla
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
