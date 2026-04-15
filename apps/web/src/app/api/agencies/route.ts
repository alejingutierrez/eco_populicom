import { NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { agencies } from '@eco/database';
import { eq } from 'drizzle-orm';

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

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
  });
}
