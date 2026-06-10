import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, agencies } from '@eco/database';
import { eq } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/narrative/[id]/day?date=YYYY-MM-DD&agency=slug
 *
 * Menciones primarias de una narrativa en un día específico (AST timezone),
 * agrupadas por sentimiento (clusters). Pensado para el drawer del timeline.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rl = consume('narrative-day:' + clientKey(request), { limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date (expected YYYY-MM-DD)' }, { status: 400 });
  }

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

  // Verificar que la narrativa pertenece a la agencia (defensa)
  const pgPool = getPool();
  const owned = await pgPool.query(
    'SELECT 1 FROM narratives WHERE id = $1 AND agency_id = $2',
    [id, agencyId],
  );
  if (owned.rowCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Trae menciones de ese día (AST timezone) asignadas como primarias
  const mentions = await pgPool.query(
    `SELECT m.id, m.title, m.snippet, m.author, m.url,
            m.published_at AS "publishedAt",
            m.page_type AS "pageType",
            m.nlp_sentiment AS sentiment,
            (COALESCE(m.likes, 0) + COALESCE(m.comments, 0) + COALESCE(m.shares, 0))::int AS engagement,
            COALESCE(m.reach_estimate, 0)::bigint AS reach
       FROM mentions m
       JOIN narrative_mentions nm ON nm.mention_id = m.id
       WHERE nm.narrative_id = $1
         AND m.is_duplicate = false
         AND nm.is_primary = true
         AND date_trunc('day', m.published_at AT TIME ZONE 'America/Puerto_Rico')::date = $2::date
       ORDER BY engagement DESC NULLS LAST, m.published_at DESC
       LIMIT 200`,
    [id, date],
  );

  // Cluster por sentimiento
  const clusters: Record<string, typeof mentions.rows> = {
    positivo: [],
    neutral: [],
    negativo: [],
    sin_clasificar: [],
  };
  for (const m of mentions.rows) {
    const s = (m.sentiment ?? '').toLowerCase();
    if (s === 'positivo' || s === 'positive') clusters.positivo.push(m);
    else if (s === 'negativo' || s === 'negative') clusters.negativo.push(m);
    else if (s === 'neutral' || s === 'neutro') clusters.neutral.push(m);
    else clusters.sin_clasificar.push(m);
  }

  return NextResponse.json({
    day: date,
    totalMentions: mentions.rows.length,
    clusters: {
      positivo: clusters.positivo,
      neutral: clusters.neutral,
      negativo: clusters.negativo,
      ...(clusters.sin_clasificar.length > 0 ? { sin_clasificar: clusters.sin_clasificar } : {}),
    },
  });
}
