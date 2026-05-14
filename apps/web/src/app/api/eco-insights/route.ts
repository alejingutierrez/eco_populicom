/**
 * GET /api/eco-insights — sirve insights cacheados o dispara cómputo async.
 *
 * Resuelve (period_start, period_end) igual que /api/overview:
 *   - period=preset (1D/5D/7D/30D/90D/1M/3M/6M/1A) → closedWindowYmdInTZ
 *   - period=custom + from/to → ventana explícita
 *
 * Cache semantics sobre `overview_period_insights`:
 *   - Existe + period_end < ayer (histórico inmutable) → 200 {status:'ready'}
 *   - Existe + period_end >= ayer + generated_at > NOW - 1h → 200 ready
 *   - Existe + stale → 200 ready + dispara recalc async
 *   - No existe → 202 {status:'computing'} + invoca lambda async
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, overviewPeriodInsights } from '@eco/database';
import { sql, and, eq, desc } from 'drizzle-orm';
import { closedWindowYmdInTZ, ymdInTimeZone } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { log } from '@/lib/log';
import { consume, clientKey } from '@/lib/rate-limit';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

export const dynamic = 'force-dynamic';

const TZ = 'America/Puerto_Rico';
const AI_TASKS_FUNCTION_NAME = process.env.AI_TASKS_FUNCTION_NAME ?? 'eco-ai-tasks';

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

async function triggerLambdaAsync(agencySlug: string, periodStart: string, periodEnd: string): Promise<void> {
  // InvocationType: 'Event' devuelve 202 inmediato; el lambda corre en background.
  await getLambdaClient().send(new InvokeCommand({
    FunctionName: AI_TASKS_FUNCTION_NAME,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify({
      action: 'period-insights',
      agencySlug,
      periodStart,
      periodEnd,
    })),
  }));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rl = consume('eco-insights:' + clientKey(request), { limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } },
    );
  }

  const start = Date.now();
  const { searchParams } = new URL(request.url);
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
      return NextResponse.json(
        { error: `Unsupported period: ${periodKey}` },
        { status: 400 },
      );
    }
    const w = closedWindowYmdInTZ(days, new Date(), TZ);
    startYmd = w.startYmd;
    endYmd = w.endYmd;
  }

  // Resolver agencia + slug (necesitamos slug para invocar el lambda).
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
      .from(overviewPeriodInsights)
      .where(and(
        eq(overviewPeriodInsights.agencyId, agencyId),
        eq(overviewPeriodInsights.periodStartDate, startYmd),
        eq(overviewPeriodInsights.periodEndDate, endYmd),
      ))
      .orderBy(desc(overviewPeriodInsights.generatedAt))
      .limit(1);

    const yesterdayYmd = ymdInTimeZone(new Date(Date.now() - 86400000), TZ);
    const isHistorical = endYmd < yesterdayYmd;
    const generatedAt = row?.generatedAt ? new Date(row.generatedAt as unknown as string) : null;
    const ageMs = generatedAt ? Date.now() - generatedAt.getTime() : Infinity;
    const STALE_MS = 60 * 60 * 1000; // 1h

    if (row) {
      const ready = {
        status: 'ready' as const,
        periodStart: startYmd,
        periodEnd: endYmd,
        insights: {
          negative: (row.negativeInsights as string[] | null) ?? [],
          neutral: (row.neutralInsights as string[] | null) ?? [],
          positive: (row.positiveInsights as string[] | null) ?? [],
        },
        dailySummary: row.dailySummary,
        generatedAt: row.generatedAt,
        stale: !isHistorical && ageMs > STALE_MS,
      };
      // Background recalc si stale y es ventana rolling (incluye hoy/ayer).
      if (!isHistorical && ageMs > STALE_MS) {
        // No await — fire and forget.
        triggerLambdaAsync(agencySlug, startYmd, endYmd).catch((e) => {
          log.warn('eco-insights', 'background recalc failed to invoke', { err: (e as Error).message });
        });
      }
      const res = NextResponse.json(ready);
      res.headers.set('Cache-Control', 'no-store');
      return res;
    }

    // No existe → dispara cómputo async y devuelve 202.
    await triggerLambdaAsync(agencySlug, startYmd, endYmd);
    const res = NextResponse.json(
      { status: 'computing', periodStart: startYmd, periodEnd: endYmd },
      { status: 202 },
    );
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (err) {
    log.error('eco-insights', 'handler failed', { msg: (err as Error).message });
    return NextResponse.json(
      { error: 'eco-insights error', message: (err as Error).message },
      { status: 500 },
    );
  } finally {
    log.info('eco-insights', 'request complete', {
      latencyMs: Date.now() - start,
      period: customRange ? 'custom' : periodKey,
      startYmd, endYmd,
    });
  }
}
