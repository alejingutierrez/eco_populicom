import { NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { topics, subtopics, mentionTopics } from '@eco/database';
import { sql, count, eq } from 'drizzle-orm';

export async function GET() {
  const db = getDb();

  try {
    // Topics with mention counts
    const topicRows = await db
      .select({
        id: topics.id,
        slug: topics.slug,
        name: topics.name,
        count: count(mentionTopics.mentionId),
      })
      .from(topics)
      .leftJoin(mentionTopics, eq(mentionTopics.topicId, topics.id))
      .groupBy(topics.id, topics.slug, topics.name)
      .orderBy(sql`count(${mentionTopics.mentionId}) DESC`);

    // For each topic, get subtopics with counts
    const result = [];
    for (const t of topicRows) {
      const subRows = await db
        .select({
          slug: subtopics.slug,
          name: subtopics.name,
          count: count(mentionTopics.mentionId),
        })
        .from(subtopics)
        .leftJoin(mentionTopics, sql`${mentionTopics.subtopicId} = ${subtopics.id}`)
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
