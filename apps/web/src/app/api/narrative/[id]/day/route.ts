import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
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

  // Sin fallback a "primera agencia activa" (leak de tenant — auditoría
  // 2026-08, P1-1): null = usuario sin agencias concedidas → 404.
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) return NextResponse.json({ error: 'No agency' }, { status: 404 });

  // Verificar que la narrativa pertenece a la agencia (defensa) y resolver el
  // puntero de fusión: si la narrativa fue absorbida, sus filas de
  // narrative_mentions SIGUEN existiendo con is_primary=true, así que sin el
  // COALESCE este endpoint devolvería el subconjunto pre-fusión mientras la
  // cabecera y el timeline de la MISMA pantalla —que sí resuelven al
  // superviviente— cuentan la unión. Dos paneles, dos números.
  const pgPool = getPool();
  const owned = await pgPool.query<{ id: string }>(
    `SELECT COALESCE(req.merged_into_id, req.id) AS id
       FROM narratives req
       JOIN narratives n ON n.id = COALESCE(req.merged_into_id, req.id)
      WHERE req.id = $1 AND req.agency_id = $2 AND n.agency_id = $2`,
    [id, agencyId],
  );
  if (owned.rowCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const effectiveId = owned.rows[0].id;

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
    [effectiveId, date],
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
