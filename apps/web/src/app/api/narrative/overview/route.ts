import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
import { addDaysYmd, resolveWindow } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { requireAuth } from '@/lib/auth/require-admin';
import { consume, clientKey } from '@/lib/rate-limit';
import { log } from '@/lib/log';
import {
  buildOverview, mondayOf, MAP_WEEKS, type OverviewPayload, type RawMentionRow,
} from '@/lib/narrative/overview';

export const dynamic = 'force-dynamic';

const TZ = 'America/Puerto_Rico';
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/narrative/overview — la página Narrativas (oct-2026) en una sola
 * respuesta: la serie de historias (30 días), el tablero por etapa de vida
 * (7 días contra los 7 anteriores), y el mapa de las últimas 26 semanas. La
 * propagación de cada narrativa va aparte (`/api/narrative/[id]/propagation`).
 *
 * Ventanas FIJAS que terminan ayer (AST): la página no usa el selector de
 * periodo, porque cada bloque tiene su propia escala de tiempo.
 *
 * Universo, el mismo en los cuatro bloques:
 *  - solo la asignación principal de cada mención (`nm.is_primary = true`) en
 *    narrativas no fusionadas;
 *  - sin duplicados y pertinente (el universo PERTINENTE del resto del
 *    dashboard);
 *  - «solo fecha»: una mención a medianoche UTC pertenece a su fecha UTC (en
 *    hora de PR caería el día anterior a las 8 p. m.). El día efectivo se
 *    calcula en JS con `mentionWhen`, y el SQL ensancha los bordes para no
 *    perder ninguna.
 *
 * Las cifras (conteos, origen, picos, historias, cajón, duplicados) se
 * calculan en `lib/narrative/overview.ts`; aquí solo se traen las filas.
 */

// Filas de toda la vida de las narrativas que tocan el mapa. El CTE decide
// qué narrativas entran (una mención del universo desde el lunes de la semana
// más antigua del mapa); la consulta exterior trae todas sus menciones, porque
// el origen, el pico de 14 días y el cajón se miden sobre la vida entera.
const ROWS_SQL = `
WITH touch AS (
  SELECT DISTINCT nm.narrative_id
    FROM narrative_mentions nm
    JOIN narratives n ON n.id = nm.narrative_id
    JOIN mentions m ON m.id = nm.mention_id
   WHERE n.agency_id = $1 AND n.merged_into_id IS NULL AND m.agency_id = $1
     AND nm.is_primary = true
     AND m.is_duplicate = false
     AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
     AND m.published_at >= $2::timestamptz
     AND m.published_at < $3::timestamptz
)
SELECT nm.narrative_id AS nid, m.id, m.published_at, m.url, m.title, m.page_type,
       m.author, m.author_fullname, m.domain,
       COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
       (COALESCE(m.likes, 0) + COALESCE(m.comments, 0) + COALESCE(m.shares, 0)) AS inter
  FROM touch t
  JOIN narrative_mentions nm ON nm.narrative_id = t.narrative_id
  JOIN mentions m ON m.id = nm.mention_id
 WHERE nm.is_primary = true AND m.agency_id = $1
   AND m.is_duplicate = false
   AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
   AND m.published_at < $3::timestamptz`;

// Todas las menciones del universo por día efectivo, y cuántas tienen una
// narrativa principal viva. La fila de contexto del mapa: una semana con
// menciones y ninguna en narrativas es un hueco del agrupador, no silencio
// (del 6 al 19 de julio de 2026 estuvo detenido).
const CONTEXT_SQL = `
SELECT day, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE in_narr)::int AS in_narr
  FROM (
    SELECT to_char(CASE WHEN (m.published_at AT TIME ZONE 'UTC')::time = '00:00'
                        THEN (m.published_at AT TIME ZONE 'UTC')::date
                        ELSE (m.published_at AT TIME ZONE '${TZ}')::date END, 'YYYY-MM-DD') AS day,
           EXISTS (SELECT 1 FROM narrative_mentions nm
                     JOIN narratives n ON n.id = nm.narrative_id
                    WHERE nm.mention_id = m.id AND nm.is_primary = true
                      AND n.merged_into_id IS NULL AND n.agency_id = $1) AS in_narr
      FROM mentions m
     WHERE m.agency_id = $1
       AND m.is_duplicate = false
       AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
       AND m.published_at >= $2::timestamptz
       AND m.published_at < $3::timestamptz
  ) z
 WHERE day BETWEEN $4 AND $5
 GROUP BY day`;

// Coseno de centroides entre las narrativas candidatas. Solo los pares que
// pueden formar una historia (≥ 0.44) o un duplicado (≥ 0.60): el resto no
// hace falta y así no viajan miles de filas. Barrido por JOIN, exacto (sin el
// índice ivfflat aproximado).
const PAIRS_SQL = `
SELECT a.id AS a, b.id AS b, (1 - (a.centroid <=> b.centroid))::float8 AS sim
  FROM narratives a
  JOIN narratives b ON a.id < b.id
 WHERE a.id = ANY($1::uuid[]) AND b.id = ANY($1::uuid[])
   AND a.agency_id = $2 AND b.agency_id = $2
   AND a.centroid IS NOT NULL AND b.centroid IS NOT NULL
   AND 1 - (a.centroid <=> b.centroid) >= 0.44`;

// Caché por agencia y día: el agrupador corre cada 30 minutos y la página se
// recarga al cambiar de agencia; 10 minutos de frescura bastan.
const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; payload: OverviewPayload }>();
// Varias peticiones simultáneas de la misma agencia comparten un solo cálculo.
const inflight = new Map<string, Promise<OverviewPayload>>();

export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const rl = consume('narrative-overview:' + clientKey(request), { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } });
  }
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  // Último día con datos: ayer en AST. `to` (YYYY-MM-DD, no posterior a ayer)
  // corta las ventanas en otro día; el estado de cada narrativa (naciendo,
  // activa…) y los conteos de terminadas siguen siendo los de hoy.
  const yesterday = resolveWindow({ period: '1D', timeZone: TZ })!.endYmd;
  const toParam = searchParams.get('to');
  if (toParam && (!YMD_RE.test(toParam) || addDaysYmd(toParam, 0) !== toParam)) {
    return NextResponse.json({ error: 'Invalid to (YYYY-MM-DD)' }, { status: 400 });
  }
  const endYmd = toParam && toParam < yesterday ? toParam : yesterday;

  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ agency: null, asOf: endYmd, narratives: [], series: [], board: { emerging: [], active: [], declining: [] }, lanes: [], stories: [], context: [], alertId: null, cajones: [], counts: { live: 0, dormant: 0, dormantSince: null } });
  }

  const cacheKey = `${agencyId}|${endYmd}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.payload, { headers: { 'Cache-Control': 'private, max-age=60' } });
  }

  try {
    let job = inflight.get(cacheKey);
    if (!job) {
      job = computeOverview(agencyId, endYmd).finally(() => inflight.delete(cacheKey));
      inflight.set(cacheKey, job);
    }
    const payload = await job;
    cache.set(cacheKey, { at: Date.now(), payload });
    if (cache.size > 50) cache.delete(cache.keys().next().value as string);
    log.info('narrative-overview', 'request complete', {
      ms: Date.now() - t0, agencyId, endYmd, narratives: payload.narratives.length,
    });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (err) {
    log.error('narrative-overview', 'handler failed', { msg: (err as Error).message, agencyId });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

async function computeOverview(agencyId: string, endYmd: string): Promise<OverviewPayload> {
  const pool = getPool();
  const mapFrom = addDaysYmd(mondayOf(endYmd), -7 * (MAP_WEEKS - 1));
  // Bordes holgados: una «solo fecha» del primer día está a las 00:00Z; la
  // última mención con hora del día final, antes de las 04:00Z del siguiente.
  const lo = `${mapFrom}T00:00:00Z`;
  const hi = `${addDaysYmd(endYmd, 1)}T04:00:00Z`;

  const [agencyRes, rowsRes, metaRes, ctxRes, statusRes] = await Promise.all([
    pool.query<{ slug: string; name: string | null }>('SELECT slug, name FROM agencies WHERE id = $1', [agencyId]),
    pool.query<RawMentionRow>(ROWS_SQL, [agencyId, lo, hi]),
    pool.query(
      `SELECT id, name, summary, keywords, status, born_at, last_mention_at, created_at
         FROM narratives WHERE agency_id = $1 AND merged_into_id IS NULL`, [agencyId]),
    pool.query<{ day: string; total: number; in_narr: number }>(CONTEXT_SQL, [agencyId, lo, hi, mapFrom, endYmd]),
    pool.query<{ status: string; n: number; first_born: Date | null }>(
      `SELECT status, COUNT(*)::int AS n, MIN(born_at) AS first_born
         FROM narratives WHERE agency_id = $1 AND merged_into_id IS NULL GROUP BY status`, [agencyId]),
  ]);
  const agency = agencyRes.rows[0] ?? { slug: '', name: null };
  const ids = [...new Set(rowsRes.rows.map((r) => r.nid))];
  const pairsRes = ids.length > 1
    ? await pool.query<{ a: string; b: string; sim: number }>(PAIRS_SQL, [ids, agencyId])
    : { rows: [] as { a: string; b: string; sim: number }[] };

  const touched = new Set(ids);
  const payload = buildOverview({
    agency: { slug: agency.slug, name: agency.name },
    endYmd,
    rows: rowsRes.rows,
    metas: metaRes.rows.filter((m) => touched.has(m.id)),
    agencyNames: metaRes.rows.map((m) => ({ name: m.name, keywords: m.keywords })),
    pairs: pairsRes.rows.map((p) => ({ a: p.a, b: p.b, sim: Number(p.sim) })),
    contextDays: ctxRes.rows,
    statusCounts: statusRes.rows,
  });
  return payload;
}
