import { NextRequest, NextResponse } from 'next/server';
import { getDb, alertRules, agencies } from '@eco/database';
import { sql, eq } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

/** Resolve the agency the authenticated caller is allowed to act on. Prefers
 *  the slug pinned to their Cognito claims (header set by middleware); falls
 *  back to the URL param for read-only GETs. Never trusts body.agencyId. */
async function resolveCallerAgencyId(request: NextRequest): Promise<string | null> {
  const sessionSlug = request.headers.get('x-eco-user-agency');
  if (sessionSlug) {
    const db = getDb();
    const [row] = await db
      .select({ id: agencies.id })
      .from(agencies)
      .where(eq(agencies.slug, sessionSlug))
      .limit(1);
    if (row?.id) return row.id;
  }
  return resolveAgencyId(request.nextUrl.searchParams);
}

export async function GET(request: NextRequest) {
  const agencyId = await resolveCallerAgencyId(request);
  if (!agencyId) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
  }
  const db = getDb();
  try {
    const rules = await db
      .select()
      .from(alertRules)
      .where(eq(alertRules.agencyId, agencyId))
      .orderBy(sql`${alertRules.createdAt} DESC`);
    return NextResponse.json({
      rules: rules.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isActive: r.isActive,
        config: r.config,
        notifyEmails: r.notifyEmails,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    log.error('alerts.GET', (err as Error).message);
    return NextResponse.json({ rules: [] });
  }
}

export async function POST(request: NextRequest) {
  const agencyId = await resolveCallerAgencyId(request);
  if (!agencyId) {
    return NextResponse.json({ error: 'Agency not resolved for caller' }, { status: 403 });
  }
  let body: {
    name?: string;
    description?: string;
    config?: Record<string, unknown>;
    notifyEmails?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!body.config || typeof body.config !== 'object') {
    return NextResponse.json({ error: 'config object is required' }, { status: 400 });
  }
  const notifyEmails = Array.isArray(body.notifyEmails)
    ? body.notifyEmails.filter((s) => typeof s === 'string' && /.+@.+\..+/.test(s))
    : [];
  const db = getDb();
  try {
    const [rule] = await db
      .insert(alertRules)
      .values({
        agencyId, // trusted: from session header, not body
        name: body.name.trim(),
        description: body.description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config: body.config as any,
        notifyEmails,
      })
      .returning();
    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    log.error('alerts.POST', (err as Error).message, { name: body?.name });
    return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 });
  }
}
