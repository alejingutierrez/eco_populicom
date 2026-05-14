/**
 * GET /api/eco-metric-insight — sirve el insight explicativo de una métrica
 * sintética (crisis/polarization/nss/bhi/volume) para una agencia + periodo.
 *
 * Mismo patrón cache-or-202 que /api/eco-insights, pero keyed además por
 * `metric`. Histórico (period_end < ayer) inmutable; rolling refresca cada 1h.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, metricInsightsCache } from '@eco/database';
import { and, eq, desc } from 'drizzle-orm';
import { closedWindowYmdInTZ, ymdInTimeZone } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { log } from '@/lib/log';
import { consume, clientKey } from '@/lib/rate-limit';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

export const dynamic = 'force-dynamic';

const TZ = 'America/Puerto_Rico';
const AI_TASKS_FUNCTION_NAME = process.env.AI_TASKS_FUNCTION_NAME ?? 'eco-ai-tasks';
const VALID_METRICS = new Set(['crisis', 'polarization', 'nss', 'bhi', 'volume']);

const PERIOD_DAYS: Record<string, number> = {
  '1D': 1, '5D': 5, '7D': 7, '30D': 30, '90D': 90,
  '1M': 30, '3M': 90, '6M': 180, '1A': 365,
};

function parseCustomRange(
  fromParam: string | null,
  toParam: string | null,
): null | { startYmd: string; endYmd: string } {
  if (!fromParam || !toParam) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromParam) || !/^\d{4}-\d{2}-\d{2}$/.test(toParam)) return null;
  if (fromParam > toParam) return null;
  return { startYmd: fromParam, endYmd: toParam };
}

let lambdaClient: LambdaClient | null = null;
function getLambdaClient(): LambdaClient {
  if (!lambdaClient) lambdaClient = new LambdaClient({});
  return lambdaClient;
}

async function triggerLambdaAsync(agencySlug: string, metric: string, periodStart: string, periodEnd: string): Promise<void> {
  await getLambdaClient().send(new InvokeCommand({
    FunctionName: AI_TASKS_FUNCTION_NAME,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify({
      action: 'metric-insight',
      agencySlug,
      metric,
      periodStart,
      periodEnd,
    })),
  }));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rl = consume('eco-metric-insight:' + clientKey(request), { limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } },
    );
  }

  const start = Date.now();
  const { searchParams } = new URL(request.url);
  const metric = searchParams.get('metric');
  if (!metric || !VALID_METRICS.has(metric)) {
    return NextResponse.json(
      { error: `Invalid or missing metric. Valid: ${[...VALID_METRICS].join(', ')}` },
      { status: 400 },
    );
  }

  const periodKey = searchParams.get('period') ?? '7D';
  const customRange = parseCustomRange(searchParams.get('from'), searchParams.get('to'));

  let startYmd: string;
  let endYmd: string;
  if (customRange) {
    startYmd = customRange.startYmd;
    endYmd = customRange.endYmd;
  } else {
    const days = PERIOD_DAYS[periodKey];
    if (!days) {
      return NextResponse.json({ error: `Unsupported period: ${periodKey}` }, { status: 400 });
    }
    const w = closedWindowYmdInTZ(days, new Date(), TZ);
    startYmd = w.startYmd;
    endYmd = w.endYmd;
  }

  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ error: 'No agency resolved' }, { status: 404 });
  }
  const pool = getPool();
  const agencyRow = await pool.query<{ slug: string }>(
    `SELECT slug FROM agencies WHERE id = $1 LIMIT 1`,
    [agencyId],
  );
  const agencySlug = agencyRow.rows[0]?.slug;
  if (!agencySlug) {
    return NextResponse.json({ error: 'Agency slug not found' }, { status: 404 });
  }

  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(metricInsightsCache)
      .where(and(
        eq(metricInsightsCache.agencyId, agencyId),
        eq(metricInsightsCache.metric, metric),
        eq(metricInsightsCache.periodStartDate, startYmd),
        eq(metricInsightsCache.periodEndDate, endYmd),
      ))
      .orderBy(desc(metricInsightsCache.generatedAt))
      .limit(1);

    const yesterdayYmd = ymdInTimeZone(new Date(Date.now() - 86400000), TZ);
    const isHistorical = endYmd < yesterdayYmd;
    const generatedAt = row?.generatedAt ? new Date(row.generatedAt as unknown as string) : null;
    const ageMs = generatedAt ? Date.now() - generatedAt.getTime() : Infinity;
    const STALE_MS = 60 * 60 * 1000;

    if (row) {
      const ready = {
        status: 'ready' as const,
        metric,
        periodStart: startYmd,
        periodEnd: endYmd,
        insight: row.insightText,
        generatedAt: row.generatedAt,
        stale: !isHistorical && ageMs > STALE_MS,
      };
      if (!isHistorical && ageMs > STALE_MS) {
        triggerLambdaAsync(agencySlug, metric, startYmd, endYmd).catch((e) => {
          log.warn('eco-metric-insight', 'background recalc failed to invoke', { err: (e as Error).message });
        });
      }
      const res = NextResponse.json(ready);
      res.headers.set('Cache-Control', 'no-store');
      return res;
    }

    await triggerLambdaAsync(agencySlug, metric, startYmd, endYmd);
    const res = NextResponse.json(
      { status: 'computing', metric, periodStart: startYmd, periodEnd: endYmd },
      { status: 202 },
    );
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (err) {
    log.error('eco-metric-insight', 'handler failed', { msg: (err as Error).message });
    return NextResponse.json(
      { error: 'eco-metric-insight error', message: (err as Error).message },
      { status: 500 },
    );
  } finally {
    log.info('eco-metric-insight', 'request complete', {
      latencyMs: Date.now() - start, metric, startYmd, endYmd,
    });
  }
}
