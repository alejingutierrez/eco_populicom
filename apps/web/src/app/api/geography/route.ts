import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { municipalities, mentionMunicipalities, mentions } from '@eco/database';
import { sql, count, eq } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';

export async function GET(request: NextRequest) {
  const db = getDb();

  const agencyId = await resolveAgencyId(request.nextUrl.searchParams);
  if (!agencyId) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
  }

  try {
    const rows = await db
      .select({
        slug: municipalities.slug,
        name: municipalities.name,
        region: municipalities.region,
        count: count(mentionMunicipalities.mentionId),
      })
      .from(municipalities)
      .leftJoin(mentionMunicipalities, eq(mentionMunicipalities.municipalityId, municipalities.id))
      .leftJoin(mentions, eq(mentions.id, mentionMunicipalities.mentionId))
      .where(eq(mentions.agencyId, agencyId))
      .groupBy(municipalities.slug, municipalities.name, municipalities.region)
      .orderBy(sql`count(${mentionMunicipalities.mentionId}) DESC`);

    return NextResponse.json({
      municipalities: rows
        .filter((r) => Number(r.count) > 0)
        .map((r) => ({
          slug: r.slug,
          name: r.name,
          region: r.region,
          count: Number(r.count),
          topSentiment: 'neutral',
        })),
    });
  } catch (err) {
    console.error('Geography API error:', err);
    return NextResponse.json({ municipalities: [] });
  }
}
