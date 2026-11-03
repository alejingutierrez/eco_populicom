/**
 * Composición del volumen y deltas con base mínima para los payloads de
 * /api/overview y /api/eco-data (WP-9a, spec interpretación v1 secciones 10.2
 * y 11.5).
 *
 *  - `commentShare`: qué parte del universo son comentarios de usuarios en las
 *    redes de la agencia, en la ventana actual y en la previa (en DDEC 25–31
 *    oct el 82.8 % de las «menciones» eran comentarios). Sale de
 *    `commentShare` de @eco/shared (numerador y denominador en la MISMA query).
 *  - `deltas`: variación de volumen y de cada sentimiento contra la ventana
 *    previa con `minBaseDelta`: el porcentaje solo se ofrece con una base
 *    previa ≥ 30 menciones; debajo, solo la diferencia absoluta (nunca
 *    «+1400 %»).
 *
 * Todo es ADITIVO: los campos que ya existían en los payloads no cambian.
 * Sigue el universo de la ruta (`opts`): con la bandera apagada cuenta sobre
 * el universo histórico, el mismo de los totales que se muestran al lado.
 */
import {
  commentShare,
  minBaseDelta,
  type BaseDelta,
  type CommentShare,
  type PgClientLike,
  type SentimentTotals,
  type UniverseOptions,
} from '@eco/shared';
import { universeLabel } from './universe-config';

export interface CompositionPayload {
  /** Qué universo cuenta este payload (para rotular junto a las cifras). */
  universe: { strict: boolean; label: string };
  commentShare: {
    current: CommentShare;
    previous: CommentShare;
    /** Cambio en puntos de porcentaje (actual − previa); null si alguna ventana está vacía. */
    deltaPts: number | null;
  };
  /** Variación contra la ventana previa con base mínima (porcentaje solo si prev ≥ minBase). */
  deltas: {
    total: BaseDelta;
    positive: BaseDelta;
    neutral: BaseDelta;
    negative: BaseDelta;
  };
}

export interface CompositionWindow {
  startYmd: string;
  endYmd: string;
  prevStartYmd: string;
  prevEndYmd: string;
}

/** Aritmética del bloque, separada del acceso a datos para probarla sin DB. */
export function buildComposition(
  cur: CommentShare,
  prev: CommentShare,
  totals: { cur: SentimentTotals; prev: SentimentTotals },
  opts: UniverseOptions | undefined,
): CompositionPayload {
  return {
    universe: { strict: !!opts?.strictUniverse, label: universeLabel(opts, false) },
    commentShare: {
      current: cur,
      previous: prev,
      deltaPts: cur.total > 0 && prev.total > 0 ? Number((cur.pct - prev.pct).toFixed(1)) : null,
    },
    deltas: {
      total: minBaseDelta(totals.prev.total, totals.cur.total),
      positive: minBaseDelta(totals.prev.positive, totals.cur.positive),
      neutral: minBaseDelta(totals.prev.neutral, totals.cur.neutral),
      negative: minBaseDelta(totals.prev.negative, totals.cur.negative),
    },
  };
}

/**
 * Carga la composición de las dos ventanas (2 consultas acotadas por agencia y
 * fechas; no escanean la tabla). `commentShare` de @eco/shared usa el universo
 * ESTRICTO por defecto: aquí se fija al de la ruta para que el denominador sea
 * el mismo total que se muestra.
 */
export async function loadComposition(
  pool: PgClientLike,
  agencyId: string,
  win: CompositionWindow,
  opts: UniverseOptions | undefined,
  totals: { cur: SentimentTotals; prev: SentimentTotals },
): Promise<CompositionPayload> {
  const o: UniverseOptions = { ...opts, strictUniverse: !!opts?.strictUniverse };
  const [cur, prev] = await Promise.all([
    commentShare(pool, agencyId, { startYmd: win.startYmd, endYmd: win.endYmd }, o),
    commentShare(pool, agencyId, { startYmd: win.prevStartYmd, endYmd: win.prevEndYmd }, o),
  ]);
  return buildComposition(cur, prev, totals, opts);
}
