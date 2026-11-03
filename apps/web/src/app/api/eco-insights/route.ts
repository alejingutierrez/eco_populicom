/**
 * GET /api/eco-insights — sirve insights cacheados o dispara cómputo async.
 *
 * Resuelve (period_start, period_end) igual que /api/overview:
 *   - period=preset (1D/5D/7D/30D/90D/1M/3M/6M/1A) → dashboardPresetWindowYmdInTZ
 *   - period=custom + from/to → ventana explícita
 *
 * Cache semantics sobre `overview_period_insights`:
 *   - Existe + period_end < ayer + datos sin cambios → 200 {status:'ready'}
 *   - Existe + period_end >= ayer + generated_at > NOW - 1h → 200 ready
 *   - Existe + stale → 200 ready + dispara recalc async
 *   - Existe + vieja (llegaron menciones después de generarla, ver
 *     lib/ai-cache-freshness) → 200 ready {outdated:true} + recalc async; si
 *     era una fila «sin señal» y hoy ya hay señal → 202 + recalc async
 *   - No existe → 202 {status:'computing'} + invoca lambda async
 * Los disparos se deduplican por ventana (claimAiTrigger, 3 min).
 *
 * Motor de redacción (WP-8): la fila declara `composer_version` (NULL =
 * texto legacy). Si no coincide con la que pide `COMPOSER_WEB_AGENCIES` para
 * esta agencia y ventana, se sirve y se recalcula una vez en segundo plano
 * (como un lede viejo), y el disparo le dice al lambda qué camino usar. El
 * motor nunca está en el camino crítico de la primera vista: sin texto que
 * mostrar se pide primero el legacy (`composer: false`, ~20 s como hoy) y el
 * motor (84–231 s) corre después en segundo plano. Con la bandera vacía y
 * filas legacy nada de esto cambia la respuesta.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, overviewPeriodInsights } from '@eco/database';
import { sql, and, eq, desc } from 'drizzle-orm';
import { dashboardPresetWindowYmdInTZ, ymdInTimeZone, PERIOD_DAYS, type PgClientLike } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { log } from '@/lib/log';
import {
  loadWindowFreshness, isAiCacheOutdated, claimAiTrigger, releaseAiTrigger,
  composerWebActive, expectedComposerVersion, isComposerVersionStale,
} from '@/lib/ai-cache-freshness';
import { consume, clientKey } from '@/lib/rate-limit';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

export const dynamic = 'force-dynamic';

const TZ = 'America/Puerto_Rico';
const AI_TASKS_FUNCTION_NAME = process.env.AI_TASKS_FUNCTION_NAME ?? 'eco-ai-tasks';
/** Versión vigente del lede que escribe eco-ai-tasks (PeriodLede.v). */
const LEDE_VERSION = 2;

// PERIOD_DAYS: mapa canónico de @eco/shared. El local anterior no tenía
// 'Max' y el chip Max devolvía 400 al abrir insights (auditoría 2026-08).

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

/**
 * `legacyFirst`: con motor y sin texto que mostrar, se pide primero el texto
 * legacy (`composer: false`, ~20 s como hoy) en vez de esperar al motor (84 a
 * 231 s). Cuando esa fila llega, la siguiente consulta la sirve y dispara el
 * motor en segundo plano (clave de dedup aparte). Así el motor nunca está en
 * el camino crítico de la primera vista.
 */
async function triggerLambdaAsync(
  agencySlug: string,
  periodStart: string,
  periodEnd: string,
  opts: { legacyFirst?: boolean } = {},
): Promise<void> {
  // La clave no incluye la versión: un cambio de bandera dentro de los 3 min
  // de dedup espera a la siguiente ventana, como cualquier otro recálculo.
  // Una generación por ventana cada 3 min: el SPA consulta cada 2 s mientras
  // recibe 202 y cada consulta disparaba OTRA corrida Opus (~10 por vista).
  // El arranque legacy lleva su propia clave para no bloquear al motor.
  const key = `period-insights:${agencySlug}:${periodStart}:${periodEnd}${opts.legacyFirst ? ':legacy-first' : ''}`;
  if (!claimAiTrigger(key)) return;
  try {
    await sendInvoke(agencySlug, periodStart, periodEnd, opts.legacyFirst === true);
  } catch (e) {
    releaseAiTrigger(key);
    throw e;
  }
}

async function sendInvoke(agencySlug: string, periodStart: string, periodEnd: string, legacyFirst: boolean): Promise<void> {
  // InvocationType: 'Event' devuelve 202 inmediato; el lambda corre en background.
  // `composer` solo viaja con la bandera definida: así web y lambda esperan la
  // misma versión de la fila (sin bandera el payload es el de siempre, y el
  // lambda sin `composer` va por el camino legacy aunque tenga la variable).
  const payload: Record<string, unknown> = {
    action: 'period-insights',
    agencySlug,
    periodStart,
    periodEnd,
  };
  if (composerWebActive()) {
    payload.composer = !legacyFirst && expectedComposerVersion(agencySlug, { startYmd: periodStart, endYmd: periodEnd }) != null;
  }
  await getLambdaClient().send(new InvokeCommand({
    FunctionName: AI_TASKS_FUNCTION_NAME,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify(payload)),
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
    const w = dashboardPresetWindowYmdInTZ(periodKey, days, new Date(), TZ);
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
    // Solo las columnas que se usan: `composition` (JSONB grande) no viaja.
    const [row] = await db
      .select({
        negativeInsights: overviewPeriodInsights.negativeInsights,
        neutralInsights: overviewPeriodInsights.neutralInsights,
        positiveInsights: overviewPeriodInsights.positiveInsights,
        dailySummary: overviewPeriodInsights.dailySummary,
        lede: overviewPeriodInsights.lede,
        generatedAt: overviewPeriodInsights.generatedAt,
        composerVersion: overviewPeriodInsights.composerVersion,
      })
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

    // Versión del motor que debe tener la fila (null = legacy, bandera vacía).
    const expectedVersion = expectedComposerVersion(agencySlug, { startYmd, endYmd });

    if (row) {
      // Filas previas a la migración 0008 no traen lede (titular, viñetas,
      // rótulos de picos, foto), y las de lede v1 traen una foto que no
      // dependía de la ventana (la nota más reciente). Se sirven igual y se
      // recalculan UNA vez en segundo plano, también las históricas.
      const ledeVersion = Number((row.lede as { v?: number } | null)?.v ?? 1);
      const missingLede = row.dailySummary != null && (row.lede == null || ledeVersion < LEDE_VERSION);
      // Otra versión del motor (o legacy vs motor): se recalcula una vez.
      const composerStale = isComposerVersionStale(row.composerVersion, expectedVersion);
      const rollingStale = !isHistorical && ageMs > STALE_MS;
      // Vieja = llegaron menciones a la ventana después de generarla (QA
      // 23-oct: DF 15→21 decía «720» con 1,037 en la base). Aplica también a
      // las históricas y a las «sin señal» (DF 19/20-oct: daily_summary NULL
      // con 81/199 menciones hoy). Solo se consulta si no va a recalcular ya
      // (salvo las «sin señal», que deben pasar a 202 aunque sean rolling, y
      // que con otra versión del motor necesitan saber si ya hay señal).
      const wasEmpty = row.dailySummary == null;
      const outdated = !missingLede && (!composerStale || wasEmpty) && (wasEmpty || !rollingStale) && generatedAt != null
        && isAiCacheOutdated(
          await loadWindowFreshness(pool as unknown as PgClientLike, { agencyId, startYmd, endYmd, generatedAt }),
          { wasEmpty },
        );
      if ((outdated || composerStale) && wasEmpty) {
        // La fila vieja no tiene texto que mostrar: 202 para que el SPA siga
        // consultando hasta que llegue la nueva. Si ahora hay señal y toca el
        // motor, primero el texto legacy (rápido); si sigue sin señal, el
        // motor escribe la fila vacía con su versión en segundos.
        await triggerLambdaAsync(agencySlug, startYmd, endYmd, { legacyFirst: outdated && expectedVersion != null });
        const res = NextResponse.json(
          { status: 'computing', periodStart: startYmd, periodEnd: endYmd },
          { status: 202 },
        );
        res.headers.set('Cache-Control', 'no-store');
        return res;
      }
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
        lede: row.lede ?? null,
        generatedAt: row.generatedAt,
        stale: missingLede || rollingStale || outdated || composerStale,
        outdated,
      };
      // Background recalc si stale y es ventana rolling (incluye hoy/ayer),
      // si a la fila le falta el lede, si quedó vieja o si es de otra versión
      // del motor.
      if (missingLede || rollingStale || outdated || composerStale) {
        // No await — fire and forget.
        triggerLambdaAsync(agencySlug, startYmd, endYmd).catch((e) => {
          log.warn('eco-insights', 'background recalc failed to invoke', { err: (e as Error).message });
        });
      }
      const res = NextResponse.json(ready);
      res.headers.set('Cache-Control', 'no-store');
      return res;
    }

    // No existe → dispara cómputo async y devuelve 202. Con motor, primero el
    // texto legacy (misma latencia que hoy); el motor sigue en segundo plano.
    await triggerLambdaAsync(agencySlug, startYmd, endYmd, { legacyFirst: expectedVersion != null });
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
