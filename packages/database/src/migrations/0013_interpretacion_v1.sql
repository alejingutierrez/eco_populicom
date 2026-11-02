-- 0013 — Interpretación v1: esquema de datos (nov-2026).
--
-- Spec:  docs/tecnica/spec-interpretacion-eco-v1.md (5.1, 5.2, 12.1)
-- Plan:  docs/tecnica/plan-implementacion-interpretacion-eco-v1.md (WP-1)
--
-- Qué añade (todo aditivo; ninguna fila se modifica, ninguna columna cambia):
--   mentions                  6 columnas nulas + 2 índices
--   mention_nlp_shadow        tabla nueva (clasificación en sombra, WP-12)
--   report_send_log           subject, headline, composition, composer_version
--   report_configs            composer_mode (NOT NULL DEFAULT 'legacy')
--   overview_period_insights  composition, composer_version
--   metric_insights_cache     composition, composer_version
--
-- Este archivo es el REGISTRO, no el mecanismo: Drizzle no corre en el deploy
-- y eco-migration no acepta DDL genérico (exec-write solo UPDATE/INSERT/DELETE).
-- Cada sentencia numerada abajo tiene su acción de eco-migration lista para
-- pegar en docs/tecnica/migration-0013-actions.md (ahí también el
-- procedimiento de parcheo del bundle y las consultas de verificación).
--
-- Todo es idempotente (IF NOT EXISTS): correrlo dos veces no hace nada la
-- segunda. Ver "Por qué no toma locks largos" al final.
--
-- ORDEN OBLIGATORIO de despliegue: esta migración ANTES que cualquier código
-- que use el schema nuevo de @eco/database. Drizzle lista TODAS las columnas
-- del schema en cada INSERT y en cada select() sin columnas (p. ej.
-- `db.select().from(reportConfigs)` y los INSERT en report_send_log), así que
-- un deploy de código sin la migración rompe esas consultas aunque no use los
-- campos nuevos.
--
-- Rollback: fix-forward. Las columnas son nulas (o con default 'legacy') y
-- compatibles con el código viejo; no hace falta revertirlas.

-- Sesión: lo mínimo para no encolarse detrás de una lectura larga. Un ALTER
-- TABLE en cola bloquea a TODAS las consultas posteriores sobre la tabla
-- (ingesta incluida), por eso el timeout es corto y se reintenta después.
SET lock_timeout = '5s';

-- ─── 1. mentions: columnas (spec 5.1, 12.1) ─────────────────────────────────
-- Una sola sentencia: un solo lock ACCESS EXCLUSIVE, de milisegundos
-- (ADD COLUMN nulo sin DEFAULT es solo catálogo en PG 16; no reescribe la tabla).
ALTER TABLE mentions
  ADD COLUMN IF NOT EXISTS mention_kind        varchar(24),
  ADD COLUMN IF NOT EXISTS parent_mention_id   uuid,
  ADD COLUMN IF NOT EXISTS parent_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS nlp_adverse_fact    boolean,
  ADD COLUMN IF NOT EXISTS nlp_prompt_version  varchar(24),
  ADD COLUMN IF NOT EXISTS nlp_model           varchar(64);

-- ─── 2-3. mentions: índices ─────────────────────────────────────────────────
-- CONCURRENTLY: no bloquea las escrituras de la ingesta. NO puede correr dentro
-- de un bloque BEGIN/COMMIT ni junto a otras sentencias en un mismo envío:
-- cada uno va solo. Si falla a medias deja un índice INVALID que IF NOT EXISTS
-- NO reemplaza: ver la consulta de verificación (indisvalid) y el DROP INDEX
-- CONCURRENTLY en docs/tecnica/migration-0013-actions.md.
-- Ambos son cortos (mentions ≈ 143 mil filas, 228 MB de heap).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mentions_kind
  ON mentions (agency_id, mention_kind, published_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mentions_parent
  ON mentions (parent_mention_id);

-- ─── 4. mention_nlp_shadow (spec 12.1; plan WP-1 tarea 2) ───────────────────
-- Sin FK a mentions a propósito (igual que parent_mention_id): una FK pediría
-- SHARE ROW EXCLUSIVE sobre mentions al crearla y un chequeo por inserción.
-- La PK (mention_id, prompt_version) es también el índice de búsqueda.
CREATE TABLE IF NOT EXISTS mention_nlp_shadow (
  mention_id     uuid         NOT NULL,
  prompt_version varchar(24)  NOT NULL,
  model          varchar(64)  NOT NULL,
  sentiment      varchar(20),
  pertinence     varchar(10),
  adverse_fact   boolean,
  topics         jsonb,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT mention_nlp_shadow_pk PRIMARY KEY (mention_id, prompt_version)
);

-- ─── 5. report_send_log: archivo de cada envío (spec 5.2) ───────────────────
ALTER TABLE report_send_log
  ADD COLUMN IF NOT EXISTS subject          text,
  ADD COLUMN IF NOT EXISTS headline         text,
  ADD COLUMN IF NOT EXISTS composition      jsonb,
  ADD COLUMN IF NOT EXISTS composer_version varchar(24);

-- ─── 6. report_configs: bandera del motor por agencia ───────────────────────
-- 'legacy' (default) | 'shadow' | 'agentic'. DEFAULT constante + NOT NULL:
-- en PG 16 no reescribe la tabla (4 filas de todos modos). Para cambiarla por
-- SQL, editar con `updated_by` NOT NULL o el self-heal horario de
-- eco-weekly-report revierte la fila (ver memoria feedback_report_configs_selfheal_gate).
ALTER TABLE report_configs
  ADD COLUMN IF NOT EXISTS composer_mode varchar(10) NOT NULL DEFAULT 'legacy';

-- ─── 7. overview_period_insights: traza de la composición (spec 12.1) ───────
ALTER TABLE overview_period_insights
  ADD COLUMN IF NOT EXISTS composition      jsonb,
  ADD COLUMN IF NOT EXISTS composer_version varchar(24);

-- ─── 8. metric_insights_cache: traza de la composición (spec 12.1) ──────────
ALTER TABLE metric_insights_cache
  ADD COLUMN IF NOT EXISTS composition      jsonb,
  ADD COLUMN IF NOT EXISTS composer_version varchar(24);

-- ─── Por qué no toma locks largos ───────────────────────────────────────────
--  * Ninguna sentencia reescribe una tabla ni escanea `mentions`: las columnas
--    son nulas sin DEFAULT (o con DEFAULT constante en una tabla de 4 filas).
--  * Los ALTER TABLE piden ACCESS EXCLUSIVE solo el instante de tocar el
--    catálogo; con lock_timeout = 5 s no se encolan detrás de una lectura larga
--    (una lectura de ~7 min ya bloqueó un ALTER antes). Si vence: reintentar
--    fuera de la ventana de ingesta.
--  * Los índices usan CONCURRENTLY (solo SHARE UPDATE EXCLUSIVE: la ingesta
--    sigue escribiendo).
--  * CREATE TABLE no toca tablas existentes.
-- Sin cambios de datos: ningún UPDATE/INSERT/DELETE.
