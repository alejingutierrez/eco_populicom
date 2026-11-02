import { NextRequest, NextResponse } from 'next/server';
import { addDaysYmd, resolveWindow } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { requireAuth } from '@/lib/auth/require-admin';
import { consume, clientKey } from '@/lib/rate-limit';
import { log } from '@/lib/log';
import { computeOverview, TZ } from '@/lib/narrative/compute';
import type { OverviewPayload } from '@/lib/narrative/overview';

export const dynamic = 'force-dynamic';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/narrative/overview — la página Narrativas (oct-2026) en una sola
 * respuesta: la serie de historias (30 días), el tablero por etapa de vida
 * (7 días contra los 7 anteriores), y el mapa de las últimas 26 semanas. La
 * propagación de cada narrativa va aparte (`/api/narrative/[id]/propagation`).
 *
 * Ventanas FIJAS que terminan ayer (AST): la página no usa el selector de
 * periodo, porque cada bloque tiene su propia escala de tiempo.
 *
 * Universo, el mismo en los cuatro bloques:
 *  - solo la asignación principal de cada mención (`nm.is_primary = true`) en
 *    narrativas no fusionadas;
 *  - sin duplicados y pertinente (el universo PERTINENTE del resto del
 *    dashboard);
 *  - «solo fecha»: una mención a medianoche UTC pertenece a su fecha UTC (en
 *    hora de PR caería el día anterior a las 8 p. m.). El día efectivo se
 *    calcula en JS con `mentionWhen`, y el SQL ensancha los bordes para no
 *    perder ninguna.
 *
 * Las cifras (conteos, origen, picos, historias, cajón, duplicados) se
 * calculan en `lib/narrative/overview.ts`; aquí solo se traen las filas.
 */

// Caché por agencia y día: el agrupador corre cada 30 minutos y la página se
// recarga al cambiar de agencia; 10 minutos de frescura bastan.
const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; payload: OverviewPayload }>();
// Varias peticiones simultáneas de la misma agencia comparten un solo cálculo.
const inflight = new Map<string, Promise<OverviewPayload>>();

export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const rl = consume('narrative-overview:' + clientKey(request), { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } });
  }
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  // Último día con datos: ayer en AST. `to` (YYYY-MM-DD, no posterior a ayer)
  // corta las ventanas en otro día; el estado de cada narrativa (naciendo,
  // activa…) y los conteos de terminadas siguen siendo los de hoy.
  const yesterday = resolveWindow({ period: '1D', timeZone: TZ })!.endYmd;
  const toParam = searchParams.get('to');
  if (toParam && (!YMD_RE.test(toParam) || addDaysYmd(toParam, 0) !== toParam)) {
    return NextResponse.json({ error: 'Invalid to (YYYY-MM-DD)' }, { status: 400 });
  }
  const endYmd = toParam && toParam < yesterday ? toParam : yesterday;

  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ agency: null, asOf: endYmd, narratives: [], series: [], board: { emerging: [], active: [], declining: [] }, lanes: [], stories: [], context: [], alertId: null, cajones: [], counts: { live: 0, dormant: 0, dormantSince: null } });
  }

  const cacheKey = `${agencyId}|${endYmd}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.payload, { headers: { 'Cache-Control': 'private, max-age=60' } });
  }

  try {
    let job = inflight.get(cacheKey);
    if (!job) {
      job = computeOverview(agencyId, endYmd).finally(() => inflight.delete(cacheKey));
      inflight.set(cacheKey, job);
    }
    const payload = await job;
    cache.set(cacheKey, { at: Date.now(), payload });
    if (cache.size > 50) cache.delete(cache.keys().next().value as string);
    log.info('narrative-overview', 'request complete', {
      ms: Date.now() - t0, agencyId, endYmd, narratives: payload.narratives.length,
    });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (err) {
    log.error('narrative-overview', 'handler failed', { msg: (err as Error).message, agencyId });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
