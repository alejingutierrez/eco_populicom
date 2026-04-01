import { NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { mentions } from '@eco/database';
import { sql, count, avg, sum, eq, gte } from 'drizzle-orm';

export async function GET() {
  const db = getDb();

  // Date range: last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  try {
    // KPIs
    const [kpiResult] = await db
      .select({
        totalMentions: count(),
        avgEngagement: avg(mentions.engagementScore),
        totalReach: sum(mentions.reachEstimate),
      })
      .from(mentions)
      .where(gte(mentions.publishedAt, thirtyDaysAgo));

    const [negativeCount] = await db
      .select({ cnt: count() })
      .from(mentions)
      .where(
        sql`${mentions.publishedAt} >= ${thirtyDaysAgo} AND ${mentions.nlpSentiment} = 'negativo'`,
      );

    const totalMentions = Number(kpiResult.totalMentions) || 0;
    const negativePct = totalMentions > 0
      ? Math.round((Number(negativeCount.cnt) / totalMentions) * 100)
      : 0;

    // Timeline: mentions per day (last 30 days)
    const timeline = await db
      .select({
        date: sql<string>`to_char(${mentions.publishedAt}, 'MM/DD')`,
        count: count(),
      })
      .from(mentions)
      .where(gte(mentions.publishedAt, thirtyDaysAgo))
      .groupBy(sql`to_char(${mentions.publishedAt}, 'MM/DD'), DATE(${mentions.publishedAt})`)
      .orderBy(sql`DATE(${mentions.publishedAt})`);

    // Sentiment breakdown
    const sentimentData = await db
      .select({
        sentiment: mentions.nlpSentiment,
        count: count(),
      })
      .from(mentions)
      .where(gte(mentions.publishedAt, thirtyDaysAgo))
      .groupBy(mentions.nlpSentiment);

    const sentimentColors: Record<string, string> = {
      positivo: '#4ade80',
      neutral: '#94a3b8',
      negativo: '#f87171',
    };

    const sentimentBreakdown = sentimentData.map((s) => ({
      name: s.sentiment ?? 'neutral',
      value: Number(s.count),
      color: sentimentColors[s.sentiment ?? 'neutral'] ?? '#94a3b8',
    }));

    // Top sources
    const topSources = await db
      .select({
        source: mentions.contentSourceName,
        count: count(),
      })
      .from(mentions)
      .where(gte(mentions.publishedAt, thirtyDaysAgo))
      .groupBy(mentions.contentSourceName)
      .orderBy(sql`count(*) DESC`)
      .limit(6);

    // Recent mentions
    const recentMentions = await db
      .select({
        id: mentions.id,
        title: mentions.title,
        domain: mentions.domain,
        pageType: mentions.pageType,
        nlpSentiment: mentions.nlpSentiment,
        publishedAt: mentions.publishedAt,
        engagementScore: mentions.engagementScore,
      })
      .from(mentions)
      .orderBy(sql`${mentions.publishedAt} DESC`)
      .limit(5);

    return NextResponse.json({
      kpis: {
        totalMentions,
        negativePct,
        avgEngagement: Number(kpiResult.avgEngagement) || 0,
        totalReach: Number(kpiResult.totalReach) || 0,
      },
      timeline: timeline.map((t) => ({ date: t.date, count: Number(t.count) })),
      sentimentBreakdown,
      topSources: topSources.map((s) => ({
        source: s.source ?? 'Desconocido',
        count: Number(s.count),
      })),
      recentMentions: recentMentions.map((m) => ({
        ...m,
        publishedAt: m.publishedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('Dashboard API error:', err);
    return NextResponse.json(
      { error: 'Error fetching dashboard data' },
      { status: 500 },
    );
  }
}
