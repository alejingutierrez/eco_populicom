import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import {
  mentions,
  dailyMetricSnapshots,
  topics,
  mentionTopics,
  municipalities,
  mentionMunicipalities,
  agencies,
} from '@eco/database';
import { sql, count, gte, lte, eq, and, desc, inArray } from 'drizzle-orm';

const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

function parseDateRange(params: URLSearchParams) {
  const period = params.get('period') ?? '30d';
  const days = PERIOD_DAYS[period];

  if (days) {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    return { start, end, days };
  }

  // Custom range
  const startDate = params.get('startDate');
  const endDate = params.get('endDate');
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return { start, end, days };
  }

  // Fallback 30d
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return { start, end, days: 30 };
}

function buildMentionFilters(params: URLSearchParams, dateStart: Date, agencyId: string) {
  const conditions = [gte(mentions.publishedAt, dateStart), eq(mentions.agencyId, agencyId)];

  const sentiment = params.get('sentiment');
  if (sentiment) conditions.push(eq(mentions.nlpSentiment, sentiment));

  const source = params.get('source');
  if (source) conditions.push(eq(mentions.contentSourceName, source));

  const pertinence = params.get('pertinence');
  if (pertinence) conditions.push(eq(mentions.nlpPertinence, pertinence));

  return conditions;
}

function hasContentFilters(params: URLSearchParams): boolean {
  return !!(
    params.get('sentiment') ||
    params.get('source') ||
    params.get('topic') ||
    params.get('pertinence') ||
    params.get('municipality')
  );
}

/** Compute composite metrics from raw aggregates (same formulas as metrics-calculator Lambda) */
function computeMetrics(raw: {
  totalMentions: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalReach: number;
  totalEngagement: number;
  highPertinenceCount: number;
}) {
  const total = raw.totalMentions || 1;
  const nss = ((raw.positiveCount - raw.negativeCount) / total) * 100;
  const interactions = raw.totalLikes + raw.totalComments + raw.totalShares;
  const engagementRate = raw.totalReach > 0 ? (interactions / raw.totalReach) * 100 : 0;
  const amplificationRate = interactions > 0 ? (raw.totalShares / interactions) * 100 : 0;

  return {
    nss: Math.round(nss * 10) / 10,
    brandHealthIndex: null as number | null, // requires rolling windows, not available in filtered mode
    reputationMomentum: null as number | null,
    engagementRate: Math.round(engagementRate * 100) / 100,
    amplificationRate: Math.round(amplificationRate * 100) / 100,
    engagementVelocity: null as number | null,
    crisisRiskScore: null as number | null,
    volumeAnomalyZscore: null as number | null,
    totalMentions: raw.totalMentions,
    positiveCount: raw.positiveCount,
    neutralCount: raw.neutralCount,
    negativeCount: raw.negativeCount,
    highPertinenceCount: raw.highPertinenceCount,
    totalReach: raw.totalReach,
    nss7d: null as number | null,
    nss30d: null as number | null,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const { start, end, days } = parseDateRange(searchParams);
  const compare = searchParams.get('compare') === 'true';
  const topicFilter = searchParams.get('topic');
  const municipalityFilter = searchParams.get('municipality');
  const startStr = start.toISOString().split('T')[0];

  const db = getDb();

  const agencySlug = searchParams.get('agency') ?? 'aaa';
  const [agencyRow] = await db
    .select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.slug, agencySlug))
    .limit(1);
  if (!agencyRow) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
  }
  const agencyId = agencyRow.id;

  const useFiltered = hasContentFilters(searchParams);

  try {
    // ─── METRICS ───────────────────────────────────────────────
    let metricsResult;

    if (!useFiltered && !topicFilter && !municipalityFilter) {
      // Fast path: use pre-computed snapshots
      const snapshots = await db
        .select()
        .from(dailyMetricSnapshots)
        .where(and(gte(dailyMetricSnapshots.date, startStr), eq(dailyMetricSnapshots.agencyId, agencyId)))
        .orderBy(desc(dailyMetricSnapshots.date));

      // Find the most recent snapshot that has computed metrics (not null)
      // Today's snapshot may exist but have null values if Lambda hasn't run yet
      const current = snapshots.find((s) => s.nss !== null) ?? snapshots[0] ?? null;
      const timeline = [...snapshots].reverse().map((s) => ({
        date: s.date,
        nss: s.nss,
        brandHealthIndex: s.brandHealthIndex,
        crisisRiskScore: s.crisisRiskScore,
        engagementRate: s.engagementRate,
        amplificationRate: s.amplificationRate,
        engagementVelocity: s.engagementVelocity,
        volumeAnomalyZscore: s.volumeAnomalyZscore,
        totalMentions: s.totalMentions,
      }));

      // Sparkline data for hero KPIs
      const sparklines = {
        mentions: timeline.map((t) => t.totalMentions),
        nss: timeline.map((t) => t.nss ?? 0),
      };

      metricsResult = {
        current: current
          ? {
              nss: current.nss,
              brandHealthIndex: current.brandHealthIndex,
              reputationMomentum: current.reputationMomentum,
              engagementRate: current.engagementRate,
              amplificationRate: current.amplificationRate,
              engagementVelocity: current.engagementVelocity,
              crisisRiskScore: current.crisisRiskScore,
              volumeAnomalyZscore: current.volumeAnomalyZscore,
              totalMentions: snapshots.reduce((s, r) => s + r.totalMentions, 0),
              positiveCount: snapshots.reduce((s, r) => s + r.positiveCount, 0),
              neutralCount: snapshots.reduce((s, r) => s + r.neutralCount, 0),
              negativeCount: snapshots.reduce((s, r) => s + r.negativeCount, 0),
              highPertinenceCount: snapshots.reduce((s, r) => s + r.highPertinenceCount, 0),
              totalReach: snapshots.reduce((s, r) => s + r.totalReach, 0),
              nss7d: current.nss7d,
              nss30d: current.nss30d,
            }
          : null,
        timeline,
        sparklines,
      };
    } else {
      // Filtered path: aggregate from mentions table
      const baseConditions = buildMentionFilters(searchParams, start, agencyId);

      // If topic/municipality filter, we need to join
      let mentionIdSubquery: string[] | null = null;

      if (topicFilter) {
        const topicRow = await db
          .select({ id: topics.id })
          .from(topics)
          .where(and(eq(topics.slug, topicFilter), eq(topics.agencyId, agencyId)))
          .limit(1);
        if (topicRow.length > 0) {
          const mentionIds = await db
            .select({ mentionId: mentionTopics.mentionId })
            .from(mentionTopics)
            .where(eq(mentionTopics.topicId, topicRow[0].id));
          mentionIdSubquery = mentionIds.map((r) => r.mentionId);
        }
      }

      if (municipalityFilter) {
        const munRow = await db
          .select({ id: municipalities.id })
          .from(municipalities)
          .where(eq(municipalities.slug, municipalityFilter))
          .limit(1);
        if (munRow.length > 0) {
          const mentionIds = await db
            .select({ mentionId: mentionMunicipalities.mentionId })
            .from(mentionMunicipalities)
            .where(eq(mentionMunicipalities.municipalityId, munRow[0].id));
          const ids = mentionIds.map((r) => r.mentionId);
          mentionIdSubquery = mentionIdSubquery
            ? mentionIdSubquery.filter((id) => ids.includes(id))
            : ids;
        }
      }

      if (mentionIdSubquery !== null && mentionIdSubquery.length > 0) {
        baseConditions.push(inArray(mentions.id, mentionIdSubquery));
      }

      const [rawAgg] = await db
        .select({
          totalMentions: sql<number>`count(*)::int`,
          positiveCount: sql<number>`count(*) FILTER (WHERE ${mentions.nlpSentiment} = 'positivo')::int`,
          neutralCount: sql<number>`count(*) FILTER (WHERE ${mentions.nlpSentiment} = 'neutral')::int`,
          negativeCount: sql<number>`count(*) FILTER (WHERE ${mentions.nlpSentiment} = 'negativo')::int`,
          highPertinenceCount: sql<number>`count(*) FILTER (WHERE ${mentions.nlpPertinence} = 'alta')::int`,
          totalLikes: sql<number>`coalesce(sum(${mentions.likes}), 0)::int`,
          totalComments: sql<number>`coalesce(sum(${mentions.comments}), 0)::int`,
          totalShares: sql<number>`coalesce(sum(${mentions.shares}), 0)::int`,
          totalReach: sql<number>`coalesce(sum(${mentions.reachEstimate}), 0)::bigint`,
          totalEngagement: sql<number>`coalesce(sum(${mentions.engagementScore}), 0)`,
        })
        .from(mentions)
        .where(and(...baseConditions));

      // Build daily timeline from filtered mentions
      const dailyRows = await db
        .select({
          date: sql<string>`DATE(${mentions.publishedAt})::text`,
          totalMentions: sql<number>`count(*)::int`,
          positiveCount: sql<number>`count(*) FILTER (WHERE ${mentions.nlpSentiment} = 'positivo')::int`,
          negativeCount: sql<number>`count(*) FILTER (WHERE ${mentions.nlpSentiment} = 'negativo')::int`,
          totalReach: sql<number>`coalesce(sum(${mentions.reachEstimate}), 0)::int`,
          totalLikes: sql<number>`coalesce(sum(${mentions.likes}), 0)::int`,
          totalComments: sql<number>`coalesce(sum(${mentions.comments}), 0)::int`,
          totalShares: sql<number>`coalesce(sum(${mentions.shares}), 0)::int`,
        })
        .from(mentions)
        .where(and(...baseConditions))
        .groupBy(sql`DATE(${mentions.publishedAt})`)
        .orderBy(sql`DATE(${mentions.publishedAt})`);

      const filteredTimeline = dailyRows.map((row) => {
        const total = row.totalMentions || 1;
        const nss = ((row.positiveCount - row.negativeCount) / total) * 100;
        const interactions = row.totalLikes + row.totalComments + row.totalShares;
        const engRate = row.totalReach > 0 ? (interactions / row.totalReach) * 100 : 0;
        return {
          date: row.date,
          nss: Math.round(nss * 10) / 10,
          totalMentions: row.totalMentions,
          engagementRate: Math.round(engRate * 100) / 100,
          brandHealthIndex: null,
          crisisRiskScore: null,
          amplificationRate: interactions > 0 ? Math.round((row.totalShares / interactions) * 1000) / 10 : 0,
          engagementVelocity: null,
          volumeAnomalyZscore: null,
        };
      });

      metricsResult = {
        current: computeMetrics(rawAgg),
        timeline: filteredTimeline,
        sparklines: {
          mentions: filteredTimeline.map((t) => t.totalMentions),
          nss: filteredTimeline.map((t) => t.nss ?? 0),
        },
      };
    }

    // ─── COMPARE (previous period) ──────────────────────────────
    let previousMetrics = null;
    if (compare) {
      const prevEnd = new Date(start);
      const prevStart = new Date(start);
      prevStart.setDate(prevStart.getDate() - days);
      const prevStartStr = prevStart.toISOString().split('T')[0];
      const prevEndStr = prevEnd.toISOString().split('T')[0];

      const prevSnapshots = await db
        .select()
        .from(dailyMetricSnapshots)
        .where(
          and(
            gte(dailyMetricSnapshots.date, prevStartStr),
            lte(dailyMetricSnapshots.date, prevEndStr),
            eq(dailyMetricSnapshots.agencyId, agencyId),
          ),
        )
        .orderBy(desc(dailyMetricSnapshots.date));

      if (prevSnapshots.length > 0) {
        const prev = prevSnapshots[0];
        previousMetrics = {
          nss: prev.nss,
          brandHealthIndex: prev.brandHealthIndex,
          reputationMomentum: prev.reputationMomentum,
          engagementRate: prev.engagementRate,
          amplificationRate: prev.amplificationRate,
          engagementVelocity: prev.engagementVelocity,
          crisisRiskScore: prev.crisisRiskScore,
          volumeAnomalyZscore: prev.volumeAnomalyZscore,
          totalMentions: prevSnapshots.reduce((s, r) => s + r.totalMentions, 0),
          positiveCount: prevSnapshots.reduce((s, r) => s + r.positiveCount, 0),
          neutralCount: prevSnapshots.reduce((s, r) => s + r.neutralCount, 0),
          negativeCount: prevSnapshots.reduce((s, r) => s + r.negativeCount, 0),
          totalReach: prevSnapshots.reduce((s, r) => s + r.totalReach, 0),
          nss7d: prev.nss7d,
          nss30d: prev.nss30d,
        };
      }
    }

    // ─── MENTIONS QUERIES (always filtered) ──────────────────────
    const mentionConditions = buildMentionFilters(searchParams, start, agencyId);

    const [sentimentData, topSources, recentMentions] = await Promise.all([
      // Sentiment breakdown
      db
        .select({ sentiment: mentions.nlpSentiment, count: count() })
        .from(mentions)
        .where(and(...mentionConditions))
        .groupBy(mentions.nlpSentiment),

      // Top sources
      db
        .select({ source: mentions.contentSourceName, count: count() })
        .from(mentions)
        .where(and(...mentionConditions))
        .groupBy(mentions.contentSourceName)
        .orderBy(sql`count(*) DESC`)
        .limit(6),

      // Recent mentions
      db
        .select({
          id: mentions.id,
          title: mentions.title,
          snippet: mentions.snippet,
          domain: mentions.domain,
          pageType: mentions.pageType,
          contentSourceName: mentions.contentSourceName,
          nlpSentiment: mentions.nlpSentiment,
          nlpPertinence: mentions.nlpPertinence,
          nlpEmotions: mentions.nlpEmotions,
          nlpSummary: mentions.nlpSummary,
          engagementScore: mentions.engagementScore,
          likes: mentions.likes,
          comments: mentions.comments,
          shares: mentions.shares,
          reachEstimate: mentions.reachEstimate,
          publishedAt: mentions.publishedAt,
          url: mentions.url,
          author: mentions.author,
        })
        .from(mentions)
        .where(and(...mentionConditions))
        .orderBy(sql`${mentions.publishedAt} DESC`)
        .limit(5),
    ]);

    // ─── TOPIC TREEMAP ──────────────────────────────────────────
    const topicTreemap = await db
      .select({
        slug: topics.slug,
        name: topics.name,
        count: count(mentionTopics.mentionId),
        positiveCount: sql<number>`count(*) FILTER (WHERE ${mentions.nlpSentiment} = 'positivo')::int`,
        neutralCount: sql<number>`count(*) FILTER (WHERE ${mentions.nlpSentiment} = 'neutral')::int`,
        negativeCount: sql<number>`count(*) FILTER (WHERE ${mentions.nlpSentiment} = 'negativo')::int`,
      })
      .from(topics)
      .innerJoin(mentionTopics, eq(mentionTopics.topicId, topics.id))
      .innerJoin(mentions, eq(mentions.id, mentionTopics.mentionId))
      .where(and(gte(mentions.publishedAt, start), eq(mentions.agencyId, agencyId)))
      .groupBy(topics.slug, topics.name)
      .orderBy(sql`count(${mentionTopics.mentionId}) DESC`);

    const topicsData = topicTreemap.map((t) => {
      const total = Number(t.count) || 1;
      const positivePct = Math.round((Number(t.positiveCount) / total) * 100);
      const neutralPct = Math.round((Number(t.neutralCount) / total) * 100);
      const negativePct = Math.round((Number(t.negativeCount) / total) * 100);
      let dominantSentiment: 'positivo' | 'negativo' | 'neutral' | 'mixed' = 'mixed';
      if (positivePct > 60) dominantSentiment = 'positivo';
      else if (negativePct > 60) dominantSentiment = 'negativo';
      else if (neutralPct > 60) dominantSentiment = 'neutral';

      return {
        slug: t.slug,
        name: t.name,
        count: Number(t.count),
        positivePct,
        neutralPct,
        negativePct,
        dominantSentiment,
      };
    });

    // ─── FILTER OPTIONS (for dropdowns) ─────────────────────────
    const [sourceOptions, topicOptions, municipalityOptions] = await Promise.all([
      db
        .select({ source: mentions.contentSourceName })
        .from(mentions)
        .where(eq(mentions.agencyId, agencyId))
        .groupBy(mentions.contentSourceName)
        .orderBy(mentions.contentSourceName),

      db
        .select({ slug: topics.slug, name: topics.name })
        .from(topics)
        .where(eq(topics.agencyId, agencyId))
        .orderBy(topics.name),

      db
        .select({
          slug: municipalities.slug,
          name: municipalities.name,
          region: municipalities.region,
        })
        .from(municipalities)
        .orderBy(municipalities.region, municipalities.name),
    ]);

    // Group municipalities by region
    const municipalitiesByRegion: Record<string, { slug: string; name: string }[]> = {};
    for (const m of municipalityOptions) {
      const region = m.region ?? 'Otro';
      if (!municipalitiesByRegion[region]) municipalitiesByRegion[region] = [];
      municipalitiesByRegion[region].push({ slug: m.slug, name: m.name });
    }

    const sentimentColors: Record<string, string> = {
      positivo: '#52C47A',
      neutral: '#CBD5E1',
      negativo: '#E86452',
    };

    return NextResponse.json(
      {
        metrics: {
          current: metricsResult.current,
          previous: previousMetrics,
          timeline: metricsResult.timeline,
          sparklines: metricsResult.sparklines,
        },
        topics: topicsData,
        sentimentBreakdown: sentimentData.map((s) => ({
          name: s.sentiment ?? 'neutral',
          value: Number(s.count),
          color: sentimentColors[s.sentiment ?? 'neutral'] ?? '#CBD5E1',
        })),
        topSources: topSources.map((s) => ({
          source: s.source ?? 'Desconocido',
          count: Number(s.count),
        })),
        recentMentions: recentMentions.map((m) => ({
          ...m,
          publishedAt: m.publishedAt.toISOString(),
        })),
        filterOptions: {
          sources: sourceOptions.map((s) => s.source).filter(Boolean) as string[],
          topics: topicOptions,
          municipalitiesByRegion,
        },
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      },
    );
  } catch (err) {
    console.error('Dashboard API error:', err);
    return NextResponse.json({ error: 'Error fetching dashboard data' }, { status: 500 });
  }
}
