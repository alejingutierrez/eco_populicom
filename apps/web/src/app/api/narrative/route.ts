import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
import { PERIOD_DAYS } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// PERIOD_DAYS: mapa canónico de @eco/shared. El local anterior no tenía
// 7D/30D/90D y esos chips caían en silencio a 730 días (auditoría 2026-08).
// El filtro sigue siendo por RECENCIA de actividad (last_mention_at), no una
// ventana de conteo — las narrativas son entidades vivas, no agregados.

interface NarrativeListItem {
  id: string;
  name: string;
  slug: string;
  summary: string | null;
  keywords: string[];
  status: string;
  mentionCount: number;
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
 * GET /api/narratives — lista narrativas para el grafo.
 *
 * Query params:
 *   agency        slug (default vía resolveAgencyId)
 *   status        comma-separated, ej. "active,peaking,emerging"
 *   period        1D|5D|1M|3M|6M|1A|Max (default Max)
 *   minMentions   filtra mention_count >= N
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
  const days = PERIOD_DAYS[periodKey] ?? 730;
  const statusFilter = (searchParams.get('status') ?? '').split(',').filter(Boolean);
  const minMentions = Math.max(0, Number(searchParams.get('minMentions') ?? 0));
  const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit') ?? 250)));

  // Sin fallback a "primera agencia activa": resolveAgencyId ya resuelve
  // dentro del set PERMITIDO del usuario; null = set vacío, y servir otra
  // agencia era un leak de tenant (auditoría 2026-08, P1-1).
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ narratives: [], meta: { total: 0, period: periodKey } });
  }

  const pgPool = getPool();

  const params: unknown[] = [agencyId];
  let where = 'n.agency_id = $1';
  if (statusFilter.length > 0) {
    params.push(statusFilter);
    where += ` AND n.status = ANY($${params.length}::text[])`;
  }
  if (days < 730) {
    where += ` AND (n.last_mention_at IS NULL OR n.last_mention_at >= NOW() - INTERVAL '${days} days')`;
  }
  if (minMentions > 0) {
    params.push(minMentions);
    where += ` AND n.mention_count >= $${params.length}`;
  }
  params.push(limit);

  const result = await pgPool.query(
    `SELECT n.id, n.name, n.slug, n.summary, n.keywords, n.status,
            n.mention_count AS "mentionCount",
            n.velocity_24h  AS "velocity24h",
            n.total_engagement AS "totalEngagement",
            n.total_reach   AS "totalReach",
            n.born_at       AS "bornAt",
            n.last_mention_at AS "lastMentionAt",
            n.peaked_at     AS "peakedAt",
            n.initiator_first AS "initiatorFirst",
            n.initiator_influencer AS "initiatorInfluencer"
       FROM narratives n
       WHERE ${where}
       ORDER BY n.mention_count DESC, n.born_at DESC
       LIMIT $${params.length}`,
    params,
  );

  const narratives = (result.rows as NarrativeListItem[]).map((r) => ({
    ...r,
    mentionCount: Number(r.mentionCount ?? 0),
    velocity24h: Number(r.velocity24h ?? 0),
    totalEngagement: Number(r.totalEngagement ?? 0),
    totalReach: Number(r.totalReach ?? 0),
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
  }));

  // Sparklines: últimas 30 día de menciones/día por narrativa. Una sola query
  // (left join generate_series) para no hacer N+1 al frontend.
  const sparklineRows = narratives.length > 0
    ? await pgPool.query(
        `WITH days AS (
           SELECT generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day')::date AS day
         )
         SELECT n.id AS narrative_id,
                to_char(d.day, 'YYYY-MM-DD') AS day,
                COALESCE(COUNT(m.id), 0)::int AS cnt
           FROM narratives n
           CROSS JOIN days d
           LEFT JOIN narrative_mentions nm ON nm.narrative_id = n.id AND nm.is_primary = true
           LEFT JOIN mentions m ON m.id = nm.mention_id
             AND date_trunc('day', m.published_at AT TIME ZONE 'America/Puerto_Rico')::date = d.day
           WHERE n.id = ANY($1::uuid[])
           GROUP BY n.id, d.day
           ORDER BY n.id, d.day`,
        [narratives.map((n) => n.id)],
      )
    : { rows: [] as Array<{ narrative_id: string; day: string; cnt: number }> };

  // Group by narrative_id → ordered array of 30 counts
  const sparklineByNarrative: Record<string, number[]> = {};
  for (const row of sparklineRows.rows as Array<{ narrative_id: string; day: string; cnt: number }>) {
    if (!sparklineByNarrative[row.narrative_id]) sparklineByNarrative[row.narrative_id] = [];
    sparklineByNarrative[row.narrative_id].push(Number(row.cnt));
  }

  const narrativesWithSpark = narratives.map((n) => ({
    ...n,
    sparkline: sparklineByNarrative[n.id] || new Array(30).fill(0),
  }));

  return NextResponse.json({
    narratives: narrativesWithSpark,
    meta: {
      total: narrativesWithSpark.length,
      period: periodKey,
      statusFilter: statusFilter.length > 0 ? statusFilter : null,
    },
  });
}
