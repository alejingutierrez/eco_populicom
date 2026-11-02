/**
 * Universo pertinente ÚNICO del producto (spec interpretación v1, sección 8, D4).
 *
 *     universo = is_duplicate = false
 *                AND nlp_pertinence IN ('alta', 'media')      -- P1: NULL queda fuera
 *
 * Gráficos, conteos, NSS, tópicos, fuentes, municipios, emociones, series
 * diarias, correos, Scorecard, Overview y alertas deben contar sobre ESTE
 * predicado. Antes de v1 convivían tres variantes en silencio:
 *   - los conteos del correo y del dashboard: `NULL o <> 'baja'`;
 *   - las muestras del correo: `IN ('alta','media')`;
 *   - los agregados de fuentes, municipios y emociones del lambda: sin filtro
 *     (en DDEC 25-31 oct las fuentes sumaban 795 contra 647 del total).
 *
 * P1 (confirmada por el product owner, 2-nov): una mención con pertinencia
 * NULL (pendiente de NLP) sale del universo hasta clasificarse; se cuenta
 * aparte (`loadUniverseCoverage`) para que diagnostics la muestre.
 *
 * Excepción documentada: `admin/diagnostics` cuenta SIN filtrar `is_duplicate`
 * a propósito (CLAUDE.md). No usa este predicado y no debe migrarse.
 *
 * BANDERA: el comportamiento histórico (`NULL o <> 'baja'`) sigue siendo el
 * DEFAULT de las funciones que ya existían (`buildSentimentReport`,
 * `buildReportDetail`, `loadAggregatesForWindow`); el universo estricto se
 * activa con `{ strictUniverse: true }`. Los consumidores nuevos (paquete de
 * hechos, `buildUniverseFacts`) usan siempre el estricto.
 *
 * Este módulo no importa nada: lo consumen lambdas, web y los demás módulos de
 * `@eco/shared` sin riesgo de ciclos.
 */

/** Pertinencias que forman parte del universo. */
export const UNIVERSE_PERTINENCES = ['alta', 'media'] as const;
export type UniversePertinence = (typeof UNIVERSE_PERTINENCES)[number];

/** Literal SQL de la lista (`'alta','media'`), derivado de UNIVERSE_PERTINENCES. */
const PERTINENCE_LIST_SQL = UNIVERSE_PERTINENCES.map((p) => `'${p}'`).join(',');

/**
 * Opciones que gobiernan qué universo cuenta una agregación.
 */
export interface UniverseOptions {
  /**
   * Usar el universo estricto de v1 (`IN ('alta','media')`, NULL fuera).
   * Default FALSE: comportamiento histórico (`NULL o <> 'baja'`), idéntico al
   * anterior a v1. Se enciende por agencia/bandera desde el consumidor.
   */
  strictUniverse?: boolean;
  /**
   * Incluir `nlp_pertinence = 'baja'`. Default FALSE. Solo para listas y
   * detalle: el toggle «incluir pertinencia baja» NUNCA debe alterar una cifra
   * de gráfico, conteo o correo (spec 8). Con `strictUniverse` suma 'baja' a
   * la lista pero NULL sigue fuera; sin él, quita el filtro de pertinencia
   * (comportamiento histórico).
   */
  includeLowPertinence?: boolean;
}

/** Normaliza el prefijo de tabla: '' | 'm.' | 'm' → '' | 'm.'. */
function prefix(alias: string): string {
  if (!alias) return '';
  return alias.endsWith('.') ? alias : `${alias}.`;
}

/**
 * Predicado SQL del universo (SIN `AND` inicial). `alias` es el alias de la
 * tabla `mentions` en la query: `'m'` o `'m.'`; vacío si no usa alias.
 *
 *     WHERE agency_id = $1 AND ${pertinentUniverseSql()} AND …
 *
 * Es una conjunción simple (sin OR), así que se puede insertar tras un `AND`
 * sin paréntesis.
 */
export function pertinentUniverseSql(alias = ''): string {
  const a = prefix(alias);
  return `${a}is_duplicate = false AND ${a}nlp_pertinence IN (${PERTINENCE_LIST_SQL})`;
}

/**
 * Fragmento `AND …` completo (duplicados + pertinencia) según las opciones.
 * Es el único punto por el que las agregaciones de `@eco/shared` arman el
 * filtro de universo, de modo que no puedan divergir entre sí.
 *
 *   - sin opciones (legacy): `is_duplicate = false AND (pert IS NULL OR pert <> 'baja')`
 *   - `includeLowPertinence` sin strict (legacy): solo `is_duplicate = false`
 *   - `strictUniverse`: `pertinentUniverseSql()`
 *   - `strictUniverse` + `includeLowPertinence`: `IN ('alta','media','baja')`
 */
export function universeFilterSql(opts?: UniverseOptions, alias = ''): string {
  const a = prefix(alias);
  if (opts?.strictUniverse) {
    if (opts.includeLowPertinence) {
      return `AND ${a}is_duplicate = false AND ${a}nlp_pertinence IN (${PERTINENCE_LIST_SQL},'baja')`;
    }
    return `AND ${pertinentUniverseSql(alias)}`;
  }
  if (opts?.includeLowPertinence) return `AND ${a}is_duplicate = false`;
  return `AND ${a}is_duplicate = false
        AND (${a}nlp_pertinence IS NULL OR ${a}nlp_pertinence <> 'baja')`;
}

/**
 * Forma mínima de una mención para decidir pertenencia al universo. Acepta las
 * dos convenciones del repo: filas crudas de SQL (snake_case) y filas de
 * Drizzle (camelCase).
 */
export interface UniverseMentionLike {
  is_duplicate?: boolean | null;
  isDuplicate?: boolean | null;
  nlp_pertinence?: string | null;
  nlpPertinence?: string | null;
  /** Alias corto que usan los payloads de muestras (`pertinence`). */
  pertinence?: string | null;
}

/**
 * Versión en memoria del predicado SQL (`pertinentUniverseSql`): misma lógica,
 * para filtrar listas ya cargadas (muestras, hilos) sin riesgo de que difieran
 * de los conteos. La pertinencia se compara EXACTA (como el SQL): sin
 * normalizar mayúsculas ni espacios; NULL/undefined → fuera (P1).
 */
export function isInUniverse(m: UniverseMentionLike): boolean {
  const dup = m.is_duplicate ?? m.isDuplicate ?? false;
  if (dup) return false;
  const pert = m.nlp_pertinence ?? m.nlpPertinence ?? m.pertinence ?? null;
  return pert === 'alta' || pert === 'media';
}

/**
 * Cobertura del universo en una ventana: cuántas filas entran y cuántas se
 * quedan fuera y por qué. Alimenta diagnostics (P1: las NULL «se cuentan
 * aparte») y documenta cualquier diferencia contra el universo histórico.
 */
export interface UniverseCoverage {
  /** Entran al universo (no duplicadas, pertinencia alta o media). */
  inUniverse: number;
  /** Fuera por pertinencia 'baja'. */
  low: number;
  /** Fuera por pertinencia NULL: pendientes de NLP (P1). */
  pending: number;
  /** Fuera por ser duplicadas (cualquier pertinencia). */
  duplicates: number;
}
