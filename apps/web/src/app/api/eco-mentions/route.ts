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
} from '@eco/database';
import { sql, eq, and, gte, lte, desc, inArray } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { consume, clientKey } from '@/lib/rate-limit';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

const PERIOD_DAYS: Record<string, number> = {
  '1D': 1, '5D': 5, '1M': 30, '2M': 60, '3M': 90, '6M': 180, '1A': 365, 'Max': 730,
};

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

/**
 * GET /api/eco-mentions
 * Query params (all optional):
 *   agency — slug (default resolves via resolveAgencyId)
 *   period — 1D/5D/1M/3M/6M/1A/Max (default 1M)
 *   sentiment — positivo | neutral | negativo
 *   source — facebook | twitter | news | instagram | youtube | blog
 *   pageType — exact page_type (override source mapping)
 *   topic — topic slug
 *   subtopic — subtopic name (exact)
 *   municipality — municipality slug
 *   region — region name
 *   emotion — emotion name (lowercase; matches any element of nlp_emotions array)
 *   dow — day-of-week 0..6 (Mon=0)
 *   hour — hour 0..23
 *   day — YYYY-MM-DD (filter to that calendar day in UTC)
 *   pertinence — alta | media | baja
 *   q — full-text search in title/snippet
 *   limit — default 20, max 100
 *   offset — default 0
 */
export async function GET(request: NextRequest) {
  const rl = consume('eco-mentions:' + clientKey(request), { limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } });
  }
  const start = Date.now();
  const { searchParams } = new URL(request.url);

  const periodKey = searchParams.get('period') ?? '1M';
  const days = PERIOD_DAYS[periodKey] ?? 30;
  const limit = Math.min(100, Number(searchParams.get('limit') ?? '20'));
  const offset = Math.max(0, Number(searchParams.get('offset') ?? '0'));

  const db = getDb();

  let agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    const [first] = await db.select({ id: agencies.id }).from(agencies).where(eq(agencies.isActive, true)).limit(1);
    agencyId = first?.id ?? null;
  }
  if (!agencyId) {
    return NextResponse.json({ mentions: [], total: 0 });
  }

  const since = new Date();
  since.setDate(since.getDate() - days);

  const conditions: ReturnType<typeof eq>[] = [
    eq(mentions.agencyId, agencyId),
    gte(mentions.publishedAt, since),
  ];

  const sentiment = searchParams.get('sentiment');
  if (sentiment) conditions.push(eq(mentions.nlpSentiment, sentiment));

  const pertinence = searchParams.get('pertinence');
  if (pertinence) conditions.push(eq(mentions.nlpPertinence, pertinence));

  const pageTypeParam = searchParams.get('pageType');
  if (pageTypeParam) {
    conditions.push(eq(mentions.pageType, pageTypeParam));
  } else {
    const source = searchParams.get('source');
    if (source) {
      // Match all page_type values that map to this canonical source.
      const srcMap: Record<string, string[]> = {
        facebook: ['facebook'],
        twitter: ['twitter', 'x', 'xcom'],
        instagram: ['instagram'],
        youtube: ['youtube'],
        blog: ['blog'],
        news: ['news', 'forum'],
      };
      const list = srcMap[source];
      if (list && list.length > 0) {
        conditions.push(inArray(mentions.pageType, list));
      }
    }
  }

  const q = searchParams.get('q');
  if (q) {
    conditions.push(sql`(${mentions.title} ILIKE ${'%' + q + '%'} OR ${mentions.snippet} ILIKE ${'%' + q + '%'})` as any);
  }

  const emotion = searchParams.get('emotion');
  if (emotion) {
    // nlpEmotions is jsonb array; use @> with a JSON array containing lowercase emotion
    conditions.push(sql`${mentions.nlpEmotions} @> ${JSON.stringify([emotion.toLowerCase()])}::jsonb` as any);
  }

  // The `published_at` column is stored in UTC, but the dashboard thinks in
  // Puerto Rico local time (AST, UTC-4). Convert before extracting weekday /
  // hour, and treat day=YYYY-MM-DD as a local calendar day.
  const dow = searchParams.get('dow');
  if (dow !== null && dow !== '') {
    const uiDow = Number(dow); // Mon=0..Sun=6
    const pgDow = (uiDow + 1) % 7; // Postgres: Sun=0..Sat=6
    conditions.push(sql`EXTRACT(DOW FROM (${mentions.publishedAt} AT TIME ZONE 'America/Puerto_Rico')) = ${pgDow}` as any);
  }

  const hour = searchParams.get('hour');
  if (hour !== null && hour !== '') {
    conditions.push(sql`EXTRACT(HOUR FROM (${mentions.publishedAt} AT TIME ZONE 'America/Puerto_Rico')) = ${Number(hour)}` as any);
  }

  const day = searchParams.get('day');
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    // AST is UTC-4 year-round (no DST in PR), so start/end in AST maps to
    // explicit -04:00 offsets in UTC.
    const start = new Date(day + 'T00:00:00-04:00');
    const end = new Date(day + 'T23:59:59.999-04:00');
    conditions.push(gte(mentions.publishedAt, start));
    conditions.push(lte(mentions.publishedAt, end));
  }

  const region = searchParams.get('region');
  const municipalitySlug = searchParams.get('municipality');
  const topicSlug = searchParams.get('topic');
  const subtopicName = searchParams.get('subtopic');

  // If filtering by topic/subtopic/municipality/region, we need subqueries.
  let filteredMentionIds: string[] | null = null;

  async function intersect(ids: string[]) {
    if (filteredMentionIds === null) {
      filteredMentionIds = ids;
    } else {
      const set = new Set(ids);
      filteredMentionIds = filteredMentionIds.filter((x) => set.has(x));
    }
  }

  if (topicSlug) {
    const tRows = await db
      .select({ id: mentionTopics.mentionId })
      .from(mentionTopics)
      .innerJoin(topics, eq(topics.id, mentionTopics.topicId))
      .where(eq(topics.slug, topicSlug));
    await intersect(tRows.map((r) => r.id));
  }

  if (subtopicName) {
    const stRows = await db
      .select({ id: mentionTopics.mentionId })
      .from(mentionTopics)
      .innerJoin(subtopics, eq(subtopics.id, mentionTopics.subtopicId))
      .where(eq(subtopics.name, subtopicName));
    await intersect(stRows.map((r) => r.id));
  }

  if (municipalitySlug) {
    const mRows = await db
      .select({ id: mentionMunicipalities.mentionId })
      .from(mentionMunicipalities)
      .innerJoin(municipalities, eq(municipalities.id, mentionMunicipalities.municipalityId))
      .where(eq(municipalities.slug, municipalitySlug));
    await intersect(mRows.map((r) => r.id));
  } else if (region) {
    const mRows = await db
      .select({ id: mentionMunicipalities.mentionId })
      .from(mentionMunicipalities)
      .innerJoin(municipalities, eq(municipalities.id, mentionMunicipalities.municipalityId))
      .where(eq(municipalities.region, region));
    await intersect(mRows.map((r) => r.id));
  }

  if (filteredMentionIds !== null) {
    const ids = filteredMentionIds as string[];
    if (ids.length === 0) {
      return NextResponse.json({ mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 } });
    }
    conditions.push(inArray(mentions.id, ids));
  }

  const whereClause = and(...conditions);

  // Total count (for pagination + slice summary)
  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(mentions)
    .where(whereClause);

  // Sentiment breakdown for the slice
  const sentAgg = await db
    .select({ s: mentions.nlpSentiment, c: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(mentions)
    .where(whereClause)
    .groupBy(mentions.nlpSentiment);

  const sentCounts = { pos: 0, neu: 0, neg: 0 };
  for (const r of sentAgg) {
    const k = pillFromSentiment(r.s);
    const bucket = k === 'positivo' ? 'pos' : k === 'negativo' ? 'neg' : 'neu';
    sentCounts[bucket] += Number(r.c);
  }

  // Page of mentions
  const rows = await db
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
    .where(whereClause)
    .orderBy(desc(mentions.publishedAt))
    .limit(limit)
    .offset(offset);

  // Resolve topic + municipality per mention in a batch
  const ids = rows.map((r) => r.id);
  const tRows = ids.length > 0 ? await db
    .select({
      mentionId: mentionTopics.mentionId,
      topicSlug: topics.slug,
      topicName: topics.name,
      subName: subtopics.name,
    })
    .from(mentionTopics)
    .leftJoin(topics, eq(topics.id, mentionTopics.topicId))
    .leftJoin(subtopics, eq(subtopics.id, mentionTopics.subtopicId))
    .where(inArray(mentionTopics.mentionId, ids)) : [];

  const mRows = ids.length > 0 ? await db
    .select({
      mentionId: mentionMunicipalities.mentionId,
      muniName: municipalities.name,
      region: municipalities.region,
      lat: municipalities.latitude,
      lon: municipalities.longitude,
    })
    .from(mentionMunicipalities)
    .innerJoin(municipalities, eq(municipalities.id, mentionMunicipalities.municipalityId))
    .where(inArray(mentionMunicipalities.mentionId, ids)) : [];

  const topicByMention = new Map<string, { topic: string; topicName: string; subtopics: string[] }>();
  for (const r of tRows) {
    if (!r.topicSlug) continue;
    if (!topicByMention.has(r.mentionId)) {
      topicByMention.set(r.mentionId, { topic: r.topicSlug, topicName: r.topicName ?? r.topicSlug, subtopics: [] });
    }
    if (r.subName) topicByMention.get(r.mentionId)!.subtopics.push(r.subName);
  }
  const muniByMention = new Map<string, { name: string; region: string; coords: [number, number] }>();
  for (const r of mRows) {
    if (!muniByMention.has(r.mentionId)) {
      muniByMention.set(r.mentionId, {
        name: r.muniName,
        region: r.region,
        coords: [Number(r.lat), Number(r.lon)],
      });
    }
  }

  const out = rows.map((m) => {
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

  log.info('eco-mentions', 'request complete', { latencyMs: Date.now() - start, total: Number(total) });
  return NextResponse.json({
    mentions: out,
    total: Number(total),
    sentiment: sentCounts,
  });
}
