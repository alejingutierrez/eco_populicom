import { NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { mentions, dailyMetricSnapshots } from '@eco/database';
import { sql, count, gte } from 'drizzle-orm';

export async function GET() {
  const db = getDb();

  // Date range: last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

  try {
    // All queries in parallel
    const [kpiRows, timeline, sentimentData, topSources, recentMentions] = await Promise.all([
      // KPIs from pre-computed daily_metric_snapshots (~30 rows vs thousands)
      db
        .select({
          totalMentions: sql<number>`coalesce(sum(${dailyMetricSnapshots.totalMentions}), 0)::int`,
          negativeCount: sql<number>`coalesce(sum(${dailyMetricSnapshots.negativeCount}), 0)::int`,
          totalReach: sql<number>`coalesce(sum(${dailyMetricSnapshots.totalReach}), 0)::bigint`,
          totalEngagement: sql<number>`coalesce(sum(${dailyMetricSnapshots.totalEngagementScore}), 0)`,
          totalMentionsForAvg: sql<number>`coalesce(sum(${dailyMetricSnapshots.totalMentions}), 1)::int`,
        })
        .from(dailyMetricSnapshots)
        .where(gte(dailyMetricSnapshots.date, thirtyDaysAgoStr)),

      // Timeline
      db
        .select({
          date: sql<string>`to_char(${mentions.publishedAt}, 'MM/DD')`,
          count: count(),
        })
        .from(mentions)
        .where(gte(mentions.publishedAt, thirtyDaysAgo))
        .groupBy(sql`to_char(${mentions.publishedAt}, 'MM/DD'), DATE(${mentions.publishedAt})`)
        .orderBy(sql`DATE(${mentions.publishedAt})`),

      // Sentiment breakdown
      db
        .select({
          sentiment: mentions.nlpSentiment,
          count: count(),
        })
        .from(mentions)
        .where(gte(mentions.publishedAt, thirtyDaysAgo))
        .groupBy(mentions.nlpSentiment),

      // Top sources
      db
        .select({
          source: mentions.contentSourceName,
          count: count(),
        })
        .from(mentions)
        .where(gte(mentions.publishedAt, thirtyDaysAgo))
        .groupBy(mentions.contentSourceName)
        .orderBy(sql`count(*) DESC`)
        .limit(6),

      // Recent mentions
      db
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
        .limit(5),
    ]);

    const kpi = kpiRows[0];
    const totalMentions = Number(kpi?.totalMentions) || 0;
    const negativeCount = Number(kpi?.negativeCount) || 0;
    const negativePct = totalMentions > 0
      ? Math.round((negativeCount / totalMentions) * 100)
      : 0;
    const avgEngagement = totalMentions > 0
      ? Number(kpi?.totalEngagement) / totalMentions
      : 0;

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

    return NextResponse.json({
      kpis: {
        totalMentions,
        negativePct,
        avgEngagement: Number(avgEngagement.toFixed(1)),
        totalReach: Number(kpi?.totalReach) || 0,
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
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err) {
    console.error('Dashboard API error:', err);
    return NextResponse.json(
      { error: 'Error fetching dashboard data' },
      { status: 500 },
    );
  }
}
