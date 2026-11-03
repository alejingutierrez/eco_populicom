import { NextRequest, NextResponse } from 'next/server';
import { agencies, getDb, getPool } from '@eco/database';
import { PERIOD_DAYS, closedWindowYmdInTZ, type PgClientLike } from '@eco/shared';
import { eq } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { requireCapability } from '@/lib/auth/require-admin';
import { consume, clientKey } from '@/lib/rate-limit';
import { log } from '@/lib/log';
import { loadQuality } from '@/lib/quality/payload';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/quality — panel «Calidad de datos» (Configuración, spec
 * interpretación v1 11.7): pertinencia pendiente, versión de la rúbrica,
 * resolución de padres, texto completo y archivo de los envíos de la agencia
 * activa. Con SESIÓN y la capacidad `manage_users` (la misma que el SPA exige
 * para mostrar la sección): a diferencia de /api/admin/diagnostics, que es el
 * reporte técnico del cron y se autentica con el secreto compartido.
 *
 * Misma ventana que /api/eco-data: from/to cerrados, o los últimos N días hasta
 * ayer (`period`, default 1M).
 */
const TZ = 'America/Puerto_Rico';
const CACHE_TTL_MS = 2 * 60_000;
const cache = new Map<string, { at: number; payload: unknown }>();

function resolveWindow(sp: URLSearchParams, now = new Date()) {
  const from = sp.get('from'), to = sp.get('to');
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to) {
    return { startYmd: from, endYmd: to };
  }
  const w = closedWindowYmdInTZ(PERIOD_DAYS[sp.get('period') ?? '1M'] ?? 30, now, TZ);
  return { startYmd: w.startYmd, endYmd: w.endYmd };
}

export async function GET(request: NextRequest) {
  const rl = consume('admin-quality:' + clientKey(request), { limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } });
  }
  const gate = await requireCapability('manage_users');
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(request.url);
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) return NextResponse.json({ error: 'No agency resolved for this user' }, { status: 404 });

  const w = resolveWindow(searchParams);
  const key = `${agencyId}|${w.startYmd}~${w.endYmd}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.payload, { headers: { 'Cache-Control': 'private, max-age=30' } });
  }
  try {
    const [ag] = await getDb().select({ slug: agencies.slug, name: agencies.name }).from(agencies).where(eq(agencies.id, agencyId)).limit(1);
    const payload = await loadQuality(getPool() as unknown as PgClientLike, agencyId, ag ? { slug: ag.slug, name: ag.name ?? '' } : null, w);
    cache.set(key, { at: Date.now(), payload });
    if (cache.size > 40) cache.delete(cache.keys().next().value as string);
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=30' } });
  } catch (err) {
    log.error('quality', 'handler failed', { msg: (err as Error).message, agencyId });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
