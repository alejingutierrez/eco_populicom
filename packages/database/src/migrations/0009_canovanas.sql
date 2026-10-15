-- 0009 — Canóvanas, el municipio 78.
--
-- La tabla `municipalities` nació con 77 filas: Canóvanas no estaba ni aquí ni
-- en `@eco/shared/municipalities.ts`, así que ninguna mención podía quedar
-- georreferenciada ahí (el processor busca el id por slug y, si no hay fila,
-- se salta la asociación en silencio).
--
-- Mismos valores que el catálogo: centro del pueblo (OpenStreetMap, nodo
-- place=town) y población del Censo al 1 jul 2025 (Vintage 2025,
-- PRM-EST2025-POP). Con esta fila la tabla suma 3,184,835, el total de PR.
-- Idempotente: volver a correrla no hace nada.
INSERT INTO municipalities (name, slug, region, latitude, longitude, population)
VALUES ('Canóvanas', 'canovanas', 'Norte', 18.3792, -65.9010, 41302)
ON CONFLICT (slug) DO NOTHING;
