import { NextRequest, NextResponse } from 'next/server';
import { getDb, users, agencies } from '@eco/database';
import { eq, and } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';

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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agencyId = await resolveCallerAgencyId(request);
  if (!agencyId) return NextResponse.json({ error: 'Agency not resolved' }, { status: 403 });
  let body: { name?: unknown; role?: unknown; isActive?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const patch: { name?: string; role?: Role; isActive?: boolean } = {};
  if (typeof body.name === 'string') patch.name = body.name.trim();
  if (typeof body.role === 'string' && VALID_ROLES.includes(body.role as Role)) patch.role = body.role as Role;
  if (typeof body.isActive === 'boolean') patch.isActive = body.isActive;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid fields in patch' }, { status: 400 });
  }
  const db = getDb();
  try {
    const [row] = await db
      .update(users)
      .set(patch)
      .where(and(eq(users.id, id), eq(users.agencyId, agencyId)))
      .returning();
    if (!row) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json({ user: row });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', scope: 'users.PATCH', id, msg: (err as Error).message }));
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agencyId = await resolveCallerAgencyId(request);
  if (!agencyId) return NextResponse.json({ error: 'Agency not resolved' }, { status: 403 });
  const db = getDb();
  try {
    // Soft-delete (deactivate) rather than dropping the row so history stays.
    const [row] = await db
      .update(users)
      .set({ isActive: false })
      .where(and(eq(users.id, id), eq(users.agencyId, agencyId)))
      .returning();
    if (!row) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', scope: 'users.DELETE', id, msg: (err as Error).message }));
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
