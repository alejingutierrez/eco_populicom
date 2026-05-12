import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool } from '@eco/database';
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
  agencyBriefings,
} from '@eco/database';
import { sql, eq, and, gte, lt, lte, desc, count } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { log } from '@/lib/log';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const PERIOD_DAYS: Record<string, number> = {
  '1D': 1, '5D': 5, '7D': 7, '30D': 30, '90D': 90,
  '1M': 30, '2M': 60, '3M': 90, '6M': 180, '1A': 365, 'Max': 730,
  '24h': 1, '7d': 7, '30d': 30, '90d': 90,
};

/**
 * Parse y validación del rango personalizado from / to.
 *
 * `from` y `to` son YYYY-MM-DD en AST (TZ America/Puerto_Rico, UTC-4 sin DST).
 * Como AST = UTC-4 constante, podemos derivar timestamps UTC exactos:
 *   - sinceUtc:           `from`T04:00:00Z   (AST 00:00 del día `from`)
 *   - untilExclusiveUtc:  `to`T04:00:00Z + 1 día  (AST 24:00 del día `to`)
 *
 * El upper bound es exclusivo (`lt`) para no incluir mediciones de un día
 * adicional por error de comparación.
 *
 * Retorna null si los parámetros son inválidos (faltantes, mal formados, o
 * `from` > `to`). En ese caso el caller cae al cálculo por `period`.
 */
function parseCustomRange(
  fromParam: string | null,
  toParam: string | null,
): null | {
  from: string;
  to: string;
  sinceUtc: Date;
  untilExclusiveUtc: Date;
  days: number;
} {
  if (!fromParam || !toParam) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromParam) || !/^\d{4}-\d{2}-\d{2}$/.test(toParam)) return null;
  if (fromParam > toParam) return null;
  const sinceUtc = new Date(`${fromParam}T04:00:00.000Z`);
  const untilExclusiveUtc = new Date(`${toParam}T04:00:00.000Z`);
  untilExclusiveUtc.setUTCDate(untilExclusiveUtc.getUTCDate() + 1);
  if (Number.isNaN(sinceUtc.getTime()) || Number.isNaN(untilExclusiveUtc.getTime())) return null;
  const days = Math.round((untilExclusiveUtc.getTime() - sinceUtc.getTime()) / 86400000);
  return { from: fromParam, to: toParam, sinceUtc, untilExclusiveUtc, days };
}

type TimelineRow = {
  date: string;
  fullDate: string;
  nss: number;
  brandHealthIndex: number;
  totalMentions: number;
  crisisRiskScore: number;
  engagementRate: number;
  polarizationIndex: number | null;
  positivo: number;
  neutral: number;
  negativo: number;
};

const TZ = 'America/Puerto_Rico';

function esShortDate(iso: string) {
  try {
    // snapshot.date is a Postgres DATE column. Drizzle / node-postgres hands
    // it to us as a Date object, which the route then stringifies via
    // `new Date(s.date).toISOString()` to "2026-04-14T00:00:00.000Z" — midnight
    // UTC = 20:00 AST on the 13th. A plain TZ conversion from that value
    // renders every snapshot one day earlier than it really is.
    // Match both the bare "YYYY-MM-DD" and midnight-UTC ISO forms and anchor
    // to noon UTC so the AST calendar day matches the snapshot's actual date.
    const bareMatch = iso.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.000)?Z)?$/);
    const anchored = bareMatch ? `${bareMatch[1]}T12:00:00Z` : iso;
    const d = new Date(anchored);
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

/**
 * Sentimiento efectivo: NLP propio si está clasificado, fallback al de
 * Brandwatch para no perder señal cuando el clasificador aún no procesó la
 * mención. Este es el mismo COALESCE que aplica el correo semanal — así las
 * cifras del dashboard y del correo cuadran.
 */
const effectiveSentimentSql = sql<string | null>`COALESCE(${mentions.nlpSentiment}, ${mentions.bwSentiment})`;

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
  // Rango personalizado: from / to en YYYY-MM-DD interpretados en TZ
  // America/Puerto_Rico (UTC-4 sin DST). Solo se honran si vienen ambos y son
  // un rango válido; cualquier desviación cae al cálculo por `period`.
  const customRange = parseCustomRange(searchParams.get('from'), searchParams.get('to'));
  const days = customRange ? customRange.days : (PERIOD_DAYS[periodKey] ?? 30);

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

  // Cota inferior: o el inicio del rango custom (AST 00:00) o NOW − days.
  // Cota superior (opcional): solo se aplica para custom — marca el final
  // del día AST `to` (exclusivo en UTC = AST `to` 24:00).
  const since = customRange ? customRange.sinceUtc : (() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  })();
  const untilExclusive: Date | null = customRange ? customRange.untilExclusiveUtc : null;
  const snapshotStartDate: string = customRange ? customRange.from : since.toISOString().split('T')[0];
  const snapshotEndDate: string | null = customRange ? customRange.to : null;

  const baseWhere = untilExclusive
    ? and(
        eq(mentions.agencyId, agencyId),
        gte(mentions.publishedAt, since),
        lt(mentions.publishedAt, untilExclusive),
      )
    : and(eq(mentions.agencyId, agencyId), gte(mentions.publishedAt, since));

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
    const snapshotConditions = [
      gte(dailyMetricSnapshots.date, snapshotStartDate),
      eq(dailyMetricSnapshots.agencyId, agencyId),
    ];
    if (snapshotEndDate) snapshotConditions.push(lte(dailyMetricSnapshots.date, snapshotEndDate));
    const snapshots = await db
      .select()
      .from(dailyMetricSnapshots)
      .where(and(...snapshotConditions))
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
        polarizationIndex: s.polarizationIndex != null ? Number(s.polarizationIndex) : null,
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
      nss7d: last.nss7d != null ? Number(last.nss7d) : null,
      nss30d: last.nss30d != null ? Number(last.nss30d) : null,
      brandHealthIndex: last.brandHealthIndex != null ? Number(last.brandHealthIndex) : null,
      crisisRiskScore: last.crisisRiskScore != null ? Number(last.crisisRiskScore) : null,
      engagementRate: last.engagementRate != null ? Number(last.engagementRate) : null,
      amplificationRate: last.amplificationRate != null ? Number(last.amplificationRate) : null,
      reputationMomentum: last.reputationMomentum != null ? Number(last.reputationMomentum) : null,
      engagementVelocity: last.engagementVelocity != null ? Number(last.engagementVelocity) : null,
      volumeAnomalyZscore: last.volumeAnomalyZscore != null ? Number(last.volumeAnomalyZscore) : null,
      polarizationIndex: last.polarizationIndex != null ? Number(last.polarizationIndex) : null,
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
      .select({ s: effectiveSentimentSql, c: count() })
      .from(mentions)
      .where(baseWhere)
      .groupBy(effectiveSentimentSql);

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

    // Live counts respetan el filtro del usuario (date range / agency / topic)
    // y se usan para los conteos directos (totalMentions, conteo por sentimiento,
    // engagement rate observado en la ventana). Las métricas COMPUESTAS (BHI,
    // CrisisRisk, EngagementVelocity, PolarizationIndex, ReputationMomentum,
    // VolumeAnomalyZ) vienen EXCLUSIVAMENTE del snapshot diario calculado por
    // eco-metrics-calculator — una sola fórmula, una sola fuente de verdad.
    // Si no hay snapshot todavía (lambda corre cada 10 min), las compuestas
    // muestran null y la UI las renderiza como "—".
    const liveTotal = sentCounts.positivo + sentCounts.neutral + sentCounts.negativo;
    const liveNss = liveTotal > 0
      ? Number((((sentCounts.positivo - sentCounts.negativo) / liveTotal) * 100).toFixed(1))
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

    // Snapshots son fuente de verdad para métricas compuestas. Los counters
    // (mentions/sentiment/engagement rate) usan los conteos vivos del filtro
    // — esos respetan el rango de fechas del usuario.
    const pickLive = (snap: number, live: number) => (snap && snap !== 0 ? snap : live);
    const CURRENT_METRICS = {
      nss: pickLive(snapMetrics?.nss ?? 0, liveNss),
      nss7d: snapMetrics?.nss7d ?? null,
      nss30d: snapMetrics?.nss30d ?? null,
      nssDelta: snapDeltas.nssDelta,
      brandHealthIndex: snapMetrics?.brandHealthIndex ?? null,
      brandHealthDelta: snapDeltas.brandHealthDelta,
      crisisRiskScore: snapMetrics?.crisisRiskScore ?? null,
      crisisDelta: snapDeltas.crisisDelta,
      totalMentions: pickLive(snapMetrics?.totalMentions ?? 0, liveTotal),
      totalMentionsDelta: snapDeltas.totalMentionsDelta,
      totalReach: liveReach,
      engagementRate: pickLive(snapMetrics?.engagementRate ?? 0, liveEngRate),
      engagementDelta: snapDeltas.engagementDelta,
      amplificationRate: snapMetrics?.amplificationRate ?? null,
      amplificationDelta: 0,
      reputationMomentum: snapMetrics?.reputationMomentum ?? null,
      engagementVelocity: snapMetrics?.engagementVelocity ?? null,
      volumeAnomalyZscore: snapMetrics?.volumeAnomalyZscore ?? null,
      polarizationIndex: snapMetrics?.polarizationIndex ?? null,
      positiveCount: pickLive(snapMetrics?.positiveCount ?? 0, sentCounts.positivo),
      neutralCount: pickLive(snapMetrics?.neutralCount ?? 0, sentCounts.neutral),
      negativeCount: pickLive(snapMetrics?.negativeCount ?? 0, sentCounts.negativo),
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
      .select({ pageType: mentions.pageType, s: effectiveSentimentSql, c: count() })
      .from(mentions)
      .where(baseWhere)
      .groupBy(mentions.pageType, effectiveSentimentSql);

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
    // TOPICS: top-confidence dedup (cada mención cuenta UNA vez bajo su tópico
    // de mayor confianza) + secondaryCount como dato suplementario. Misma
    // semántica que el correo y /api/overview — el `count` que muestra el
    // dashboard ahora coincide byte-por-byte con el del Overview/correo.
    // El secondaryCount permite al UI comunicar "+N también lo tocan".
    const pool = getPool();
    // Para rango personalizado, el WHERE incluye además la cota superior
    // (`published_at < $3`). Para el caso default (period preset), la cota
    // superior es la fecha actual y no necesita filtro extra.
    const topicSinceIso = since.toISOString();
    const topicSql = untilExclusive
      ? `WITH primaries AS (
           SELECT t.id AS topic_id, t.slug, t.name,
                  COUNT(*)::int AS primary_count,
                  COUNT(*) FILTER (WHERE pt.sentiment = 'negativo')::int AS negative,
                  COUNT(*) FILTER (WHERE pt.sentiment = 'neutral')::int AS neutral,
                  COUNT(*) FILTER (WHERE pt.sentiment = 'positivo')::int AS positive
             FROM (
               SELECT m.id AS mention_id,
                      COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
                      (SELECT topic_id FROM mention_topics
                         WHERE mention_id = m.id
                         ORDER BY confidence DESC NULLS LAST, topic_id ASC LIMIT 1) AS topic_id
                 FROM mentions m
                WHERE m.agency_id = $1
                  AND m.published_at >= $2
                  AND m.published_at < $3
             ) pt
             JOIN topics t ON t.id = pt.topic_id
            GROUP BY t.id, t.slug, t.name
         ),
         multi AS (
           SELECT mt.topic_id,
                  COUNT(DISTINCT mt.mention_id)::int AS multi_count
             FROM mention_topics mt
             JOIN mentions m ON m.id = mt.mention_id
            WHERE m.agency_id = $1
              AND m.published_at >= $2
              AND m.published_at < $3
            GROUP BY mt.topic_id
         )
         SELECT p.slug, p.name, p.primary_count, p.negative, p.neutral, p.positive,
                GREATEST(COALESCE(mu.multi_count, 0) - p.primary_count, 0)::int AS secondary_count
           FROM primaries p
           LEFT JOIN multi mu ON mu.topic_id = p.topic_id
          ORDER BY p.primary_count DESC
          LIMIT 12`
      : `WITH primaries AS (
           SELECT t.id AS topic_id, t.slug, t.name,
                  COUNT(*)::int AS primary_count,
                  COUNT(*) FILTER (WHERE pt.sentiment = 'negativo')::int AS negative,
                  COUNT(*) FILTER (WHERE pt.sentiment = 'neutral')::int AS neutral,
                  COUNT(*) FILTER (WHERE pt.sentiment = 'positivo')::int AS positive
             FROM (
               SELECT m.id AS mention_id,
                      COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
                      (SELECT topic_id FROM mention_topics
                         WHERE mention_id = m.id
                         ORDER BY confidence DESC NULLS LAST, topic_id ASC LIMIT 1) AS topic_id
                 FROM mentions m
                WHERE m.agency_id = $1
                  AND m.published_at >= $2
             ) pt
             JOIN topics t ON t.id = pt.topic_id
            GROUP BY t.id, t.slug, t.name
         ),
         multi AS (
           SELECT mt.topic_id,
                  COUNT(DISTINCT mt.mention_id)::int AS multi_count
             FROM mention_topics mt
             JOIN mentions m ON m.id = mt.mention_id
            WHERE m.agency_id = $1
              AND m.published_at >= $2
            GROUP BY mt.topic_id
         )
         SELECT p.slug, p.name, p.primary_count, p.negative, p.neutral, p.positive,
                GREATEST(COALESCE(mu.multi_count, 0) - p.primary_count, 0)::int AS secondary_count
           FROM primaries p
           LEFT JOIN multi mu ON mu.topic_id = p.topic_id
          ORDER BY p.primary_count DESC
          LIMIT 12`;
    const topicRowsRaw = await pool.query<{
      slug: string;
      name: string;
      primary_count: number | string;
      secondary_count: number | string;
      negative: number | string;
      neutral: number | string;
      positive: number | string;
    }>(
      topicSql,
      untilExclusive
        ? [agencyId, topicSinceIso, untilExclusive.toISOString()]
        : [agencyId, topicSinceIso],
    );

    // Descripciones IA por tópico — pobladas por eco-ai-tasks (acción
    // topic-descriptions). Si una está vacía, la UI renderiza un fallback
    // suave en lugar de inventar texto.
    const topicDescRows = await db
      .select({ slug: topics.slug, description: topics.description })
      .from(topics)
      .where(eq(topics.agencyId, agencyId));
    const descBySlug = new Map<string, string | null>();
    for (const r of topicDescRows) descBySlug.set(r.slug, r.description ?? null);

    const TOPICS = topicRowsRaw.rows.map((r) => {
      const primary = Number(r.primary_count);
      const secondary = Number(r.secondary_count);
      const neg = Number(r.negative);
      const neu = Number(r.neutral);
      const pos = Number(r.positive);
      const total = primary || 1;
      const positivePct = Math.round((pos / total) * 100);
      const negativePct = Math.round((neg / total) * 100);
      const neutralPct = Math.max(0, 100 - positivePct - negativePct);
      let dominant: 'positivo' | 'negativo' | 'mixed' = 'mixed';
      if (positivePct > negativePct + 8) dominant = 'positivo';
      else if (negativePct > positivePct + 8) dominant = 'negativo';
      return {
        slug: r.slug,
        name: r.name,
        count: primary,        // top-confidence — coincide con correo y Overview
        secondaryCount: secondary,
        positivePct, negativePct, neutralPct,
        dominantSentiment: dominant,
        delta: 0,
        description: descBySlug.get(r.slug) ?? null,
        evolution: [] as Array<{ date: string; fullDate: string; count: number }>,
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

    // ---- TOPIC EVOLUTION (per-topic daily series, last 35d AST) ----
    // El TopicDetail "Evolución" antes mostraba una proporción artificial
    // (totalMentions × topic.count / totalMentions). Ahora servimos el conteo
    // real diario por tópico en zona AST para que la línea refleje cambios
    // reales del volumen del tópico.
    const topicEvolutionRows = await db.execute<{ slug: string; day: string; c: number | string }>(sql`
      SELECT t.slug AS slug,
             (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date::text AS day,
             COUNT(*) AS c
        FROM mentions m
        JOIN mention_topics mt ON mt.mention_id = m.id
        JOIN topics t ON t.id = mt.topic_id
       WHERE m.agency_id = ${agencyId}
         AND m.published_at >= NOW() - INTERVAL '35 days'
       GROUP BY t.slug, day
       ORDER BY t.slug, day
    `);
    const evoList: Array<{ slug: string; day: string; c: number | string }> = Array.isArray(topicEvolutionRows)
      ? (topicEvolutionRows as unknown as Array<{ slug: string; day: string; c: number | string }>)
      : (((topicEvolutionRows as unknown as { rows?: Array<{ slug: string; day: string; c: number | string }> }).rows) ?? []);
    const evolutionByTopic = new Map<string, Array<{ date: string; fullDate: string; count: number }>>();
    for (const r of evoList) {
      const arr = evolutionByTopic.get(r.slug) ?? [];
      const fullDate = `${r.day}T12:00:00Z`;
      arr.push({
        date: esShortDate(fullDate),
        fullDate,
        count: Number(r.c),
      });
      evolutionByTopic.set(r.slug, arr);
    }
    for (const t of TOPICS) {
      t.evolution = evolutionByTopic.get(t.slug) ?? [];
    }

    // ---- TOPIC CALENDAR (per-day dominant topic, last 35d AST) ----
    // El "Calendario de tópico principal por día" antes usaba una rotación
    // determinística falsa (índice * 7 + ruido). Ahora calculamos el top-1
    // tópico por día con su sentimiento dominante en datos reales.
    const calendarRows = await db.execute<{
      day: string; slug: string; name: string;
      volume: number | string; pos: number | string; neg: number | string;
    }>(sql`
      WITH per_day AS (
        SELECT
          (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date AS day,
          t.slug, t.name,
          COUNT(*) AS volume,
          COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('positivo','positive')) AS pos,
          COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative')) AS neg
          FROM mentions m
          JOIN mention_topics mt ON mt.mention_id = m.id
          JOIN topics t ON t.id = mt.topic_id
         WHERE m.agency_id = ${agencyId}
           AND m.published_at >= NOW() - INTERVAL '35 days'
         GROUP BY day, t.slug, t.name
      ),
      ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY day ORDER BY volume DESC, slug ASC) AS rk
          FROM per_day
      )
      SELECT day::text AS day, slug, name, volume, pos, neg
        FROM ranked
       WHERE rk = 1
       ORDER BY day
    `);
    const calList: Array<{ day: string; slug: string; name: string; volume: number | string; pos: number | string; neg: number | string }> = Array.isArray(calendarRows)
      ? (calendarRows as unknown as Array<{ day: string; slug: string; name: string; volume: number | string; pos: number | string; neg: number | string }>)
      : (((calendarRows as unknown as { rows?: Array<{ day: string; slug: string; name: string; volume: number | string; pos: number | string; neg: number | string }> }).rows) ?? []);
    const TOPIC_CALENDAR = calList.map((r) => {
      const volume = Number(r.volume);
      const pos = Number(r.pos);
      const neg = Number(r.neg);
      const neu = Math.max(0, volume - pos - neg);
      const sentiment = neg > pos + neu * 0.2 ? 'negativo' : pos > neg + neu * 0.2 ? 'positivo' : 'neutral';
      const fullDate = `${r.day}T12:00:00Z`;
      return {
        date: esShortDate(fullDate),
        fullDate,
        volume,
        topicSlug: r.slug,
        topicName: r.name,
        sentiment,
      };
    });

    // ---- MUNICIPALITIES ----
    const muniRows = await db
      .select({
        slug: municipalities.slug,
        name: municipalities.name,
        region: municipalities.region,
        lat: municipalities.latitude,
        lon: municipalities.longitude,
        s: effectiveSentimentSql,
        c: count(),
      })
      .from(mentionMunicipalities)
      .innerJoin(municipalities, eq(municipalities.id, mentionMunicipalities.municipalityId))
      .innerJoin(mentions, eq(mentions.id, mentionMunicipalities.mentionId))
      .where(baseWhere)
      .groupBy(municipalities.slug, municipalities.name, municipalities.region, municipalities.latitude, municipalities.longitude, effectiveSentimentSql);

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
    const emotionAgg = untilExclusive
      ? await db.execute<{ emotion: string; c: number | string }>(sql`
          SELECT lower(trim(e.value::text, '"')) AS emotion, COUNT(*) AS c
          FROM mentions m, jsonb_array_elements(COALESCE(m.nlp_emotions, '[]'::jsonb)) AS e
          WHERE m.agency_id = ${agencyId}
            AND m.published_at >= ${since.toISOString()}
            AND m.published_at < ${untilExclusive.toISOString()}
          GROUP BY emotion
          ORDER BY c DESC
          LIMIT 20
        `)
      : await db.execute<{ emotion: string; c: number | string }>(sql`
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
        snippet: mentions.snippet,
        domain: mentions.domain,
        pageType: mentions.pageType,
        author: mentions.author,
        authorFullname: mentions.authorFullname,
        nlpSentiment: mentions.nlpSentiment,
        bwSentiment: mentions.bwSentiment,
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
        confidence: mentionTopics.confidence,
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

    // Una mención puede tener varios topics; nos quedamos con el topic de mayor
    // confidence como "principal" y exponemos esa confianza al UI (el panel de
    // detalle muestra UN tópico con su confianza).
    const topicByMention = new Map<string, { topic: string; topicName: string; subtopics: string[]; confidence: number | null }>();
    for (const r of mtRows) {
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
      // Mostrar el contenido real al usuario: news/blog suelen traer un título
      // descriptivo, pero LinkedIn/Tumblr/Instagram lo dejan vacío y el texto
      // del post vive en `snippet`. Sin este fallback, el dashboard renderiza
      // filas en blanco (94% de LinkedIn de DDECPR caía aquí).
      const title = (m.title && m.title.trim()) || (m.snippet && m.snippet.trim()) || '';
      return {
        id: m.id,
        title,
        snippet: m.snippet ?? '',
        domain: m.domain ?? '',
        source: sourceKey(m.pageType),
        author: m.authorFullname ?? m.author ?? '',
        sentiment: pillFromSentiment(m.nlpSentiment ?? m.bwSentiment),
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

    // ---- BRIEFING ----
    // Fuente primaria: tabla agency_briefings poblada por eco-ai-tasks cada
    // 6 horas. Si el último briefing tiene más de 12 horas (lambda caída, o
    // aún no corrió por primera vez), reconstruimos uno con la misma plantilla
    // determinística histórica para no dejar la UI en blanco.
    // El frontend usa `BRIEFING.source` ('ai' | 'rule') para decidir el chip
    // de procedencia.
    const dominantTopic = TOPICS[0];
    const BRIEFING_TTL_MS = 12 * 60 * 60 * 1000;

    const [latestBriefing] = await db
      .select()
      .from(agencyBriefings)
      .where(eq(agencyBriefings.agencyId, agencyId))
      .orderBy(desc(agencyBriefings.generatedAt))
      .limit(1);

    const briefingFresh = latestBriefing && (Date.now() - new Date(latestBriefing.generatedAt).getTime()) < BRIEFING_TTL_MS;

    type BriefingShape = {
      eyebrow: string;
      narrativeHtml: string;
      dominantSignal: string;
      action: string;
      actionTone: string;
      reachLabel: string | null;
      source: 'ai' | 'rule';
      generatedAtIso: string | null;
      generatedAtLabel: string | null;
    };

    function buildRuleBriefing(): BriefingShape | null {
      if (!dominantTopic) return null;
      const dominantTone = dominantTopic.dominantSentiment === 'positivo' ? 'Positiva'
        : dominantTopic.dominantSentiment === 'negativo' ? 'Negativa'
        : 'Mixta';
      const tone = liveNss > 5 ? 'pos' : liveNss < -5 ? 'neg' : 'warn';
      const verb = tone === 'pos' ? 'mejora' : tone === 'neg' ? 'deteriora' : 'se mantiene estable';
      const narrativeHtml = `La percepción pública se <strong>${verb}</strong> en torno a <strong>${dominantTopic.name}</strong> (${dominantTopic.count.toLocaleString('es-PR')} menciones, ${dominantTopic.negativePct}% negativo).`;
      const reachLabel = liveReach >= 1_000_000
        ? (liveReach / 1_000_000).toFixed(2) + 'M impresiones'
        : liveReach >= 1000
        ? Math.round(liveReach / 1000) + 'K impresiones'
        : String(liveReach) + ' impresiones';
      return {
        eyebrow: new Date().toLocaleDateString('es-PR', { day: 'numeric', month: 'short', year: 'numeric' }),
        narrativeHtml,
        dominantSignal: `${dominantTopic.name} · ${dominantTone}`,
        action: `Seguir ${dominantTopic.name} →`,
        actionTone: tone,
        reachLabel,
        source: 'rule',
        generatedAtIso: null,
        generatedAtLabel: null,
      };
    }

    let BRIEFING: BriefingShape | null = null;
    if (briefingFresh && latestBriefing) {
      const generatedAt = new Date(latestBriefing.generatedAt);
      BRIEFING = {
        eyebrow: generatedAt.toLocaleDateString('es-PR', { day: 'numeric', month: 'short', year: 'numeric' }),
        narrativeHtml: latestBriefing.narrativeHtml,
        dominantSignal: latestBriefing.dominantSignal,
        action: latestBriefing.actionLabel,
        actionTone: latestBriefing.actionTone,
        reachLabel: latestBriefing.reachLabel ?? null,
        source: latestBriefing.fallback ? 'rule' : 'ai',
        generatedAtIso: generatedAt.toISOString(),
        generatedAtLabel: relativeTime(generatedAt),
      };
    } else {
      BRIEFING = buildRuleBriefing();
    }

    // Slug the user is bound to (resolved from Cognito custom:agency_slug
    // header or the URL ?agency= param). Surface it so the dashboard can pick
    // the right default when localStorage is empty — otherwise the prototype
    // falls back to AGENCIES_FULL[0] (sorted by slug) and a ddecpr-bound user
    // lands on aaa charts at first boot.
    const [agencyRow] = await db
      .select({ slug: agencies.slug })
      .from(agencies)
      .where(eq(agencies.id, agencyId))
      .limit(1);
    const USER_AGENCY_SLUG = agencyRow?.slug ?? null;

    const res = NextResponse.json({
      AGENCIES_FULL,
      USER_AGENCY_SLUG,
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
      TOPIC_CALENDAR: TOPIC_CALENDAR.length > 0 ? TOPIC_CALENDAR : null,
    });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (err) {
    log.error('eco-data', 'handler failed', { msg: (err as Error).message });
    return NextResponse.json({ error: 'eco-data error', message: (err as Error).message }, { status: 500 });
  } finally {
    log.info('eco-data', 'request complete', {
      latencyMs: Date.now() - start,
      period: customRange ? 'custom' : periodKey,
      ...(customRange ? { from: customRange.from, to: customRange.to } : {}),
    });
  }
}
