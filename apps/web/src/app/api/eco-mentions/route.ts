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
import { sql, eq, and, gte, lt, lte, desc, inArray } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { consume, clientKey } from '@/lib/rate-limit';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

const PERIOD_DAYS: Record<string, number> = {
  '1D': 1, '5D': 5, '7D': 7, '30D': 30, '90D': 90,
  '1M': 30, '2M': 60, '3M': 90, '6M': 180, '1A': 365, 'Max': 730,
};

/**
 * Espejo de parseCustomRange en /api/eco-data — interpreta from/to
 * (YYYY-MM-DD) como AST (UTC-4 sin DST) y devuelve cotas exactas en UTC.
 * Upper bound es exclusivo para alinearse con
 * `lt(mentions.publishedAt, untilExclusiveUtc)`.
 */
function parseCustomRange(
  fromParam: string | null,
  toParam: string | null,
): null | { from: string; to: string; sinceUtc: Date; untilExclusiveUtc: Date } {
  if (!fromParam || !toParam) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromParam) || !/^\d{4}-\d{2}-\d{2}$/.test(toParam)) return null;
  if (fromParam > toParam) return null;
  const sinceUtc = new Date(`${fromParam}T04:00:00.000Z`);
  const untilExclusiveUtc = new Date(`${toParam}T04:00:00.000Z`);
  untilExclusiveUtc.setUTCDate(untilExclusiveUtc.getUTCDate() + 1);
  if (Number.isNaN(sinceUtc.getTime()) || Number.isNaN(untilExclusiveUtc.getTime())) return null;
  return { from: fromParam, to: toParam, sinceUtc, untilExclusiveUtc };
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
 *   pertinence — alta | media | baja (explicit; bypasses default exclude-low)
 *   includeLow — '1'/'true' to keep baja pertinencia in results (default excludes)
 *   minEngagement — number; keeps mentions con engagement_score >= N (viral filter)
 *   q — full-text search in title/snippet (multi-token AND)
 *   sortBy — recent (default) | engagement | relevance (relevance solo aplica con q)
 *   similar_to — mention id; returns coseno-neighbors (excluye filtros de contenido)
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
  const customRange = parseCustomRange(searchParams.get('from'), searchParams.get('to'));
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

  const since = customRange ? customRange.sinceUtc : (() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  })();

  // similar_to: rama dedicada — devuelve coseno-vecinos de la mención fuente
  // dentro de la misma agencia, ignorando filtros de contenido. Si la mención
  // fuente no tiene embedding (aún por backfill), fallback a la lógica
  // existente filtrando por mismo topic.
  const similarTo = searchParams.get('similar_to');
  if (similarTo && /^[0-9a-f-]{36}$/i.test(similarTo)) {
    return await handleSimilarTo(similarTo, agencyId, limit);
  }

  const conditions: ReturnType<typeof eq>[] = [
    eq(mentions.agencyId, agencyId),
    eq(mentions.isDuplicate, false),
    gte(mentions.publishedAt, since),
  ];
  if (customRange) {
    conditions.push(lt(mentions.publishedAt, customRange.untilExclusiveUtc));
  }

  const sentiment = searchParams.get('sentiment');
  if (sentiment) conditions.push(eq(mentions.nlpSentiment, sentiment));

  // Default: excluye 'baja' pertinencia. Si el caller pasa `pertinence` explícito
  // o `includeLow=1`, no aplica el filtro (compat con drawer y slices de debug).
  const pertinence = searchParams.get('pertinence');
  const includeLow = searchParams.get('includeLow');
  if (pertinence) {
    conditions.push(eq(mentions.nlpPertinence, pertinence));
  } else if (!includeLow || (includeLow !== '1' && includeLow.toLowerCase() !== 'true')) {
    conditions.push(sql`(${mentions.nlpPertinence} IS NULL OR ${mentions.nlpPertinence} <> 'baja')` as any);
  }

  // minEngagement: usado por la card "Virales" del MentionsScreen.
  const minEngagementRaw = searchParams.get('minEngagement');
  if (minEngagementRaw && !isNaN(Number(minEngagementRaw))) {
    const minE = Math.max(0, Number(minEngagementRaw));
    if (minE > 0) conditions.push(sql`${mentions.engagementScore} >= ${minE}` as any);
  }

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

  // Full-text search: split the query into whitespace-separated tokens and
  // require EACH token to appear in title OR snippet (AND across tokens). El
  // ILIKE ingenuo de la cadena completa fallaba con multi-palabra ("ayuda
  // federal" no encontraba "ayuda económica federal"). Cap a 8 tokens para
  // que una query absurda no infle el plan. Tokens muy cortos (<2) se ignoran.
  const q = searchParams.get('q');
  const qTokens = q
    ? q.trim().split(/\s+/).filter((t) => t.length >= 2).slice(0, 8)
    : [];
  for (const tok of qTokens) {
    const like = '%' + tok + '%';
    // Búsqueda por texto Y por URL/dominio: cada token matchea título/snippet o
    // url/original_url/domain. Pegar una URL (un solo token sin espacios) o un
    // dominio ('elnuevodia.com') ahora devuelve esas menciones. (domain está
    // indexado; url/original_url hacen seq-scan — aceptable al volumen actual.)
    conditions.push(sql`(${mentions.title} ILIKE ${like} OR ${mentions.snippet} ILIKE ${like} OR ${mentions.url} ILIKE ${like} OR ${mentions.originalUrl} ILIKE ${like} OR ${mentions.domain} ILIKE ${like})` as any);
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

  // Defensive validation — Drizzle parameterizes these, but shaped slugs
  // keep garbage out of the query plan and make bad input fail fast.
  const SLUG = /^[a-z0-9][a-z0-9\-]{0,60}$/;
  const isSlug = (s: string | null) => !!s && SLUG.test(s);
  const region = searchParams.get('region');
  const municipalitySlug = searchParams.get('municipality');
  const topicSlug = searchParams.get('topic');
  const subtopicName = searchParams.get('subtopic');
  if (municipalitySlug && !isSlug(municipalitySlug)) return NextResponse.json({ mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 }, error: 'invalid municipality' }, { status: 400 });
  if (topicSlug && !isSlug(topicSlug)) return NextResponse.json({ mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 }, error: 'invalid topic' }, { status: 400 });
  if (region && region.length > 60) return NextResponse.json({ mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 }, error: 'invalid region' }, { status: 400 });
  if (subtopicName && subtopicName.length > 120) return NextResponse.json({ mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 }, error: 'invalid subtopic' }, { status: 400 });

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
    // topicMode=primary: solo menciones cuyo TOP-CONFIDENCE topic = topicSlug.
    // Hace que el conteo del modal coincida con el "count" mostrado en el
    // Overview, Scorecard y TopicsScreen (que también es top-confidence).
    // topicMode=all (default): cualquier mención que toque ese tópico, sin
    // importar la confianza — comportamiento histórico, útil para ver TODA
    // la cobertura de un tópico aunque sea secundario.
    const topicMode = searchParams.get('topicMode') === 'primary' ? 'primary' : 'all';
    if (topicMode === 'primary') {
      const tRowsRaw = await db.execute(sql`
        SELECT m.id::text AS id
          FROM mentions m
         WHERE m.id IN (
           SELECT mention_id FROM (
             SELECT mention_id,
                    topic_id,
                    ROW_NUMBER() OVER (
                      PARTITION BY mention_id
                      ORDER BY confidence DESC NULLS LAST, topic_id ASC
                    ) AS rn
               FROM mention_topics
           ) ranked
           WHERE ranked.rn = 1
             AND ranked.topic_id = (SELECT id FROM topics WHERE slug = ${topicSlug})
         )
      `);
      // Drizzle's db.execute devuelve QueryResult con .rows (pg driver) o el
      // array directamente. Normalizamos antes de leer .id.
      const raw = tRowsRaw as unknown as Array<{ id: string }> | { rows?: Array<{ id: string }> };
      const rows = Array.isArray(raw) ? raw : (raw.rows ?? []);
      await intersect(rows.map((r) => r.id));
    } else {
      const tRows = await db
        .select({ id: mentionTopics.mentionId })
        .from(mentionTopics)
        .innerJoin(topics, eq(topics.id, mentionTopics.topicId))
        .where(eq(topics.slug, topicSlug));
      await intersect(tRows.map((r) => r.id));
    }
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

  // sortBy controla el orden del feed. Antes el endpoint SIEMPRE ordenaba por
  // published_at desc y el control "Ordenar por" del MentionsScreen era UI
  // muerta. Ahora:
  //   recent     — más recientes primero (default).
  //   engagement — mayor engagement primero, desempate por recencia.
  //   relevance  — (solo con q) prioriza coincidencias en el título sobre las
  //                que solo matchean en el snippet, desempate por recencia.
  const sortBy = searchParams.get('sortBy') ?? 'recent';
  let orderByClause: any[];
  if (sortBy === 'engagement') {
    orderByClause = [desc(mentions.engagementScore), desc(mentions.publishedAt)];
  } else if (sortBy === 'relevance' && qTokens.length > 0) {
    const titleCases = qTokens.map(
      (tok) => sql`(CASE WHEN ${mentions.title} ILIKE ${'%' + tok + '%'} THEN 1 ELSE 0 END)`,
    );
    const titleScore = sql.join(titleCases, sql` + `);
    orderByClause = [desc(sql`(${titleScore})`), desc(mentions.publishedAt)];
  } else {
    orderByClause = [desc(mentions.publishedAt)];
  }

  // Page of mentions
  const rows = await db
    .select({
      id: mentions.id,
      title: mentions.title,
      snippet: mentions.snippet,
      domain: mentions.domain,
      pageType: mentions.pageType,
      author: mentions.author,
      authorFullname: mentions.authorFullname,
      nlpSentiment: mentions.nlpSentiment,
      nlpPertinence: mentions.nlpPertinence,
      nlpEmotions: mentions.nlpEmotions,
      nlpSummary: mentions.nlpSummary,
      engagementScore: mentions.engagementScore,
      likes: mentions.likes,
      comments: mentions.comments,
      shares: mentions.shares,
      publishedAt: mentions.publishedAt,
      url: mentions.url,
    })
    .from(mentions)
    .where(whereClause)
    .orderBy(...orderByClause)
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
      confidence: mentionTopics.confidence,
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

  // Una mención puede tener varios topics; nos quedamos con el topic de mayor
  // confidence como "principal" y exponemos esa confianza al UI (el panel de
  // detalle muestra UN tópico con su confianza).
  const topicByMention = new Map<string, { topic: string; topicName: string; subtopics: string[]; confidence: number | null }>();
  for (const r of tRows) {
    if (!r.topicSlug) continue;
    const conf = typeof r.confidence === 'number' ? r.confidence : null;
    const existing = topicByMention.get(r.mentionId);
    if (!existing) {
      topicByMention.set(r.mentionId, { topic: r.topicSlug, topicName: r.topicName ?? r.topicSlug, subtopics: [], confidence: conf });
    } else if (conf != null && (existing.confidence == null || conf > existing.confidence)) {
      existing.topic = r.topicSlug;
      existing.topicName = r.topicName ?? r.topicSlug;
      existing.confidence = conf;
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
    // Igual que en /api/eco-data: cuando title está vacío (LinkedIn/Tumblr/
    // tweets), el contenido real vive en snippet. Sin este fallback el feed
    // renderiza filas en blanco. La búsqueda full-text ya cubre ambos campos.
    const title = (m.title && m.title.trim()) || (m.snippet && m.snippet.trim()) || '';
    return {
      id: m.id,
      title,
      snippet: m.snippet ?? '',
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
      topicConfidence: tp?.confidence ?? null,
      subtopics: tp?.subtopics ?? [],
      municipality: mu?.name ?? '',
      region: mu?.region ?? '',
      coords: mu?.coords,
      url: m.url,
      summary: m.nlpSummary ?? null,
    };
  });

  log.info('eco-mentions', 'request complete', { latencyMs: Date.now() - start, total: Number(total) });
  const res = NextResponse.json({
    mentions: out,
    total: Number(total),
    sentiment: sentCounts,
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/**
 * Devuelve los vecinos coseno-más-cercanos a `sourceId` dentro de la misma
 * agencia. Si la mención fuente no tiene embedding (backfill pendiente),
 * fallback al comportamiento previo: menciones del mismo topic principal.
 */
async function handleSimilarTo(sourceId: string, agencyId: string, limit: number) {
  const db = getDb();
  const k = Math.min(20, Math.max(1, limit));

  // 1) ¿La mención fuente tiene embedding? Si no, fallback inmediato.
  // Cast explícito a uuid: Drizzle parametriza strings como text por defecto y
  // PostgreSQL no siempre hace cast implícito text→uuid en el contexto de un
  // operador vectorial (`<=>`). Sin ::uuid la query corre pero no encuentra
  // matches.
  const srcRaw = await db.execute(sql`
    SELECT m.id::text AS id,
           (m.embedding IS NOT NULL) AS has_embedding,
           m.agency_id::text AS agency_id
      FROM mentions m
     WHERE m.id = ${sourceId}::uuid
     LIMIT 1
  `);
  const srcRows = (Array.isArray(srcRaw) ? srcRaw : ((srcRaw as any).rows ?? [])) as Array<{
    id: string; has_embedding: boolean; agency_id: string;
  }>;
  log.info('eco-mentions', 'similar_to lookup', {
    sourceId,
    agencyId,
    srcFound: srcRows.length,
    hasEmbedding: srcRows[0]?.has_embedding ?? null,
    srcAgencyId: srcRows[0]?.agency_id ?? null,
  });
  if (srcRows.length === 0 || srcRows[0].agency_id !== agencyId) {
    return NextResponse.json({ mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 }, similar: true });
  }

  let neighborIds: string[] = [];

  if (srcRows[0].has_embedding) {
    // pgvector: <=> es la distancia coseno (menor = más similar).
    const nbrRaw = await db.execute(sql`
      SELECT n.id::text AS id
        FROM mentions n, mentions s
       WHERE s.id = ${sourceId}::uuid
         AND n.agency_id = ${agencyId}::uuid
         AND n.is_duplicate = false
         AND n.id <> s.id
         AND n.embedding IS NOT NULL
       ORDER BY n.embedding <=> s.embedding
       LIMIT ${k}
    `);
    const rows = (Array.isArray(nbrRaw) ? nbrRaw : ((nbrRaw as any).rows ?? [])) as Array<{ id: string }>;
    neighborIds = rows.map((r) => r.id);
    log.info('eco-mentions', 'similar_to cosine', { sourceId, neighbors: neighborIds.length });
  }

  // Fallback / complemento: si no hay embedding o hubo cero vecinos, usar
  // mismo topic principal (orden por publishedAt DESC).
  if (neighborIds.length === 0) {
    const fbRaw = await db.execute(sql`
      WITH src AS (
        SELECT mt.topic_id, m.published_at
          FROM mentions m
          JOIN mention_topics mt ON mt.mention_id = m.id
         WHERE m.id = ${sourceId}::uuid
         ORDER BY mt.confidence DESC NULLS LAST
         LIMIT 1
      )
      SELECT n.id::text AS id
        FROM mentions n
        JOIN mention_topics nt ON nt.mention_id = n.id
        JOIN src ON src.topic_id = nt.topic_id
       WHERE n.agency_id = ${agencyId}::uuid
         AND n.is_duplicate = false
         AND n.id <> ${sourceId}::uuid
       ORDER BY n.published_at DESC
       LIMIT ${k}
    `);
    const rows = (Array.isArray(fbRaw) ? fbRaw : ((fbRaw as any).rows ?? [])) as Array<{ id: string }>;
    neighborIds = rows.map((r) => r.id);
    log.info('eco-mentions', 'similar_to fallback-topic', { sourceId, neighbors: neighborIds.length });
  }

  if (neighborIds.length === 0) {
    return NextResponse.json({ mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 }, similar: true });
  }

  // 2) Hidrata los neighbors usando el mismo shape de respuesta.
  const rows = await db
    .select({
      id: mentions.id,
      title: mentions.title,
      snippet: mentions.snippet,
      domain: mentions.domain,
      pageType: mentions.pageType,
      author: mentions.author,
      authorFullname: mentions.authorFullname,
      nlpSentiment: mentions.nlpSentiment,
      nlpPertinence: mentions.nlpPertinence,
      nlpEmotions: mentions.nlpEmotions,
      nlpSummary: mentions.nlpSummary,
      engagementScore: mentions.engagementScore,
      likes: mentions.likes,
      comments: mentions.comments,
      shares: mentions.shares,
      publishedAt: mentions.publishedAt,
      url: mentions.url,
    })
    .from(mentions)
    .where(inArray(mentions.id, neighborIds));

  // Preserva el orden de neighborIds (cercanía coseno).
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = neighborIds.map((id) => byId.get(id)).filter(Boolean) as typeof rows;

  const ids = ordered.map((r) => r.id);
  const tRows = ids.length > 0 ? await db
    .select({
      mentionId: mentionTopics.mentionId,
      topicSlug: topics.slug,
      topicName: topics.name,
      subName: subtopics.name,
      confidence: mentionTopics.confidence,
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

  const topicByMention = new Map<string, { topic: string; topicName: string; subtopics: string[]; confidence: number | null }>();
  for (const r of tRows) {
    if (!r.topicSlug) continue;
    const conf = typeof r.confidence === 'number' ? r.confidence : null;
    const existing = topicByMention.get(r.mentionId);
    if (!existing) {
      topicByMention.set(r.mentionId, { topic: r.topicSlug, topicName: r.topicName ?? r.topicSlug, subtopics: [], confidence: conf });
    } else if (conf != null && (existing.confidence == null || conf > existing.confidence)) {
      existing.topic = r.topicSlug;
      existing.topicName = r.topicName ?? r.topicSlug;
      existing.confidence = conf;
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

  const out = ordered.map((m) => {
    const tp = topicByMention.get(m.id);
    const mu = muniByMention.get(m.id);
    const title = (m.title && m.title.trim()) || (m.snippet && m.snippet.trim()) || '';
    return {
      id: m.id,
      title,
      snippet: m.snippet ?? '',
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
      topicConfidence: tp?.confidence ?? null,
      subtopics: tp?.subtopics ?? [],
      municipality: mu?.name ?? '',
      region: mu?.region ?? '',
      coords: mu?.coords,
      url: m.url,
      summary: m.nlpSummary ?? null,
    };
  });

  const res = NextResponse.json({
    mentions: out,
    total: out.length,
    sentiment: { pos: 0, neu: 0, neg: 0 },
    similar: true,
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
