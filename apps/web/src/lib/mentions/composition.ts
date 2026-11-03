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
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  commentShare,
  minBaseDelta,
  prWindowSql,
  universeFilterSql,
  type BaseDelta,
  type CommentShare,
  type PgClientLike,
  type SentimentTotals,
  type UniverseOptions,
} from '@eco/shared';
import { universeLabel } from './universe-config';
import { MENTION_KINDS, mentionKindExprSql, type MentionKind, type MentionKindAgency } from './kind';

/** Conteo del universo por tipo de mención (la barra de composición, spec 11.5). */
export type KindCounts = Record<MentionKind, number> & { total: number };

export interface CompositionPayload {
  /** Qué universo cuenta este payload (para rotular junto a las cifras). */
  universe: { strict: boolean; label: string };
  /**
   * Volumen del universo por TIPO de mención (comentario, publicación de la
   * agencia, nota de prensa, tercero), ventana actual y previa. Se cuenta con
   * la MISMA expresión que el filtro `mentionKind` de /api/eco-mentions
   * (`mentionKindExprSql`): el tramo de la barra y la lista que abre al hacer
   * clic suman lo mismo. (`commentShare` sigue contando con la definición de
   * @eco/shared, la de los correos.)
   */
  byKind: { current: KindCounts; previous: KindCounts };
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
  byKind: { current: KindCounts; previous: KindCounts } = { current: emptyKindCounts(), previous: emptyKindCounts() },
): CompositionPayload {
  return {
    universe: { strict: !!opts?.strictUniverse, label: universeLabel(opts, false) },
    byKind,
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

export function emptyKindCounts(): KindCounts {
  return { comment: 0, agency_post: 0, article: 0, third_party_post: 0, total: 0 };
}

/** Filas `{ kind, n }` de la consulta → conteos por tipo (un tipo desconocido solo suma al total). */
export function toKindCounts(rows: Array<{ kind: string | null; n: number | string }>): KindCounts {
  const out = emptyKindCounts();
  for (const r of rows) {
    const n = Number(r.n) || 0;
    out.total += n;
    if ((MENTION_KINDS as readonly string[]).includes(r.kind ?? '')) out[r.kind as MentionKind] += n;
  }
  return out;
}

/**
 * Expresión del tipo de mención lista para `pool.query`: la de Drizzle
 * (`mentionKindExprSql`) renderizada a texto, con sus parámetros renumerados a
 * partir de `$${offset + 1}` para convivir con `$1..$offset` de la consulta.
 */
export function kindExprForPool(agency: MentionKindAgency | null, offset: number): { text: string; params: unknown[] } {
  const q = new PgDialect().sqlToQuery(mentionKindExprSql(agency));
  return { text: q.sql.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + offset}`), params: q.params };
}

/** Volumen del universo por tipo en `[startYmd, endYmd]` (días PR), una consulta acotada por agencia y fechas. */
export async function kindCounts(
  pool: PgClientLike,
  agencyId: string,
  window: { startYmd: string; endYmd: string },
  opts: UniverseOptions | undefined,
  agency: MentionKindAgency | null,
): Promise<KindCounts> {
  const k = kindExprForPool(agency, 3);
  const r = await pool.query<{ kind: string | null; n: number | string }>(
    `SELECT ${k.text} AS kind, COUNT(*)::int AS n
       FROM mentions
      WHERE mentions.agency_id = $1
        ${universeFilterSql({ ...opts, strictUniverse: !!opts?.strictUniverse }, 'mentions.')}
        ${prWindowSql('mentions.')}
      GROUP BY 1`,
    [agencyId, window.startYmd, window.endYmd, ...k.params],
  );
  return toKindCounts(r.rows);
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
  /** Slug y nombre de la agencia (para los autores propios del tipo); si falta se consulta. */
  agency?: MentionKindAgency | null,
): Promise<CompositionPayload> {
  const o: UniverseOptions = { ...opts, strictUniverse: !!opts?.strictUniverse };
  let ag = agency;
  if (ag === undefined) {
    const r = await pool.query<{ slug: string; name: string | null }>('SELECT a.slug, a.name FROM agencies a WHERE a.id = $1 LIMIT 1', [agencyId]);
    ag = r.rows[0] ? { slug: r.rows[0].slug, name: r.rows[0].name ?? '' } : null;
  }
  const [cur, prev, kCur, kPrev] = await Promise.all([
    commentShare(pool, agencyId, { startYmd: win.startYmd, endYmd: win.endYmd }, o),
    commentShare(pool, agencyId, { startYmd: win.prevStartYmd, endYmd: win.prevEndYmd }, o),
    kindCounts(pool, agencyId, { startYmd: win.startYmd, endYmd: win.endYmd }, o, ag),
    kindCounts(pool, agencyId, { startYmd: win.prevStartYmd, endYmd: win.prevEndYmd }, o, ag),
  ]);
  return buildComposition(cur, prev, totals, opts, { current: kCur, previous: kPrev });
}
