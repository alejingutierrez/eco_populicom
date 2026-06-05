import { NextRequest, NextResponse } from 'next/server';
import { getDb, users, agencies } from '@eco/database';
import { eq, and, inArray, type SQL } from 'drizzle-orm';
import { resolveAllowedAgencySlugs } from '@/lib/agency';
import { setUserAgencyAccess } from '@/lib/provision';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

type Role = 'admin' | 'analyst' | 'viewer';
const VALID_ROLES: Role[] = ['admin', 'analyst', 'viewer'];

async function idsForSlugs(slugs: string[]): Promise<string[]> {
  if (slugs.length === 0) return [];
  const db = getDb();
  const rows = await db.select({ id: agencies.id }).from(agencies).where(inArray(agencies.slug, slugs));
  return rows.map((r) => r.id);
}

/**
 * Which user rows this caller may touch. Staff (allowed = null) can manage any
 * user; an agency admin only users whose primary agency is within the agencies
 * they can see. Returns null when the caller manages no agencies (→ 404/forbid).
 */
async function callerScope(id: string): Promise<{ where: SQL; allowedSlugs: string[] | null } | null> {
  const allowedSlugs = await resolveAllowedAgencySlugs();
  if (allowedSlugs === null) return { where: eq(users.id, id), allowedSlugs: null };
  const ids = await idsForSlugs(allowedSlugs);
  if (ids.length === 0) return null;
  return { where: and(eq(users.id, id), inArray(users.agencyId, ids))!, allowedSlugs };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await callerScope(id);
  if (!scope) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { name?: unknown; role?: unknown; isActive?: unknown; allAgencies?: unknown; agencySlugs?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const patch: { name?: string; role?: Role; isActive?: boolean } = {};
  if (typeof body.name === 'string') patch.name = body.name.trim();
  if (typeof body.role === 'string' && VALID_ROLES.includes(body.role as Role)) patch.role = body.role as Role;
  if (typeof body.isActive === 'boolean') patch.isActive = body.isActive;
  const allAgencies = typeof body.allAgencies === 'boolean' ? body.allAgencies : undefined;
  const agencySlugs = Array.isArray(body.agencySlugs) ? body.agencySlugs.filter((s): s is string => typeof s === 'string') : undefined;

  const db = getDb();
  try {
    // Verify the target is within the caller's scope before mutating anything.
    const [target] = await db.select({ id: users.id }).from(users).where(scope.where).limit(1);
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    if (Object.keys(patch).length > 0) {
      await db.update(users).set(patch).where(scope.where);
    }
    if (allAgencies !== undefined || agencySlugs !== undefined) {
      await setUserAgencyAccess(id, { allAgencies, agencySlugs }, scope.allowedSlugs);
    }
    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return NextResponse.json({ user: row });
  } catch (err) {
    log.error('users.PATCH', (err as Error).message, { id });
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await callerScope(id);
  if (!scope) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const db = getDb();
  try {
    // Soft-delete (deactivate) rather than dropping the row so history stays.
    const [row] = await db.update(users).set({ isActive: false }).where(scope.where).returning();
    if (!row) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error('users.DELETE', (err as Error).message, { id });
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
