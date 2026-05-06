-- Migración 0001: defaults del reporte semanal a San Juan / Puerto Rico
--
-- Ajusta el horario de envío y la zona horaria de la tabla report_configs:
--   • send_hour_local: 16 → 6  (envío a las 6:00 AM hora local)
--   • timezone:        America/Bogota → America/Puerto_Rico (AST, UTC-4 sin DST)
--
-- También migra la configuración de la agencia DDEC para que la fila existente
-- en producción quede alineada con el código (TZ PR, hora 6, 6 destinatarios).
-- El UPDATE sobreescribe valores aunque la fila haya sido editada desde la UI;
-- esto es intencional para resincronizar la config tras el cambio de TZ. La UI
-- sigue pudiendo editar después de esta migración sin obstáculos.

-- 1) Cambiar defaults de columna para futuras inserciones
ALTER TABLE "report_configs" ALTER COLUMN "send_hour_local" SET DEFAULT 6;--> statement-breakpoint
ALTER TABLE "report_configs" ALTER COLUMN "timezone" SET DEFAULT 'America/Puerto_Rico';--> statement-breakpoint

-- 2) Re-sincronizar la config de DDEC con los valores definitivos
UPDATE "report_configs" rc
   SET "send_hour_local" = 6,
       "timezone"        = 'America/Puerto_Rico',
       "is_active"       = true,
       "recipients"      = '[
         "agutierrez@populicom.com",
         "gpaz@populicom.com",
         "csanchez@populicom.com",
         "asoto@populicom.com",
         "lquinones@populicom.com",
         "grosado@populicom.com"
       ]'::jsonb,
       "updated_at"      = NOW()
  FROM "agencies" a
 WHERE rc.agency_id = a.id
   AND a.slug = 'ddecpr';
