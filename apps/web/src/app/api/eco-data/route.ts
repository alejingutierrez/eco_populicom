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
import { sql, eq, and, gte, lt, lte, desc, count, inArray } from 'drizzle-orm';
import {
  closedWindowYmdInTZ, loadMetricsForWindow, addDaysYmd, type PgClientLike,
  formatMetric, formatDelta, formatVelocity,
  sourceKey, sourceLabel,
} from '@eco/shared';
import { resolveAgencyId, resolveAllowedAgencySlugs } from '@/lib/agency';
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

// sourceKey / sourceLabel viven en @eco/shared (fuente única de verdad
// compartida con eco-mentions/eco-geo) para que agregación y drilldown nunca
// diverjan. Ver packages/shared/src/sources.ts.

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

  // Ventana cerrada en TZ Puerto Rico — termina ayer (no incluye hoy parcial),
  // mismo patrón que /api/overview y el correo eco-weekly-report. Esto hace
  // que NSS/BHI/Crisis/Polarization para el "scorecard" coincidan con los del
  // espejo del correo, y que el filtro de fecha del usuario cambie todas las
  // métricas (no solo el volumen).
  //
  // Para rangos custom (from/to), respetamos los YMD del usuario y derivamos
  // la ventana previa de igual duración hacia atrás — eso permite calcular
  // deltaVsPrev para periodos arbitrarios elegidos en el calendario.
  const window = customRange
    ? (() => {
        const startYmd = customRange.from;
        const endYmd = customRange.to;
        const prevEndYmd = addDaysYmd(startYmd, -1);
        const prevStartYmd = addDaysYmd(prevEndYmd, -(customRange.days - 1));
        return { startYmd, endYmd, prevStartYmd, prevEndYmd };
      })()
    : closedWindowYmdInTZ(days, new Date(), TZ);
  const { startYmd, endYmd, prevStartYmd, prevEndYmd } = window;

  // Para el filtro de mentions usamos los bordes de la ventana traducidos a
  // UTC con offset -04:00 (AST sin DST).
  const since = new Date(`${startYmd}T00:00:00-04:00`);
  const until = new Date(`${endYmd}T23:59:59.999-04:00`);

  // is_duplicate = false: alinea TODAS las agregaciones Drizzle (sentiment,
  // fuentes, MUNICIPALITIES, región) con las consultas raw-SQL (#65) y con las
  // métricas windowed (winCur), que ya excluyen duplicados. Sin esto, el dot
  // del mapa contaba duplicados mientras el total del modal (eco-mentions) los
  // excluía → "la modal muestra mal los datos".
  const baseWhere = and(
    eq(mentions.agencyId, agencyId),
    eq(mentions.isDuplicate, false),
    gte(mentions.publishedAt, since),
    lte(mentions.publishedAt, until),
  );

  try {
    // ---- AGENCIES (the ones this user may switch between) ----
    const agencyRows = await db
      .select({ id: agencies.id, name: agencies.name, slug: agencies.slug })
      .from(agencies)
      .where(eq(agencies.isActive, true));

    // null = every active agency (staff / all_agencies / public). Otherwise
    // restrict the switcher to the user's granted set so they can't switch into
    // an agency they aren't allowed to read.
    const allowedSlugs = await resolveAllowedAgencySlugs();
    const visibleAgencies = allowedSlugs
      ? agencyRows.filter((a) => allowedSlugs.includes(a.slug))
      : agencyRows;

    const AGENCIES_FULL = visibleAgencies.map((a) => ({
      key: a.slug,
      name: (a.slug || '').toUpperCase().slice(0, 6),
      long: a.name,
    }));

    // Sentinel "TODAS" para la vista ejecutiva multi-agencia — solo staff
    // (allowedSlugs === null ≡ ve todas las agencias) puede seleccionarla.
    // El frontend rutea la selección __all__ a /api/exec-overview.
    if (allowedSlugs === null) {
      AGENCIES_FULL.unshift({ key: '__all__', name: 'TODAS', long: 'Todas las agencias' });
    }

    // ---- TIMELINE from snapshots (un punto por día dentro de la ventana) ----
    const snapshots = await db
      .select()
      .from(dailyMetricSnapshots)
      .where(and(
        eq(dailyMetricSnapshots.agencyId, agencyId),
        gte(dailyMetricSnapshots.date, startYmd),
        lte(dailyMetricSnapshots.date, endYmd),
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
        polarizationIndex: s.polarizationIndex != null ? Number(s.polarizationIndex) : null,
        positivo: Number(s.positiveCount ?? 0),
        neutral: Number(s.neutralCount ?? 0),
        negativo: Number(s.negativeCount ?? 0),
      };
    });

    // ---- CURRENT_METRICS — recalculadas sobre la ventana del period ----
    // Antes leíamos solo el snapshot del último día. Ahora computamos
    // NSS/BHI/Crisis/Polarization/etc sobre la ventana cerrada del usuario
    // (single source of truth: @eco/shared/metrics:loadMetricsForWindow).
    // Eso hace que cambiar 1D → 1M → 1A cambie también las compuestas.
    const pool = getPool() as unknown as PgClientLike;
    const [winCur, winPrev] = await Promise.all([
      loadMetricsForWindow(pool, agencyId, startYmd, endYmd),
      loadMetricsForWindow(pool, agencyId, prevStartYmd, prevEndYmd),
    ]);

    // Deltas vs ventana previa de igual duración.
    const safeDelta = (cur: number | null, prev: number | null, decimals = 1) => {
      if (cur == null || prev == null) return 0;
      return Number((cur - prev).toFixed(decimals));
    };
    const pctDelta = (cur: number, prev: number) =>
      prev > 0 ? Number((((cur - prev) / prev) * 100).toFixed(1)) : 0;

    const snapDeltas = {
      nssDelta: safeDelta(winCur.nss, winPrev.nss, 1),
      brandHealthDelta: safeDelta(winCur.brandHealthIndex, winPrev.brandHealthIndex, 2),
      crisisDelta: safeDelta(winCur.crisisRiskScore, winPrev.crisisRiskScore, 2),
      totalMentionsDelta: pctDelta(winCur.totals.total, winPrev.totals.total),
      engagementDelta: safeDelta(winCur.engagementRate, winPrev.engagementRate, 2),
    };

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

    // CURRENT_METRICS — single source of truth: @eco/shared/metrics.
    // Todas las métricas compuestas (NSS, BHI, Crisis, Polarization,
    // EngagementRate, ReputationMomentum, EngagementVelocity, etc.) se
    // calculan sobre la VENTANA del period del usuario. Cambiar 1D → 1M → 1A
    // las cambia a todas (no solo a totalMentions/sentiment counts como antes).
    const [engAgg] = await db
      .select({
        hiPert: sql<number>`COUNT(*) FILTER (WHERE ${mentions.nlpPertinence} = 'alta')`.mapWith(Number),
      })
      .from(mentions)
      .where(baseWhere);

    const CURRENT_METRICS = {
      nss: winCur.nss ?? 0,
      nss7d: winCur.nss7d,
      nss30d: winCur.nss30d,
      nssDelta: snapDeltas.nssDelta,
      brandHealthIndex: winCur.brandHealthIndex,
      brandHealthDelta: snapDeltas.brandHealthDelta,
      crisisRiskScore: winCur.crisisRiskScore,
      crisisDelta: snapDeltas.crisisDelta,
      totalMentions: winCur.totals.total,
      totalMentionsDelta: snapDeltas.totalMentionsDelta,
      totalReach: winCur.totalReach,
      engagementRate: winCur.engagementRate ?? 0,
      engagementDelta: snapDeltas.engagementDelta,
      amplificationRate: winCur.amplificationRate,
      amplificationDelta: 0,
      reputationMomentum: winCur.reputationMomentum,
      engagementVelocity: winCur.engagementVelocity,
      volumeAnomalyZscore: winCur.volumeAnomalyZscore,
      polarizationIndex: winCur.polarizationIndex,
      positiveCount: winCur.totals.positive,
      neutralCount: winCur.totals.neutral,
      negativeCount: winCur.totals.negative,
      highPertinenceCount: Number(engAgg?.hiPert ?? 0),

      // ---- Formato legible-para-el-público (single source: @eco/shared/format) ----
      // Cada métrica trae su representación principal (palabra) + número de
      // apoyo + tono/color, ya formateados, para que la SPA estática no tenga
      // que re-derivar escalas/bandas (eso causaba "6.3" vs "0.59" en pantallas
      // contiguas). Los campos numéricos crudos de arriba se conservan para los
      // ejes de los charts.
      display: {
        nss: formatMetric('nss', winCur.nss),
        brandHealth: formatMetric('bhi', winCur.brandHealthIndex),
        crisis: formatMetric('crisis', winCur.crisisRiskScore),
        polarization: formatMetric('polarization', winCur.polarizationIndex),
        engagementRate: formatMetric('engagementRate', winCur.engagementRate),
        amplificationRate: formatMetric('amplificationRate', winCur.amplificationRate),
        // Velocidad redefinida: cambio % del engagement-por-mención vs el
        // período anterior de igual duración (resuelve el "0" → "Estable").
        velocity: formatVelocity(winCur.engagementPerMention, winPrev.engagementPerMention),
      },
      // Tendencias vs período anterior, con palabra y distinguiendo
      // "estable" (cambio ≈ 0) de "sin base de comparación" (sin período previo).
      deltaDisplay: {
        nss: formatDelta(winCur.nss, winPrev.nss, { kind: 'absolute', decimals: 1 }),
        brandHealth: formatDelta(
          winCur.brandHealthIndex != null ? 1 + winCur.brandHealthIndex * 9 : null,
          winPrev.brandHealthIndex != null ? 1 + winPrev.brandHealthIndex * 9 : null,
          { kind: 'absolute', decimals: 1, suffix: '' },
        ),
        crisis: formatDelta(
          winCur.crisisRiskScore != null ? winCur.crisisRiskScore * 100 : null,
          winPrev.crisisRiskScore != null ? winPrev.crisisRiskScore * 100 : null,
          { kind: 'absolute', decimals: 0, suffix: ' pts', invert: true },
        ),
        engagementRate: formatDelta(winCur.engagementRate, winPrev.engagementRate, { kind: 'absolute', decimals: 1, suffix: ' pts' }),
        totalMentions: formatDelta(winCur.totals.total, winPrev.totals.total, { kind: 'percent', decimals: 0 }),
        polarization: formatDelta(winCur.polarizationIndex, winPrev.polarizationIndex, { kind: 'absolute', decimals: 0, suffix: ' pts' }),
      },
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

    // ---- SENTIMENT_BY_TOPIC (dedup top-confidence por mención) ----
    // Misma semántica que TOPICS: cada mención cuenta UNA vez bajo su tópico
    // de mayor confianza. Esto coincide con el correo/Overview.
    const sByTopicRaw = await (pool as ReturnType<typeof getPool>).query<{
      slug: string; name: string; sentiment: string | null; c: number | string;
    }>(
      `SELECT t.slug, t.name, pt.sentiment, COUNT(*)::int AS c
         FROM (
           SELECT m.id AS mention_id,
                  COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
                  (SELECT topic_id FROM mention_topics
                     WHERE mention_id = m.id
                     ORDER BY confidence DESC NULLS LAST, topic_id ASC LIMIT 1) AS topic_id
             FROM mentions m
            WHERE m.agency_id = $1
              AND m.is_duplicate = false
              AND m.published_at >= $2
              AND m.published_at <= $3
         ) pt
         JOIN topics t ON t.id = pt.topic_id
         GROUP BY t.slug, t.name, pt.sentiment`,
      [agencyId, since.toISOString(), until.toISOString()],
    );
    const byTopic = new Map<string, { topic: string; slug: string; positivo: number; neutral: number; negativo: number }>();
    for (const r of sByTopicRaw.rows) {
      if (!byTopic.has(r.slug)) byTopic.set(r.slug, { topic: r.name, slug: r.slug, positivo: 0, neutral: 0, negativo: 0 });
      byTopic.get(r.slug)![pillFromSentiment(r.sentiment)] += Number(r.c);
    }
    const SENTIMENT_BY_TOPIC = Array.from(byTopic.values())
      .sort((a, b) => (b.positivo + b.neutral + b.negativo) - (a.positivo + a.neutral + a.negativo))
      .slice(0, 8);

    // ---- SENTIMENT_BY_SUBTOPIC (dedup top-confidence; solo menciones con subtopic) ----
    const sBySubtopicRaw = await (pool as ReturnType<typeof getPool>).query<{
      slug: string; name: string; sentiment: string | null; c: number | string;
    }>(
      `SELECT st.slug, st.name, pt.sentiment, COUNT(*)::int AS c
         FROM (
           SELECT m.id AS mention_id,
                  COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
                  (SELECT subtopic_id FROM mention_topics
                     WHERE mention_id = m.id AND subtopic_id IS NOT NULL
                     ORDER BY confidence DESC NULLS LAST, topic_id ASC LIMIT 1) AS subtopic_id
             FROM mentions m
            WHERE m.agency_id = $1
              AND m.is_duplicate = false
              AND m.published_at >= $2
              AND m.published_at <= $3
         ) pt
         JOIN subtopics st ON st.id = pt.subtopic_id
         GROUP BY st.slug, st.name, pt.sentiment`,
      [agencyId, since.toISOString(), until.toISOString()],
    );
    const bySubtopic = new Map<string, { subtopic: string; slug: string; positivo: number; neutral: number; negativo: number }>();
    for (const r of sBySubtopicRaw.rows) {
      if (!bySubtopic.has(r.slug)) bySubtopic.set(r.slug, { subtopic: r.name, slug: r.slug, positivo: 0, neutral: 0, negativo: 0 });
      bySubtopic.get(r.slug)![pillFromSentiment(r.sentiment)] += Number(r.c);
    }
    const SENTIMENT_BY_SUBTOPIC = Array.from(bySubtopic.values())
      .sort((a, b) => (b.positivo + b.neutral + b.negativo) - (a.positivo + a.neutral + a.negativo))
      .slice(0, 8);

    // ---- TOPICS ----
    // TOPICS: top-confidence dedup (cada mención cuenta UNA vez bajo su tópico
    // de mayor confianza) + secondaryCount como dato suplementario. Misma
    // semántica que el correo y /api/overview — el `count` que muestra el
    // dashboard ahora coincide byte-por-byte con el del Overview/correo.
    // El secondaryCount permite al UI comunicar "+N también lo tocan".
    // `pool` ya fue resuelto arriba para loadMetricsForWindow. La query usa
    // bordes [since, until] para respetar tanto el preset (cerrado en AST)
    // como el rango custom del calendario.
    const topicRowsRaw = await (pool as ReturnType<typeof getPool>).query<{
      slug: string;
      name: string;
      primary_count: number | string;
      secondary_count: number | string;
      negative: number | string;
      neutral: number | string;
      positive: number | string;
    }>(
      `WITH primaries AS (
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
                AND m.is_duplicate = false
                AND m.published_at >= $2
                AND m.published_at <= $3
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
            AND m.is_duplicate = false
            AND m.published_at >= $2
            AND m.published_at <= $3
          GROUP BY mt.topic_id
       )
       SELECT p.slug, p.name, p.primary_count, p.negative, p.neutral, p.positive,
              GREATEST(COALESCE(mu.multi_count, 0) - p.primary_count, 0)::int AS secondary_count
         FROM primaries p
         LEFT JOIN multi mu ON mu.topic_id = p.topic_id
        ORDER BY p.primary_count DESC
        LIMIT 12`,
      [agencyId, since.toISOString(), until.toISOString()],
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
        // `delta` se computa más abajo cuando ya cargamos la evolution; puede
        // ser `null` cuando no hay base de comparación (la UI lo renderiza "—").
        delta: null as number | null,
        description: descBySlug.get(r.slug) ?? null,
        evolution: [] as Array<{ date: string; fullDate: string; count: number }>,
      };
    });

    // ---- SUBTOPICS ----
    // Para cada subtopic con menciones en el período, traemos slug,
    // descripción y desglose de sentimiento. La descripción del subtopic
    // (poblada por el script de seed/migración) describe el cluster real
    // de menciones — la UI la muestra como subtítulo en TopicDetail.
    const subtopicRowsRaw = await (pool as ReturnType<typeof getPool>).query<{
      topic_slug: string;
      sub_slug: string;
      sub_name: string;
      sub_description: string | null;
      c: number | string;
      pos: number | string;
      neg: number | string;
      neu: number | string;
    }>(
      `SELECT t.slug AS topic_slug,
              s.slug AS sub_slug,
              s.name AS sub_name,
              s.description AS sub_description,
              COUNT(*)::int AS c,
              COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('positivo','positive'))::int AS pos,
              COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative'))::int AS neg,
              COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) NOT IN ('positivo','positive','negativo','negative') OR COALESCE(m.nlp_sentiment, m.bw_sentiment) IS NULL)::int AS neu
         FROM mention_topics mt
         JOIN subtopics s ON s.id = mt.subtopic_id
         JOIN topics t ON t.id = mt.topic_id
         JOIN mentions m ON m.id = mt.mention_id
        WHERE m.agency_id = $1
          AND m.is_duplicate = false
          AND m.published_at >= $2
          AND m.published_at <= $3
        GROUP BY t.slug, s.slug, s.name, s.description`,
      [agencyId, since.toISOString(), until.toISOString()],
    );

    const SUBTOPICS: Record<string, Array<{
      slug: string;
      name: string;
      description: string | null;
      count: number;
      positive: number;
      neutral: number;
      negative: number;
      positivePct: number;
      negativePct: number;
      neutralPct: number;
      dominantSentiment: 'positivo' | 'negativo' | 'mixed';
    }>> = {};
    for (const r of subtopicRowsRaw.rows) {
      const c = Number(r.c);
      const pos = Number(r.pos);
      const neg = Number(r.neg);
      const neu = Number(r.neu);
      const total = c || 1;
      const positivePct = Math.round((pos / total) * 100);
      const negativePct = Math.round((neg / total) * 100);
      const neutralPct = Math.max(0, 100 - positivePct - negativePct);
      let dominant: 'positivo' | 'negativo' | 'mixed' = 'mixed';
      if (positivePct > negativePct + 8) dominant = 'positivo';
      else if (negativePct > positivePct + 8) dominant = 'negativo';
      if (!SUBTOPICS[r.topic_slug]) SUBTOPICS[r.topic_slug] = [];
      SUBTOPICS[r.topic_slug].push({
        slug: r.sub_slug,
        name: r.sub_name,
        description: r.sub_description ?? null,
        count: c,
        positive: pos,
        neutral: neu,
        negative: neg,
        positivePct, negativePct, neutralPct,
        dominantSentiment: dominant,
      });
    }
    for (const k of Object.keys(SUBTOPICS)) {
      SUBTOPICS[k].sort((a, b) => b.count - a.count);
    }

    // ---- TOPIC EVOLUTION (per-topic daily series) ----
    // Servimos el conteo real diario por tópico en zona AST. La ventana se
    // expande a max(35, 2 * days) para que el cálculo de `delta` (segunda
    // mitad vs primera mitad) tenga datos suficientes incluso con periods
    // largos (1A, Max). La ventana ahora está anclada a AST cerrada (mismo
    // borde superior que el resto de queries), no a NOW() — antes podía
    // incluir mentions del día parcial actual y dejar el delta inestable.
    const evolutionDays = Math.max(35, 2 * days);
    const evolutionStartYmd = addDaysYmd(endYmd, -(evolutionDays - 1));
    const topicEvolutionRows = await db.execute<{ slug: string; day: string; c: number | string }>(sql`
      SELECT t.slug AS slug,
             (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date::text AS day,
             COUNT(*) AS c
        FROM mentions m
        JOIN mention_topics mt ON mt.mention_id = m.id
        JOIN topics t ON t.id = mt.topic_id
       WHERE m.agency_id = ${agencyId}
         AND m.is_duplicate = false
         AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date >= ${evolutionStartYmd}::date
         AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date <= ${endYmd}::date
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

    // Cálculo de `delta`: comparamos los últimos `halfWindow` días contra los
    // `halfWindow` anteriores DENTRO de la evolución del tópico. Devolvemos
    // `null` cuando no hay base de comparación (period anterior vacío) o
    // cuando el tópico no tuvo actividad en ninguna mitad — eso evita el
    // mensaje confuso "↓ 0%" cuando lo correcto es "sin dato comparable".
    const halfWindow = Math.max(3, Math.floor(days / 2));
    for (const t of TOPICS) {
      const evo = evolutionByTopic.get(t.slug) ?? [];
      t.evolution = evo;
      const recent = evo.slice(-halfWindow).reduce((s, e) => s + e.count, 0);
      const previous = evo.slice(-2 * halfWindow, -halfWindow).reduce((s, e) => s + e.count, 0);
      if (previous === 0) {
        // Sin base de comparación: distinguimos "tópico no existía" (recent=0) de
        // "tópico apareció en este periodo" (recent>0). En ambos casos el delta
        // porcentual no es informativo — devolvemos null y la UI renderiza "—".
        t.delta = null;
      } else {
        t.delta = Math.round(((recent - previous) / previous) * 100);
      }
    }

    // ---- TOPIC CALENDAR (per-day dominant topic, ventana AST cerrada) ----
    // El "Calendario de tópico principal por día" antes usaba una rotación
    // determinística falsa (índice * 7 + ruido). Ahora calculamos el top-1
    // tópico por día con su sentimiento dominante en datos reales. La
    // ventana se ajusta al periodo seleccionado del usuario: mínimo 35 días
    // (para que el calendario nunca quede chiquito) y máximo 365 (1 año)
    // — periodos largos como "1A" o "Max" muestran 365 días con marcadores
    // de cambio de mes en el frontend.
    const calendarDays = Math.max(35, Math.min(days, 365));
    const calendarStartYmd = addDaysYmd(endYmd, -(calendarDays - 1));
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
           AND m.is_duplicate = false
           AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date >= ${calendarStartYmd}::date
           AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date <= ${endYmd}::date
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
      // Excluye 'baja' pertinencia igual que el feed del scorecard y el modal
      // (eco-mentions, default). Así el conteo del dot del mapa coincide con el
      // total que muestra el modal de cada municipio/región al hacer click.
      .where(and(baseWhere, sql`(${mentions.nlpPertinence} IS NULL OR ${mentions.nlpPertinence} <> 'baja')`))
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

    // ---- SENTIMENT_BY_REGION ----
    // Agrupar los muniRows ya recolectados por la columna `region`. Reutiliza
    // el aggregator existente — no requiere un round-trip extra a la DB.
    const byRegion = new Map<string, { region: string; positivo: number; neutral: number; negativo: number }>();
    for (const r of muniRows) {
      const region = (r.region || '').trim() || 'Sin región';
      if (!byRegion.has(region)) byRegion.set(region, { region, positivo: 0, neutral: 0, negativo: 0 });
      byRegion.get(region)![pillFromSentiment(r.s)] += Number(r.c);
    }
    const SENTIMENT_BY_REGION = Array.from(byRegion.values())
      .sort((a, b) => (b.positivo + b.neutral + b.negativo) - (a.positivo + a.neutral + a.negativo))
      .slice(0, 8);

    // ---- EMOTIONS (aggregated in SQL, no memory-heavy rows in Node) ----
    // since/until ya están computados desde la ventana cerrada (preset) o
    // desde customRange — cubren ambos casos sin necesidad de branch.
    const emotionAgg = await db.execute<{ emotion: string; c: number | string }>(sql`
      SELECT lower(trim(e.value::text, '"')) AS emotion, COUNT(*) AS c
      FROM mentions m, jsonb_array_elements(COALESCE(m.nlp_emotions, '[]'::jsonb)) AS e
      WHERE m.agency_id = ${agencyId}
        AND m.is_duplicate = false
        AND m.published_at >= ${since.toISOString()}
        AND m.published_at <= ${until.toISOString()}
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
    // Issue #2 + #9: el feed del scorecard excluye Twitter (su contenido suele
    // venir vacío y deja filas en blanco) y menciones de baja pertinencia
    // (ruido). La pantalla `/mentions` mantiene el comportamiento histórico
    // (todos los sources / pertinencias) — solo el feed del scorecard filtra.
    const TWITTER_PAGE_TYPES = ['twitter', 'x', 'xcom'];
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
      .where(and(
        baseWhere,
        sql`COALESCE(${mentions.pageType}, '') NOT IN ('twitter','x','xcom')`,
        sql`COALESCE(${mentions.nlpPertinence}, 'media') <> 'baja'`,
      ))
      .orderBy(desc(mentions.publishedAt))
      .limit(50);
    // (TWITTER_PAGE_TYPES queda como referencia documental; el filtro SQL es
    // el que cuenta.)
    void TWITTER_PAGE_TYPES;

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

    // ---- BRIEFING (3 modos: signal / emerging / crisis) ----
    // Fuente primaria: tabla agency_briefings poblada por eco-ai-tasks cada
    // 6 horas. Ahora cada corrida produce 3 filas, una por modo. Si algún
    // modo no tiene fila fresca (<12h), cae a un resumen rule-based.
    // El frontend lee `D.BRIEFING[focus].narrativeHtml` según el chip activo.
    const dominantTopic = TOPICS[0];
    const BRIEFING_TTL_MS = 12 * 60 * 60 * 1000;
    const liveNss = winCur.nss ?? 0;
    const liveReach = winCur.totalReach;

    // Trae el briefing más reciente por (agencia, mode). DISTINCT ON evita
    // un GROUP BY agg awkward y respeta el orden por generated_at DESC.
    const briefingsRows = await db.execute<{
      mode: string;
      generated_at: Date | string;
      narrative_html: string;
      dominant_signal: string;
      action_label: string;
      action_tone: string;
      reach_label: string | null;
      fallback: boolean;
    }>(sql`
      SELECT DISTINCT ON (mode)
             mode, generated_at, narrative_html, dominant_signal,
             action_label, action_tone, reach_label, fallback
        FROM agency_briefings
       WHERE agency_id = ${agencyId}
       ORDER BY mode, generated_at DESC
    `);
    const briefingList: Array<{
      mode: string;
      generated_at: Date | string;
      narrative_html: string;
      dominant_signal: string;
      action_label: string;
      action_tone: string;
      reach_label: string | null;
      fallback: boolean;
    }> = Array.isArray(briefingsRows)
      ? (briefingsRows as unknown as Array<{
          mode: string; generated_at: Date | string; narrative_html: string;
          dominant_signal: string; action_label: string; action_tone: string;
          reach_label: string | null; fallback: boolean;
        }>)
      : (((briefingsRows as unknown as { rows?: Array<{
          mode: string; generated_at: Date | string; narrative_html: string;
          dominant_signal: string; action_label: string; action_tone: string;
          reach_label: string | null; fallback: boolean;
        }> }).rows) ?? []);

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

    function formatReachLabel(reach: number): string {
      if (reach >= 1_000_000) return (reach / 1_000_000).toFixed(2) + 'M impresiones';
      if (reach >= 1000) return Math.round(reach / 1000) + 'K impresiones';
      return String(reach) + ' impresiones';
    }

    function buildRuleBriefingForMode(mode: 'signal' | 'emerging' | 'crisis'): BriefingShape | null {
      if (!dominantTopic) return null;
      const dominantTone = dominantTopic.dominantSentiment === 'positivo' ? 'Positiva'
        : dominantTopic.dominantSentiment === 'negativo' ? 'Negativa'
        : 'Mixta';
      const tone = liveNss > 5 ? 'pos' : liveNss < -5 ? 'neg' : 'warn';

      let narrativeHtml: string;
      let dominantSignal: string;
      let action: string;
      let actionTone: 'pos' | 'neg' | 'warn' | 'neu' = tone;

      if (mode === 'emerging') {
        // El delta de un tópico puede ser null (sin base de comparación). Esos
        // los tratamos como -Infinity para que nunca ganen el sort de mayor a
        // menor crecimiento — solo nos interesa el tópico con mayor delta real.
        const deltaOrSentinel = (t: { delta: number | null }) => t.delta ?? -Infinity;
        const emerging = [...TOPICS].sort((a, b) => deltaOrSentinel(b) - deltaOrSentinel(a))[0];
        if (emerging && emerging.delta != null && emerging.delta > 15) {
          narrativeHtml = `<strong>${emerging.name}</strong> crece <strong>+${emerging.delta}%</strong> en la segunda mitad del periodo (${emerging.count.toLocaleString('es-PR')} menciones, ${emerging.negativePct}% negativo).`;
          dominantSignal = `${emerging.name} · +${emerging.delta}%`;
          action = `Seguir ${emerging.name} →`;
          actionTone = emerging.dominantSentiment === 'positivo' ? 'pos' : emerging.dominantSentiment === 'negativo' ? 'neg' : 'warn';
        } else {
          narrativeHtml = `Sin narrativas emergentes claras en el periodo. Tópico más activo: <strong>${dominantTopic.name}</strong> (${dominantTopic.count.toLocaleString('es-PR')} menciones).`;
          dominantSignal = 'Sin narrativas emergentes · Estable';
          action = 'Explorar tópicos activos →';
          actionTone = 'neu';
        }
      } else if (mode === 'crisis') {
        const crisis = winCur.crisisRiskScore ?? 0;
        const band = crisis >= 0.60 ? 'CRISIS' : crisis >= 0.40 ? 'ALERTA' : crisis >= 0.25 ? 'ELEVADO' : 'NORMAL';
        if (band === 'NORMAL') {
          narrativeHtml = `Sin señales de crisis en el periodo. Negativas: <strong>${winCur.totals.negative.toLocaleString('es-PR')}</strong> de ${winCur.totals.total.toLocaleString('es-PR')}.`;
          dominantSignal = 'NORMAL · Sin tópico crítico';
          action = 'Ver menciones negativas →';
          actionTone = 'neu';
        } else {
          narrativeHtml = `Banda actual <strong>${band}</strong> con concentración en <strong>${dominantTopic.name}</strong> (${dominantTopic.negativePct}% negativo). Crisis Risk: <strong>${crisis.toFixed(2)}</strong>.`;
          dominantSignal = `${band} · ${dominantTopic.name}`;
          action = `Revisar ${dominantTopic.name} →`;
          actionTone = band === 'ELEVADO' ? 'warn' : 'neg';
        }
      } else {
        const verb = tone === 'pos' ? 'mejora' : tone === 'neg' ? 'deteriora' : 'se mantiene estable';
        narrativeHtml = `La percepción pública se <strong>${verb}</strong> en torno a <strong>${dominantTopic.name}</strong> (${dominantTopic.count.toLocaleString('es-PR')} menciones, ${dominantTopic.negativePct}% negativo).`;
        dominantSignal = `${dominantTopic.name} · ${dominantTone}`;
        action = `Seguir ${dominantTopic.name} →`;
      }

      return {
        eyebrow: new Date().toLocaleDateString('es-PR', { day: 'numeric', month: 'short', year: 'numeric' }),
        narrativeHtml,
        dominantSignal,
        action,
        actionTone,
        reachLabel: formatReachLabel(liveReach),
        source: 'rule',
        generatedAtIso: null,
        generatedAtLabel: null,
      };
    }

    function toShape(row: typeof briefingList[number]): BriefingShape {
      const generatedAt = new Date(row.generated_at);
      return {
        eyebrow: generatedAt.toLocaleDateString('es-PR', { day: 'numeric', month: 'short', year: 'numeric' }),
        narrativeHtml: row.narrative_html,
        dominantSignal: row.dominant_signal,
        action: row.action_label,
        actionTone: row.action_tone,
        reachLabel: row.reach_label ?? null,
        source: row.fallback ? 'rule' : 'ai',
        generatedAtIso: generatedAt.toISOString(),
        generatedAtLabel: relativeTime(generatedAt),
      };
    }

    const briefingByMode = new Map<string, typeof briefingList[number]>();
    for (const row of briefingList) briefingByMode.set(row.mode, row);

    function resolveMode(mode: 'signal' | 'emerging' | 'crisis'): BriefingShape | null {
      const row = briefingByMode.get(mode);
      if (row) {
        const generated = new Date(row.generated_at);
        const fresh = Date.now() - generated.getTime() < BRIEFING_TTL_MS;
        if (fresh) return toShape(row);
      }
      return buildRuleBriefingForMode(mode);
    }

    const BRIEFING = {
      signal: resolveMode('signal'),
      emerging: resolveMode('emerging'),
      crisis: resolveMode('crisis'),
    };

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
      SENTIMENT_BY_TOPIC: SENTIMENT_BY_TOPIC.length > 0 ? SENTIMENT_BY_TOPIC : null,
      SENTIMENT_BY_SUBTOPIC: SENTIMENT_BY_SUBTOPIC.length > 0 ? SENTIMENT_BY_SUBTOPIC : null,
      SENTIMENT_BY_REGION: SENTIMENT_BY_REGION.length > 0 ? SENTIMENT_BY_REGION : null,
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
