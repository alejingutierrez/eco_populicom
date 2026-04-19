import { NextRequest, NextResponse } from 'next/server';
import { getDb, users } from '@eco/database';
import { and, eq, isNull, like, lt } from 'drizzle-orm';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

/**
 * Cleanup invited users who never signed in.
 *
 * Rows created via /api/users POST set cognitoSub = 'invited:<email>' as a
 * placeholder. When the real invitee signs in for the first time, that value
 * is replaced with their actual Cognito sub. Rows that stay as 'invited:%'
 * beyond a threshold (default 30 days) represent expired invitations and
 * are safely deactivated here.
 *
 * Invoke via:
 *   GET /api/admin/invited-users-cleanup?dry=true  (preview)
 *   POST /api/admin/invited-users-cleanup          (apply)
 *
 * Authorization: caller must present `x-eco-cron-secret` that matches the
 * ECO_CRON_SECRET env var. EventBridge Scheduler targets should inject this
 * header on the HTTP invocation. No Cognito session required so EventBridge
 * can call it without an ALB listener change.
 */

const DEFAULT_DAYS = 30;

function authorized(request: NextRequest): boolean {
  const required = process.env.ECO_CRON_SECRET;
  if (!required) return false; // fail closed when no secret configured
  const provided = request.headers.get('x-eco-cron-secret');
  return !!provided && provided === required;
}

async function runCleanup(dryRun: boolean, days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const db = getDb();
  const filter = and(
    like(users.cognitoSub, 'invited:%'),
    isNull(users.lastLogin),
    lt(users.createdAt, cutoff),
    eq(users.isActive, true),
  );
  const candidates = await db
    .select({ id: users.id, email: users.email, createdAt: users.createdAt, agencyId: users.agencyId })
    .from(users)
    .where(filter);
  if (dryRun) return { mode: 'dry-run' as const, wouldDeactivate: candidates.length, sample: candidates.slice(0, 5) };
  if (candidates.length === 0) return { mode: 'noop' as const, deactivated: 0 };
  await db.update(users).set({ isActive: false }).where(filter);
  return { mode: 'applied' as const, deactivated: candidates.length, ids: candidates.map((c) => c.id) };
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const days = Number(request.nextUrl.searchParams.get('days') ?? DEFAULT_DAYS);
  const result = await runCleanup(true, days);
  log.info('users.cleanup', 'dry-run', { ...result, days });
  return NextResponse.json({ ok: true, days, ...result });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  let days = DEFAULT_DAYS;
  try {
    const body = await request.json();
    if (typeof body.days === 'number' && body.days > 0) days = body.days;
  } catch {
    // body optional
  }
  try {
    const result = await runCleanup(false, days);
    log.info('users.cleanup', 'applied', { ...result, days });
    return NextResponse.json({ ok: true, days, ...result });
  } catch (err) {
    log.error('users.cleanup', (err as Error).message);
    return NextResponse.json({ error: 'Cleanup failed', message: (err as Error).message }, { status: 500 });
  }
}
