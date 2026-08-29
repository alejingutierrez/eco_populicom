import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
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
  // Number('abc') es NaN y `strength >= NaN` es falso para toda fila: un
  // minStrength con basura devolvía el grafo VACÍO en silencio, con 200.
  const rawMin = Number(searchParams.get('minStrength') ?? 0.15);
  const minStrength = Number.isFinite(rawMin) ? rawMin : 0.15;
  const types = (searchParams.get('types') ?? '').split(',').filter(Boolean);

  // Sin fallback a "primera agencia activa" (leak de tenant — auditoría
  // 2026-08, P1-1): null = usuario sin agencias concedidas → vacío.
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) return NextResponse.json({ edges: [], meta: { total: 0 } });

  const pgPool = getPool();

  const params: unknown[] = [agencyId, minStrength];
  let where = 'ne.agency_id = $1 AND ne.strength >= $2';
  if (types.length > 0) {
    params.push(types);
    where += ` AND ne.edge_type = ANY($${params.length}::text[])`;
  }

  // N8, dos cosas:
  //
  // (a) Las aristas hacia narrativas absorbidas apuntan a nodos que la lista ya
  //     no devuelve. Sin el filtro el grafo dibuja aristas hacia el vacío hasta
  //     que el pase diario de eco-narrative-edges las regenera.
  //
  // (b) Se devuelve el NOMBRE y el ESTADO de los dos extremos. El front resolvía
  //     el vecino buscándolo en la lista, y desde que la lista está acotada al
  //     período, un vecino sin actividad en la ventana no aparecía ahí y el
  //     panel de "relacionadas" se vaciaba. Una conexión con una narrativa
  //     dormida sigue siendo información: mejor mostrarla marcada que perderla.
  const result = await pgPool.query(
    `SELECT ne.source_narrative_id AS "source",
            ne.target_narrative_id AS "target",
            ne.edge_type            AS "type",
            ne.strength,
            src.name   AS "sourceName", src.status AS "sourceStatus",
            tgt.name   AS "targetName", tgt.status AS "targetStatus"
       FROM narrative_edges ne
       JOIN narratives src ON src.id = ne.source_narrative_id AND src.merged_into_id IS NULL
       JOIN narratives tgt ON tgt.id = ne.target_narrative_id AND tgt.merged_into_id IS NULL
       WHERE ${where}
       ORDER BY ne.strength DESC
       LIMIT 4000`,
    params,
  );

  return NextResponse.json({
    edges: (result.rows as Array<{
      source: string; target: string; type: string; strength: string | number;
      sourceName: string; sourceStatus: string; targetName: string; targetStatus: string;
    }>).map((r) => ({
      source: r.source,
      target: r.target,
      type: r.type,
      strength: Number(r.strength),
      sourceName: r.sourceName,
      sourceStatus: r.sourceStatus,
      targetName: r.targetName,
      targetStatus: r.targetStatus,
    })),
    meta: { total: result.rows.length },
  });
}
