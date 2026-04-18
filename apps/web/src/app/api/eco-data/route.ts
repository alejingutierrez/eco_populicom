import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import {
  mentions,
  agencies,
  topics,
  subtopics,
  municipalities,
  mentionTopics,
  mentionMunicipalities,
  dailyMetricSnapshots,
  alertRules,
} from '@eco/database';
import { sql, eq, and, gte, desc, count } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { log } from '@/lib/log';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const PERIOD_DAYS: Record<string, number> = {
  '1D': 1, '5D': 5, '1M': 30, '2M': 60, '3M': 90, '6M': 180, '1A': 365, 'Max': 730,
  '24h': 1, '7d': 7, '30d': 30, '90d': 90,
};

type TimelineRow = {
  date: string;
  fullDate: string;
  nss: number;
  brandHealthIndex: number;
  totalMentions: number;
  crisisRiskScore: number;
  engagementRate: number;
  positivo: number;
  neutral: number;
  negativo: number;
};

const TZ = 'America/Puerto_Rico';

function esShortDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-PR', { month: 'short', day: 'numeric', timeZone: TZ });
  } catch {
    return iso;
  }
}

/** ISO YYYY-MM-DD in the Puerto Rico calendar (not UTC). */
function astDateKey(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function pillFromSentiment(s: string | null): 'positivo' | 'neutral' | 'negativo' {
  if (s === 'positivo' || s === 'positive') return 'positivo';
  if (s === 'negativo' || s === 'negative') return 'negativo';
  return 'neutral';
}

function sourceKey(pageType: string | null): string {
  const t = (pageType ?? '').toLowerCase();
  if (t.includes('facebook')) return 'facebook';
  if (t.includes('twitter') || t === 'x' || t.includes('xcom')) return 'twitter';
  if (t.includes('instagram')) return 'instagram';
  if (t.includes('youtube')) return 'youtube';
  if (t.includes('blog')) return 'blog';
  if (t.includes('news') || t.includes('forum')) return 'news';
  return t || 'otros';
}

function sourceLabel(key: string): string {
  const map: Record<string, string> = {
    facebook: 'Facebook',
    twitter: 'X / Twitter',
    instagram: 'Instagram',
    youtube: 'YouTube',
    blog: 'Blogs',
    news: 'Noticias',
    otros: 'Otros',
  };
  return map[key] ?? key;
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const day = Math.round(h / 24);
  return `hace ${day} d`;
}

export async function GET(request: NextRequest) {
  const rl = consume('eco-data:' + clientKey(request), { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } });
  }
  const start = Date.now();
  const { searchParams } = new URL(request.url);
  const periodKey = searchParams.get('period') ?? '1M';
  const days = PERIOD_DAYS[periodKey] ?? 30;

  const db = getDb();

  // Resolve agency — fall back to the first active agency if the requested
  // one doesn't exist (so a stale localStorage slug from testing doesn't 404).
  let agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    const [first] = await db
      .select({ id: agencies.id })
      .from(agencies)
      .where(eq(agencies.isActive, true))
      .limit(1);
    agencyId = first?.id ?? null;
  }
  if (!agencyId) {
    return NextResponse.json({ error: 'No active agencies configured' }, { status: 404 });
  }

  const since = new Date();
  since.setDate(since.getDate() - days);

  const baseWhere = and(eq(mentions.agencyId, agencyId), gte(mentions.publishedAt, since));

  try {
    // ---- AGENCIES (all) ----
    const agencyRows = await db
      .select({ id: agencies.id, name: agencies.name, slug: agencies.slug })
      .from(agencies)
      .where(eq(agencies.isActive, true));

    const AGENCIES_FULL = agencyRows.map((a) => ({
      key: a.slug,
      name: (a.slug || '').toUpperCase().slice(0, 6),
      long: a.name,
    }));

    // ---- TIMELINE + CURRENT_METRICS from snapshots ----
    const snapshots = await db
      .select()
      .from(dailyMetricSnapshots)
      .where(and(
        gte(dailyMetricSnapshots.date, since.toISOString().split('T')[0]),
        eq(dailyMetricSnapshots.agencyId, agencyId),
      ))
      .orderBy(dailyMetricSnapshots.date);

    const TIMELINE: TimelineRow[] = snapshots.map((s) => {
      const iso = new Date(s.date).toISOString();
      return {
        date: esShortDate(iso),
        fullDate: iso,
        nss: Number(s.nss ?? 0),
        brandHealthIndex: Number(s.brandHealthIndex ?? 0),
        totalMentions: Number(s.totalMentions ?? 0),
        crisisRiskScore: Number(s.crisisRiskScore ?? 0),
        engagementRate: Number(s.engagementRate ?? 0),
        positivo: Number(s.positiveCount ?? 0),
        neutral: Number(s.neutralCount ?? 0),
        negativo: Number(s.negativeCount ?? 0),
      };
    });

    const last = snapshots[snapshots.length - 1];
    const prev = snapshots[snapshots.length - 2];

    // Snapshot-based metrics (may be zero/null if the metrics-calculator
    // Lambda hasn't run yet). We keep the numbers and fall back to live
    // aggregates below when they come back empty.
    const snapMetrics = last ? {
      nss: Number(last.nss ?? 0),
      nss7d: Number(last.nss7d ?? 0),
      nss30d: Number(last.nss30d ?? 0),
      brandHealthIndex: Number(last.brandHealthIndex ?? 0),
      crisisRiskScore: Number(last.crisisRiskScore ?? 0),
      engagementRate: Number(last.engagementRate ?? 0),
      amplificationRate: Number(last.amplificationRate ?? 0),
      reputationMomentum: Number(last.reputationMomentum ?? 0),
      engagementVelocity: Number(last.engagementVelocity ?? 0),
      volumeAnomalyZscore: Number(last.volumeAnomalyZscore ?? 0),
      totalMentions: Number(last.totalMentions ?? 0),
      positiveCount: Number(last.positiveCount ?? 0),
      neutralCount: Number(last.neutralCount ?? 0),
      negativeCount: Number(last.negativeCount ?? 0),
    } : null;

    const snapDeltas = last && prev ? {
      nssDelta: Number((Number(last.nss ?? 0) - Number(prev.nss ?? 0)).toFixed(1)),
      brandHealthDelta: Number((Number(last.brandHealthIndex ?? 0) - Number(prev.brandHealthIndex ?? 0)).toFixed(2)),
      crisisDelta: Number((Number(last.crisisRiskScore ?? 0) - Number(prev.crisisRiskScore ?? 0)).toFixed(1)),
      totalMentionsDelta: Number(prev.totalMentions) > 0
        ? Number((((Number(last.totalMentions) - Number(prev.totalMentions)) / Number(prev.totalMentions)) * 100).toFixed(1))
        : 0,
      engagementDelta: Number((Number(last.engagementRate ?? 0) - Number(prev.engagementRate ?? 0)).toFixed(2)),
    } : { nssDelta: 0, brandHealthDelta: 0, crisisDelta: 0, totalMentionsDelta: 0, engagementDelta: 0 };

    // ---- SENTIMENT_BREAKDOWN ----
    const sentimentAgg = await db
      .select({ s: mentions.nlpSentiment, c: count() })
      .from(mentions)
      .where(baseWhere)
      .groupBy(mentions.nlpSentiment);

    const sentCounts = { positivo: 0, neutral: 0, negativo: 0 };
    for (const r of sentimentAgg) {
      const k = pillFromSentiment(r.s);
      sentCounts[k] += Number(r.c);
    }
    const SENTIMENT_BREAKDOWN = [
      { name: 'positivo', value: sentCounts.positivo, label: 'Positivo' },
      { name: 'neutral', value: sentCounts.neutral, label: 'Neutral' },
      { name: 'negativo', value: sentCounts.negativo, label: 'Negativo' },
    ];

    // Live-aggregate metrics from mentions — used when daily snapshots are
    // missing or zero. Also drive the hero KPIs until the metrics-calculator
    // Lambda catches up.
    const liveTotal = sentCounts.positivo + sentCounts.neutral + sentCounts.negativo;
    const liveNss = liveTotal > 0
      ? Number((((sentCounts.positivo - sentCounts.negativo) / liveTotal) * 100).toFixed(1))
      : 0;
    // Brand Health Index: 0.5 neutral baseline, shifts with positivity
    const liveBhi = liveTotal > 0
      ? Number((0.5 + ((sentCounts.positivo - sentCounts.negativo) / liveTotal) * 0.5).toFixed(2))
      : 0;
    // Crisis risk: scale by fraction of negative mentions (0..3)
    const liveCrisis = liveTotal > 0
      ? Number(((sentCounts.negativo / liveTotal) * 3).toFixed(1))
      : 0;

    const [engAgg] = await db
      .select({
        reach: sql<number>`COALESCE(SUM(${mentions.reachEstimate}), 0)`.mapWith(Number),
        eng: sql<number>`COALESCE(SUM(${mentions.likes} + ${mentions.comments} + ${mentions.shares}), 0)`.mapWith(Number),
        hiPert: sql<number>`COUNT(*) FILTER (WHERE ${mentions.nlpPertinence} = 'alta')`.mapWith(Number),
      })
      .from(mentions)
      .where(baseWhere);

    const liveReach = Number(engAgg?.reach ?? 0);
    const liveEngSum = Number(engAgg?.eng ?? 0);
    const liveEngRate = liveReach > 0
      ? Number(((liveEngSum / liveReach) * 100).toFixed(2))
      : 0;

    // Prefer snapshot values when non-zero; fall back to live aggregates.
    const pick = (snap: number, live: number) => (snap && snap !== 0 ? snap : live);
    const CURRENT_METRICS = {
      nss: pick(snapMetrics?.nss ?? 0, liveNss),
      nss7d: pick(snapMetrics?.nss7d ?? 0, liveNss),
      nss30d: pick(snapMetrics?.nss30d ?? 0, liveNss),
      nssDelta: snapDeltas.nssDelta,
      brandHealthIndex: pick(snapMetrics?.brandHealthIndex ?? 0, liveBhi),
      brandHealthDelta: snapDeltas.brandHealthDelta,
      crisisRiskScore: pick(snapMetrics?.crisisRiskScore ?? 0, liveCrisis),
      crisisDelta: snapDeltas.crisisDelta,
      totalMentions: pick(snapMetrics?.totalMentions ?? 0, liveTotal),
      totalMentionsDelta: snapDeltas.totalMentionsDelta,
      totalReach: pick(0, liveReach || liveTotal * 180),
      engagementRate: pick(snapMetrics?.engagementRate ?? 0, liveEngRate),
      engagementDelta: snapDeltas.engagementDelta,
      amplificationRate: Number(snapMetrics?.amplificationRate ?? 0),
      amplificationDelta: 0,
      reputationMomentum: Number(snapMetrics?.reputationMomentum ?? 0),
      engagementVelocity: Number(snapMetrics?.engagementVelocity ?? 0),
      volumeAnomalyZscore: Number(snapMetrics?.volumeAnomalyZscore ?? 0),
      positiveCount: pick(snapMetrics?.positiveCount ?? 0, sentCounts.positivo),
      neutralCount: pick(snapMetrics?.neutralCount ?? 0, sentCounts.neutral),
      negativeCount: pick(snapMetrics?.negativeCount ?? 0, sentCounts.negativo),
      highPertinenceCount: Number(engAgg?.hiPert ?? 0),
    };

    // ---- TOP_SOURCES ----
    const srcAgg = await db
      .select({ pageType: mentions.pageType, c: count() })
      .from(mentions)
      .where(baseWhere)
      .groupBy(mentions.pageType);

    const srcMap = new Map<string, number>();
    for (const r of srcAgg) {
      const k = sourceKey(r.pageType);
      srcMap.set(k, (srcMap.get(k) ?? 0) + Number(r.c));
    }
    const TOP_SOURCES = Array.from(srcMap.entries())
      .map(([key, c]) => ({ source: sourceLabel(key), key, count: c }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // ---- SENTIMENT_BY_SOURCE ----
    const sBySrcAgg = await db
      .select({ pageType: mentions.pageType, s: mentions.nlpSentiment, c: count() })
      .from(mentions)
      .where(baseWhere)
      .groupBy(mentions.pageType, mentions.nlpSentiment);

    const bySrc = new Map<string, { source: string; positivo: number; neutral: number; negativo: number }>();
    for (const r of sBySrcAgg) {
      const k = sourceKey(r.pageType);
      const label = sourceLabel(k);
      if (!bySrc.has(k)) bySrc.set(k, { source: label, positivo: 0, neutral: 0, negativo: 0 });
      const entry = bySrc.get(k)!;
      entry[pillFromSentiment(r.s)] += Number(r.c);
    }
    const SENTIMENT_BY_SOURCE = Array.from(bySrc.values())
      .sort((a, b) => (b.positivo + b.neutral + b.negativo) - (a.positivo + a.neutral + a.negativo))
      .slice(0, 8);

    // ---- TOPICS ----
    const topicRows = await db
      .select({
        slug: topics.slug,
        name: topics.name,
        s: mentions.nlpSentiment,
        c: count(),
      })
      .from(mentionTopics)
      .innerJoin(topics, eq(topics.id, mentionTopics.topicId))
      .innerJoin(mentions, eq(mentions.id, mentionTopics.mentionId))
      .where(baseWhere)
      .groupBy(topics.slug, topics.name, mentions.nlpSentiment);

    const tMap = new Map<string, { slug: string; name: string; total: number; positivo: number; neutral: number; negativo: number }>();
    for (const r of topicRows) {
      if (!tMap.has(r.slug)) tMap.set(r.slug, { slug: r.slug, name: r.name, total: 0, positivo: 0, neutral: 0, negativo: 0 });
      const e = tMap.get(r.slug)!;
      const k = pillFromSentiment(r.s);
      const c = Number(r.c);
      e[k] += c;
      e.total += c;
    }
    const TOPICS = Array.from(tMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 12)
      .map((t) => {
        const total = t.total || 1;
        const positivePct = Math.round((t.positivo / total) * 100);
        const negativePct = Math.round((t.negativo / total) * 100);
        const neutralPct = Math.max(0, 100 - positivePct - negativePct);
        let dominant: 'positivo' | 'negativo' | 'mixed' = 'mixed';
        if (positivePct > negativePct + 8) dominant = 'positivo';
        else if (negativePct > positivePct + 8) dominant = 'negativo';
        return {
          slug: t.slug,
          name: t.name,
          count: t.total,
          positivePct, negativePct, neutralPct,
          dominantSentiment: dominant,
          delta: 0,
        };
      });

    // ---- SUBTOPICS ----
    const subtopicRows = await db
      .select({
        topicSlug: topics.slug,
        subName: subtopics.name,
        c: count(),
      })
      .from(mentionTopics)
      .innerJoin(subtopics, eq(subtopics.id, mentionTopics.subtopicId))
      .innerJoin(topics, eq(topics.id, mentionTopics.topicId))
      .innerJoin(mentions, eq(mentions.id, mentionTopics.mentionId))
      .where(baseWhere)
      .groupBy(topics.slug, subtopics.name);

    const SUBTOPICS: Record<string, Array<{ name: string; count: number }>> = {};
    for (const r of subtopicRows) {
      if (!SUBTOPICS[r.topicSlug]) SUBTOPICS[r.topicSlug] = [];
      SUBTOPICS[r.topicSlug].push({ name: r.subName, count: Number(r.c) });
    }
    for (const k of Object.keys(SUBTOPICS)) {
      SUBTOPICS[k].sort((a, b) => b.count - a.count);
    }

    // ---- MUNICIPALITIES ----
    const muniRows = await db
      .select({
        slug: municipalities.slug,
        name: municipalities.name,
        region: municipalities.region,
        lat: municipalities.latitude,
        lon: municipalities.longitude,
        s: mentions.nlpSentiment,
        c: count(),
      })
      .from(mentionMunicipalities)
      .innerJoin(municipalities, eq(municipalities.id, mentionMunicipalities.municipalityId))
      .innerJoin(mentions, eq(mentions.id, mentionMunicipalities.mentionId))
      .where(baseWhere)
      .groupBy(municipalities.slug, municipalities.name, municipalities.region, municipalities.latitude, municipalities.longitude, mentions.nlpSentiment);

    const mMap = new Map<string, {
      slug: string; name: string; region: string;
      lat: number; lon: number;
      positivo: number; neutral: number; negativo: number; total: number;
    }>();
    for (const r of muniRows) {
      if (!mMap.has(r.slug)) mMap.set(r.slug, {
        slug: r.slug, name: r.name, region: r.region,
        lat: Number(r.lat), lon: Number(r.lon),
        positivo: 0, neutral: 0, negativo: 0, total: 0,
      });
      const e = mMap.get(r.slug)!;
      const k = pillFromSentiment(r.s);
      const c = Number(r.c);
      e[k] += c;
      e.total += c;
    }
    // All municipalities with mentions in the period (PR has 78, we return all
    // that appear). Callers can rely on complete data; no silent drop.
    const MUNICIPALITIES = Array.from(mMap.values())
      .sort((a, b) => b.total - a.total)
      .map((m) => {
        const t = m.total || 1;
        const nss = Math.round(((m.positivo - m.negativo) / t) * 100) / 10;
        return {
          slug: m.slug,
          name: m.name,
          region: m.region,
          count: m.total,
          nss,
          lat: m.lat,
          lon: m.lon,
          positivo: m.positivo,
          neutral: m.neutral,
          negativo: m.negativo,
        };
      });

    // ---- EMOTIONS (aggregated in SQL, no memory-heavy rows in Node) ----
    const emotionAgg = await db.execute<{ emotion: string; c: number | string }>(sql`
      SELECT lower(trim(e.value::text, '"')) AS emotion, COUNT(*) AS c
      FROM mentions m, jsonb_array_elements(COALESCE(m.nlp_emotions, '[]'::jsonb)) AS e
      WHERE m.agency_id = ${agencyId}
        AND m.published_at >= ${since.toISOString()}
      GROUP BY emotion
      ORDER BY c DESC
      LIMIT 20
    `);
    // pg driver returns { rows, rowCount, ... }; Drizzle passes that through.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emotionRowsList: Array<{ emotion: string; c: number | string }> = Array.isArray(emotionAgg)
      ? (emotionAgg as unknown as Array<{ emotion: string; c: number | string }>)
      : (((emotionAgg as unknown as { rows?: Array<{ emotion: string; c: number | string }> }).rows) ?? []);
    const eCounts: Record<string, number> = {};
    for (const row of emotionRowsList) {
      if (row && row.emotion) eCounts[row.emotion] = Number(row.c);
    }
    const emotionColorMap: Record<string, string> = {
      enojo: 'neg', frustración: 'neg', preocupación: 'warn',
      aprobación: 'pos', esperanza: 'pos', alegría: 'pos', confusión: 'neu',
    };
    const EMOTIONS = Object.entries(eCounts)
      .map(([emotion, c]) => ({
        emotion: emotion.charAt(0).toUpperCase() + emotion.slice(1),
        count: c,
        color: emotionColorMap[emotion.toLowerCase()] ?? 'neu',
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // ---- MENTIONS (top 50 recent) ----
    const recentRows = await db
      .select({
        id: mentions.id,
        title: mentions.title,
        domain: mentions.domain,
        pageType: mentions.pageType,
        author: mentions.author,
        authorFullname: mentions.authorFullname,
        nlpSentiment: mentions.nlpSentiment,
        nlpPertinence: mentions.nlpPertinence,
        nlpEmotions: mentions.nlpEmotions,
        engagementScore: mentions.engagementScore,
        likes: mentions.likes,
        comments: mentions.comments,
        shares: mentions.shares,
        publishedAt: mentions.publishedAt,
        url: mentions.url,
      })
      .from(mentions)
      .where(baseWhere)
      .orderBy(desc(mentions.publishedAt))
      .limit(50);

    // Resolve topics & municipalities for those mentions (batched)
    const mentionIds = recentRows.map((m) => m.id);
    const mtRows = mentionIds.length > 0 ? await db
      .select({
        mentionId: mentionTopics.mentionId,
        topicSlug: topics.slug,
        topicName: topics.name,
        subName: subtopics.name,
      })
      .from(mentionTopics)
      .leftJoin(topics, eq(topics.id, mentionTopics.topicId))
      .leftJoin(subtopics, eq(subtopics.id, mentionTopics.subtopicId))
      .where(sql`${mentionTopics.mentionId} IN (${sql.join(mentionIds.map((id) => sql`${id}`), sql`, `)})`) : [];

    const mmRows = mentionIds.length > 0 ? await db
      .select({
        mentionId: mentionMunicipalities.mentionId,
        muniName: municipalities.name,
        region: municipalities.region,
        lat: municipalities.latitude,
        lon: municipalities.longitude,
      })
      .from(mentionMunicipalities)
      .innerJoin(municipalities, eq(municipalities.id, mentionMunicipalities.municipalityId))
      .where(sql`${mentionMunicipalities.mentionId} IN (${sql.join(mentionIds.map((id) => sql`${id}`), sql`, `)})`) : [];

    const topicByMention = new Map<string, { topic: string; topicName: string; subtopics: string[] }>();
    for (const r of mtRows) {
      if (!r.topicSlug) continue;
      if (!topicByMention.has(r.mentionId)) {
        topicByMention.set(r.mentionId, { topic: r.topicSlug, topicName: r.topicName ?? r.topicSlug, subtopics: [] });
      }
      if (r.subName) topicByMention.get(r.mentionId)!.subtopics.push(r.subName);
    }
    const muniByMention = new Map<string, { name: string; region: string; coords: [number, number] }>();
    for (const r of mmRows) {
      if (!muniByMention.has(r.mentionId)) {
        muniByMention.set(r.mentionId, {
          name: r.muniName, region: r.region,
          coords: [Number(r.lat), Number(r.lon)],
        });
      }
    }

    const MENTIONS = recentRows.map((m) => {
      const tp = topicByMention.get(m.id);
      const mu = muniByMention.get(m.id);
      return {
        id: m.id,
        title: m.title ?? '',
        domain: m.domain ?? '',
        source: sourceKey(m.pageType),
        author: m.authorFullname ?? m.author ?? '',
        sentiment: pillFromSentiment(m.nlpSentiment),
        pertinence: m.nlpPertinence ?? 'media',
        engagement: Number(m.engagementScore ?? 0),
        likes: Number(m.likes ?? 0),
        comments: Number(m.comments ?? 0),
        shares: Number(m.shares ?? 0),
        publishedAt: relativeTime(new Date(m.publishedAt)),
        emotions: (m.nlpEmotions ?? []).map((e) => e.toLowerCase()),
        topic: tp?.topic ?? '',
        topicName: tp?.topicName ?? '',
        subtopics: tp?.subtopics ?? [],
        municipality: mu?.name ?? '',
        region: mu?.region ?? '',
        coords: mu?.coords,
        url: m.url,
      };
    });

    // ---- INGESTION_STATUS (most recent mention timestamp for "live" badge) ----
    const [latestIngest] = await db
      .select({ ts: sql<Date>`MAX(${mentions.ingestedAt})`.mapWith((v) => v as Date) })
      .from(mentions)
      .where(eq(mentions.agencyId, agencyId));

    const lastIngest = latestIngest?.ts ? new Date(latestIngest.ts) : null;
    const INGESTION_STATUS = lastIngest ? {
      lastIngestAt: lastIngest.toISOString(),
      lastIngestLabel: relativeTime(lastIngest),
    } : null;

    // ---- ALERTS ----
    const alertRows = await db
      .select()
      .from(alertRules)
      .where(eq(alertRules.agencyId, agencyId))
      .orderBy(desc(alertRules.createdAt))
      .limit(20);

    const ALERTS = alertRows.map((a) => ({
      id: a.id,
      name: a.name,
      active: a.isActive,
      priority: 'media',
      triggered: 0,
      lastFired: '—',
      channels: a.notifyEmails && a.notifyEmails.length > 0 ? ['email'] : [],
    }));

    // ---- HOUR_HEATMAP (7 days × 24 hours, Mon=0..Sun=6) ----
    // Convert the UTC-stored `published_at` into Puerto Rico local time
    // (America/Puerto_Rico is AST year-round, UTC-4) before extracting the
    // day-of-week and hour — otherwise a mention posted at 02:00 AST shows up
    // in the 06:00 UTC bucket on the wrong weekday.
    // Postgres DOW returns Sun=0..Sat=6; we remap to Mon=0..Sun=6 in JS.
    const localTs = sql`(${mentions.publishedAt} AT TIME ZONE 'America/Puerto_Rico')`;
    const heatRows = await db
      .select({
        dow: sql<number>`EXTRACT(DOW FROM ${localTs})`.mapWith(Number),
        hour: sql<number>`EXTRACT(HOUR FROM ${localTs})`.mapWith(Number),
        c: count(),
      })
      .from(mentions)
      .where(baseWhere)
      .groupBy(sql`EXTRACT(DOW FROM ${localTs})`, sql`EXTRACT(HOUR FROM ${localTs})`);

    const HOUR_HEATMAP = Array(7 * 24).fill(0);
    for (const r of heatRows) {
      const pgDow = Number(r.dow);
      const hour = Number(r.hour);
      // Postgres Sun=0..Sat=6 → Mon=0..Sun=6
      const day = (pgDow + 6) % 7;
      if (day >= 0 && day < 7 && hour >= 0 && hour < 24) {
        HOUR_HEATMAP[day * 24 + hour] += Number(r.c);
      }
    }

    // ---- PULSE (live feed for the hero right-rail) ----
    // Take the 6 most recent mentions and surface them as short ticker events.
    const PULSE = MENTIONS.slice(0, 6).map((m) => ({
      time: m.publishedAt,
      dot: m.sentiment === 'positivo' ? 'pos' : m.sentiment === 'negativo' ? 'neg' : 'warn',
      text: m.title.length > 78 ? m.title.slice(0, 78) + '…' : m.title,
      eng: m.engagement > 999 ? (m.engagement / 1000).toFixed(1) + 'K' : String(m.engagement || '—'),
      mention: m,
    }));

    // ---- BRIEFING (data-driven executive summary) ----
    const dominantTopic = TOPICS[0];
    const sentTrend = liveNss;
    const briefingTone = sentTrend > 5 ? 'pos' : sentTrend < -5 ? 'neg' : 'neu';
    const briefingVerb = briefingTone === 'pos' ? 'mejora' : briefingTone === 'neg' ? 'deteriora' : 'se mantiene estable';
    const BRIEFING = dominantTopic ? {
      eyebrow: new Date().toLocaleDateString('es-PR', { day: 'numeric', month: 'short', year: 'numeric' }),
      narrative: {
        pre: 'La percepción pública se',
        verb: briefingVerb,
        verbTone: briefingTone,
        linkPre: ' por la conversación sobre ',
        emphasis: dominantTopic.name,
        linkPost: ` (${dominantTopic.count.toLocaleString('es-PR')} menciones, ${dominantTopic.negativePct}% negativo).`,
      },
      dominantSignal: `${dominantTopic.name} · ${dominantTopic.dominantSentiment === 'positivo' ? 'Positiva' : dominantTopic.dominantSentiment === 'negativo' ? 'Negativa' : 'Mixta'}`,
      reachLabel: liveReach >= 1_000_000
        ? (liveReach / 1_000_000).toFixed(2) + 'M impresiones'
        : liveReach >= 1000
        ? Math.round(liveReach / 1000) + 'K impresiones'
        : String(liveReach) + ' impresiones',
      action: dominantTopic.negativePct > 50
        ? `Comunicado oficial ${dominantTopic.name} →`
        : `Monitorear ${dominantTopic.name} →`,
    } : null;

    return NextResponse.json({
      AGENCIES_FULL,
      TIMELINE: TIMELINE.length > 0 ? TIMELINE : null,
      CURRENT_METRICS,
      SENTIMENT_BREAKDOWN: SENTIMENT_BREAKDOWN.some((x) => x.value > 0) ? SENTIMENT_BREAKDOWN : null,
      TOP_SOURCES: TOP_SOURCES.length > 0 ? TOP_SOURCES : null,
      SENTIMENT_BY_SOURCE: SENTIMENT_BY_SOURCE.length > 0 ? SENTIMENT_BY_SOURCE : null,
      TOPICS: TOPICS.length > 0 ? TOPICS : null,
      SUBTOPICS: Object.keys(SUBTOPICS).length > 0 ? SUBTOPICS : null,
      MUNICIPALITIES: MUNICIPALITIES.length > 0 ? MUNICIPALITIES : null,
      EMOTIONS: EMOTIONS.length > 0 ? EMOTIONS : null,
      MENTIONS: MENTIONS.length > 0 ? MENTIONS : null,
      ALERTS: ALERTS.length > 0 ? ALERTS : null,
      HOUR_HEATMAP: HOUR_HEATMAP.some((v) => v > 0) ? HOUR_HEATMAP : null,
      PULSE: PULSE.length > 0 ? PULSE : null,
      BRIEFING,
      INGESTION_STATUS,
    });
  } catch (err) {
    log.error('eco-data', 'handler failed', { msg: (err as Error).message });
    return NextResponse.json({ error: 'eco-data error', message: (err as Error).message }, { status: 500 });
  } finally {
    log.info('eco-data', 'request complete', { latencyMs: Date.now() - start, period: periodKey });
  }
}
