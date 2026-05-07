import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, dailyMetricSnapshots, mentions } from '@eco/database';
import { sql, and, eq, lte, desc } from 'drizzle-orm';
import {
  buildSentimentReport,
  closedWindowYmdInTZ,
  formatPeriodLabel,
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

    // Métricas compuestas: último snapshot dentro de la ventana.
    const db = getDb();
    const [snap] = await db
      .select()
      .from(dailyMetricSnapshots)
      .where(and(
        eq(dailyMetricSnapshots.agencyId, agencyId),
        lte(dailyMetricSnapshots.date, endYmd),
      ))
      .orderBy(desc(dailyMetricSnapshots.date))
      .limit(1);

    // Reach acumulado de la ventana — los snapshots son por día, así que para
    // el "totalReach del periodo" sumamos reach_estimate de la tabla mentions
    // con el mismo filtro que el termómetro (paridad con totals.total).
    const reachRow = await pool.query<{ reach: number | string }>(
      `SELECT COALESCE(SUM(reach_estimate), 0)::bigint AS reach
         FROM mentions
        WHERE agency_id = $1
          AND published_at >= ($2::date)
          AND published_at <  (($3::date) + INTERVAL '1 day')`,
      [agencyId, startYmd, endYmd],
    );
    const totalReach = Number(reachRow.rows[0]?.reach ?? 0);

    // Delta de volumen (% change) vs ventana previa.
    const prevTotalRow = await pool.query<{ total: number | string }>(
      `SELECT COUNT(*)::int AS total
         FROM mentions
        WHERE agency_id = $1
          AND published_at >= ($2::date)
          AND published_at <  (($3::date) + INTERVAL '1 day')`,
      [agencyId, prevStartYmd, prevEndYmd],
    );
    const prevTotal = Number(prevTotalRow.rows[0]?.total ?? 0);
    const totalMentionsDelta = prevTotal > 0
      ? Number((((report.totals.total - prevTotal) / prevTotal) * 100).toFixed(1))
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
        nss: snap?.nss != null ? Number(snap.nss) : null,
        nss7d: snap?.nss7d != null ? Number(snap.nss7d) : null,
        nss30d: snap?.nss30d != null ? Number(snap.nss30d) : null,
        crisisRiskScore: snap?.crisisRiskScore != null ? Number(snap.crisisRiskScore) : null,
        brandHealthIndex: snap?.brandHealthIndex != null ? Number(snap.brandHealthIndex) : null,
        engagementRate: snap?.engagementRate != null ? Number(snap.engagementRate) : null,
        totalMentions: report.totals.total,
        totalReach,
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
