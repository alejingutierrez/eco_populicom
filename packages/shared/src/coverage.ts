// ============================================================
// ECO Platform — Cobertura de datos de una agencia
// ============================================================
//
// Dos hechos que las métricas necesitan y que ningún conteo de menciones dice
// por sí solo (examen de las métricas de DF, 19-oct-2026):
//
// 1) DESDE CUÁNDO hay datos de verdad. El backfill diario de
//    eco-metrics-calculator escribe un snapshot por agencia para CADA fecha
//    con menciones de cualquier agencia (desde ene-2025), así que una agencia
//    nueva arrastra cientos de días en 0 que no son silencio, son «todavía no
//    se recolectaba». Esos ceros entraban como historia del riesgo de crisis
//    (media de negativas ≈ 0, desviación en el piso de 1) y el 29–31 de julio
//    DF salía en Alerta/Crisis con 4–15 negativas. `startYmd` es el inicio de
//    la cobertura CONTINUA: el primer día D con menciones en al menos
//    COVERAGE_MIN_DAYS de los 7 días [D, D+6]. Así una mención suelta antes
//    de que arranque la colección (DF: 15-jul, y nada hasta el 28) no adelanta
//    el inicio.
//
// 2) HASTA CUÁNDO hay datos, para las agencias que se alimentan de exportes
//    (queryId negativo, ver bunker-import.ts). Entre un exporte y el
//    siguiente, los días posteriores al corte no están vacíos: no se han
//    cargado. El Diario del 18-oct de DF contó 271 menciones de una ventana
//    que tenía 382 porque el 17 salía en 0. `lastPublishedAt` es el corte del
//    último exporte y `lastCompleteYmd` el último día que el exporte cubre
//    entero (el anterior al del corte: el exporte se descarga a media
//    jornada). Para las agencias de Brandwatch la ingesta es continua y no
//    hay corte.

import type { PgClientLike } from './aggregations/sentiment-report';
import { isImportQueryId } from './bunker-import';
import { addDaysYmd, ymdInTimeZone } from './dates';

/** Días con menciones, de 7, que marcan el arranque de la cobertura continua. */
export const COVERAGE_MIN_DAYS = 4;

export interface AgencyCoverage {
  /** La agencia se alimenta de exportes (queryId negativo), no de ingesta continua. */
  importFed: boolean;
  /** Primer día (AST) de cobertura continua, o null si la agencia no tiene menciones. */
  startYmd: string | null;
  /** Mención más reciente: en una agencia importada, el corte del último exporte. */
  lastPublishedAt: Date | null;
  /** Última vez que entró una mención (para una agencia importada, el último exporte cargado). */
  lastIngestedAt: Date | null;
  /** Último día (AST) que el último exporte cubre entero; null si no es importada o no hay datos. */
  lastCompleteYmd: string | null;
}

const TZ = 'America/Puerto_Rico';
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: AgencyCoverage }>();

/** Solo para pruebas: olvida la cobertura cacheada. */
export function clearCoverageCache(): void {
  cache.clear();
}

/**
 * Cobertura de la agencia. Cacheada 5 minutos por proceso: el dashboard la
 * consulta en cada request y solo cambia cuando entra un exporte.
 */
export async function loadAgencyCoverage(client: PgClientLike, agencyId: string): Promise<AgencyCoverage> {
  const hit = cache.get(agencyId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const r = await client.query<{
    brandwatch_project_id: string | number | null;
    brandwatch_query_ids: number[] | null;
    start_ymd: string | null;
    last_published_at: string | Date | null;
    last_ingested_at: string | Date | null;
  }>(
    `WITH d AS (
       SELECT DISTINCT (published_at AT TIME ZONE '${TZ}')::date AS day
         FROM mentions
        WHERE agency_id = $1
     )
     SELECT a.brandwatch_project_id,
            a.brandwatch_query_ids,
            (SELECT MIN(d1.day)::text
               FROM d d1
              WHERE (SELECT COUNT(*) FROM d d2 WHERE d2.day BETWEEN d1.day AND d1.day + 6) >= $2) AS start_ymd,
            (SELECT MAX(published_at) FROM mentions WHERE agency_id = $1) AS last_published_at,
            (SELECT MAX(ingested_at) FROM mentions WHERE agency_id = $1) AS last_ingested_at
       FROM agencies a
      WHERE a.id = $1`,
    [agencyId, COVERAGE_MIN_DAYS],
  );
  const row = r.rows[0];
  const value = coverageFromRow(row ?? null);
  cache.set(agencyId, { at: Date.now(), value });
  return value;
}

/** Arma la cobertura desde la fila cruda (separado para probarlo sin DB). */
export function coverageFromRow(row: {
  brandwatch_project_id: string | number | null;
  brandwatch_query_ids: number[] | null;
  start_ymd: string | null;
  last_published_at: string | Date | null;
  last_ingested_at: string | Date | null;
} | null): AgencyCoverage {
  if (!row) return { importFed: false, startYmd: null, lastPublishedAt: null, lastIngestedAt: null, lastCompleteYmd: null };
  const importFed = row.brandwatch_project_id == null
    && Array.isArray(row.brandwatch_query_ids)
    && row.brandwatch_query_ids.map(Number).some(isImportQueryId);
  const lastPublishedAt = row.last_published_at ? new Date(row.last_published_at) : null;
  const lastIngestedAt = row.last_ingested_at ? new Date(row.last_ingested_at) : null;
  return {
    importFed,
    startYmd: row.start_ymd ?? null,
    lastPublishedAt,
    lastIngestedAt,
    lastCompleteYmd: importFed && lastPublishedAt ? addDaysYmd(ymdInTimeZone(lastPublishedAt, TZ), -1) : null,
  };
}

/**
 * El «ahora» para calcular la ventana cerrada de un reporte. Una ventana
 * cerrada termina AYER respecto de este instante; para una agencia importada
 * se usa el corte del último exporte, de modo que la ventana termina en el
 * último día que el exporte cubre entero y nunca incluye días sin cargar.
 */
export function reportWindowNow(coverage: AgencyCoverage, nowUtc: Date): Date {
  if (!coverage.importFed || !coverage.lastPublishedAt) return nowUtc;
  return coverage.lastPublishedAt < nowUtc ? coverage.lastPublishedAt : nowUtc;
}
