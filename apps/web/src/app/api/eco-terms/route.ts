/**
 * GET /api/eco-terms — términos para la nube de palabras de Menciones.
 *
 * Dos modos:
 *   · `mode=frequent`    — DF crudo (cuántas menciones contienen el término).
 *   · `mode=distinctive` — log-odds ratio con prior de Dirichlet informativo
 *     (Monroe, Colaresi & Quinn 2008), el estándar para "qué distingue a este
 *     periodo". Es el DEFAULT, porque la frecuencia cruda sobre este corpus
 *     devuelve los términos del propio boolean de Brandwatch: medido en
 *     producción para gobernadora a 365 días, los seis primeros son
 *     gonzález / jenniffer / gobernadora / colón / puerto / rico.
 *
 * Rendimiento medido en producción: el 90% del coste es PARSEAR el texto, no
 * agregar. Con el tsvector ya calculado, `unnest + GROUP BY` sobre 1.26 M
 * lexemas cuesta <1 s; parsear en caliente tarda 34 s para 2,290 menciones.
 * Por eso hay dos rutas:
 *   · si existe `mention_terms` (índice invertido), se lee de ahí — rápido;
 *   · si no existe, se calcula al vuelo con `to_tsvector` y se acota la ventana,
 *     para que la función SIRVA sin depender de una migración.
 *
 * El scope usa EXACTAMENTE el mismo predicado que `/api/eco-mentions`: si la
 * nube y la lista contaran distinto sería el hallazgo F9 otra vez (dos fuentes
 * rivales para el mismo número), que es el defecto que más credibilidad cuesta.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool } from '@eco/database';
import { agencies } from '@eco/database';
import { eq } from 'drizzle-orm';
import { resolveWindow } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { consume, clientKey } from '@/lib/rate-limit';
import { log } from '@/lib/log';
import { hasTermsTable, queryTerms } from '@/lib/terms/query';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const rl = consume('eco-terms:' + clientKey(request), { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } },
    );
  }
  const started = Date.now();
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get('mode') === 'frequent' ? 'frequent' : 'distinctive';
  const limit = Math.min(120, Math.max(10, Number(searchParams.get('limit') ?? '60')));
  // La ventana de /api/eco-data (D.PERIOD): from/to cerrados si llegan; si no,
  // `period` → N días CERRADOS terminando ayer en TZ PR. Antes el endpoint
  // ignoraba from/to, tenía su propia tabla (Max=3650 vs 730 canónico) y
  // contaba NOW()-N rolling: la nube no hablaba del periodo de la página
  // (QA 2026-10-23, M6).
  const w = resolveWindow({ period: searchParams.get('period'), from: searchParams.get('from'), to: searchParams.get('to') })
    ?? resolveWindow({ period: '7D' })!;

  // Sin fallback a "primera agencia activa": resolveAgencyId ya resuelve dentro
  // del set PERMITIDO del usuario; null = set vacío. Servir la primera agencia
  // activa era un leak de tenant, igual que el que /api/eco-mentions cerró en la
  // auditoría 2026-08 (P1-1) (QA 2026-10-23, M7).
  const db = getDb();
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ terms: [], mode, refMode: null, total: 0 });
  }
  const [agRow] = await db.select({ slug: agencies.slug }).from(agencies).where(eq(agencies.id, agencyId)).limit(1);
  const agencySlug: string | null = agRow?.slug ?? null;

  const pool = getPool();
  const fast = await hasTermsTable(pool);

  try {
    const { terms, refMode, refDays } = await queryTerms(pool, {
      searchParams, w, agencyId, agencySlug, mode, limit, fast,
    });
    const out = NextResponse.json({
      terms,
      mode,
      refMode,
      refDays: refMode === 'prev' ? refDays : w.days,
      window: { from: w.startYmd, to: w.endYmd },
      total: terms.length,
      // Se declara la ruta usada: sin `mention_terms` la ventana grande es lenta,
      // y el cliente merece saber por qué.
      source: fast ? 'mention_terms' : 'on-the-fly',
    });
    out.headers.set('Cache-Control', 'no-store');
    return out;
  } catch (err) {
    log.error('eco-terms', 'query failed', { msg: (err as Error).message });
    return NextResponse.json({ error: 'eco-terms error', message: (err as Error).message }, { status: 500 });
  } finally {
    log.info('eco-terms', 'request complete', { latencyMs: Date.now() - started, mode, fast });
  }
}
