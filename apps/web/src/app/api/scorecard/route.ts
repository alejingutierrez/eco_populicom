import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
import { PERIOD_DAYS, resolveWindow, type PgClientLike } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { requireAuth } from '@/lib/auth/require-admin';
import { consume, clientKey } from '@/lib/rate-limit';
import { log } from '@/lib/log';
import { computeScorecard } from '@/lib/scorecard/payload';

export const dynamic = 'force-dynamic';

const TZ = 'America/Puerto_Rico';

/**
 * GET /api/scorecard — lo que el Scorecard (oct-2026) muestra además de
 * /api/eco-data:
 *  - `prev`: los índices de la ventana previa (para «antes» en la tabla de
 *    indicadores) y su serie diaria (para la tendencia de las tarjetas);
 *  - `weeks`: las últimas 12 semanas y lo usual de la agencia (bloque «Últimas
 *    12 semanas»);
 *  - `voices`: quién habló en la ventana (bloque «Quién habló»).
 *
 * El cálculo y sus consultas viven en `lib/scorecard/payload.ts`.
 */

const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; payload: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const rl = consume('scorecard:' + clientKey(request), { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } });
  }
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const periodKey = searchParams.get('period') ?? '7D';
  const win = resolveWindow({ period: periodKey, from: searchParams.get('from'), to: searchParams.get('to'), timeZone: TZ });
  if (!win) {
    return NextResponse.json(
      { error: `Unsupported period: ${periodKey}. Valid: ${Object.keys(PERIOD_DAYS).join(', ')}, or pass from/to.` },
      { status: 400 },
    );
  }
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) return NextResponse.json({ prev: null, weeks: null, voices: null });

  const key = `${agencyId}|${win.startYmd}|${win.endYmd}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.payload, { headers: { 'Cache-Control': 'private, max-age=60' } });
  }
  try {
    let job = inflight.get(key);
    if (!job) {
      job = computeScorecard(getPool() as unknown as PgClientLike, agencyId, win.startYmd, win.endYmd, win.prevStartYmd, win.prevEndYmd).finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    const payload = await job;
    cache.set(key, { at: Date.now(), payload });
    if (cache.size > 50) cache.delete(cache.keys().next().value as string);
    log.info('scorecard', 'request complete', { ms: Date.now() - t0, agencyId, from: win.startYmd, to: win.endYmd });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (err) {
    log.error('scorecard', 'handler failed', { msg: (err as Error).message, agencyId });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
