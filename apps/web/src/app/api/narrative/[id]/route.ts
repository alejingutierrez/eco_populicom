import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
import { PERIOD_DAYS, resolveWindow } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const TZ = 'America/Puerto_Rico';
const AST = '-04:00';

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
 *
 * N8 (ago-2026): acepta la ventana estándar (period / from+to). El TIMELINE
 * sigue cubriendo toda la vida de la narrativa —ese arco completo es lo que
 * aporta la pantalla de detalle— pero las CIFRAS de cabecera, los autores, las
 * plataformas y las menciones recientes se limitan a la ventana, para que el
 * detalle hable del mismo universo que la lista. La ventana se devuelve en
 * `window` para que el front pueda sombrearla sobre el timeline.
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
  const startTs = `${win.startYmd}T00:00:00${AST}`;
  const endTs = `${win.endYmd}T23:59:59.999${AST}`;

  // Sin fallback a "primera agencia activa" (leak de tenant — auditoría
  // 2026-08, P1-1): null = usuario sin agencias concedidas → 404.
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) return NextResponse.json({ error: 'No agency' }, { status: 404 });

  const pgPool = getPool();

  // Un enlace viejo puede apuntar a una narrativa que después se consolidó en
  // otra. En vez de un 404 o de una página fantasma, se sirve la superviviente
  // y se avisa con `redirectedFrom` para que el front pueda corregir la URL.
  const narrativeRes = await pgPool.query(
    `SELECT n.id, n.name, n.slug, n.summary, n.keywords, n.status,
            n.mention_count AS "lifetimeMentionCount", n.velocity_24h AS "velocity24h",
            n.born_at AS "bornAt", n.last_mention_at AS "lastMentionAt",
            n.peaked_at AS "peakedAt",
            n.initiator_first AS "initiatorFirst",
            n.initiator_influencer AS "initiatorInfluencer",
            req.id <> n.id AS "wasMerged", req.id AS "requestedId"
       FROM narratives req
       JOIN narratives n ON n.id = COALESCE(req.merged_into_id, req.id)
       WHERE req.id = $1 AND req.agency_id = $2 AND n.agency_id = $2`,
    [id, agencyId],
  );
  if (narrativeRes.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const narrative = narrativeRes.rows[0];
  // A partir de aquí se trabaja SIEMPRE con la superviviente.
  const effectiveId: string = narrative.id;

  // Cifras de la VENTANA — son las que tienen que cuadrar con la lista.
  const windowAgg = await pgPool.query(
    `SELECT COUNT(*)::int AS "mentionCount",
            COALESCE(SUM(m.engagement_score), 0)::bigint AS "totalEngagement",
            COALESCE(SUM(m.reach_estimate), 0)::bigint AS "totalReach"
       FROM narrative_mentions nm
       JOIN mentions m ON m.id = nm.mention_id
      WHERE nm.narrative_id = $1 AND nm.is_primary = true AND m.is_duplicate = false
        AND m.published_at >= $2::timestamptz AND m.published_at <= $3::timestamptz`,
    [effectiveId, startTs, endTs],
  );

  // Timeline diario con breakdown por sentimiento (streamgraph stacked).
  // Cubre desde born_at hasta hoy para que el timeline muestre toda la vida
  // de la narrativa (no solo últimos 90d como antes).
  const timeline = await pgPool.query(
    `SELECT to_char(date_trunc('day', m.published_at AT TIME ZONE 'America/Puerto_Rico'), 'YYYY-MM-DD') AS day,
            COUNT(*)::int AS mentions,
            COUNT(*) FILTER (WHERE m.nlp_sentiment IN ('positivo','positive'))::int AS positive,
            COUNT(*) FILTER (WHERE m.nlp_sentiment IN ('neutral','neutro'))::int AS neutral,
            COUNT(*) FILTER (WHERE m.nlp_sentiment IN ('negativo','negative'))::int AS negative,
            SUM(COALESCE(m.likes,0) + COALESCE(m.comments,0) + COALESCE(m.shares,0))::int AS engagement,
            SUM(COALESCE(m.reach_estimate, 0))::bigint AS reach
       FROM mentions m
       JOIN narrative_mentions nm ON nm.mention_id = m.id
       WHERE nm.narrative_id = $1 AND nm.is_primary = true
       AND m.is_duplicate = false
       GROUP BY 1
       ORDER BY 1 ASC`,
    [effectiveId],
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
         AND m.is_duplicate = false
         AND m.author IS NOT NULL
         AND m.published_at >= $2::timestamptz AND m.published_at <= $3::timestamptz
       GROUP BY m.author
       ORDER BY engagement DESC NULLS LAST, mentions DESC
       LIMIT 10`,
    [effectiveId, startTs, endTs],
  );

  // Breakdown por plataforma
  const platforms = await pgPool.query(
    `SELECT COALESCE(m.page_type, 'desconocido') AS platform,
            COUNT(*)::int AS mentions
       FROM mentions m
       JOIN narrative_mentions nm ON nm.mention_id = m.id
       WHERE nm.narrative_id = $1 AND nm.is_primary = true
       AND m.is_duplicate = false
       AND m.published_at >= $2::timestamptz AND m.published_at <= $3::timestamptz
       GROUP BY 1
       ORDER BY 2 DESC`,
    [effectiveId, startTs, endTs],
  );

  // Edges salientes — filtrados por agencia: sin el filtro, una narrativa
  // podía listar vecinas de OTRO tenant (auditoría 2026-08, P1 tenancy).
  const edges = await pgPool.query(
    `SELECT CASE WHEN ne.source_narrative_id = $1 THEN ne.target_narrative_id ELSE ne.source_narrative_id END AS other_id,
            ne.edge_type, ne.strength,
            other.name AS other_name, other.slug AS other_slug, other.status AS other_status
       FROM narrative_edges ne
       JOIN narratives other ON other.id = CASE WHEN ne.source_narrative_id = $1 THEN ne.target_narrative_id ELSE ne.source_narrative_id END
       WHERE (ne.source_narrative_id = $1 OR ne.target_narrative_id = $1)
         AND ne.agency_id = $2
         AND other.agency_id = $2
         AND other.merged_into_id IS NULL
       ORDER BY ne.strength DESC
       LIMIT 20`,
    [effectiveId, agencyId],
  );

  // 10 menciones recientes
  const recentMentions = await pgPool.query(
    `SELECT m.id, m.title, m.snippet, m.author, m.url, m.published_at AS "publishedAt",
            m.page_type AS "pageType", m.nlp_sentiment AS sentiment,
            COALESCE(m.likes,0) + COALESCE(m.comments,0) + COALESCE(m.shares,0) AS engagement
       FROM mentions m
       JOIN narrative_mentions nm ON nm.mention_id = m.id
       WHERE nm.narrative_id = $1 AND nm.is_primary = true
       AND m.is_duplicate = false
       AND m.published_at >= $2::timestamptz AND m.published_at <= $3::timestamptz
       ORDER BY m.published_at DESC
       LIMIT 10`,
    [effectiveId, startTs, endTs],
  );

  return NextResponse.json({
    narrative: {
      ...narrative,
      // Las cifras visibles son las de la ventana; el total de vida viaja
      // aparte para que la UI pueda decir "X en el período, Y en total".
      mentionCount: Number(windowAgg.rows[0]?.mentionCount ?? 0),
      lifetimeMentionCount: Number(narrative.lifetimeMentionCount ?? 0),
      velocity24h: Number(narrative.velocity24h ?? 0),
      totalEngagement: Number(windowAgg.rows[0]?.totalEngagement ?? 0),
      totalReach: Number(windowAgg.rows[0]?.totalReach ?? 0),
      keywords: Array.isArray(narrative.keywords) ? narrative.keywords : [],
    },
    window: {
      period: periodKey,
      from: win.startYmd,
      to: win.endYmd,
      days: win.days,
      custom: win.custom,
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
