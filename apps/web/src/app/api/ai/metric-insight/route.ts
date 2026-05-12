/**
 * GET /api/ai/metric-insight
 *
 * Devuelve la serie temporal de una métrica para la ventana del period
 * solicitada + una interpretación AI generada con Claude (Bedrock).
 *
 * Query params:
 *   metric=nss|crisis|volume|bhi|polarization  (requerido)
 *   period=1D|5D|7D|1M|3M|6M|1A                (default 7D)
 *   agency=<slug>                              (resuelve via resolveAgencyId)
 *
 * Respuesta:
 *   {
 *     metric, label, value, band, deltaVsPrev,
 *     series: [{ date, fullDate, value }],
 *     interpretation: "<html con <strong> permitido>"
 *   }
 *
 * Las invocaciones se cachean en memoria (LRU TTL 30min) por
 * `(agency, metric, period)` para evitar burnear tokens si el usuario abre
 * varias veces el mismo modal.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, dailyMetricSnapshots } from '@eco/database';
import { sql, and, eq, gte, lte, desc } from 'drizzle-orm';
import {
  closedWindowYmdInTZ,
  loadMetricsForWindow,
  METRIC_INSIGHT_SYSTEM_PROMPT,
  buildMetricInsightPrompt,
  type MetricKey,
  type MetricBand,
  type MetricInsightInput,
  type MetricInsightOutput,
  type PgClientLike,
} from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { log } from '@/lib/log';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const TZ = 'America/Puerto_Rico';

const PERIOD_DAYS: Record<string, number> = {
  '1D': 1, '5D': 5, '7D': 7, '1M': 30, '3M': 90, '6M': 180, '1A': 365,
};

// In-memory LRU cache (TTL 30 min). Reset al reiniciar el contenedor — basta
// para evitar regeneraciones cuando el usuario abre el mismo modal varias
// veces dentro de la sesión.
interface CacheEntry { value: unknown; expiresAt: number }
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 50;
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): unknown | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { cache.delete(key); return null; }
  // LRU touch
  cache.delete(key); cache.set(key, e);
  return e.value;
}
function cacheSet(key: string, value: unknown): void {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

const METRIC_LABELS: Record<MetricKey, string> = {
  nss: 'Net Sentiment Score',
  crisis: 'Riesgo de crisis',
  volume: 'Volumen de menciones',
  bhi: 'Brand Health Index',
  polarization: 'Polarización',
};

function bandFor(metric: MetricKey, value: number): MetricBand {
  if (metric === 'nss') {
    if (value >= 20) return 'POSITIVO';
    if (value > 5) return 'POSITIVO';
    if (value >= -5) return 'NEUTRAL';
    return 'NEGATIVO';
  }
  if (metric === 'crisis') {
    if (value >= 0.60) return 'CRISIS';
    if (value >= 0.40) return 'ALERTA';
    if (value >= 0.25) return 'ELEVADO';
    return 'NORMAL';
  }
  if (metric === 'volume') {
    // Volumen no tiene banda intrínseca; PROMEDIO es la default y la API
    // contextualiza con P25/P75 al modelo de IA.
    return 'PROMEDIO';
  }
  if (metric === 'bhi') {
    if (value >= 0.80) return 'FUERTE';
    if (value >= 0.60) return 'SANO';
    if (value >= 0.40) return 'DÉBIL';
    return 'CRÍTICO';
  }
  if (metric === 'polarization') {
    if (value >= 75) return 'EXTREMA';
    if (value >= 50) return 'ALTA';
    if (value >= 30) return 'MODERADA';
    return 'APÁTICA';
  }
  return 'NORMAL';
}

/** Extrae el valor de una métrica del bundle que devuelve loadMetricsForWindow. */
function metricValueFrom(metric: MetricKey, win: Awaited<ReturnType<typeof loadMetricsForWindow>>): number | null {
  switch (metric) {
    case 'nss': return win.nss;
    case 'crisis': return win.crisisRiskScore;
    case 'volume': return win.totals.total;
    case 'bhi': return win.brandHealthIndex;
    case 'polarization': return win.polarizationIndex;
  }
}

/** Mapea la métrica a la columna del snapshot diario para la serie temporal. */
function snapshotColumn(metric: MetricKey): keyof typeof dailyMetricSnapshots {
  switch (metric) {
    case 'nss': return 'nss';
    case 'crisis': return 'crisisRiskScore';
    case 'volume': return 'totalMentions';
    case 'bhi': return 'brandHealthIndex';
    case 'polarization': return 'polarizationIndex';
  }
}

const TZ_FMT = new Intl.DateTimeFormat('es-PR', { month: 'short', day: 'numeric', timeZone: TZ });
function esShortDate(ymd: string): string {
  // Anclamos a mediodía UTC para que la fecha en TZ AST no salte al día anterior.
  const d = new Date(`${ymd}T12:00:00Z`);
  return TZ_FMT.format(d);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rl = consume('metric-insight:' + clientKey(request), { limit: 20, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } },
    );
  }

  const t0 = Date.now();
  const { searchParams } = new URL(request.url);
  const metric = (searchParams.get('metric') ?? '') as MetricKey;
  const periodKey = searchParams.get('period') ?? '7D';
  const days = PERIOD_DAYS[periodKey];

  if (!metric || !METRIC_LABELS[metric]) {
    return NextResponse.json({ error: `Unsupported metric: ${metric}` }, { status: 400 });
  }
  if (!days) {
    return NextResponse.json({ error: `Unsupported period: ${periodKey}` }, { status: 400 });
  }

  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ error: 'No agency resolved' }, { status: 404 });
  }

  const cacheKey = `${agencyId}::${metric}::${periodKey}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    const { startYmd, endYmd, prevStartYmd, prevEndYmd } = closedWindowYmdInTZ(days, new Date(), TZ);
    const pool = getPool() as unknown as PgClientLike;

    // Métricas actuales y previas en la misma ventana — para deltaVsPrev.
    const [winCur, winPrev] = await Promise.all([
      loadMetricsForWindow(pool, agencyId, startYmd, endYmd),
      loadMetricsForWindow(pool, agencyId, prevStartYmd, prevEndYmd),
    ]);

    const value = metricValueFrom(metric, winCur);
    const prevValue = metricValueFrom(metric, winPrev);
    const deltaVsPrev = value != null && prevValue != null
      ? Math.round((value - prevValue) * 100) / 100
      : null;
    const band = bandFor(metric, value ?? 0);

    // Serie temporal de la métrica desde daily_metric_snapshots para la ventana actual.
    const db = getDb();
    const col = snapshotColumn(metric);
    const snaps = await db
      .select()
      .from(dailyMetricSnapshots)
      .where(and(
        eq(dailyMetricSnapshots.agencyId, agencyId),
        gte(dailyMetricSnapshots.date, startYmd),
        lte(dailyMetricSnapshots.date, endYmd),
      ))
      .orderBy(dailyMetricSnapshots.date);

    const series = snaps.map((s) => {
      const dateStr = typeof s.date === 'string' ? s.date : (s.date as Date).toISOString().slice(0, 10);
      const raw = (s as Record<string, unknown>)[col as string];
      return {
        date: esShortDate(dateStr),
        fullDate: dateStr,
        value: raw == null ? null : Number(raw),
      };
    });

    // P25/P75 histórico (90d previos al fin de ventana).
    const p25p75 = await pool.query<{ p25: number | string | null; p75: number | string | null }>(
      `SELECT
         percentile_cont(0.25) WITHIN GROUP (ORDER BY ${col === 'crisisRiskScore' ? 'crisis_risk_score'
                                                : col === 'brandHealthIndex' ? 'brand_health_index'
                                                : col === 'polarizationIndex' ? 'polarization_index'
                                                : col === 'totalMentions' ? 'total_mentions'
                                                : 'nss'}) AS p25,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY ${col === 'crisisRiskScore' ? 'crisis_risk_score'
                                                : col === 'brandHealthIndex' ? 'brand_health_index'
                                                : col === 'polarizationIndex' ? 'polarization_index'
                                                : col === 'totalMentions' ? 'total_mentions'
                                                : 'nss'}) AS p75
         FROM daily_metric_snapshots
        WHERE agency_id = $1
          AND date BETWEEN ($2::date - INTERVAL '90 days') AND $2::date`,
      [agencyId, startYmd],
    );
    const p25 = p25p75.rows[0]?.p25 != null ? Number(p25p75.rows[0].p25) : null;
    const p75 = p25p75.rows[0]?.p75 != null ? Number(p25p75.rows[0].p75) : null;

    // Top tópicos que más contribuyen a la métrica (top 3).
    // Volumen → más menciones; crisis → mayor share negativo; otros → más
    // menciones positivas o negativas según el caso.
    const orderBy = metric === 'crisis'
      ? `(COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative')))::float / NULLIF(COUNT(*), 0) DESC`
      : `COUNT(*) DESC`;
    const topicsRes = await pool.query<{ name: string; total: number | string }>(
      `SELECT t.name AS name, COUNT(*)::int AS total
         FROM mentions m
         JOIN mention_topics mt ON mt.mention_id = m.id
         JOIN topics t ON t.id = mt.topic_id
        WHERE m.agency_id = $1
          AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date >= $2::date
          AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date <= $3::date
        GROUP BY t.name
        HAVING COUNT(*) >= 3
        ORDER BY ${orderBy}
        LIMIT 3`,
      [agencyId, startYmd, endYmd],
    );
    const totalForShare = winCur.totals.total || 1;
    const topContributingTopics = topicsRes.rows.map((r) => ({
      name: r.name,
      share: Number(r.total) / totalForShare,
    }));

    // Invocar Claude para la interpretación. Si falla, devolvemos una
    // interpretación rule-based (no rompemos la UI).
    const insightInput: MetricInsightInput = {
      metric,
      metricLabel: METRIC_LABELS[metric],
      currentValue: value ?? 0,
      band,
      windowDays: days,
      deltaVsPrev,
      historicalP25: p25,
      historicalP75: p75,
      topContributingTopics,
      topMunicipality: null,
    };

    let interpretation: string;
    try {
      interpretation = await generateInterpretation(insightInput);
    } catch (err) {
      log.warn('metric-insight', 'AI call failed, using rule-based', { msg: (err as Error).message });
      interpretation = buildRuleBasedInsight(insightInput);
    }

    const payload = {
      metric,
      label: METRIC_LABELS[metric],
      value,
      band,
      deltaVsPrev,
      windowDays: days,
      periodStart: startYmd,
      periodEnd: endYmd,
      series,
      historicalP25: p25,
      historicalP75: p75,
      topContributingTopics,
      interpretation,
    };

    cacheSet(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (err) {
    log.error('metric-insight', 'handler failed', { msg: (err as Error).message });
    return NextResponse.json({ error: 'metric-insight error', message: (err as Error).message }, { status: 500 });
  } finally {
    log.info('metric-insight', 'request complete', { latencyMs: Date.now() - t0, metric, period: periodKey });
  }
}

/**
 * Invoca Claude vía Bedrock. El SDK se carga dinámicamente para que el
 * bundler de Next.js no lo arrastre al build de páginas — sigue el mismo
 * patrón que `packages/shared/src/bedrock.ts`.
 */
async function generateInterpretation(input: MetricInsightInput): Promise<string> {
  const { getBedrockClient } = await import('@/lib/bedrock-client');
  const { invokeClaude } = await import('@eco/shared/src/bedrock');

  const text = await invokeClaude({
    client: getBedrockClient(),
    systemPrompt: METRIC_INSIGHT_SYSTEM_PROMPT,
    userPrompt: buildMetricInsightPrompt(input),
    maxTokens: 400,
    temperature: 0,
  });
  const parsed = JSON.parse(text) as MetricInsightOutput;
  const raw = (parsed?.interpretation ?? '').trim();
  // Sanitize: permite solo <strong>.
  return raw.replace(/<(?!\/?strong\b)[^>]*>/gi, '').slice(0, 1200);
}

/**
 * Interpretación de reglas para cuando Bedrock no está disponible. Texto
 * neutral y descriptivo, sin recomendaciones — mismo tono que el AI.
 */
function buildRuleBasedInsight(i: MetricInsightInput): string {
  const v = i.currentValue;
  const deltaSign = (i.deltaVsPrev ?? 0) > 0 ? 'subió' : (i.deltaVsPrev ?? 0) < 0 ? 'bajó' : 'se mantuvo';
  const deltaAbs = i.deltaVsPrev != null ? Math.abs(i.deltaVsPrev) : null;
  const deltaStr = deltaAbs != null ? `${deltaSign} <strong>${deltaAbs}</strong>` : 'no presenta cambio medible';
  const windowStr = `últimos ${i.windowDays} día${i.windowDays === 1 ? '' : 's'}`;
  if (i.metric === 'nss') {
    return `El sentimiento neto está en <strong>${v}</strong> (${i.band.toLowerCase()}) en los ${windowStr}, y ${deltaStr} puntos vs. la ventana anterior.`;
  }
  if (i.metric === 'crisis') {
    return `El riesgo de crisis está en <strong>${v}</strong>, banda <strong>${i.band}</strong>, en los ${windowStr}. ${deltaStr === 'no presenta cambio medible' ? 'Sin variación notable.' : `${deltaStr} puntos vs. la ventana anterior.`}`;
  }
  if (i.metric === 'volume') {
    return `Se registraron <strong>${v.toLocaleString('es-PR')}</strong> menciones en los ${windowStr}. ${deltaStr === 'no presenta cambio medible' ? 'Volumen estable vs. la ventana anterior.' : `Volumen ${deltaStr}% vs. la ventana anterior.`}`;
  }
  if (i.metric === 'bhi') {
    return `El Brand Health Index está en <strong>${v}</strong> (${i.band.toLowerCase()}) en los ${windowStr}. ${deltaStr === 'no presenta cambio medible' ? 'Sin movimiento medible.' : `${deltaStr} puntos vs. la ventana anterior.`}`;
  }
  return `La polarización está en <strong>${v}%</strong> (${i.band.toLowerCase()}) en los ${windowStr}. ${deltaStr === 'no presenta cambio medible' ? 'Sin variación medible.' : `${deltaStr} puntos vs. la ventana anterior.`}`;
}
