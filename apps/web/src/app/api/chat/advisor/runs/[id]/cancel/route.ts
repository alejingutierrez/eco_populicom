/** POST /api/chat/advisor/runs/:id/cancel — marca cancel_requested; 202 (spec §9.4). */
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
import { requireCapability } from '@/lib/auth/require-admin';
import { isAdvisorStaff } from '@/lib/advisor/config';
import { ensureAdvisorSchema } from '@/lib/advisor/store';
import { requestCancel } from '@/lib/advisor/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = await requireCapability('advise');
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  const pool = getPool();
  await ensureAdvisorSchema(pool);
  const ok = await requestCancel(pool, id, gate.user.sub, isAdvisorStaff(gate.user));
  if (!ok) return NextResponse.json({ error: 'not_found_or_finished' }, { status: 404 });
  return NextResponse.json({ ok: true }, { status: 202 });
}
