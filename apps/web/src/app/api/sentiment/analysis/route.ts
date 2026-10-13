import { NextRequest, NextResponse } from 'next/server';
import { agencies, getDb, getPool } from '@eco/database';
import { PERIOD_DAYS, addDaysYmd, closedWindowYmdInTZ, type PgClientLike } from '@eco/shared';
import { eq } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { requireAuth } from '@/lib/auth/require-admin';
import { consume, clientKey } from '@/lib/rate-limit';
import { log } from '@/lib/log';
import { computeSentimentAnalysis, type SentimentWindow } from '@/lib/sentiment/payload';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sentiment/analysis — lo que la página de Sentimiento (oct-2026)
 * suma a sus bloques de siempre: quién movió el NSS contra el periodo previo
 * (por dónde se dijo) y las emociones de las últimas 12 semanas. Misma ventana
 * que /api/eco-data (cerrada, termina ayer; o from/to) para que la cascada
 * empiece y termine en el NSS que muestra la página. El cálculo vive en
 * `lib/sentiment/payload.ts`.
 */

const TZ = 'America/Puerto_Rico';
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; payload: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

/** La ventana de /api/eco-data: from/to cerrados con su previa de igual largo, o los últimos N días hasta ayer. */
function resolveWindow(sp: URLSearchParams, now = new Date()): SentimentWindow {
  const from = sp.get('from'), to = sp.get('to');
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to) {
    const days = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5) + 1;
    const prevEndYmd = addDaysYmd(from, -1);
    return { startYmd: from, endYmd: to, prevStartYmd: addDaysYmd(prevEndYmd, -(days - 1)), prevEndYmd };
  }
  return closedWindowYmdInTZ(PERIOD_DAYS[sp.get('period') ?? '1M'] ?? 30, now, TZ);
}

export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const rl = consume('sentiment-analysis:' + clientKey(request), { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } });
  }
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) return NextResponse.json({ error: 'No agency resolved for this user' }, { status: 404 });

  const w = resolveWindow(searchParams);
  // La ventana cierra en ayer: la clave cambia con el día y la caché no se queda con el de ayer.
  const key = `${agencyId}|${w.startYmd}~${w.endYmd}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.payload, { headers: { 'Cache-Control': 'private, max-age=60' } });
  }
  try {
    let job = inflight.get(key);
    if (!job) {
      job = (async () => {
        const [ag] = await getDb().select({ slug: agencies.slug, name: agencies.name }).from(agencies).where(eq(agencies.id, agencyId)).limit(1);
        return computeSentimentAnalysis(getPool() as unknown as PgClientLike, { id: agencyId, slug: ag?.slug ?? '', name: ag?.name ?? null }, w);
      })().finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    const payload = await job;
    cache.set(key, { at: Date.now(), payload });
    if (cache.size > 60) cache.delete(cache.keys().next().value as string);
    log.info('sentiment-analysis', 'request complete', { ms: Date.now() - t0, agencyId, start: w.startYmd, end: w.endYmd });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (err) {
    log.error('sentiment-analysis', 'handler failed', { msg: (err as Error).message, agencyId });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
