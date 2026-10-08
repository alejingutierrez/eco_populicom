import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
import {
  buildSentimentReport,
  resolveWindow,
  PERIOD_DAYS,
  formatPeriodLabel,
  loadMetricsForWindow,
  loadHourlySentimentSeries,
  loadDailySentimentSeries,
  formatMetric,
  formatDelta,
} from '@eco/shared';
import type { PgClientLike, SentimentReport, MetricDisplay, DeltaDisplay, HourlyPoint, DailyPoint } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { log } from '@/lib/log';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const TZ = 'America/Puerto_Rico';

// Ventana: resolveWindow de @eco/shared — período cerrado terminando AYER en
// TZ Puerto Rico (misma semántica que el correo eco-weekly-report) o rango
// custom from/to en días AST inclusivos. El mapa de períodos válidos es el
// PERIOD_DAYS canónico del paquete compartido.

/** Siglas de la cabecera — las mismas que imprime el correo (agencyShortName). */
const SHORT_NAMES: Record<string, string> = { aaa: 'AAA', ddecpr: 'DDEC' };

/**
 * Tendencia con la ventana previa al lado (bloque 04, como el «Ritmo diario»
 * del correo): solo hasta 14 días. Con 30/90 días serían 60/180 barras y la
 * comparación deja de leerse.
 */
const PREV_SERIES_MAX_DAYS = 14;

interface OverviewResponse {
  /** Cabecera con la forma del correo: "DDEC · Departamento de …". */
  agency: { slug: string; name: string; shortName: string } | null;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  prevPeriodStart: string;
  prevPeriodEnd: string;
  totals: SentimentReport['totals'];
  deltaVsPrev: SentimentReport['deltaVsPrev'];
  dailySeries: SentimentReport['dailySeries'];
  /**
   * Serie diaria de la ventana previa, mismo universo que dailySeries. null
   * cuando la ventana pasa de PREV_SERIES_MAX_DAYS días o es de un solo día.
   */
  prevDailySeries: DailyPoint[] | null;
  /**
   * Riesgo de crisis del bloque 02. `window`/`prevWindow` son la métrica de la
   * VENTANA (la misma del correo: loadMetricsForWindow); `daily` es el
   * snapshot de cada día (cinta bajo la tendencia, pico y cierre).
   */
  crisis: {
    window: number | null;
    prevWindow: number | null;
    daily: Array<{ date: string; score: number }>;
    peak: { date: string; score: number } | null;
    last: { date: string; score: number } | null;
  };
  /**
   * Granularidad de la tendencia. 'hour' cuando la ventana es de UN día
   * (chip 1D o custom de un solo día): a nivel diario ese caso rendía un
   * único punto sin forma. 'day' en todo lo demás.
   */
  trendGranularity: 'hour' | 'day';
  /** Poblada solo cuando trendGranularity === 'hour'. */
  hourlySeries: HourlyPoint[] | null;
  topicsTable: SentimentReport['topicsTable'];
  /**
   * Estado actual de las métricas compuestas (NSS, BHI, crisis, etc) — leído
   * del último snapshot dentro de la ventana. Volumen y reach son sumas
   * sobre la ventana (no del último snapshot).
   */
  currentMetrics: {
    nss: number | null;
    nss7d: number | null;
    nss30d: number | null;
    crisisRiskScore: number | null;
    brandHealthIndex: number | null;
    engagementRate: number | null;
    totalMentions: number;
    totalReach: number;
    totalMentionsDelta: number;
    /** Formato legible (palabra + número de apoyo). Single source: @eco/shared/format. */
    display: {
      nss: MetricDisplay;
      crisis: MetricDisplay;
      brandHealth: MetricDisplay;
    };
    /** Tendencia del volumen vs período anterior (palabra + distingue sin-base). */
    totalMentionsDeltaDisplay: DeltaDisplay;
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rl = consume('overview:' + clientKey(request), { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } },
    );
  }

  const start = Date.now();
  const { searchParams } = new URL(request.url);
  const periodKey = searchParams.get('period') ?? '7D';
  const window = resolveWindow({
    period: periodKey,
    from: searchParams.get('from'),
    to: searchParams.get('to'),
    timeZone: TZ,
  });
  if (!window) {
    return NextResponse.json(
      { error: `Unsupported period: ${periodKey}. Valid: ${Object.keys(PERIOD_DAYS).join(', ')}, or pass from/to.` },
      { status: 400 },
    );
  }

  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ error: 'No agency resolved' }, { status: 404 });
  }

  try {
    const { startYmd, endYmd, prevStartYmd, prevEndYmd } = window;

    // pg.Pool implementa PgClientLike (mismo shape que pg.Client del lambda).
    const pool = getPool() as unknown as PgClientLike;

    // Agregados base — misma fuente que el correo.
    const report = await buildSentimentReport(
      pool, agencyId, startYmd, endYmd, prevStartYmd, prevEndYmd,
    );

    // Métricas compuestas — recalculadas sobre la VENTANA del period (no
    // sólo el snapshot del último día). Paridad con /api/eco-data del
    // Scorecard, ambos usan el mismo loadMetricsForWindow del paquete
    // `@eco/shared/metrics`. Antes el Overview leía sólo el snapshot más
    // reciente, lo que producía valores idénticos para todos los periods
    // (Crisis ayer = 0.185 para 1D/7D/1M/3M/6M/1A) — inconsistencia visible
    // contra el Scorecard que sí recalculaba (0.588 para 7D).
    const singleDayWindow = startYmd === endYmd;
    const windowDays = report.dailySeries.length;
    const [winCur, winPrev, prevDailySeries, crisisDaily, agencyRow] = await Promise.all([
      loadMetricsForWindow(pool, agencyId, startYmd, endYmd),
      loadMetricsForWindow(pool, agencyId, prevStartYmd, prevEndYmd),
      !singleDayWindow && windowDays <= PREV_SERIES_MAX_DAYS
        ? loadDailySentimentSeries(pool, agencyId, prevStartYmd, prevEndYmd)
        : Promise.resolve(null),
      pool.query<{ d: string; score: number | string | null }>(
        `SELECT to_char(date, 'YYYY-MM-DD') AS d, crisis_risk_score AS score
           FROM daily_metric_snapshots
          WHERE agency_id = $1 AND date BETWEEN $2::date AND $3::date
            AND crisis_risk_score IS NOT NULL
          ORDER BY date`,
        [agencyId, startYmd, endYmd],
      ),
      pool.query<{ slug: string; name: string }>(`SELECT slug, name FROM agencies WHERE id = $1 LIMIT 1`, [agencyId]),
    ]);
    const daily = crisisDaily.rows.map((r) => ({ date: r.d, score: Number(r.score) }));
    const peak = daily.reduce<{ date: string; score: number } | null>((best, p) => (!best || p.score > best.score ? p : best), null);
    const ag = agencyRow.rows[0];

    // Tendencia por HORA cuando la ventana es de un solo día. Mismo universo
    // y mismos bordes AST que la serie diaria, así que la suma de las 24
    // horas cuadra con el total del termómetro.
    const singleDay = singleDayWindow;
    const hourlySeries = singleDay
      ? await loadHourlySentimentSeries(pool, agencyId, startYmd, endYmd)
      : null;

    // Volumen y su delta salen del MISMO report que el hero/termómetro/tabla
    // (universo pertinente) — antes venían de loadMetricsForWindow (universo
    // completo) y el payload traía DOS totales distintos (auditoría 2026-08,
    // P0-16). Las métricas compuestas (NSS/crisis/BHI) salen de
    // loadMetricsForWindow, que desde V5 (oct-2026) usa ese mismo universo.
    const totalMentionsDelta = report.prevTotals.total > 0
      ? Number((((report.totals.total - report.prevTotals.total) / report.prevTotals.total) * 100).toFixed(1))
      : (report.totals.total > 0 ? 100 : 0);

    const response: OverviewResponse = {
      agency: ag ? { slug: ag.slug, name: ag.name, shortName: SHORT_NAMES[ag.slug] ?? ag.slug.toUpperCase() } : null,
      periodLabel: formatPeriodLabel(startYmd, endYmd),
      periodStart: startYmd,
      periodEnd: endYmd,
      prevPeriodStart: prevStartYmd,
      prevPeriodEnd: prevEndYmd,
      totals: report.totals,
      deltaVsPrev: report.deltaVsPrev,
      dailySeries: report.dailySeries,
      prevDailySeries,
      crisis: {
        window: winCur.crisisRiskScore,
        prevWindow: winPrev.crisisRiskScore,
        daily,
        peak,
        last: daily.length ? daily[daily.length - 1] : null,
      },
      trendGranularity: singleDay ? 'hour' : 'day',
      hourlySeries,
      topicsTable: report.topicsTable,
      currentMetrics: {
        nss: winCur.nss,
        nss7d: winCur.nss7d,
        nss30d: winCur.nss30d,
        crisisRiskScore: winCur.crisisRiskScore,
        brandHealthIndex: winCur.brandHealthIndex,
        engagementRate: winCur.engagementRate,
        totalMentions: report.totals.total,
        totalReach: winCur.totalReach,
        totalMentionsDelta,
        display: {
          nss: formatMetric('nss', winCur.nss),
          crisis: formatMetric('crisis', winCur.crisisRiskScore),
          brandHealth: formatMetric('bhi', winCur.brandHealthIndex),
        },
        totalMentionsDeltaDisplay: formatDelta(report.totals.total, report.prevTotals.total, { kind: 'percent', decimals: 0 }),
      },
    };

    const res = NextResponse.json(response);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (err) {
    log.error('overview', 'handler failed', { msg: (err as Error).message });
    return NextResponse.json(
      { error: 'overview error', message: (err as Error).message },
      { status: 500 },
    );
  } finally {
    log.info('overview', 'request complete', {
      latencyMs: Date.now() - start,
      period: window.custom ? 'custom' : periodKey,
      ...(window.custom ? { from: window.startYmd, to: window.endYmd } : {}),
    });
  }
}
