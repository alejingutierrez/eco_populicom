import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
import { PERIOD_DAYS, closedWindowYmdInTZ, type PgClientLike } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { requireAuth } from '@/lib/auth/require-admin';
import { consume, clientKey } from '@/lib/rate-limit';
import { log } from '@/lib/log';
import { computeGeoAnalysis } from '@/lib/geo/payload';
import type { GeoWindow } from '@/lib/geo/analysis';

export const dynamic = 'force-dynamic';

/**
 * GET /api/geo/analysis — lo que la página de Geografía (oct-2026) suma al
 * mapa: cuántas menciones dicen dónde, quién se movió contra lo usual, los
 * municipios más nombrados semana a semana y la población para leer por
 * habitante. Misma ventana y mismos filtros (source/topic/subtopic) que
 * /api/eco-geo, así todo cuadra con el mapa. El cálculo vive en
 * `lib/geo/payload.ts`.
 */

const TZ = 'America/Puerto_Rico';
const SLUG = /^[a-z0-9][a-z0-9\-]{0,60}$/;
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; payload: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

function resolveWindow(sp: URLSearchParams): GeoWindow {
  const from = sp.get('from'), to = sp.get('to');
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to) return { startYmd: from, endYmd: to };
  const w = closedWindowYmdInTZ(PERIOD_DAYS[sp.get('period') ?? '1M'] ?? 30, new Date(), TZ);
  return { startYmd: w.startYmd, endYmd: w.endYmd };
}

export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const rl = consume('geo-analysis:' + clientKey(request), { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } });
  }
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) return NextResponse.json({ error: 'No agency resolved for this user' }, { status: 404 });

  const source = searchParams.get('source'), topic = searchParams.get('topic'), subtopic = searchParams.get('subtopic');
  if (topic && !SLUG.test(topic)) return NextResponse.json({ error: 'invalid topic' }, { status: 400 });
  if (subtopic && subtopic.length > 120) return NextResponse.json({ error: 'invalid subtopic' }, { status: 400 });
  const w = resolveWindow(searchParams);
  const key = `${agencyId}|${w.startYmd}~${w.endYmd}|${source ?? ''}|${topic ?? ''}|${subtopic ?? ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.payload, { headers: { 'Cache-Control': 'private, max-age=60' } });
  }
  try {
    let job = inflight.get(key);
    if (!job) {
      job = computeGeoAnalysis(getPool() as unknown as PgClientLike, agencyId, w, { source, topic, subtopic }).finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    const payload = await job;
    cache.set(key, { at: Date.now(), payload });
    if (cache.size > 80) cache.delete(cache.keys().next().value as string);
    log.info('geo-analysis', 'request complete', { ms: Date.now() - t0, agencyId, start: w.startYmd, end: w.endYmd });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (err) {
    log.error('geo-analysis', 'handler failed', { msg: (err as Error).message, agencyId });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
