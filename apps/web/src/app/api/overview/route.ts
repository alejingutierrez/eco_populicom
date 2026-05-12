import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
import {
  buildSentimentReport,
  closedWindowYmdInTZ,
  formatPeriodLabel,
  loadMetricsForWindow,
} from '@eco/shared';
import type { PgClientLike, SentimentReport } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { log } from '@/lib/log';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const TZ = 'America/Puerto_Rico';

/**
 * Periodos soportados por /api/overview. Cada uno se traduce a una ventana
 * cerrada en TZ Puerto Rico terminando AYER (no incluye hoy parcial) — la
 * misma semántica que el correo eco-weekly-report. El default es 7D
 * (replica exactamente el correo).
 */
const PERIOD_DAYS: Record<string, number> = {
  '1D': 1,
  '5D': 5,
  '7D': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1A': 365,
};

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
  const daysBack = PERIOD_DAYS[periodKey];
  if (!daysBack) {
    return NextResponse.json(
      { error: `Unsupported period: ${periodKey}. Valid: ${Object.keys(PERIOD_DAYS).join(', ')}` },
      { status: 400 },
    );
  }

  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ error: 'No agency resolved' }, { status: 404 });
  }

  try {
    const window = closedWindowYmdInTZ(daysBack, new Date(), TZ);
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
    const [winCur, winPrev] = await Promise.all([
      loadMetricsForWindow(pool, agencyId, startYmd, endYmd),
      loadMetricsForWindow(pool, agencyId, prevStartYmd, prevEndYmd),
    ]);

    const totalMentionsDelta = winPrev.totals.total > 0
      ? Number((((winCur.totals.total - winPrev.totals.total) / winPrev.totals.total) * 100).toFixed(1))
      : (winCur.totals.total > 0 ? 100 : 0);

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
        totalMentions: winCur.totals.total,
        totalReach: winCur.totalReach,
        totalMentionsDelta,
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
    log.info('overview', 'request complete', { latencyMs: Date.now() - start, period: periodKey });
  }
}
