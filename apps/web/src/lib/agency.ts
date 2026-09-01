import { getDb, agencies, users, userAgencies } from '@eco/database';
import { eq, or, type SQL } from 'drizzle-orm';
import { headers } from 'next/headers';

const DEFAULT_AGENCY_SLUG = 'aaa';

/**
 * Staff interno: usuarios con este dominio de email ven TODAS las agencias por
 * defecto (sin necesitar filas en user_agencies). Es el fallback mientras la
 * fila del usuario aún no existe y el default al aprovisionarla. Ajusta aquí si
 * el criterio de "staff que ve todo" cambia.
 */
export const STAFF_EMAIL_DOMAIN = '@populicom.com';

/**
 * Agencias de acceso restringido: NO entran en el "ve todas" de
 * `all_agencies` ni en el fallback de dominio de staff. Solo las ve el correo
 * listado aquí.
 *
 * Hace falta porque `all_agencies` significa literalmente *todas* las agencias
 * activas, y hoy lo tienen los diez correos @populicom.com: sin esta lista, dar
 * de alta una agencia la publica para todo el staff.
 *
 * Es una constante en código y no una columna de `agencies` por dos razones:
 * el `exec-write` del lambda `eco-migration` rechaza DDL (añadir la columna
 * exigiría parchear su bundle en producción), y estos casos son temporales por
 * naturaleza — una marca en evaluación que después se va a otro front. Mismo
 * patrón que la lista blanca de correos de /api/alerts.
 */
export const RESTRICTED_AGENCIES: Record<string, readonly string[]> = {
  medalla: ['agutierrez@populicom.com'],
};

/**
 * ¿Este correo puede ver esta agencia? Las agencias que no están en
 * RESTRICTED_AGENCIES son visibles para todo el mundo (comportamiento previo).
 * Sin sesión no se ve ninguna restringida.
 */
export function agencyVisibleTo(slug: string, email: string | null | undefined): boolean {
  const allow = RESTRICTED_AGENCIES[slug];
  if (!allow) return true;
  if (!email) return false;
  return allow.includes(email.toLowerCase());
}

async function slugToId(slug: string | undefined | null): Promise<string | null> {
  if (!slug) return null;
  const db = getDb();
  const [row] = await db
    .select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.slug, slug))
    .limit(1);
  return row?.id ?? null;
}

async function firstActiveAgencyId(email: string | null = null): Promise<string | null> {
  const db = getDb();
  // Se piden slugs además del id porque el fallback no puede aterrizar en una
  // agencia restringida: sería una fuga por la puerta de atrás justo cuando el
  // resto de la resolución ya la había descartado.
  const rows = await db
    .select({ id: agencies.id, slug: agencies.slug })
    .from(agencies)
    .where(eq(agencies.isActive, true));
  const first = rows.find((a) => agencyVisibleTo(a.slug, email));
  return first?.id ?? null;
}

export async function listActiveAgencies(): Promise<{ id: string; slug: string }[]> {
  const db = getDb();
  return db
    .select({ id: agencies.id, slug: agencies.slug })
    .from(agencies)
    .where(eq(agencies.isActive, true));
}

/** The set of agencies a signed-in user may read. `'all'` = every active agency. */
type Access = { allowedIds: Set<string> | 'all'; primaryId: string | null };

// Cached briefly so the per-request data routes don't hit the DB on every call.
// The ECS process is long-lived, so this Map persists across requests. Access
// changes (provisioning, admin edits) take effect within ACCESS_TTL_MS or
// immediately via clearAccessCache().
const accessCache = new Map<string, { at: number; access: Access }>();
const ACCESS_TTL_MS = 60_000;

export function clearAccessCache(): void {
  accessCache.clear();
}

/**
 * Resolve a signed-in user's allowed agency set. Returns null when there is no
 * session (public / seed / bootstrap context).
 *
 *   1. If a `users` row exists: `all_agencies` → every active agency; otherwise
 *      the explicit `user_agencies` rows plus the primary `users.agencyId`.
 *   2. No row yet (e.g. a Cognito user that never hit /api/auth/me): fall back
 *      to the domain rule — staff (@populicom.com) see all; everyone else is
 *      limited to their JWT agency. This keeps the switcher working for staff
 *      with no window where access breaks right after deploy.
 */
async function getUserAccess(
  sub: string | null,
  email: string | null,
  sessionSlug: string | null,
): Promise<Access | null> {
  if (!sub && !email) return null;
  const key = sub || email!;
  const cached = accessCache.get(key);
  if (cached && Date.now() - cached.at < ACCESS_TTL_MS) return cached.access;

  const db = getDb();
  const conds: SQL[] = [];
  if (sub) conds.push(eq(users.cognitoSub, sub));
  if (email) conds.push(eq(users.email, email));
  const [u] = await db
    .select({ id: users.id, allAgencies: users.allAgencies, agencyId: users.agencyId })
    .from(users)
    .where(conds.length === 1 ? conds[0] : or(...conds))
    .limit(1);

  let access: Access;
  if (u) {
    if (u.allAgencies) {
      access = { allowedIds: 'all', primaryId: u.agencyId };
    } else {
      const rows = await db
        .select({ agencyId: userAgencies.agencyId })
        .from(userAgencies)
        .where(eq(userAgencies.userId, u.id));
      const ids = new Set(rows.map((r) => r.agencyId));
      ids.add(u.agencyId); // the primary agency is always visible
      access = { allowedIds: ids, primaryId: u.agencyId };
    }
  } else {
    const primaryId = await slugToId(sessionSlug);
    const isStaff = !!email && email.toLowerCase().endsWith(STAFF_EMAIL_DOMAIN);
    access = isStaff
      ? { allowedIds: 'all', primaryId }
      : { allowedIds: primaryId ? new Set([primaryId]) : new Set<string>(), primaryId };
  }

  accessCache.set(key, { at: Date.now(), access });
  return access;
}

async function sessionFromHeaders(): Promise<{ sub: string | null; email: string | null; slug: string | null }> {
  try {
    const hdrs = await headers();
    return {
      sub: hdrs.get('x-eco-user-sub'),
      email: hdrs.get('x-eco-user-email'),
      slug: hdrs.get('x-eco-user-agency'),
    };
  } catch {
    return { sub: null, email: null, slug: null };
  }
}

/**
 * Resolve which agency's data the current caller is allowed to read.
 *
 * Authenticated users: the explicit `?agency=` (the dashboard's agency
 * switcher) wins **only if it's within the user's allowed set**; otherwise we
 * fall back to their primary agency. This is the tenant-isolation boundary —
 * a user can only read agencies they've been granted (see getUserAccess).
 *
 * Public / seed contexts (no session): `?agency=` → default slug → first
 * active agency, so bootstrap tools and the sign-in flow never 404.
 */
export async function resolveAgencyId(params: URLSearchParams): Promise<string | null> {
  const param = params.get('agency');
  const { sub, email, slug } = await sessionFromHeaders();
  const access = await getUserAccess(sub, email, slug);

  // No session → public/seed behavior (unchanged from before user-scoping),
  // salvo que una agencia restringida nunca se sirve sin sesión.
  if (!access) {
    if (param && agencyVisibleTo(param, null)) {
      const paramId = await slugToId(param);
      if (paramId) return paramId;
    }
    const def = await slugToId(DEFAULT_AGENCY_SLUG);
    if (def) return def;
    return firstActiveAgencyId(null);
  }

  // Mapa id→slug de las activas: la restricción se expresa por slug pero la
  // tenencia se compara por id, y `primaryId` puede apuntar a una restringida.
  const active = await listActiveAgencies();
  const slugOf = new Map(active.map((a) => [a.id, a.slug]));
  const visible = (id: string | null): boolean =>
    !!id && agencyVisibleTo(slugOf.get(id) ?? '', email);

  const isAllowed = (id: string | null): id is string =>
    !!id && visible(id) && (access.allowedIds === 'all' || access.allowedIds.has(id));

  // 1. Switcher selection, honored only if the user may see that agency.
  if (param) {
    const paramId = await slugToId(param);
    if (isAllowed(paramId)) return paramId;
  }
  // 2. The user's primary agency (default landing).
  if (isAllowed(access.primaryId)) return access.primaryId;
  // 3. Primary missing/disallowed → first agency the user can actually see.
  if (access.allowedIds === 'all') return firstActiveAgencyId(email);
  for (const id of access.allowedIds) {
    if (visible(id)) return id;
  }
  return null;
}

/**
 * Slugs of the agencies the current user may switch between, for filtering the
 * dashboard's agency switcher. Returns null when every active agency is allowed
 * (staff / all_agencies / public) — callers then show the full list.
 */
export async function resolveAllowedAgencySlugs(): Promise<string[] | null> {
  const { sub, email, slug } = await sessionFromHeaders();
  const access = await getUserAccess(sub, email, slug);
  // `null` sigue significando "ve todas" — tres rutas dependen de esa señal
  // (el centinela __all__ de la vista ejecutiva, /api/users y /api/users/[id]),
  // así que NO se convierte en lista aquí. Las agencias restringidas se sacan
  // en `filterAgenciesForCaller`, que es por donde pasan las listas que el
  // usuario ve.
  if (!access || access.allowedIds === 'all') return null;
  const active = await listActiveAgencies();
  const allowed = access.allowedIds;
  return active
    .filter((a) => allowed.has(a.id) && agencyVisibleTo(a.slug, email))
    .map((a) => a.slug);
}

/**
 * Quita de una lista de agencias las restringidas que el llamante no puede ver.
 * Va aparte de `resolveAllowedAgencySlugs` porque ese contrato usa `null` para
 * "ve todas" y, con agencias restringidas, "todas" ya no es todas: las rutas que
 * construyen el selector tienen que filtrar aunque el usuario sea staff.
 */
export async function filterAgenciesForCaller<T extends { slug: string }>(rows: T[]): Promise<T[]> {
  const { email } = await sessionFromHeaders();
  return rows.filter((a) => agencyVisibleTo(a.slug, email));
}

/**
 * La agencia sobre la que el llamante puede ESCRIBIR. Prefiere el slug fijado a
 * sus claims de Cognito (cabecera que pone el middleware) y solo cae al
 * parámetro de la URL cuando no hay sesión con agencia — nunca confía en el
 * cuerpo de la petición.
 *
 * Vive aquí y no en cada ruta porque la tenencia no se duplica: tres rutas de
 * escritura (/api/alerts, /api/alerts/[id], /api/users) necesitaban la misma
 * resolución, y tener tres copias significa que endurecer una deja las otras
 * atrás. Para LECTURAS usa `resolveAgencyId`, que sí honra el switcher `?agency=`
 * dentro del conjunto permitido del usuario.
 */
export async function resolveCallerAgencyId(request: {
  headers: { get(name: string): string | null };
  nextUrl: { searchParams: URLSearchParams };
}): Promise<string | null> {
  const sessionSlug = request.headers.get('x-eco-user-agency');
  if (sessionSlug) {
    const id = await slugToId(sessionSlug);
    if (id) return id;
  }
  return resolveAgencyId(request.nextUrl.searchParams);
}
