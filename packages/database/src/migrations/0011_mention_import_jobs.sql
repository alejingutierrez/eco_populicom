-- 0011 — mention_import_jobs: importaciones de exportes desde Configuración →
-- Importar menciones (oct-2026).
--
-- Una fila por archivo subido. La crea y la avanza eco-mention-import
-- (preview → enqueuing → processing → metrics → done | failed | discarded);
-- el web solo la lee para mostrar el avance. El lambda ejecuta este mismo DDL
-- en cada arranque (ensureSchema), así que este archivo es el registro, no el
-- mecanismo: eco-migration no acepta DDL.
--
-- No se llama `mention_imports` porque en prod ya existe una tabla con ese
-- nombre y otro esquema: la dejó un intento de mayo-2026 («import manual de
-- menciones», commit 0b50fd1, nunca mergeado a main; 30 filas de pruebas del
-- 25/26-may). No la usa nada en main.
CREATE TABLE IF NOT EXISTS mention_import_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id    uuid NOT NULL REFERENCES agencies(id),
  agency_slug  text NOT NULL,
  source       text NOT NULL DEFAULT 'bunker',
  file_name    text NOT NULL,
  s3_key       text NOT NULL,          -- s3://eco-raw-…/bunker/<slug>/<fecha>/…; el plan va en <s3_key>.plan.jsonl
  uploaded_by  text,
  status       text NOT NULL,
  summary      jsonb,                  -- filas, nuevas, ya cargadas, repetidas, por día y por red
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- avance de cada fase
  total        integer NOT NULL DEFAULT 0,
  enqueued     integer NOT NULL DEFAULT 0,
  processed    integer NOT NULL DEFAULT 0,
  date_from    timestamptz,
  date_to      timestamptz,
  error        text,
  lease_until  timestamptz,            -- arriendo: una sola invocación trabaja cada importación
  created_at   timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX IF NOT EXISTS mention_import_jobs_agency_created_idx ON mention_import_jobs (agency_id, created_at DESC);
