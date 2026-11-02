/**
 * Composición del volumen y variaciones honestas (spec interpretación v1,
 * sección 10.2, «paquete de hechos»).
 *
 *  - `commentShare`: qué parte del universo son COMENTARIOS de usuarios en las
 *    redes de la agencia. En DDEC 25–31 oct el 82.8 % de las 647 «menciones»
 *    eran comentarios (468 de un solo hilo, el video de El Horno de Pane): sin
 *    esta cifra el correo contaba conversación de un post como si fuera
 *    prensa.
 *  - `minBaseDelta`: un porcentaje de variación solo se ofrece si la base
 *    previa es ≥ 30 menciones; si no, solo la diferencia absoluta. Evita
 *    «+1400 %» (DDEC: 9 positivas → 135).
 *
 * Todo cálculo es código determinista: el modelo no escribe cifras propias.
 */

import { universeFilterSql, type UniverseOptions } from '../universe';
import { sourceKey } from '../sources';
import { prWindowSql } from './pr-range';
import type { PgClientLike } from './sentiment-report';

// ============================================================
// Comentarios de usuarios (mention_kind = 'comment', spec 5.1)
// ============================================================

/**
 * Forma mínima para decidir si una mención es un comentario. Acepta filas
 * crudas (snake_case) y de Drizzle (camelCase).
 */
export interface CommentMentionLike {
  url?: string | null;
  bw_guid?: string | null;
  bwGuid?: string | null;
  page_type?: string | null;
  pageType?: string | null;
}

/**
 * Comentario de un usuario en una publicación (spec 5.1):
 *   - URL con `#channels_comment` (Facebook), o
 *   - GUID de Instagram con `#` (`<post>#<comment>`).
 *
 * Es la definición DERIVADA de los datos crudos. Cuando WP-1/WP-2 pueblen
 * `mentions.mention_kind` (backfill WP-13), `mention_kind = 'comment'` la
 * reemplaza y esta función debe seguir dando lo mismo.
 */
export function isCommentMention(m: CommentMentionLike): boolean {
  if (m.url && m.url.includes('#channels_comment')) return true;
  const guid = m.bw_guid ?? m.bwGuid ?? null;
  const pageType = m.page_type ?? m.pageType ?? null;
  return !!guid && guid.includes('#') && sourceKey(pageType) === 'instagram';
}

/**
 * Predicado SQL equivalente a `isCommentMention` (sin `AND` inicial). `alias`
 * es el de la tabla mentions: `'m'`, `'m.'` o vacío.
 */
export function commentMentionSql(alias = ''): string {
  const a = !alias ? '' : alias.endsWith('.') ? alias : `${alias}.`;
  return `(strpos(COALESCE(${a}url, ''), '#channels_comment') > 0
          OR (${a}page_type ILIKE '%instagram%' AND strpos(COALESCE(${a}bw_guid, ''), '#') > 0))`;
}

export interface CommentShare {
  /** Comentarios de usuarios dentro del universo de la ventana. */
  comments: number;
  /** Total del universo de la ventana. */
  total: number;
  /** Porcentaje 0–100 (0 si la ventana está vacía). */
  pct: number;
}

/** Aritmética de la composición: separada para poder probarla sin DB. */
export function computeCommentShare(comments: number, total: number): CommentShare {
  const pct = total > 0 ? (comments / total) * 100 : 0;
  return { comments, total, pct };
}

/**
 * Porcentaje de menciones del UNIVERSO que son comentarios de usuarios en
 * redes de la agencia, en la ventana de días PR `[startYmd, endYmd]`.
 *
 * Usa el universo estricto (P1) salvo que el caller diga otra cosa: el
 * numerador y el denominador salen de la misma query, así que el porcentaje
 * es coherente con el total del paquete de hechos.
 */
export async function commentShare(
  client: PgClientLike,
  agencyId: string,
  window: { startYmd: string; endYmd: string },
  opts?: UniverseOptions,
): Promise<CommentShare> {
  const r = await client.query<{ total: number | string; comments: number | string }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE ${commentMentionSql('m.')})::int AS comments
       FROM mentions m
      WHERE m.agency_id = $1
        ${universeFilterSql({ strictUniverse: true, ...opts }, 'm.')}
        ${prWindowSql('m.')}`,
    [agencyId, window.startYmd, window.endYmd],
  );
  const row = r.rows[0];
  return computeCommentShare(Number(row?.comments ?? 0), Number(row?.total ?? 0));
}

// ============================================================
// Variación con base mínima
// ============================================================

/** Base previa mínima para ofrecer un porcentaje de variación (spec 10.2). */
export const MIN_DELTA_BASE = 30;

export interface BaseDelta {
  prev: number;
  cur: number;
  /** Diferencia absoluta `cur - prev`. Siempre disponible. */
  abs: number;
  /**
   * Variación porcentual `(cur - prev) / prev × 100`. `null` si la base
   * previa es menor que `minBase` (o cero): en ese caso solo se dice `abs`.
   */
  pct: number | null;
  /** Base mínima aplicada. */
  minBase: number;
}

/**
 * Variación entre una base previa y el valor actual. El porcentaje solo se
 * devuelve si `prev >= minBase`; con una base chica «+1400 %» es ruido.
 * `prev = 0` nunca da porcentaje (división por cero) aunque `minBase` sea 0.
 */
export function minBaseDelta(prev: number, cur: number, minBase: number = MIN_DELTA_BASE): BaseDelta {
  const abs = cur - prev;
  const pct = prev > 0 && prev >= minBase ? (abs / prev) * 100 : null;
  return { prev, cur, abs, pct, minBase };
}

// ============================================================
// Posición del día en la serie (paquete de hechos)
// ============================================================

interface DayTotals {
  date: string;
  negative: number;
  neutral: number;
  positive: number;
}

const dayTotal = (d: DayTotals) => d.negative + d.neutral + d.positive;

export interface DayPosition {
  date: string;
  total: number;
  /** 1 = el día de más volumen de la ventana. Empates comparten el mejor rango. */
  rank: number;
  /** Días de la serie. */
  of: number;
  /** El día de más volumen (primero en caso de empate). */
  peak: { date: string; total: number };
  /** Variación contra el día anterior de la serie (con base mínima), o null si es el primero. */
  vsPreviousDay: BaseDelta | null;
}

/**
 * Posición de `date` entre los días de la serie (por volumen), día pico y
 * variación contra el día previo con base mínima. `null` si `date` no está en
 * la serie. La serie es la del universo (`SentimentReport.dailySeries`).
 */
export function dayPosition(series: DayTotals[], date: string): DayPosition | null {
  const idx = series.findIndex((d) => d.date === date);
  if (idx < 0) return null;
  const total = dayTotal(series[idx]);
  const rank = 1 + series.filter((d) => dayTotal(d) > total).length;
  let peak = series[0];
  for (const d of series) if (dayTotal(d) > dayTotal(peak)) peak = d;
  return {
    date,
    total,
    rank,
    of: series.length,
    peak: { date: peak.date, total: dayTotal(peak) },
    vsPreviousDay: idx > 0 ? minBaseDelta(dayTotal(series[idx - 1]), total) : null,
  };
}
