-- 0014 — Interpretación v1, WP-6: composiciones guardadas del motor (nov-2026).
--
-- Spec:  docs/tecnica/spec-interpretacion-eco-v1.md (10.5, 11.1)
-- Plan:  docs/tecnica/plan-implementacion-interpretacion-eco-v1.md (WP-6)
--
-- Qué añade (aditivo; ninguna fila existente cambia):
--   report_compositions   tabla nueva: una composición del motor de redacción
--                         por (agencia, tipo de correo, fin de periodo).
--
-- Para qué: con report_configs.composer_mode distinto de 'legacy', el lambda
-- eco-weekly-report compone el diario 2 h antes del envío (acción `compose`,
-- invocada en asíncrono por el barrido horario) y lo guarda aquí; el envío de
-- la hora configurada lo lee. Si la fila falta, el envío compone en el momento
-- (si le queda tiempo) o manda el texto legacy. Con TODAS las agencias en
-- 'legacy' (estado actual) esta tabla no se lee ni se escribe.
--
-- Este archivo es el REGISTRO, no el mecanismo: se aplica con la acción de
-- eco-migration descrita en docs/tecnica/migration-0014-actions.md.
-- Idempotente (IF NOT EXISTS).
--
-- ORDEN: aplicar antes de pasar cualquier agencia a 'shadow' o 'agentic'. El
-- código de WP-6 tolera la tabla ausente (no guarda, no lee, sigue enviando),
-- pero sin ella no hay composición anticipada.
--
-- Rollback: fix-forward; la tabla es independiente (DROP TABLE si se quisiera
-- deshacer, sin efecto sobre ninguna otra tabla).

SET lock_timeout = '5s';

-- FK a agencies (como report_send_log): la crea con SHARE ROW EXCLUSIVE sobre
-- agencies (tabla de 5 filas), un instante. Sin FK a mentions.
-- report_type sin CHECK (igual que composer_mode en 0013): el tipo lo impone
-- TypeScript (ReportCompositionType).
CREATE TABLE IF NOT EXISTS report_compositions (
  agency_id        uuid         NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  report_type      varchar(10)  NOT NULL,
  period_end       date         NOT NULL,
  composer_version varchar(24)  NOT NULL,
  composition      jsonb        NOT NULL,
  status           varchar(16)  NOT NULL,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT report_compositions_pk PRIMARY KEY (agency_id, report_type, period_end)
);
-- La PK es también el índice de la única búsqueda (agencia + tipo + periodo).
