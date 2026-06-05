import { NextRequest, NextResponse } from 'next/server';
import { getDb, users, agencies } from '@eco/database';
import { eq, desc, inArray } from 'drizzle-orm';
import { resolveAgencyId, resolveAllowedAgencySlugs } from '@/lib/agency';
import { setUserAgencyAccess, agencySlugsByUser } from '@/lib/provision';
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

/** agency ids for a list of slugs (active agencies only). */
async function idsForSlugs(slugs: string[]): Promise<string[]> {
  if (slugs.length === 0) return [];
  const db = getDb();
  const rows = await db.select({ id: agencies.id }).from(agencies).where(inArray(agencies.slug, slugs));
  return rows.map((r) => r.id);
}

function isEmail(s: unknown): s is string {
  return typeof s === 'string' && /.+@.+\..+/.test(s);
}

export async function GET(request: NextRequest) {
  const db = getDb();
  try {
    // Staff (allowed = all) manage every user; an agency admin manages users
    // whose primary agency is within the agencies they can see.
    const allowedSlugs = await resolveAllowedAgencySlugs();
    const base = db.select().from(users).$dynamic();
    const rows = allowedSlugs === null
      ? await base.orderBy(desc(users.createdAt))
      : await base.where(inArray(users.agencyId, await idsForSlugs(allowedSlugs))).orderBy(desc(users.createdAt));

    const slugMap = await agencySlugsByUser(rows.map((u) => u.id));
    return NextResponse.json({
      users: rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
        allAgencies: u.allAgencies,
        agencies: slugMap.get(u.id) ?? [],
        lastLogin: u.lastLogin?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    log.error('users.GET', (err as Error).message, {});
    return NextResponse.json({ users: [] });
  }
}

/**
 * POST /api/users — invite a user.
 * Body: { email, name?, role?, allAgencies?, agencySlugs?: string[] }
 * The visible-agency set (agencySlugs / allAgencies) is constrained to the
 * agencies the caller can see (see setUserAgencyAccess).
 */
export async function POST(request: NextRequest) {
  const callerAgencyId = await resolveCallerAgencyId(request);
  if (!callerAgencyId) return NextResponse.json({ error: 'Agency not resolved' }, { status: 403 });
  let body: { email?: unknown; name?: unknown; role?: unknown; allAgencies?: unknown; agencySlugs?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!isEmail(body.email)) return NextResponse.json({ error: 'email required' }, { status: 400 });
  const role = typeof body.role === 'string' && VALID_ROLES.includes(body.role as Role) ? (body.role as Role) : 'viewer';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const agencySlugs = Array.isArray(body.agencySlugs) ? body.agencySlugs.filter((s): s is string => typeof s === 'string') : undefined;
  const allAgencies = typeof body.allAgencies === 'boolean' ? body.allAgencies : undefined;

  const callerAllowed = await resolveAllowedAgencySlugs();
  // Primary agency: the first requested (and permitted) slug, else the caller's.
  let primaryAgencyId = callerAgencyId;
  if (agencySlugs && agencySlugs.length > 0) {
    const permitted = callerAllowed ? agencySlugs.filter((s) => callerAllowed.includes(s)) : agencySlugs;
    const [firstId] = await idsForSlugs(permitted.slice(0, 1));
    if (firstId) primaryAgencyId = firstId;
  }

  const db = getDb();
  try {
    const [row] = await db
      .insert(users)
      .values({
        email: body.email,
        name: name || body.email.split('@')[0],
        role,
        agencyId: primaryAgencyId,
        allAgencies: allAgencies ?? false,
        // cognitoSub is NOT NULL; the real sub is claimed on first sign-in
        // (see ensureUserProvisioned). Placeholder keeps the row valid.
        cognitoSub: `invited:${body.email}`,
      })
      .returning();
    if (agencySlugs || allAgencies !== undefined) {
      await setUserAgencyAccess(row.id, { allAgencies, agencySlugs }, callerAllowed);
    }
    return NextResponse.json({ user: row }, { status: 201 });
  } catch (err) {
    log.error('users.POST', (err as Error).message, { email: body?.email, role });
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
