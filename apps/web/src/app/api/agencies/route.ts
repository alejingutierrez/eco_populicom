import { NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { agencies } from '@eco/database';
import { eq } from 'drizzle-orm';
import { resolveAllowedAgencySlugs } from '@/lib/agency';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();

  const result = await db
    .select({
      slug: agencies.slug,
      name: agencies.name,
      logoUrl: agencies.logoUrl,
      brandwatchProjectId: agencies.brandwatchProjectId,
      brandwatchQueryIds: agencies.brandwatchQueryIds,
    })
    .from(agencies)
    .where(eq(agencies.isActive, true));

  // Restrict to the agencies this user may see (null = all). Per-user, so this
  // must NOT be shared-cached — that would leak one user's list to another.
  const allowedSlugs = await resolveAllowedAgencySlugs();
  const visible = allowedSlugs ? result.filter((a) => allowedSlugs.includes(a.slug)) : result;

  return NextResponse.json(visible, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
