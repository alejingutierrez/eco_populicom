/** GET /api/chat/advisor/runs/:id/events?after=seq — hasta 100 eventos con seq > after (spec §9.3). */
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
import { requireCapability } from '@/lib/auth/require-admin';
import { isAdvisorStaff } from '@/lib/advisor/config';
import { ensureAdvisorSchema } from '@/lib/advisor/store';
import { loadRun, listEvents, TERMINAL_STATUSES } from '@/lib/advisor/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = await requireCapability('advise');
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  const after = Math.max(0, Number(new URL(request.url).searchParams.get('after') ?? 0) || 0);
  const pool = getPool();
  await ensureAdvisorSchema(pool);
  const run = await loadRun(pool, id, gate.user.sub, isAdvisorStaff(gate.user));
  if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const events = await listEvents(pool, id, after, 100);
  const done = TERMINAL_STATUSES.includes(run.status) && events.length === 0;
  return NextResponse.json({ events, done, status: run.status });
}
