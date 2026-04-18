import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { mentions } from '@eco/database';
import { sql, count, gte, eq, and } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';

export async function GET(request: NextRequest) {
  const db = getDb();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const agencyId = await resolveAgencyId(request.nextUrl.searchParams);
  if (!agencyId) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
  }

  const baseWhere = and(
    gte(mentions.publishedAt, thirtyDaysAgo),
    eq(mentions.agencyId, agencyId),
  );

  try {
    // Sentiment over time
    const timelineRaw = await db
      .select({
        date: sql<string>`to_char(${mentions.publishedAt}, 'MM/DD')`,
        sentiment: mentions.nlpSentiment,
        count: count(),
      })
      .from(mentions)
      .where(baseWhere)
      .groupBy(sql`to_char(${mentions.publishedAt}, 'MM/DD'), DATE(${mentions.publishedAt}), ${mentions.nlpSentiment}`)
      .orderBy(sql`DATE(${mentions.publishedAt})`);

    // Pivot timeline data
    const timelineMap = new Map<string, { date: string; positivo: number; neutral: number; negativo: number }>();
    for (const row of timelineRaw) {
      const d = row.date;
      if (!timelineMap.has(d)) timelineMap.set(d, { date: d, positivo: 0, neutral: 0, negativo: 0 });
      const entry = timelineMap.get(d)!;
      const s = (row.sentiment ?? 'neutral') as 'positivo' | 'neutral' | 'negativo';
      if (s in entry) entry[s] = Number(row.count);
    }

    // Sentiment by source
    const bySourceRaw = await db
      .select({
        source: mentions.contentSourceName,
        sentiment: mentions.nlpSentiment,
        count: count(),
      })
      .from(mentions)
      .where(baseWhere)
      .groupBy(mentions.contentSourceName, mentions.nlpSentiment)
      .orderBy(sql`count(*) DESC`)
      .limit(20);

    const sourceMap = new Map<string, { source: string; positivo: number; neutral: number; negativo: number }>();
    for (const row of bySourceRaw) {
      const src = row.source ?? 'Desconocido';
      if (!sourceMap.has(src)) sourceMap.set(src, { source: src, positivo: 0, neutral: 0, negativo: 0 });
      const entry = sourceMap.get(src)!;
      const s = (row.sentiment ?? 'neutral') as 'positivo' | 'neutral' | 'negativo';
      if (s in entry) entry[s] = Number(row.count);
    }

    // Emotions distribution
    const allMentions = await db
      .select({ nlpEmotions: mentions.nlpEmotions })
      .from(mentions)
      .where(baseWhere);

    const emotionCounts: Record<string, number> = {};
    for (const m of allMentions) {
      for (const e of (m.nlpEmotions ?? [])) {
        emotionCounts[e] = (emotionCounts[e] ?? 0) + 1;
      }
    }

    // BW vs Claude comparison
    const comparisonRaw = await db
      .select({
        bw: mentions.bwSentiment,
        nlp: mentions.nlpSentiment,
        count: count(),
      })
      .from(mentions)
      .where(baseWhere)
      .groupBy(mentions.bwSentiment, mentions.nlpSentiment);

    const bwCounts: Record<string, number> = { positive: 0, neutral: 0, negative: 0 };
    const claudeCounts: Record<string, number> = { positivo: 0, neutral: 0, negativo: 0 };
    for (const row of comparisonRaw) {
      if (row.bw) bwCounts[row.bw] = (bwCounts[row.bw] ?? 0) + Number(row.count);
      if (row.nlp) claudeCounts[row.nlp] = (claudeCounts[row.nlp] ?? 0) + Number(row.count);
    }

    return NextResponse.json({
      timeline: Array.from(timelineMap.values()),
      bySource: Array.from(sourceMap.values()).slice(0, 6),
      emotions: Object.entries(emotionCounts).map(([emotion, count]) => ({ emotion, count })),
      comparison: [
        { label: 'Positivo', bw: bwCounts.positive ?? 0, claude: claudeCounts.positivo ?? 0 },
        { label: 'Neutral', bw: bwCounts.neutral ?? 0, claude: claudeCounts.neutral ?? 0 },
        { label: 'Negativo', bw: bwCounts.negative ?? 0, claude: claudeCounts.negativo ?? 0 },
      ],
    });
  } catch (err) {
    console.error('Sentiment API error:', err);
    return NextResponse.json({ timeline: [], bySource: [], emotions: [], comparison: [] });
  }
}
