/** POST /api/chat/advisor/runs/:id/choice — guarda la elección del usuario (spec §9.5). */
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
import { requireCapability } from '@/lib/auth/require-admin';
import { isAdvisorStaff } from '@/lib/advisor/config';
import { ensureAdvisorSchema } from '@/lib/advisor/store';
import { setChoice } from '@/lib/advisor/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHOICES = ['A', 'B', 'otro', 'ninguno'] as const;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = await requireCapability('advise');
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  let body: { choice?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!CHOICES.includes(body.choice as (typeof CHOICES)[number])) {
    return NextResponse.json({ error: 'invalid_choice', expected: CHOICES }, { status: 400 });
  }
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null;
  const pool = getPool();
  await ensureAdvisorSchema(pool);
  const ok = await setChoice(pool, id, gate.user.sub, isAdvisorStaff(gate.user), String(body.choice), note);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
