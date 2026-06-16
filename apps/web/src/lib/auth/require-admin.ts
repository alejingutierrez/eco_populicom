import { NextResponse } from 'next/server';
import { getDb, users } from '@eco/database';
import { eq } from 'drizzle-orm';
import { getSession, type SessionUser } from '@/lib/session';
import { capabilitiesFor, roleFromGroups, type Role, type Capability } from './roles';

/**
 * Rol EFECTIVO del usuario. La DB (`users.role`) es la fuente de verdad; si la
 * fila aún no está provisionada (primer login antes de /api/auth/me), se deriva
 * de los grupos de Cognito como fallback de bootstrap. Best-effort ante fallo de
 * DB: cae a grupos para no romper el auth.
 */
export async function effectiveRole(user: SessionUser): Promise<Role> {
  try {
    const db = getDb();
    const [row] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.cognitoSub, user.sub))
      .limit(1);
    if (row?.role) return row.role as Role;
  } catch {
    /* fall through to group-based bootstrap */
  }
  return roleFromGroups(user.groups);
}

type Gate = { ok: true; user: SessionUser; role: Role } | { ok: false; response: NextResponse };

/** Exige que el rol efectivo esté en `allowed`. */
export async function requireRole(allowed: Role[]): Promise<Gate> {
  const user = await getSession();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  }
  const role = await effectiveRole(user);
  if (!allowed.includes(role)) {
    return { ok: false, response: NextResponse.json({ error: 'forbidden', required: allowed }, { status: 403 }) };
  }
  return { ok: true, user, role };
}

/** Exige que el rol efectivo tenga la capacidad `cap`. */
export async function requireCapability(cap: Capability): Promise<Gate> {
  const user = await getSession();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  }
  const role = await effectiveRole(user);
  if (!capabilitiesFor(role).includes(cap)) {
    return { ok: false, response: NextResponse.json({ error: 'forbidden', required: cap }, { status: 403 }) };
  }
  return { ok: true, user, role };
}

/**
 * Helper histórico — ahora basado en el rol de la DB (no solo el grupo Cognito).
 * Equivalente a requireRole(['admin']). Conserva la firma para los handlers que
 * ya lo usan (reports, crisis-config, etc.).
 */
export async function requireAdmin(): Promise<Gate> {
  return requireRole(['admin']);
}

/** Como requireAdmin pero acepta cualquier usuario autenticado. */
export async function requireAuth(): Promise<
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse }
> {
  const user = await getSession();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  }
  return { ok: true, user };
}
