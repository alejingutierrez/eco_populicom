import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, agencies } from '@eco/database';
import { eq } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const PERIOD_DAYS: Record<string, number> = {
  '1D': 1,
  '5D': 5,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1A': 365,
  Max: 730,
};

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

  const db = getDb();
  let agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    const [first] = await db
      .select({ id: agencies.id })
      .from(agencies)
      .where(eq(agencies.isActive, true))
      .limit(1);
    agencyId = first?.id ?? null;
  }
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

  return NextResponse.json({
    narratives,
    meta: {
      total: narratives.length,
      period: periodKey,
      statusFilter: statusFilter.length > 0 ? statusFilter : null,
    },
  });
}
