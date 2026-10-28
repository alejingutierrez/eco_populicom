/**
 * Unicidad de una mención: (agencia, resourceId de Brandwatch).
 *
 * Una misma nota o post puede coincidir con las queries de DOS agencias (una
 * nota de la Gobernadora que nombra al DDEC, un post de Fortaleza sobre el
 * Departamento de la Familia). Brandwatch le da el mismo resourceId en cada
 * proyecto, así que la llave tiene que incluir la agencia: con `bw_resource_id`
 * solo, la copia de la segunda agencia se descartaba en silencio y su dashboard
 * quedaba sin esa mención (QA 2026-10-26: 48 menciones de Gobernadora con
 * «DDEC» en el título, ninguna en DDEC).
 *
 * El índice que la respalda es `mentions_agency_bw_resource_uq`
 * (agency_id, bw_resource_id). NO es parcial a propósito: `ON CONFLICT
 * (agency_id, bw_resource_id)` solo infiere índices sin predicado, y los NULL
 * no chocan entre sí (las filas importadas sin resourceId siguen entrando).
 */

/** Llave en memoria de una mención; la misma que decide el índice único. */
export function mentionKey(agencyId: string, resourceId: string): string {
  return `${agencyId}:${resourceId}`;
}

/**
 * Qué pares (agencia, resourceId) del lote ya existen. $1 = uuid[] de agencias,
 * $2 = text[] de resourceIds, alineados por posición. Usa el índice único.
 */
export const EXISTING_MENTIONS_SQL = `
  SELECT m.agency_id::text AS agency_id, m.bw_resource_id
    FROM unnest($1::uuid[], $2::text[]) AS k(agency_id, resource_id)
    JOIN mentions m ON m.agency_id = k.agency_id AND m.bw_resource_id = k.resource_id`;

/** Árbitro del INSERT de la mención (debe coincidir con el índice de arriba). */
export const MENTION_CONFLICT_TARGET = '(agency_id, bw_resource_id)';

export interface BatchEntry<T> {
  record: T;
  /** false = el cuerpo no es JSON válido: se descarta, como siempre. */
  valid: boolean;
  /** undefined si la queryId no está en el mapa cacheado (processRecord lo refresca). */
  agencyId: string | undefined;
  resourceId: string | undefined;
}

/**
 * Registros del lote que NO existen todavía para SU agencia. Los que no se
 * pueden llavear (sin agencia en el mapa cacheado o sin resourceId) pasan: el
 * resto del flujo los resuelve o los rechaza, igual que antes de este cambio.
 */
export function selectNewRecords<T>(entries: Array<BatchEntry<T>>, existing: Set<string>): T[] {
  return entries
    .filter((e) => e.valid)
    .filter((e) => !(e.agencyId && e.resourceId && existing.has(mentionKey(e.agencyId, e.resourceId))))
    .map((e) => e.record);
}
