/** GET /api/chat/advisor/runs?agency=slug&limit=20 — historial de corridas (spec §9.6). Propias, o todas si es staff. */
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
import { requireCapability } from '@/lib/auth/require-admin';
import { resolveAgencyId } from '@/lib/agency';
import { isAdvisorStaff } from '@/lib/advisor/config';
import { ensureAdvisorSchema } from '@/lib/advisor/store';
import { listRuns } from '@/lib/advisor/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const gate = await requireCapability('advise');
  if (!gate.ok) return gate.response;
  const params = new URL(request.url).searchParams;
  const agencyId = await resolveAgencyId(params);
  if (!agencyId) return NextResponse.json({ error: 'No agency resolved' }, { status: 404 });
  const limit = Number(params.get('limit') ?? 20) || 20;
  const pool = getPool();
  await ensureAdvisorSchema(pool);
  const runs = await listRuns(pool, agencyId, gate.user.sub, isAdvisorStaff(gate.user), limit);
  return NextResponse.json({ runs });
}
