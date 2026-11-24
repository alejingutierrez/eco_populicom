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
  return (await userStanding(user)).role;
}

/**
 * Rol efectivo y si el usuario está suspendido (`users.is_active = false`).
 * Un suspendido conserva su sesión de Cognito hasta que caduque, así que el
 * corte tiene que estar en cada gate del servidor. Ante fallo de DB no se
 * marca como suspendido (mismo criterio best-effort que el rol).
 */
async function userStanding(user: SessionUser): Promise<{ role: Role; suspended: boolean; allowedPages: string[] | null }> {
  try {
    const db = getDb();
    const [row] = await db
      .select({ role: users.role, isActive: users.isActive, allowedPages: users.allowedPages })
      .from(users)
      .where(eq(users.cognitoSub, user.sub))
      .limit(1);
    if (row) {
      return {
        role: (row.role as Role) || roleFromGroups(user.groups),
        suspended: row.isActive === false,
        allowedPages: (row.allowedPages as string[] | null) ?? null,
      };
    }
  } catch {
    /* fall through to group-based bootstrap */
  }
  return { role: roleFromGroups(user.groups), suspended: false, allowedPages: null };
}

function suspendedResponse(): NextResponse {
  return NextResponse.json({ error: 'suspended' }, { status: 403 });
}

type Gate = { ok: true; user: SessionUser; role: Role } | { ok: false; response: NextResponse };

/** Exige que el rol efectivo esté en `allowed`. */
export async function requireRole(allowed: Role[]): Promise<Gate> {
  const user = await getSession();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  }
  const { role, suspended } = await userStanding(user);
  if (suspended) return { ok: false, response: suspendedResponse() };
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
  const { role, suspended } = await userStanding(user);
  if (suspended) return { ok: false, response: suspendedResponse() };
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
 * ¿El usuario puede ver una página? Misma regla que el SPA (`ecoCanSeePage`):
 * `allowed_pages` vacía o nula significa «todas»; con contenido, solo las
 * listadas.
 */
export function pageAllowed(allowedPages: string[] | null | undefined, key: string): boolean {
  if (!Array.isArray(allowedPages) || allowedPages.length === 0) return true;
  return allowedPages.includes(key);
}

/** ¿Puede ver Alertas? Lo usa /api/auth/me para el flag `canSeeAlerts` del SPA. */
export function canSeeAlerts(allowedPages: string[] | null | undefined): boolean {
  return pageAllowed(allowedPages, 'alerts');
}

/**
 * Gate de las rutas de Alertas (COR-04, nov 2026).
 *
 * De agosto a noviembre de 2026 esto era una lista de correos en código con
 * una sola dirección. Ahora es el permiso normal: cualquier usuario activo
 * cuya lista de páginas incluya «alerts» (o esté vacía = todas). Ver es esto;
 * crear o editar reglas exige además la capacidad `manage_alert_rules`, y la
 * agencia la acota cada ruta con `resolveAgencyId` / `resolveCallerAgencyId`.
 *
 * Ocultar la página en el SPA no basta: los endpoints /api/alerts/* son
 * alcanzables a mano, así que el corte real va aquí.
 */
export async function requireAlertsAccess(): Promise<Gate> {
  const user = await getSession();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  }
  const { role, suspended, allowedPages } = await userStanding(user);
  if (suspended) return { ok: false, response: suspendedResponse() };
  if (!pageAllowed(allowedPages, 'alerts')) {
    return { ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
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
  if ((await userStanding(user)).suspended) return { ok: false, response: suspendedResponse() };
  return { ok: true, user };
}
