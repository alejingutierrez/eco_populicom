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
 *   1. Authenticated user's agency (set by the middleware via header).
 *   2. `agency=<slug>` query param (for public/unauthenticated contexts).
 *   3. The default agency slug for seed/bootstrap tools.
 */
export async function resolveAgencyId(params: URLSearchParams): Promise<string | null> {
  try {
    const hdrs = await headers();
    const sessionSlug = hdrs.get('x-eco-user-agency');
    const sessionId = await slugToId(sessionSlug);
    if (sessionId) return sessionId;
  } catch {
    // headers() only works inside a request scope; ignore elsewhere.
  }

  const param = params.get('agency');
  const paramId = await slugToId(param ?? DEFAULT_AGENCY_SLUG);
  if (paramId) return paramId;

  // Last resort: first active agency so the dashboard never 404s on boot.
  const db = getDb();
  const [first] = await db
    .select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.isActive, true))
    .limit(1);
  return first?.id ?? null;
}
