/** GET /api/chat/advisor/runs/:id — estado, camino, triaje, memorando y elección (spec §9.2). */
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
import { requireCapability } from '@/lib/auth/require-admin';
import { isAdvisorStaff } from '@/lib/advisor/config';
import { ensureAdvisorSchema } from '@/lib/advisor/store';
import { loadRun } from '@/lib/advisor/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = await requireCapability('advise');
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  const pool = getPool();
  await ensureAdvisorSchema(pool);
  const r = await loadRun(pool, id, gate.user.sub, isAdvisorStaff(gate.user));
  if (!r) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({
    run: {
      id: r.id,
      status: r.status,
      camino: r.camino,
      question: r.question,
      triage: r.triage_json,
      memo: r.memo_json,
      costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
      citations: r.citations_total === null ? null : { total: r.citations_total, invalid: r.citations_invalid ?? 0 },
      choice: r.choice,
      choiceNote: r.choice_note,
      createdAt: r.created_at,
      errorCode: r.error_code,
    },
  });
}
