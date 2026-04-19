import { NextRequest, NextResponse } from 'next/server';
import { getDb, users, agencies } from '@eco/database';
import { eq, desc } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

type Role = 'admin' | 'analyst' | 'viewer';
const VALID_ROLES: Role[] = ['admin', 'analyst', 'viewer'];

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

function isEmail(s: unknown): s is string {
  return typeof s === 'string' && /.+@.+\..+/.test(s);
}

export async function GET(request: NextRequest) {
  const agencyId = await resolveCallerAgencyId(request);
  if (!agencyId) return NextResponse.json({ error: 'Agency not resolved' }, { status: 403 });
  const db = getDb();
  try {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.agencyId, agencyId))
      .orderBy(desc(users.createdAt));
    return NextResponse.json({
      users: rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
        lastLogin: u.lastLogin?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    log.error('users.GET', (err as Error).message, { agencyId });
    return NextResponse.json({ users: [] });
  }
}

/** POST /api/users — invite a user. Body: { email, name, role } */
export async function POST(request: NextRequest) {
  const agencyId = await resolveCallerAgencyId(request);
  if (!agencyId) return NextResponse.json({ error: 'Agency not resolved' }, { status: 403 });
  let body: { email?: unknown; name?: unknown; role?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!isEmail(body.email)) return NextResponse.json({ error: 'email required' }, { status: 400 });
  const role = typeof body.role === 'string' && VALID_ROLES.includes(body.role as Role) ? (body.role as Role) : 'viewer';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const db = getDb();
  try {
    const [row] = await db
      .insert(users)
      .values({
        email: body.email,
        name: name || body.email.split('@')[0],
        role,
        agencyId,
        // cognitoSub is NOT NULL in the schema; the real Cognito sub comes
        // after the invitee signs in the first time. For now store a
        // placeholder unique to the email so the row validates.
        cognitoSub: `invited:${body.email}`,
      })
      .returning();
    return NextResponse.json({ user: row }, { status: 201 });
  } catch (err) {
    log.error('users.POST', (err as Error).message, { email: body?.email, role });
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
