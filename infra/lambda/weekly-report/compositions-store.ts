/**
 * Composiciones guardadas del correo (tabla `report_compositions`, migración
 * 0014; WP-6). La composición anticipada (acción `compose`, 2 h antes del
 * envío) deja aquí el texto del motor; el envío de la hora configurada lo lee.
 *
 * Clave: (agency_id, report_type, period_end). Todas las funciones son a
 * prueba de fallos: si la tabla no existe todavía (0014 sin aplicar) o la
 * consulta falla, `load` devuelve null y `save` devuelve false, y el envío
 * sigue su camino (compone en el momento o usa el texto legacy). Nunca lanzan.
 */
import type { Composition } from '@eco/shared';
import type { Queryable } from '../lib/parent-resolver';

export type CompositionReportType = 'daily' | 'weekly';

/**
 * `complete`: el redactor produjo texto (con o sin QA agente) y la red de
 * seguridad corrió. `degraded`: el redactor falló y el texto es el
 * determinista: no se envía (el envío cae al legacy).
 */
export type CompositionStatus = 'complete' | 'degraded';

export interface StoredComposition {
  agencyId: string;
  reportType: CompositionReportType;
  periodEnd: string;
  composerVersion: string;
  composition: Composition;
  status: CompositionStatus;
  createdAt: string | null;
}

/** Estado de una composición recién hecha. */
export function compositionStatus(c: Pick<Composition, 'draft1Raw' | 'final'> | null | undefined): CompositionStatus {
  return c && c.draft1Raw && c.final && typeof c.final.headline === 'string' && c.final.headline.trim() ? 'complete' : 'degraded';
}

/**
 * Upsert. Una composición `degraded` NUNCA pisa una `complete` del mismo
 * periodo (un reintento fallido no borra un texto bueno).
 */
export const UPSERT_COMPOSITION_SQL = `INSERT INTO report_compositions
    (agency_id, report_type, period_end, composer_version, composition, status, created_at)
  VALUES ($1, $2, $3::date, $4, $5::jsonb, $6, NOW())
  ON CONFLICT (agency_id, report_type, period_end) DO UPDATE SET
    composer_version = EXCLUDED.composer_version,
    composition = EXCLUDED.composition,
    status = EXCLUDED.status,
    created_at = NOW()
  WHERE report_compositions.status <> 'complete' OR EXCLUDED.status = 'complete'`;

export const SELECT_COMPOSITION_SQL = `SELECT agency_id, report_type, to_char(period_end, 'YYYY-MM-DD') AS period_end,
         composer_version, composition, status, created_at
    FROM report_compositions
   WHERE agency_id = $1 AND report_type = $2 AND period_end = $3::date
   LIMIT 1`;

export async function saveComposition(
  client: Queryable,
  row: { agencyId: string; reportType: CompositionReportType; periodEnd: string; composition: Composition; status?: CompositionStatus },
  log: (msg: string) => void = console.warn,
): Promise<boolean> {
  try {
    await client.query(UPSERT_COMPOSITION_SQL, [
      row.agencyId,
      row.reportType,
      row.periodEnd,
      row.composition.composerVersion,
      JSON.stringify(row.composition),
      row.status ?? compositionStatus(row.composition),
    ]);
    return true;
  } catch (err) {
    log(`[weekly-report] no se pudo guardar la composición (${row.reportType} ${row.periodEnd}): ${(err as Error)?.message ?? err}`);
    return false;
  }
}

export async function loadStoredComposition(
  client: Queryable,
  agencyId: string,
  reportType: CompositionReportType,
  periodEnd: string,
  log: (msg: string) => void = console.warn,
): Promise<StoredComposition | null> {
  try {
    const r = await client.query(SELECT_COMPOSITION_SQL, [agencyId, reportType, periodEnd]);
    const row = r.rows[0];
    if (!row) return null;
    const composition = typeof row.composition === 'string' ? JSON.parse(row.composition) : row.composition;
    if (!composition || typeof composition !== 'object') return null;
    return {
      agencyId: String(row.agency_id),
      reportType: row.report_type,
      periodEnd: String(row.period_end),
      composerVersion: String(row.composer_version ?? ''),
      composition,
      status: row.status === 'complete' ? 'complete' : 'degraded',
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    };
  } catch (err) {
    log(`[weekly-report] no se pudo leer la composición guardada (${reportType} ${periodEnd}): ${(err as Error)?.message ?? err}`);
    return null;
  }
}
