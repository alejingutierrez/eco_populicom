/**
 * Frescura de los textos IA cacheados por ventana (overview_period_insights,
 * executive_summaries_cache, metric_insights_cache, topic_descriptions_cache).
 *
 * POR QUÉ. Las rutas trataban toda ventana con fin < ayer como «histórica
 * inmutable» y la servían para siempre, pero los datos de una ventana cerrada
 * SÍ cambian: llegan menciones tarde (latencia de Brandwatch) y, sobre todo,
 * llegan importaciones masivas (exportes de Bunker de DF). QA 23-oct-2026,
 * DF: el texto 15→21 oct dice «720 menciones» y hoy hay 1,037; 15 de 17 filas
 * de overview_period_insights desfasadas >10%; el resumen ejecutivo (sin TTL)
 * igual, y la descripción de asistencia-social 14→20 se generó sin 40 de sus
 * 95 menciones primarias.
 *
 * REGLA (sin cambio de esquema). Un caché está viejo si, en su ventana y en el
 * universo canónico (no duplicadas, pertinencia ≠ baja, día PR), hay menciones
 * con `ingested_at > generated_at` en una proporción que mueva las cifras que
 * cita el texto: ≥ 5% del total vivo y al menos 2. El umbral relativo evita
 * regenerar con Opus un año entero por UNA mención tardía (DDEC 18-oct-25→
 * 18-oct-26: 1 de 9,714). Una fila «sin señal» (se generó con < 10 menciones y
 * no tiene texto) está vieja en cuanto llegó algo y el total vivo ya alcanza
 * el mínimo (DF 19-oct: 81 menciones, 74 llegadas después).
 */
import type { PgClientLike } from '@eco/shared';

/** Mínimo de menciones con el que eco-ai-tasks / las rutas generan texto. */
export const AI_MIN_MENTIONS = 10;
/** Fracción de menciones llegadas después de generar que vuelve viejo el texto. */
export const AI_OUTDATED_SHARE = 0.05;
/** Piso absoluto: en ventanas chicas 1 mención tardía no justifica regenerar. */
export const AI_OUTDATED_MIN_NEW = 2;

export interface WindowFreshness {
  /** Menciones vivas de la ventana (universo canónico; del tópico si topicId). */
  total: number;
  /** De ésas, cuántas se ingirieron DESPUÉS de generar el texto. */
  newer: number;
}

/**
 * Una sola consulta: total vivo y cuántas llegaron después de `generatedAt`.
 * Los bordes van como timestamptz (día PR → UTC) para usar el índice
 * (agency_id, published_at). Con `topicId` cuenta solo las menciones cuyo
 * tópico PRIMARIO (top-confidence, mismo criterio que TOPICS de eco-data) es
 * ése.
 */
export async function loadWindowFreshness(
  pool: PgClientLike,
  opts: { agencyId: string; startYmd: string; endYmd: string; generatedAt: Date; topicId?: number },
): Promise<WindowFreshness> {
  const params: unknown[] = [opts.agencyId, opts.startYmd, opts.endYmd, opts.generatedAt.toISOString()];
  let topicFilter = '';
  if (opts.topicId != null) {
    params.push(opts.topicId);
    topicFilter = `
        AND (SELECT mt.topic_id FROM mention_topics mt
              WHERE mt.mention_id = m.id
              ORDER BY mt.confidence DESC NULLS LAST, mt.topic_id ASC
              LIMIT 1) = $5`;
  }
  const res = await pool.query<{ total: number | string; newer: number | string }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE m.ingested_at > $4::timestamptz)::int AS newer
       FROM mentions m
      WHERE m.agency_id = $1
        AND m.is_duplicate = false
        AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
        AND m.published_at >= ($2::date::timestamp AT TIME ZONE 'America/Puerto_Rico')
        AND m.published_at <  (($3::date + 1)::timestamp AT TIME ZONE 'America/Puerto_Rico')${topicFilter}`,
    params,
  );
  return {
    total: Number(res.rows[0]?.total ?? 0),
    newer: Number(res.rows[0]?.newer ?? 0),
  };
}

/**
 * ¿El texto cacheado describe datos que ya no son los de la base?
 * `wasEmpty` = la fila se guardó «sin señal» (sin texto); entonces basta con
 * que haya llegado algo y que hoy se alcance el mínimo para generar.
 */
export function isAiCacheOutdated(f: WindowFreshness, opts: { wasEmpty?: boolean } = {}): boolean {
  if (f.newer <= 0) return false;
  if (opts.wasEmpty) return f.total >= AI_MIN_MENTIONS;
  return f.newer >= Math.max(AI_OUTDATED_MIN_NEW, Math.ceil(f.total * AI_OUTDATED_SHARE));
}

/**
 * Dedup de disparos async a eco-ai-tasks. El SPA consulta cada 2–3 s mientras
 * recibe 202 (o mientras la fila sigue vieja) y cada consulta invocaba OTRA
 * generación Opus: ~10 por vista en los logs (QA 23-oct-2026). Con esto la
 * misma clave se dispara a lo sumo una vez cada 3 min por contenedor; si la
 * generación falla, el siguiente intento llega solo al vencer la ventana.
 */
export const AI_TRIGGER_DEDUP_MS = 3 * 60 * 1000;
const lastTriggerAt = new Map<string, number>();

export function claimAiTrigger(key: string, now: number = Date.now(), ttlMs: number = AI_TRIGGER_DEDUP_MS): boolean {
  const prev = lastTriggerAt.get(key);
  if (prev != null && now - prev < ttlMs) return false;
  lastTriggerAt.set(key, now);
  if (lastTriggerAt.size > 500) {
    for (const [k, t] of lastTriggerAt) if (now - t >= ttlMs) lastTriggerAt.delete(k);
  }
  return true;
}

/** Libera la clave si la invocación misma falló (para no esperar 3 min). */
export function releaseAiTrigger(key: string): void {
  lastTriggerAt.delete(key);
}
