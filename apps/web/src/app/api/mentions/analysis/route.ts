import { NextRequest, NextResponse } from 'next/server';
import { agencies, getDb, getPool } from '@eco/database';
import { addDaysYmd, resolveWindow, type PgClientLike } from '@eco/shared';
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
 * lenguaje que sube y baja. Mismo universo que /api/eco-mentions y la ventana
 * de /api/eco-data (D.PERIOD): from/to cerrados, o `period` → N días cerrados
 * terminando ayer en TZ PR. La previa del lenguaje es la de igual largo justo
 * antes. El cálculo vive en `lib/mentions/payload.ts`.
 */

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; payload: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

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

  // Ventana cerrada (D.PERIOD). Antes, sin from/to, era rolling NOW()−N: «Por
  // día» de DF 7D mezclaba el 16-oct desde la hora actual con el hoy a medias y
  // no cuadraba con la página (QA 2026-10-23, M2). AST = UTC−4 sin DST.
  const w = resolveWindow({ period: searchParams.get('period'), from: searchParams.get('from'), to: searchParams.get('to') })
    ?? resolveWindow({ period: '7D' })!;
  const since = new Date(`${w.startYmd}T04:00:00.000Z`);
  const until = new Date(`${addDaysYmd(w.endYmd, 1)}T04:00:00.000Z`);

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
        return computeMentionsAnalysis(getPool() as unknown as PgClientLike, { id: agencyId, slug: ag?.slug ?? '', name: ag?.name ?? null }, since, until);
      })().finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    const payload = await job;
    cache.set(key, { at: Date.now(), payload });
    if (cache.size > 60) cache.delete(cache.keys().next().value as string);
    log.info('mentions-analysis', 'request complete', { ms: Date.now() - t0, agencyId, start: w.startYmd, end: w.endYmd });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (err) {
    log.error('mentions-analysis', 'handler failed', { msg: (err as Error).message, agencyId });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
