import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, agencies } from '@eco/database';
import { eq } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/narratives/[id] — detalle completo de una narrativa.
 *
 * Devuelve:
 *   - Metadatos (name, summary, keywords, status, ambos iniciadores)
 *   - Timeline diario de menciones (counts/día)
 *   - Top 10 autores
 *   - Breakdown por plataforma (page_type)
 *   - Edges salientes
 *   - Sample mentions (10 más recientes con title/url)
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rl = consume('narratives-detail:' + clientKey(request), { limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
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
  if (!agencyId) return NextResponse.json({ error: 'No agency' }, { status: 404 });

  const pgPool = getPool();

  const narrativeRes = await pgPool.query(
    `SELECT n.id, n.name, n.slug, n.summary, n.keywords, n.status,
            n.mention_count AS "mentionCount", n.velocity_24h AS "velocity24h",
            n.total_engagement AS "totalEngagement", n.total_reach AS "totalReach",
            n.born_at AS "bornAt", n.last_mention_at AS "lastMentionAt",
            n.peaked_at AS "peakedAt",
            n.initiator_first AS "initiatorFirst",
            n.initiator_influencer AS "initiatorInfluencer"
       FROM narratives n
       WHERE n.id = $1 AND n.agency_id = $2`,
    [id, agencyId],
  );
  if (narrativeRes.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const narrative = narrativeRes.rows[0];

  // Timeline diario (mentions/day, last 90 days)
  const timeline = await pgPool.query(
    `SELECT to_char(date_trunc('day', m.published_at AT TIME ZONE 'America/Puerto_Rico'), 'YYYY-MM-DD') AS day,
            COUNT(*)::int AS mentions,
            SUM(COALESCE(m.likes,0) + COALESCE(m.comments,0) + COALESCE(m.shares,0))::int AS engagement
       FROM mentions m
       JOIN narrative_mentions nm ON nm.mention_id = m.id
       WHERE nm.narrative_id = $1 AND nm.is_primary = true
         AND m.published_at >= NOW() - INTERVAL '90 days'
       GROUP BY 1
       ORDER BY 1 ASC`,
    [id],
  );

  // Top 10 autores por engagement
  const topAuthors = await pgPool.query(
    `SELECT m.author,
            COUNT(*)::int AS mentions,
            SUM(COALESCE(m.likes,0) + COALESCE(m.comments,0) + COALESCE(m.shares,0))::int AS engagement,
            SUM(COALESCE(m.reach_estimate, 0))::bigint AS reach
       FROM mentions m
       JOIN narrative_mentions nm ON nm.mention_id = m.id
       WHERE nm.narrative_id = $1 AND nm.is_primary = true
         AND m.author IS NOT NULL
       GROUP BY m.author
       ORDER BY engagement DESC NULLS LAST, mentions DESC
       LIMIT 10`,
    [id],
  );

  // Breakdown por plataforma
  const platforms = await pgPool.query(
    `SELECT COALESCE(m.page_type, 'desconocido') AS platform,
            COUNT(*)::int AS mentions
       FROM mentions m
       JOIN narrative_mentions nm ON nm.mention_id = m.id
       WHERE nm.narrative_id = $1 AND nm.is_primary = true
       GROUP BY 1
       ORDER BY 2 DESC`,
    [id],
  );

  // Edges salientes
  const edges = await pgPool.query(
    `SELECT CASE WHEN ne.source_narrative_id = $1 THEN ne.target_narrative_id ELSE ne.source_narrative_id END AS other_id,
            ne.edge_type, ne.strength,
            other.name AS other_name, other.slug AS other_slug, other.status AS other_status
       FROM narrative_edges ne
       JOIN narratives other ON other.id = CASE WHEN ne.source_narrative_id = $1 THEN ne.target_narrative_id ELSE ne.source_narrative_id END
       WHERE ne.source_narrative_id = $1 OR ne.target_narrative_id = $1
       ORDER BY ne.strength DESC
       LIMIT 20`,
    [id],
  );

  // 10 menciones recientes
  const recentMentions = await pgPool.query(
    `SELECT m.id, m.title, m.snippet, m.author, m.url, m.published_at AS "publishedAt",
            m.page_type AS "pageType", m.nlp_sentiment AS sentiment,
            COALESCE(m.likes,0) + COALESCE(m.comments,0) + COALESCE(m.shares,0) AS engagement
       FROM mentions m
       JOIN narrative_mentions nm ON nm.mention_id = m.id
       WHERE nm.narrative_id = $1 AND nm.is_primary = true
       ORDER BY m.published_at DESC
       LIMIT 10`,
    [id],
  );

  return NextResponse.json({
    narrative: {
      ...narrative,
      mentionCount: Number(narrative.mentionCount ?? 0),
      velocity24h: Number(narrative.velocity24h ?? 0),
      totalEngagement: Number(narrative.totalEngagement ?? 0),
      totalReach: Number(narrative.totalReach ?? 0),
      keywords: Array.isArray(narrative.keywords) ? narrative.keywords : [],
    },
    timeline: timeline.rows,
    topAuthors: topAuthors.rows,
    platforms: platforms.rows,
    edges: edges.rows.map((e: { other_id: string; edge_type: string; strength: number; other_name: string; other_slug: string; other_status: string }) => ({
      otherId: e.other_id,
      edgeType: e.edge_type,
      strength: Number(e.strength),
      otherName: e.other_name,
      otherSlug: e.other_slug,
      otherStatus: e.other_status,
    })),
    recentMentions: recentMentions.rows,
  });
}
