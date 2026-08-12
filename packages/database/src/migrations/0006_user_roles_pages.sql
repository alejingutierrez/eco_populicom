-- 0006: tier 'editor' + visibilidad de páginas por usuario
--
-- 'editor' se ubica entre admin y analyst (puede gestionar plantillas/reglas
-- pero NO usuarios). allowed_pages es un array de claves de nav; NULL = todas
-- las páginas que su rol permita (sin override). Ambos cambios son aditivos e
-- idempotentes.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'editor';
ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_pages JSONB;
