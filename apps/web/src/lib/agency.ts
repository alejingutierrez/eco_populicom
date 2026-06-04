import { getDb, agencies } from '@eco/database';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';

const DEFAULT_AGENCY_SLUG = 'aaa';

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

/**
 * Resolve which agency's data the current caller is allowed to read.
 *
 * Precedence (highest wins):
 *   1. `agency=<slug>` query param — the dashboard's agency switcher sends the
 *      user-selected slug here, so an explicit choice always wins.
 *   2. Authenticated user's agency (set by the middleware via header) — the
 *      default when no explicit `?agency=` is provided, so a user lands on
 *      their own agency on first boot.
 *   3. The default agency slug for seed/bootstrap/public contexts.
 *   4. First active agency, so the dashboard never 404s on boot.
 *
 * SECURITY — tenant isolation: an explicit `?agency=` overrides the
 * session-bound agency, so ANY authenticated user can read ANY agency's data
 * by changing the slug. This is intentional while all users are internal
 * Populicom staff (the agency switcher must work for them). If external client
 * users are ever onboarded, gate step 1 on a "can see all agencies" claim
 * (e.g. a dedicated Cognito group) and fall through to the session agency
 * otherwise — see middleware.ts for where the session header is injected.
 */
export async function resolveAgencyId(params: URLSearchParams): Promise<string | null> {
  // 1. Explicit switcher selection wins.
  const param = params.get('agency');
  if (param) {
    const paramId = await slugToId(param);
    if (paramId) return paramId;
  }

  // 2. Session-bound agency (JWT custom:agency_slug via middleware header).
  try {
    const hdrs = await headers();
    const sessionId = await slugToId(hdrs.get('x-eco-user-agency'));
    if (sessionId) return sessionId;
  } catch {
    // headers() only works inside a request scope; ignore elsewhere.
  }

  // 3. Default slug for seed/bootstrap/public contexts.
  const defaultId = await slugToId(DEFAULT_AGENCY_SLUG);
  if (defaultId) return defaultId;

  // 4. Last resort: first active agency so the dashboard never 404s on boot.
  const db = getDb();
  const [first] = await db
    .select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.isActive, true))
    .limit(1);
  return first?.id ?? null;
}
