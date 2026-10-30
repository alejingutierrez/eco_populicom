import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { resolveAgencyId } from '@/lib/agency';
import { consume, clientKey } from '@/lib/rate-limit';
import { queryMentions } from '@/lib/mentions/query';

export const dynamic = 'force-dynamic';

/**
 * GET /api/eco-mentions — feed de menciones de la agencia (parámetros
 * documentados en lib/mentions/query.ts). Aquí solo: rate limit, agencia y
 * cabeceras; la consulta y el SQL viven en la librería.
 */
export async function GET(request: NextRequest) {
  const rl = consume('eco-mentions:' + clientKey(request), { limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } });
  }
  const { searchParams } = new URL(request.url);

  // Sin fallback a "primera agencia activa": resolveAgencyId ya resuelve dentro
  // del set PERMITIDO del usuario; null = set vacío, y servir otra agencia era un
  // leak de tenant (auditoría 2026-08, P1-1).
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 } });
  }

  const result = await queryMentions(getDb(), { agencyId }, searchParams);
  const res = NextResponse.json(result.body, { status: result.status });
  if (result.noStore) res.headers.set('Cache-Control', 'no-store');
  return res;
}
