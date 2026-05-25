import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, agencies } from '@eco/database';
import { eq } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/narratives/edges — conexiones para el grafo.
 *
 * Query params:
 *   agency       slug
 *   minStrength  filtra strength >= N (default 0.15)
 *   types        comma-separated, ej. "co_occurrence,author_overlap,semantic"
 */
export async function GET(request: NextRequest) {
  const rl = consume('narratives-edges:' + clientKey(request), { limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const minStrength = Number(searchParams.get('minStrength') ?? 0.15);
  const types = (searchParams.get('types') ?? '').split(',').filter(Boolean);

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
  if (!agencyId) return NextResponse.json({ edges: [], meta: { total: 0 } });

  const pgPool = getPool();

  const params: unknown[] = [agencyId, minStrength];
  let where = 'ne.agency_id = $1 AND ne.strength >= $2';
  if (types.length > 0) {
    params.push(types);
    where += ` AND ne.edge_type = ANY($${params.length}::text[])`;
  }

  const result = await pgPool.query(
    `SELECT ne.source_narrative_id AS "source",
            ne.target_narrative_id AS "target",
            ne.edge_type            AS "type",
            ne.strength
       FROM narrative_edges ne
       WHERE ${where}
       ORDER BY ne.strength DESC`,
    params,
  );

  return NextResponse.json({
    edges: (result.rows as Array<{ source: string; target: string; type: string; strength: string | number }>).map((r) => ({
      source: r.source,
      target: r.target,
      type: r.type,
      strength: Number(r.strength),
    })),
    meta: { total: result.rows.length },
  });
}
