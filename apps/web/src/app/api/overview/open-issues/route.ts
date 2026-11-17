import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
import { resolveWindow, type PgClientLike } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { requireAuth } from '@/lib/auth/require-admin';
import { consume, clientKey } from '@/lib/rate-limit';
import { log } from '@/lib/log';
import { computeOverviewOpenIssues, type OverviewOpenIssuesPayload } from '@/lib/overview/open-issues';

export const dynamic = 'force-dynamic';

const TZ = 'America/Puerto_Rico';

/**
 * GET /api/overview/open-issues?agency= — INT-01 · WP-5. El bloque «Asuntos
 * abiertos» y el nivel de negatividad a 14 y 28 días del Overview: el mismo
 * cálculo, la misma fecha y el mismo universo que el Diario y el Semanal
 * (`lib/overview/open-issues.ts`).
 *
 * Ventanas FIJAS que terminan ayer (día de Puerto Rico): no recibe periodo. El
 * selector del Overview no mueve este bloque, y el bloque lo dice.
 *
 * Sesión: el middleware cubre /api/overview/* en sus dos listas (matcher y
 * PROTECTED_PATHS) y aquí va además `requireAuth`, como en
 * /api/narrative/overview.
 */

// Caché por agencia y día, como /api/narrative/overview: el agrupador de
// narrativas corre cada 30 minutos; 10 minutos de frescura bastan.
const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; payload: OverviewOpenIssuesPayload }>();
// Varias peticiones simultáneas de la misma agencia comparten un solo cálculo.
const inflight = new Map<string, Promise<OverviewOpenIssuesPayload>>();

export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const rl = consume('overview-open-issues:' + clientKey(request), { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } });
  }
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  // Fecha F del correo: el último día cerrado, ayer en Puerto Rico.
  const endYmd = resolveWindow({ period: '1D', timeZone: TZ })!.endYmd;

  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    const empty: OverviewOpenIssuesPayload = {
      asOf: endYmd, agency: null, level: null, issues: [], openCount: 0, coverage: null,
      windows: null, thresholds: null, facts: [], methodology: '', errors: [],
    };
    return NextResponse.json(empty);
  }

  const cacheKey = `${agencyId}|${endYmd}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.payload, { headers: { 'Cache-Control': 'private, max-age=60' } });
  }

  try {
    let job = inflight.get(cacheKey);
    if (!job) {
      job = computeOverviewOpenIssues(getPool() as unknown as PgClientLike, agencyId, endYmd)
        .finally(() => inflight.delete(cacheKey));
      inflight.set(cacheKey, job);
    }
    const payload = await job;
    // Una carga fallida no se guarda: la siguiente petición la reintenta.
    if (!payload.errors.length) {
      cache.set(cacheKey, { at: Date.now(), payload });
      if (cache.size > 50) cache.delete(cache.keys().next().value as string);
    } else {
      log.error('overview-open-issues', 'partial load', { agencyId, endYmd, errors: payload.errors });
    }
    log.info('overview-open-issues', 'request complete', {
      ms: Date.now() - t0, agencyId, endYmd, issues: payload.issues.length, open: payload.openCount,
    });
    // Los detalles de un fallo de carga quedan en el log, no en la respuesta.
    const body = payload.errors.length
      ? { ...payload, errors: payload.errors.map((e) => e.split(':')[0]) }
      : payload;
    return NextResponse.json(body, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (err) {
    log.error('overview-open-issues', 'handler failed', { msg: (err as Error).message, agencyId });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
