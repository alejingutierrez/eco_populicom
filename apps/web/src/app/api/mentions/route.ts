import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { mentions } from '@eco/database';
import { sql, count, eq, ilike, and, type SQL } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';

export async function GET(request: NextRequest) {
  const db = getDb();
  const { searchParams } = request.nextUrl;

  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);
  const sentiment = searchParams.get('sentiment');
  const source = searchParams.get('source');
  const pertinence = searchParams.get('pertinence');
  const search = searchParams.get('search');

  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
  }

  try {
    const conditions: SQL[] = [eq(mentions.agencyId, agencyId)];

    if (sentiment) {
      conditions.push(eq(mentions.nlpSentiment, sentiment));
    }
    if (source) {
      conditions.push(eq(mentions.pageType, source));
    }
    if (pertinence) {
      conditions.push(eq(mentions.nlpPertinence, pertinence));
    }
    if (search) {
      conditions.push(
        sql`(${mentions.title} ILIKE ${'%' + search + '%'} OR ${mentions.snippet} ILIKE ${'%' + search + '%'})`,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ total: count() })
      .from(mentions)
      .where(where);

    const rows = await db
      .select({
        id: mentions.id,
        title: mentions.title,
        snippet: mentions.snippet,
        url: mentions.url,
        domain: mentions.domain,
        pageType: mentions.pageType,
        author: mentions.author,
        nlpSentiment: mentions.nlpSentiment,
        nlpPertinence: mentions.nlpPertinence,
        nlpEmotions: mentions.nlpEmotions,
        nlpSummary: mentions.nlpSummary,
        bwSentiment: mentions.bwSentiment,
        likes: mentions.likes,
        comments: mentions.comments,
        shares: mentions.shares,
        engagementScore: mentions.engagementScore,
        publishedAt: mentions.publishedAt,
        isDuplicate: mentions.isDuplicate,
      })
      .from(mentions)
      .where(where)
      .orderBy(sql`${mentions.publishedAt} DESC`)
      .limit(limit)
      .offset((page - 1) * limit);

    return NextResponse.json({
      mentions: rows.map((m) => ({
        ...m,
        publishedAt: m.publishedAt.toISOString(),
      })),
      total: Number(totalResult.total),
      page,
      limit,
    });
  } catch (err) {
    console.error('Mentions API error:', err);
    return NextResponse.json(
      { error: 'Error fetching mentions' },
      { status: 500 },
    );
  }
}
