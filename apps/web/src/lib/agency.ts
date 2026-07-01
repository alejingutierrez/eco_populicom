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

async function firstActiveAgencyId(): Promise<string | null> {
  const db = getDb();
  const [first] = await db
    .select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.isActive, true))
    .limit(1);
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

  // No session → public/seed behavior (unchanged from before user-scoping).
  if (!access) {
    if (param) {
      const paramId = await slugToId(param);
      if (paramId) return paramId;
    }
    const def = await slugToId(DEFAULT_AGENCY_SLUG);
    if (def) return def;
    return firstActiveAgencyId();
  }

  const isAllowed = (id: string | null): id is string =>
    !!id && (access.allowedIds === 'all' || access.allowedIds.has(id));

  // 1. Switcher selection, honored only if the user may see that agency.
  if (param) {
    const paramId = await slugToId(param);
    if (isAllowed(paramId)) return paramId;
  }
  // 2. The user's primary agency (default landing).
  if (isAllowed(access.primaryId)) return access.primaryId;
  // 3. Primary missing/disallowed → first agency the user can actually see.
  if (access.allowedIds === 'all') return firstActiveAgencyId();
  const firstAllowed = access.allowedIds.values().next().value;
  return firstAllowed ?? null;
}

/**
 * Slugs of the agencies the current user may switch between, for filtering the
 * dashboard's agency switcher. Returns null when every active agency is allowed
 * (staff / all_agencies / public) — callers then show the full list.
 */
export async function resolveAllowedAgencySlugs(): Promise<string[] | null> {
  const { sub, email, slug } = await sessionFromHeaders();
  const access = await getUserAccess(sub, email, slug);
  if (!access || access.allowedIds === 'all') return null;
  const active = await listActiveAgencies();
  const allowed = access.allowedIds;
  return active.filter((a) => allowed.has(a.id)).map((a) => a.slug);
}
