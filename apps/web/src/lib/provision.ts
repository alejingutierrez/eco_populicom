import { getDb, users, agencies, userAgencies } from '@eco/database';
import { eq, inArray } from 'drizzle-orm';
import { STAFF_EMAIL_DOMAIN, clearAccessCache } from './agency';
import type { SessionUser } from './session';

function roleFromGroups(groups?: string[]): 'admin' | 'analyst' | 'viewer' {
  if (groups?.includes('admin')) return 'admin';
  if (groups?.includes('analyst')) return 'analyst';
  return 'viewer';
}

/**
 * Just-in-time user provisioning. Called when an authenticated user hits
 * /api/auth/me so the `users` table reflects real Cognito users — the agency
 * switcher's access set (getUserAccess) and the Users admin screen both read
 * from it, and Cognito users created outside /api/users would otherwise never
 * appear there.
 *
 * Resolution order:
 *   1. Row already exists for this cognito_sub → just refresh email/last_login.
 *   2. A placeholder invite row exists for this email (cognito_sub = "invited:…")
 *      → claim it by setting the real cognito_sub.
 *   3. Otherwise insert a new row. New rows default to all_agencies=true for
 *      staff (@populicom.com); an admin can narrow this per-user later.
 *
 * Never overwrites an existing row's role / all_agencies / agency_id — admin
 * edits win. Best-effort: callers wrap it so a failure never blocks auth.
 */
export async function ensureUserProvisioned(s: SessionUser): Promise<void> {
  if (!s.sub || !s.email) return;
  const db = getDb();

  const [bySub] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.cognitoSub, s.sub))
    .limit(1);
  if (bySub) {
    await db.update(users).set({ email: s.email, lastLogin: new Date() }).where(eq(users.id, bySub.id));
    return;
  }

  // A users row requires a valid primary agency (agency_id is NOT NULL). If the
  // JWT's agency slug doesn't resolve, skip provisioning — the domain fallback
  // in getUserAccess still grants the right access in the meantime.
  if (!s.agencySlug) return;
  const [ag] = await db
    .select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.slug, s.agencySlug))
    .limit(1);
  if (!ag) return;

  const [byEmail] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, s.email))
    .limit(1);
  if (byEmail) {
    await db
      .update(users)
      .set({ cognitoSub: s.sub, lastLogin: new Date() })
      .where(eq(users.id, byEmail.id));
    clearAccessCache();
    return;
  }

  await db.insert(users).values({
    cognitoSub: s.sub,
    email: s.email,
    name: s.name ?? null,
    role: roleFromGroups(s.groups),
    agencyId: ag.id,
    allAgencies: s.email.toLowerCase().endsWith(STAFF_EMAIL_DOMAIN),
    lastLogin: new Date(),
  });
  clearAccessCache();
}

/**
 * Replace a user's agency grants.
 *
 * - `allAgencies` (when a boolean) toggles the see-all flag.
 * - `agencySlugs` (when an array) replaces the explicit user_agencies rows.
 *
 * Both are constrained to `callerAllowedSlugs` (null = caller sees all) so an
 * admin can never grant access to an agency they themselves can't see — that
 * would be a privilege-escalation path. Clears the access cache so the change
 * takes effect immediately.
 */
export async function setUserAgencyAccess(
  userId: string,
  opts: { allAgencies?: boolean; agencySlugs?: string[] },
  callerAllowedSlugs: string[] | null,
): Promise<void> {
  const db = getDb();

  if (typeof opts.allAgencies === 'boolean') {
    await db.update(users).set({ allAgencies: opts.allAgencies }).where(eq(users.id, userId));
  }

  if (Array.isArray(opts.agencySlugs)) {
    let slugs = opts.agencySlugs.filter((s): s is string => typeof s === 'string');
    if (callerAllowedSlugs) slugs = slugs.filter((s) => callerAllowedSlugs.includes(s));
    const rows = slugs.length
      ? await db
          .select({ id: agencies.id })
          .from(agencies)
          .where(inArray(agencies.slug, slugs))
      : [];
    await db.delete(userAgencies).where(eq(userAgencies.userId, userId));
    if (rows.length) {
      await db.insert(userAgencies).values(rows.map((r) => ({ userId, agencyId: r.id })));
    }
  }

  clearAccessCache();
}

/** slugs of the explicit agency grants for each of the given user ids. */
export async function agencySlugsByUser(userIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (userIds.length === 0) return out;
  const db = getDb();
  const rows = await db
    .select({ userId: userAgencies.userId, slug: agencies.slug })
    .from(userAgencies)
    .innerJoin(agencies, eq(agencies.id, userAgencies.agencyId))
    .where(inArray(userAgencies.userId, userIds));
  for (const r of rows) {
    const list = out.get(r.userId) ?? [];
    list.push(r.slug);
    out.set(r.userId, list);
  }
  return out;
}
