import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
import {
  buildSentimentReport,
  resolveWindow,
  PERIOD_DAYS,
  formatPeriodLabel,
  loadMetricsForWindow,
  formatMetric,
  formatDelta,
} from '@eco/shared';
import type { PgClientLike, SentimentReport, MetricDisplay, DeltaDisplay } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { log } from '@/lib/log';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const TZ = 'America/Puerto_Rico';

// Ventana: resolveWindow de @eco/shared — período cerrado terminando AYER en
// TZ Puerto Rico (misma semántica que el correo eco-weekly-report) o rango
// custom from/to en días AST inclusivos. El mapa de períodos válidos es el
// PERIOD_DAYS canónico del paquete compartido.

interface OverviewResponse {
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  prevPeriodStart: string;
  prevPeriodEnd: string;
  totals: SentimentReport['totals'];
  deltaVsPrev: SentimentReport['deltaVsPrev'];
  dailySeries: SentimentReport['dailySeries'];
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
    const winCur = await loadMetricsForWindow(pool, agencyId, startYmd, endYmd);

    // Volumen y su delta salen del MISMO report que el hero/termómetro/tabla
    // (universo pertinente) — antes venían de loadMetricsForWindow (universo
    // completo) y el payload traía DOS totales distintos (auditoría 2026-08,
    // P0-16). Las métricas compuestas (NSS/crisis/BHI) siguen saliendo de
    // loadMetricsForWindow: su universo está calibrado por backtest y no se
    // toca — son índices, no conteos.
    const totalMentionsDelta = report.prevTotals.total > 0
      ? Number((((report.totals.total - report.prevTotals.total) / report.prevTotals.total) * 100).toFixed(1))
      : (report.totals.total > 0 ? 100 : 0);

    const response: OverviewResponse = {
      periodLabel: formatPeriodLabel(startYmd, endYmd),
      periodStart: startYmd,
      periodEnd: endYmd,
      prevPeriodStart: prevStartYmd,
      prevPeriodEnd: prevEndYmd,
      totals: report.totals,
      deltaVsPrev: report.deltaVsPrev,
      dailySeries: report.dailySeries,
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
