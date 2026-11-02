import { MIN_WINDOW_MENTIONS } from '@eco/shared';
import { computeSentimentAnalysis } from '../../sentiment/payload';
import type { AdvisorToolSpec } from './types';
import {
  asArgs, closedWindow, errorResult, guard, objectSchema, P_LIMIT, P_RESPONSE_FORMAT, readLimit, readNarrativeRef,
  readResponseFormat, round1, toResult, withList,
} from './common';

const DAY = `(m.published_at AT TIME ZONE 'America/Puerto_Rico')::date`;
const POS = `COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('positivo','positive')`;
const NEG = `COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative')`;

/**
 * Narrativas primarias de la agencia con sus menciones en la ventana actual y en
 * la anterior. Parámetros: $1 agencia, $2 inicio previo, $3 inicio actual,
 * $4 fin actual, $5 asOf, $6 narrativa (opcional).
 */
const movers = (conNarrativa: boolean) => `
SELECT n.id::text AS id, n.name AS name,
       COUNT(*) FILTER (WHERE ${DAY} >= $3::date)::int AS n_cur,
       COUNT(*) FILTER (WHERE ${DAY} >= $3::date AND ${POS})::int AS pos_cur,
       COUNT(*) FILTER (WHERE ${DAY} >= $3::date AND ${NEG})::int AS neg_cur,
       COUNT(*) FILTER (WHERE ${DAY} < $3::date)::int AS n_prev,
       COUNT(*) FILTER (WHERE ${DAY} < $3::date AND ${POS})::int AS pos_prev,
       COUNT(*) FILTER (WHERE ${DAY} < $3::date AND ${NEG})::int AS neg_prev
  FROM narrative_mentions nm
  JOIN narratives n ON n.id = nm.narrative_id AND n.agency_id = $1::uuid
  JOIN mentions m ON m.id = nm.mention_id AND m.agency_id = $1::uuid
 WHERE nm.is_primary = true
   AND m.is_duplicate = false
   AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
   AND m.published_at <= $5
   AND ${DAY} >= $2::date
   AND ${DAY} <= $4::date
   ${conNarrativa ? 'AND nm.narrative_id = $6::uuid' : ''}
 GROUP BY n.id, n.name`;

interface MoverRow {
  id: string;
  name: string;
  n_cur: number | string;
  pos_cur: number | string;
  neg_cur: number | string;
  n_prev: number | string;
  pos_prev: number | string;
  neg_prev: number | string;
}

/** Quién movió el NSS: grupos por voz, narrativas que movieron el tono y emociones de 12 semanas. */
export const quienMovioNss: AdvisorToolSpec = {
  def: {
    name: 'quien_movio_nss',
    description:
      'Qué movió el NSS (tono neto) de la agencia en los últimos 7 días cerrados frente a los 7 anteriores: grupos por voz (agencia, comentarios, prensa, gobierno, otras), narrativas que más cambiaron y emociones de 12 semanas. Con «narrativa» («N-<id>») devuelve solo esa narrativa.',
    input_schema: objectSchema({
      narrativa: { type: 'string', description: 'Opcional. ID de narrativa con formato N-<identificador>, tal como lo devolvió una consulta previa.' },
      limite: P_LIMIT,
      response_format: P_RESPONSE_FORMAT,
    }),
    strict: true,
  },
  run: (ctx, args) =>
    guard(async () => {
      const a = asArgs(args, ['narrativa', 'limite', 'response_format'], 'quien_movio_nss');
      const formato = readResponseFormat(a.response_format);
      const limite = readLimit(a.limite);
      const tope = formato === 'detalle' ? limite : Math.min(limite, 5);
      const narrativaId = readNarrativeRef(a.narrativa);
      const win = closedWindow(ctx.asOf, 7);

      // Pertenencia antes que cualquier otra consulta: un ID ajeno es «no encontrado».
      if (narrativaId) {
        const own = await ctx.pool.query<{ id: string }>(
          `SELECT id::text AS id FROM narratives WHERE id = $1::uuid AND agency_id = $2::uuid`,
          [narrativaId, ctx.agencyId],
        );
        if (own.rows.length === 0) {
          return errorResult(`no encontrado: la narrativa «N-${narrativaId}» no existe para esta agencia. Usa un ID devuelto por una consulta de esta agencia, por ejemplo con la lista sin «narrativa».`);
        }
      }

      const params: unknown[] = [ctx.agencyId, win.prevStartYmd, win.startYmd, win.endYmd, ctx.asOf];
      if (narrativaId) params.push(narrativaId);

      const [sent, mov] = await Promise.all([
        computeSentimentAnalysis(ctx.pool, { id: ctx.agencyId, slug: ctx.agencySlug, name: ctx.agencyName }, win),
        ctx.pool.query<MoverRow>(movers(!!narrativaId), params),
      ]);

      // Ordenadas por cuánto cambió su balance neto (positivas menos negativas), en menciones.
      const narrativas = mov.rows
        .map((r) => {
          const nCur = Number(r.n_cur) || 0, nPrev = Number(r.n_prev) || 0;
          const netCur = (Number(r.pos_cur) || 0) - (Number(r.neg_cur) || 0);
          const netPrev = (Number(r.pos_prev) || 0) - (Number(r.neg_prev) || 0);
          return {
            fila: {
              id: `N-${r.id}`,
              nombre: String(r.name),
              menciones: { actual: nCur, previo: nPrev },
              nss: { actual: nCur ? round1((netCur / nCur) * 100) : null, previo: nPrev ? round1((netPrev / nPrev) * 100) : null },
              cambio_neto: netCur - netPrev,
            },
            abs: Math.abs(netCur - netPrev),
          };
        })
        .filter((r) => r.fila.menciones.actual + r.fila.menciones.previo > 0)
        .sort((x, y) => y.abs - x.abs || x.fila.id.localeCompare(y.fila.id))
        .map((r) => r.fila);

      const { shift } = sent;
      const base: Record<string, unknown> = {
        ok: true,
        herramienta: 'quien_movio_nss',
        ventana: {
          desde: win.startYmd,
          hasta: win.endYmd,
          previa: { desde: win.prevStartYmd, hasta: win.prevEndYmd },
          criterio: '7 días cerrados; el último es ayer (America/Puerto_Rico)',
        },
        nss: {
          actual: shift.cur.nss,
          previo: shift.prev.nss,
          menciones_actual: shift.cur.n,
          menciones_previo: shift.prev.n,
          muestra_baja: sent.lowSample,
          minimo_por_ventana: MIN_WINDOW_MENTIONS,
        },
        quien_por_voz: shift.groups.map((g) => ({
          grupo: g.key,
          menciones_actual: g.cur.n,
          nss_actual: g.now,
          nss_previo: g.before,
          cambio_nss: g.delta,
        })),
        emociones: {
          con_emocion: sent.withEmotion,
          total: sent.total,
          tono: sent.emotionTone.slice(0, tope),
          // 12 semanas en ambos formatos; en resumen solo las 5 emociones más frecuentes.
          semanas: formato === 'detalle'
            ? sent.emotionWeeks
            : { weeks: sent.emotionWeeks.weeks, rows: sent.emotionWeeks.rows.slice(0, 5) },
        },
      };
      if (narrativaId) {
        return toResult({ ...base, narrativa: narrativas[0] ?? { id: `N-${narrativaId}`, menciones: { actual: 0, previo: 0 }, nss: { actual: null, previo: null }, cambio_neto: 0 } });
      }
      return withList(base, 'narrativas', narrativas.slice(0, tope), narrativas.length, 'Pide response_format "detalle" o un límite mayor, o consulta una narrativa concreta con «narrativa».');
    }),
};
