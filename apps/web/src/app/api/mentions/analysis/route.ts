import { NextRequest, NextResponse } from 'next/server';
import { agencies, getDb, getPool } from '@eco/database';
import { PERIOD_DAYS, type PgClientLike } from '@eco/shared';
import { eq } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { requireAuth } from '@/lib/auth/require-admin';
import { consume, clientKey } from '@/lib/rate-limit';
import { log } from '@/lib/log';
import { computeMentionsAnalysis } from '@/lib/mentions/payload';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mentions/analysis — lo que la página de Menciones (oct-2026)
 * muestra además del feed: menciones por día, el mapa de atención, las
 * historias (para «Cómo viajó la historia» y «Quién amplifica a quién») y el
 * lenguaje que sube y baja. Misma ventana y mismo universo que
 * /api/eco-mentions (period rolling o from/to). El cálculo vive en
 * `lib/mentions/payload.ts`.
 */

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; payload: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

function parseCustomRange(fromParam: string | null, toParam: string | null): null | { sinceUtc: Date; untilExclusiveUtc: Date } {
  if (!fromParam || !toParam) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromParam) || !/^\d{4}-\d{2}-\d{2}$/.test(toParam) || fromParam > toParam) return null;
  const sinceUtc = new Date(`${fromParam}T04:00:00.000Z`);
  const untilExclusiveUtc = new Date(`${toParam}T04:00:00.000Z`);
  untilExclusiveUtc.setUTCDate(untilExclusiveUtc.getUTCDate() + 1);
  return Number.isNaN(sinceUtc.getTime()) || Number.isNaN(untilExclusiveUtc.getTime()) ? null : { sinceUtc, untilExclusiveUtc };
}

export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const rl = consume('mentions-analysis:' + clientKey(request), { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } });
  }
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) return NextResponse.json({ window: null, total: 0, days: [], points: null, stories: null, amplify: null, shift: null });

  // La misma ventana que /api/eco-mentions: from/to cerrados o los últimos N días hasta ahora.
  const periodKey = searchParams.get('period') ?? '7D';
  const custom = parseCustomRange(searchParams.get('from'), searchParams.get('to'));
  const now = new Date();
  const since = custom ? custom.sinceUtc : new Date(now.getTime() - (PERIOD_DAYS[periodKey] ?? 7) * 864e5);
  const until = custom ? custom.untilExclusiveUtc : now;

  // Ventana rolling: la clave cambia cada 5 minutos para que la caché no congele «hoy».
  const key = `${agencyId}|${custom ? `${searchParams.get('from')}~${searchParams.get('to')}` : periodKey}|${custom ? '' : Math.floor(now.getTime() / CACHE_TTL_MS)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.payload, { headers: { 'Cache-Control': 'private, max-age=60' } });
  }
  try {
    let job = inflight.get(key);
    if (!job) {
      job = (async () => {
        const [ag] = await getDb().select({ slug: agencies.slug, name: agencies.name }).from(agencies).where(eq(agencies.id, agencyId)).limit(1);
        return computeMentionsAnalysis(getPool() as unknown as PgClientLike, { id: agencyId, slug: ag?.slug ?? '', name: ag?.name ?? null }, since, until);
      })().finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    const payload = await job;
    cache.set(key, { at: Date.now(), payload });
    if (cache.size > 60) cache.delete(cache.keys().next().value as string);
    log.info('mentions-analysis', 'request complete', { ms: Date.now() - t0, agencyId, period: custom ? 'custom' : periodKey });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (err) {
    log.error('mentions-analysis', 'handler failed', { msg: (err as Error).message, agencyId });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
