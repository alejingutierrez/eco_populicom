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

/**
 * Correos con acceso a la página de Alertas.
 *
 * Decisión del usuario (ago 2026): "Solo el usuario agutierrez@populicom puede
 * ver esta página, de resto no". Es una lista literal en código a propósito —
 * gatearlo por `users.allowed_pages` sería configurable sin deploy, pero se
 * revierte en cuanto alguien edita el usuario desde el panel, y el requisito es
 * que NADIE más la vea. Para añadir gente hay que tocar esta constante.
 *
 * Se exporta para que el gate del servidor y /api/auth/me (que decide qué
 * páginas ve el SPA) lean la MISMA fuente.
 */
export const ALERTS_ALLOWED_EMAILS = ['agutierrez@populicom.com'];

export function canSeeAlerts(email: string | null | undefined): boolean {
  if (!email) return false;
  return ALERTS_ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}

/**
 * Gate de las rutas de Alertas. Ocultar la página en el SPA no basta: los
 * endpoints /api/alerts/* siguen siendo alcanzables a mano, así que el corte
 * real va aquí.
 */
export async function requireAlertsAccess(): Promise<Gate> {
  const user = await getSession();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  }
  if (!canSeeAlerts(user.email)) {
    return { ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  const role = await effectiveRole(user);
  return { ok: true, user, role };
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
