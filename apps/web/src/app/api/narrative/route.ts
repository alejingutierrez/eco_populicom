import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
import { PERIOD_DAYS, resolveWindow } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const TZ = 'America/Puerto_Rico';
// AST no tiene horario de verano: el offset es -04:00 todo el año, así que los
// bordes de la ventana se pueden construir por concatenación sin ambigüedad.
const AST = '-04:00';

// N8 (ago-2026): la ventana ahora FILTRA Y CUENTA. Antes había dos semánticas
// incompatibles —presets por recencia rolling de last_mention_at, from/to por
// solape de vida— y ninguna era la del resto del producto; encima el SPA no
// mandaba ninguna de las dos, así que todo el bloque era código muerto y la
// pantalla ignoraba el selector de período.
//
// Semántica única, la misma que /api/overview: ventana CERRADA de N días
// terminando AYER en AST (resolveWindow de @eco/shared). Una narrativa aparece
// si tiene AL MENOS UNA mención pertinente dentro de la ventana, y todas sus
// cifras —conteo, engagement, alcance, sparkline— son de la ventana, no de su
// vida entera. Es lo que hace que los números cuadren con Menciones y Tópicos.

interface NarrativeListItem {
  id: string;
  name: string;
  slug: string;
  summary: string | null;
  keywords: string[];
  status: string;
  mentionCount: number;
  lifetimeMentionCount: number;
  velocity24h: number;
  totalEngagement: number;
  totalReach: number;
  bornAt: string;
  lastMentionAt: string | null;
  peakedAt: string | null;
  initiatorFirst: Record<string, unknown> | null;
  initiatorInfluencer: Record<string, unknown> | null;
}

/**
 * GET /api/narrative — lista narrativas con actividad en la ventana.
 *
 * Query params:
 *   agency        slug (default vía resolveAgencyId)
 *   status        comma-separated, ej. "active,peaking,emerging"
 *   period        clave de PERIOD_DAYS (1D…Max). Ventana cerrada terminando ayer.
 *   from,to       YYYY-MM-DD inclusivos; ganan sobre period.
 *   minMentions   filtra por menciones EN LA VENTANA >= N
 *   limit         default 250, max 500
 */
export async function GET(request: NextRequest) {
  const rl = consume('narratives:' + clientKey(request), { limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } },
    );
  }

  const { searchParams } = new URL(request.url);
  const periodKey = searchParams.get('period') ?? 'Max';
  const win = resolveWindow({
    period: periodKey,
    from: searchParams.get('from'),
    to: searchParams.get('to'),
    timeZone: TZ,
  });
  if (!win) {
    return NextResponse.json(
      { error: `Unsupported period: ${periodKey}. Valid: ${Object.keys(PERIOD_DAYS).join(', ')}, or pass from/to.` },
      { status: 400 },
    );
  }

  const statusFilter = (searchParams.get('status') ?? '').split(',').filter(Boolean);
  // Number('abc') es NaN y Math.min/max lo propagan: el NaN llegaba hasta
  // `LIMIT $n` y Postgres respondía 22P02, así que un query param con basura
  // devolvía 500 en vez de caer al default.
  const rawMin = Number(searchParams.get('minMentions'));
  const minMentions = Number.isFinite(rawMin) ? Math.max(0, rawMin) : 0;
  const rawLimit = Number(searchParams.get('limit') ?? 250);
  const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, rawLimit)) : 250;

  // Sin fallback a "primera agencia activa": resolveAgencyId ya resuelve
  // dentro del set PERMITIDO del usuario; null = set vacío, y servir otra
  // agencia era un leak de tenant (auditoría 2026-08, P1-1).
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ narratives: [], meta: { total: 0, period: periodKey } });
  }

  const pgPool = getPool();

  const startTs = `${win.startYmd}T00:00:00${AST}`;
  // Borde superior EXCLUSIVO: el día `to` entero entra, sin depender de cuántos
  // decimales de segundo traiga published_at.
  const endTsExcl = `${win.endYmd}T23:59:59.999${AST}`;

  const params: unknown[] = [agencyId, startTs, endTsExcl];
  let where = 'n.agency_id = $1 AND n.merged_into_id IS NULL';
  if (statusFilter.length > 0) {
    params.push(statusFilter);
    where += ` AND n.status = ANY($${params.length}::text[])`;
  }
  if (minMentions > 0) {
    params.push(minMentions);
    where += ` AND w.cnt >= $${params.length}`;
  }
  params.push(limit);

  // `win` agrega UNA vez por narrativa sobre las menciones de la ventana; el
  // JOIN (no LEFT JOIN) es lo que impone "solo narrativas con actividad en el
  // período". El filtro por agencia va también sobre mentions para que el
  // planner pode antes de agrupar.
  const result = await pgPool.query(
    `WITH win AS (
       SELECT nm.narrative_id,
              COUNT(*)::int AS cnt,
              COALESCE(SUM(m.engagement_score), 0)::bigint AS eng,
              COALESCE(SUM(m.reach_estimate), 0)::bigint AS reach,
              MAX(m.published_at) AS last_at
         FROM narrative_mentions nm
         JOIN mentions m ON m.id = nm.mention_id
        WHERE nm.is_primary = true
          AND m.is_duplicate = false
          AND m.agency_id = $1
          AND m.published_at >= $2::timestamptz
          AND m.published_at <= $3::timestamptz
        GROUP BY nm.narrative_id
     )
     SELECT n.id, n.name, n.slug, n.summary, n.keywords, n.status,
            w.cnt            AS "mentionCount",
            n.mention_count  AS "lifetimeMentionCount",
            n.velocity_24h   AS "velocity24h",
            w.eng            AS "totalEngagement",
            w.reach          AS "totalReach",
            n.born_at        AS "bornAt",
            w.last_at        AS "lastMentionAt",
            n.peaked_at      AS "peakedAt",
            n.initiator_first AS "initiatorFirst",
            n.initiator_influencer AS "initiatorInfluencer"
       FROM narratives n
       JOIN win w ON w.narrative_id = n.id
       WHERE ${where}
       ORDER BY w.cnt DESC, n.born_at DESC
       LIMIT $${params.length}`,
    params,
  );

  const narratives = (result.rows as NarrativeListItem[]).map((r) => ({
    ...r,
    mentionCount: Number(r.mentionCount ?? 0),
    lifetimeMentionCount: Number(r.lifetimeMentionCount ?? 0),
    velocity24h: Number(r.velocity24h ?? 0),
    totalEngagement: Number(r.totalEngagement ?? 0),
    totalReach: Number(r.totalReach ?? 0),
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
  }));

  // Sparkline: la miniserie sigue la VENTANA, no unos 30 días fijos. Antes
  // estaba clavada a CURRENT_DATE-29d, así que una narrativa dormida desde hacía
  // meses se veía como una línea plana en cero al lado de "1,240 menciones".
  //
  // Con ventanas largas se agrupa en cubos de varios días para no devolver 730
  // puntos a un SVG de 56×18. `bucketDays` se calcula aquí y viaja como
  // parámetro para que el agrupado ocurra en SQL.
  const bucketDays = Math.max(1, Math.ceil(win.days / 60));
  const sparklineRows = narratives.length > 0
    ? await pgPool.query(
        `WITH buckets AS (
           -- El paso va como $4::int * INTERVAL '1 day'. Construirlo concatenando
           -- el parámetro con la palabra days lo fija como text y revienta en
           -- cuanto se reusa en aritmética — aquí se reusa dos veces más abajo
           -- como ::int. Hay un test de contrato que prohíbe esa otra forma.
           SELECT generate_series(
                    $2::date,
                    $3::date,
                    ($4::int * INTERVAL '1 day')
                  )::date AS bstart
         ),
         hits AS (
           SELECT nm.narrative_id,
                  $2::date + (
                    (((m.published_at AT TIME ZONE '${TZ}')::date - $2::date) / $4::int) * $4::int
                  ) AS bstart,
                  COUNT(*)::int AS cnt
             FROM narrative_mentions nm
             JOIN mentions m ON m.id = nm.mention_id
            WHERE nm.narrative_id = ANY($1::uuid[])
              AND nm.is_primary = true
              AND m.is_duplicate = false
              AND (m.published_at AT TIME ZONE '${TZ}')::date BETWEEN $2::date AND $3::date
            GROUP BY 1, 2
         )
         SELECT n.id AS narrative_id,
                to_char(b.bstart, 'YYYY-MM-DD') AS day,
                COALESCE(h.cnt, 0)::int AS cnt
           FROM unnest($1::uuid[]) AS n(id)
           CROSS JOIN buckets b
           LEFT JOIN hits h ON h.narrative_id = n.id AND h.bstart = b.bstart
          ORDER BY n.id, b.bstart`,
        [narratives.map((n) => n.id), win.startYmd, win.endYmd, bucketDays],
      )
    : { rows: [] as Array<{ narrative_id: string; day: string; cnt: number }> };

  const sparklineByNarrative: Record<string, number[]> = {};
  for (const row of sparklineRows.rows as Array<{ narrative_id: string; day: string; cnt: number }>) {
    if (!sparklineByNarrative[row.narrative_id]) sparklineByNarrative[row.narrative_id] = [];
    sparklineByNarrative[row.narrative_id].push(Number(row.cnt));
  }
  const bucketCount = Math.max(1, Math.floor((win.days - 1) / bucketDays) + 1);

  const narrativesWithSpark = narratives.map((n) => ({
    ...n,
    sparkline: sparklineByNarrative[n.id] || new Array(bucketCount).fill(0),
  }));

  return NextResponse.json({
    narratives: narrativesWithSpark,
    meta: {
      total: narrativesWithSpark.length,
      period: periodKey,
      from: win.startYmd,
      to: win.endYmd,
      days: win.days,
      custom: win.custom,
      bucketDays,
      statusFilter: statusFilter.length > 0 ? statusFilter : null,
    },
  });
}
