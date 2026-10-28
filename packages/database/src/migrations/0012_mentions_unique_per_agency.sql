-- 0012 — mentions: unicidad por (agency_id, bw_resource_id) en vez de global
-- (oct-2026).
--
-- Una nota o post puede coincidir con las queries de dos agencias, y Brandwatch
-- le da el mismo resourceId en cada proyecto. Con UNIQUE (bw_resource_id) la
-- segunda copia se descartaba en silencio (ON CONFLICT DO NOTHING) y esa agencia
-- nunca veía la mención. QA 2026-10-26: 48 menciones de Gobernadora con «DDEC» en
-- el título y ninguna en DDEC; 17 de Gobernadora sobre «Departamento de la
-- Familia» desde el 15-oct y ninguna en DF vía Brandwatch.
--
-- Este archivo es el registro, no el mecanismo (eco-migration no acepta DDL
-- genérico): lo aplica la acción `mentions-unique-per-agency` (lib/mentions-unique.ts),
-- en este ORDEN:
--   1) phase 'add'  — crea el índice nuevo. El processor viejo sigue igual.
--   2) desplegar eco-processor (SELECT de existencia por agencia + ON CONFLICT
--      (agency_id, bw_resource_id)).
--   3) phase 'drop' — suelta el global. Antes de esto el processor nuevo solo falla
--      (23505 → SQS reintenta, visibility 900 s, maxReceiveCount 3) en las menciones
--      que son nuevas para su agencia pero ya existen en otra.
--
-- Estado de prod al 2026-10-26: constraint mentions_bw_resource_id_key
-- UNIQUE (bw_resource_id) + índice parcial duplicado
-- mentions_bw_resource_id_partial_unique. bw_resource_id es NULLable en prod
-- (1,054 filas de DDEC importadas el 26-may no lo tienen); los NULL no chocan.

-- Paso 1
CREATE UNIQUE INDEX IF NOT EXISTS mentions_agency_bw_resource_uq
  ON mentions (agency_id, bw_resource_id);

-- Paso 3 (después de desplegar el processor)
BEGIN;
  ALTER TABLE mentions DROP CONSTRAINT IF EXISTS mentions_bw_resource_id_key;
  DROP INDEX IF EXISTS mentions_bw_resource_id_partial_unique;
COMMIT;
