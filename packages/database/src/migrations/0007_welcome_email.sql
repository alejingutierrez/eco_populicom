-- 0007 — Correo de bienvenida al activar la cuenta.
--
-- `welcome_email_sent_at`: marca de un solo uso. NULL = pendiente. La app la
-- estampa al reclamarla (antes de llamar a SES) para que dos peticiones
-- simultáneas no manden dos correos, y la devuelve a NULL si el envío falla.
--
-- `weekly_report_optin`: deja constancia en la DB de quien recibe SOLO el
-- reporte semanal por una regla EventBridge dirigida (la lista
-- `report_configs.recipients` es una sola para diario + semanal, así que no
-- sirve para eso). No dispara ningún envío: solo evita que el correo de
-- bienvenida prometa de más o de menos.
ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_email_sent_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_report_optin boolean NOT NULL DEFAULT false;

-- Backfill de UNA sola vez: todas las cuentas que ya existían quedan marcadas
-- como "ya enviado" para que el automatismo no le caiga encima a nadie que
-- lleve meses usando ECO. Solo las cuentas creadas a partir de aquí nacen con
-- la columna en NULL y reciben la bienvenida en su primer ingreso.
-- NO conviertas esto en self-heal: volver a correrlo marcaría como enviados a
-- los invitados que todavía no han activado.
UPDATE users SET welcome_email_sent_at = now() WHERE welcome_email_sent_at IS NULL;
