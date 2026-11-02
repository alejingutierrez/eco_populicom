/**
 * Rangos y días en HORA DE PUERTO RICO (America/Puerto_Rico, AST = UTC-4 todo
 * el año, sin DST) para agregaciones y MUESTRAS.
 *
 * Por qué existe (spec interpretación v1, 10.2 y plan WP-4 tarea 4): los
 * conteos del producto siempre usaron el día calendario PR
 * (`(published_at AT TIME ZONE 'America/Puerto_Rico')::date`), pero
 * `loadSamples` y `loadTodaySamples` del lambda eco-weekly-report filtran con
 * `published_at >= $2::date AND published_at < $3::date + INTERVAL '1 day'`,
 * que compara un timestamptz contra una fecha y por tanto corta el día en UTC.
 * Como AST es UTC-4, esa ventana mete las últimas 4 horas del día anterior y
 * deja fuera las últimas 4 del día final: el correo mostraba una «mención de
 * hace 6 días» y «el día de hoy» con muestras de otro día. Estos helpers dan
 * la ÚNICA definición de «día PR» para que los lambdas (WP-6) la adopten.
 *
 * Todo es puro (sin dependencias de DB); los fragmentos SQL se insertan en
 * queries con `$n` ya parametrizados.
 */

import { addDaysYmd, ymdInTimeZone } from '../dates';

export const PR_TIMEZONE = 'America/Puerto_Rico';

/** Horas que hay que SUMAR a la medianoche PR para obtener el instante UTC. */
export const PR_UTC_OFFSET_HOURS = 4;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertYmd(ymd: string): void {
  if (!YMD_RE.test(ymd)) throw new Error(`YMD inválido: ${JSON.stringify(ymd)}`);
}

/** Día calendario PR (`YYYY-MM-DD`) de un instante. */
export function prDayOf(instant: Date | string | number): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) throw new Error(`Instante inválido: ${String(instant)}`);
  return ymdInTimeZone(d, PR_TIMEZONE);
}

/** Instante UTC en que EMPIEZA el día PR `ymd` (medianoche AST = 04:00Z). */
export function prDayStartUtc(ymd: string): Date {
  assertYmd(ymd);
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, PR_UTC_OFFSET_HOURS));
}

export interface PrUtcRange {
  /** Inicio inclusive (instante UTC). */
  from: Date;
  /** Fin EXCLUSIVO (instante UTC): medianoche PR del día siguiente a `endYmd`. */
  toExclusive: Date;
  fromIso: string;
  toExclusiveIso: string;
}

/**
 * Rango UTC `[from, toExclusive)` equivalente a los días PR `startYmd..endYmd`
 * (ambos inclusivos). Sirve para pasar bordes ya resueltos como parámetros
 * (`published_at >= $2 AND published_at < $3`), que además usan el índice
 * `idx_mentions_agency_published`.
 */
export function prRangeUtc(startYmd: string, endYmd: string): PrUtcRange {
  if (startYmd > endYmd) throw new Error(`Rango invertido: ${startYmd} > ${endYmd}`);
  const from = prDayStartUtc(startYmd);
  const toExclusive = prDayStartUtc(addDaysYmd(endYmd, 1));
  return { from, toExclusive, fromIso: from.toISOString(), toExclusiveIso: toExclusive.toISOString() };
}

/** Prefijo de alias normalizado ('' | 'm.' | 'm' → '' | 'm.'). */
function prefix(alias: string): string {
  if (!alias) return '';
  return alias.endsWith('.') ? alias : `${alias}.`;
}

/** Expresión SQL del día PR de una columna timestamptz. */
export function prDaySql(alias = '', column = 'published_at'): string {
  return `(${prefix(alias)}${column} AT TIME ZONE '${PR_TIMEZONE}')::date`;
}

/** `to_char` del día PR (`YYYY-MM-DD`): para seleccionar el día de una muestra. */
export function prDayTextSql(alias = '', column = 'published_at'): string {
  return `to_char(${prefix(alias)}${column} AT TIME ZONE '${PR_TIMEZONE}', 'YYYY-MM-DD')`;
}

/**
 * Filtro de ventana por DÍA CALENDARIO PR (familia B del contrato de datos):
 * la misma que usan `buildSentimentReport` y `loadAggregatesForWindow`. Es el
 * que deben usar las muestras para que el conteo y la lista cuenten el mismo
 * día. No usa el índice por fecha (aplica una función a la columna); para
 * ventanas pequeñas es irrelevante y para las grandes ver `prWindowRangeSql`.
 *
 * Devuelve fragmento con `AND` inicial.
 */
export function prWindowSql(alias = '', startParam = '$2', endParam = '$3'): string {
  const day = prDaySql(alias);
  return `AND ${day} >= (${startParam}::date)
          AND ${day} <= (${endParam}::date)`;
}

/**
 * Misma ventana que `prWindowSql` expresada como RANGO de instantes (usa el
 * índice por fecha). `(param::date)::timestamp AT TIME ZONE 'America/Puerto_Rico'`
 * es la medianoche PR del día como timestamptz. Equivale fila a fila a
 * `prWindowSql` (AST no tiene DST). Fragmento con `AND` inicial.
 */
export function prWindowRangeSql(alias = '', startParam = '$2', endParam = '$3'): string {
  const col = `${prefix(alias)}published_at`;
  return `AND ${col} >= ((${startParam}::date)::timestamp AT TIME ZONE '${PR_TIMEZONE}')
          AND ${col} < (((${endParam}::date) + 1)::timestamp AT TIME ZONE '${PR_TIMEZONE}')`;
}

/** Días calendario entre dos YMD (`to - from`; negativo si `to` es anterior). */
export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  assertYmd(fromYmd);
  assertYmd(toYmd);
  return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86400000);
}

/**
 * Días calendario PR transcurridos entre la escritura de una publicación y la
 * de un comentario posterior (o `now`): `prDaysBetween(parentAt, commentAt)`.
 * Cuenta CAMBIOS DE DÍA PR, no múltiplos de 24 h: 23:50 → 00:10 son 1 día.
 * Para el campo «días que pasaron» de las muestras de comentarios.
 */
export function prDaysBetween(from: Date | string | number, to: Date | string | number): number {
  return daysBetweenYmd(prDayOf(from), prDayOf(to));
}
