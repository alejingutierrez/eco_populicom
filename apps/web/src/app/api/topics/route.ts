import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { topics, subtopics, mentionTopics, mentions } from '@eco/database';
import { sql, count, eq, and } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';

export async function GET(request: NextRequest) {
  const db = getDb();

  const agencyId = await resolveAgencyId(request.nextUrl.searchParams);
  if (!agencyId) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
  }

  try {
    // Topics with mention counts scoped to agency
    const topicRows = await db
      .select({
        id: topics.id,
        slug: topics.slug,
        name: topics.name,
        count: count(mentionTopics.mentionId),
      })
      .from(topics)
      .leftJoin(mentionTopics, eq(mentionTopics.topicId, topics.id))
      .leftJoin(mentions, and(
        eq(mentions.id, mentionTopics.mentionId),
        eq(mentions.agencyId, agencyId),
      ))
      .where(eq(topics.agencyId, agencyId))
      .groupBy(topics.id, topics.slug, topics.name)
      .orderBy(sql`count(${mentionTopics.mentionId}) DESC`);

    // For each topic, get subtopics with counts scoped to agency mentions
    const result = [];
    for (const t of topicRows) {
      const subRows = await db
        .select({
          slug: subtopics.slug,
          name: subtopics.name,
          count: count(mentionTopics.mentionId),
        })
        .from(subtopics)
        .leftJoin(mentionTopics, eq(mentionTopics.subtopicId, subtopics.id))
        .leftJoin(mentions, and(
          eq(mentions.id, mentionTopics.mentionId),
          eq(mentions.agencyId, agencyId),
        ))
        .where(eq(subtopics.topicId, t.id))
        .groupBy(subtopics.slug, subtopics.name)
        .orderBy(sql`count(${mentionTopics.mentionId}) DESC`);

      result.push({
        slug: t.slug,
        name: t.name,
        count: Number(t.count),
        topSentiment: 'neutral',
        subtopics: subRows.map((s) => ({ slug: s.slug, name: s.name, count: Number(s.count) })),
      });
    }

    return NextResponse.json({ topics: result });
  } catch (err) {
    console.error('Topics API error:', err);
    return NextResponse.json({ topics: [] });
  }
}
