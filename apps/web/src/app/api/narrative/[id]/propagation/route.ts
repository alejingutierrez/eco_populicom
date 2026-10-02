import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
import { addDaysYmd, resolveWindow } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { requireAuth } from '@/lib/auth/require-admin';
import { consume, clientKey } from '@/lib/rate-limit';
import { log } from '@/lib/log';
import { processRows, propagationRows, type RawMentionRow } from '@/lib/narrative/overview';

export const dynamic = 'force-dynamic';

const TZ = 'America/Puerto_Rico';
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/narrative/[id]/propagation — todas las menciones de una narrativa
 * (bloque 03 de la página Narrativas): canal, día y hora en Puerto Rico,
 * sentimiento, interacción y voz. Mismo universo y mismas reglas de dato que
 * /api/narrative/overview (principal, sin duplicados, pertinente, «solo
 * fecha», un artículo con dos URL cuenta una vez), hasta ayer en AST.
 *
 * Los hitos (primera mención, primer medio, hora pico…) los calcula el SPA a
 * partir de estas filas, para que la gráfica y los hitos no puedan
 * contradecirse.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const t0 = Date.now();
  const rl = consume('narrative-propagation:' + clientKey(request), { limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } });
  }
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  const { searchParams } = new URL(request.url);
  const yesterday = resolveWindow({ period: '1D', timeZone: TZ })!.endYmd;
  const toParam = searchParams.get('to');
  if (toParam && (!YMD_RE.test(toParam) || addDaysYmd(toParam, 0) !== toParam)) {
    return NextResponse.json({ error: 'Invalid to (YYYY-MM-DD)' }, { status: 400 });
  }
  const endYmd = toParam && toParam < yesterday ? toParam : yesterday;

  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) return NextResponse.json({ error: 'No agency' }, { status: 404 });

  try {
    const pool = getPool();
    // Un enlace viejo puede apuntar a una narrativa fusionada: se sirve la
    // superviviente y se avisa con `redirectedFrom`.
    const own = await pool.query<{ id: string; name: string; status: string; was_merged: boolean; slug: string; agency_name: string | null }>(
      `SELECT n.id, n.name, n.status, req.id <> n.id AS was_merged, a.slug, a.name AS agency_name
         FROM narratives req
         JOIN narratives n ON n.id = COALESCE(req.merged_into_id, req.id)
         JOIN agencies a ON a.id = n.agency_id
        WHERE req.id = $1 AND req.agency_id = $2 AND n.agency_id = $2`,
      [id, agencyId],
    );
    if (!own.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const narrative = own.rows[0];

    const rowsRes = await pool.query<RawMentionRow>(
      `SELECT nm.narrative_id AS nid, m.id, m.published_at, m.url, m.title, m.page_type,
              m.author, m.author_fullname, m.domain,
              COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
              (COALESCE(m.likes, 0) + COALESCE(m.comments, 0) + COALESCE(m.shares, 0)) AS inter
         FROM narrative_mentions nm
         JOIN mentions m ON m.id = nm.mention_id
        WHERE nm.narrative_id = $1 AND nm.is_primary = true AND m.agency_id = $2
          AND m.is_duplicate = false
          AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
          AND m.published_at < $3::timestamptz`,
      // Borde holgado: la última mención con hora del día final es anterior a
      // las 04:00Z del siguiente; `processRows` descarta lo posterior a endYmd.
      [narrative.id, agencyId, `${addDaysYmd(endYmd, 1)}T04:00:00Z`],
    );
    const { byNarr, voiceLabels } = processRows(rowsRes.rows, {
      agencySlug: narrative.slug, agencyName: narrative.agency_name, endYmd,
    });
    const rows = propagationRows(byNarr.get(narrative.id) ?? []);
    const voices: Record<string, string> = {};
    for (const r of rows) voices[r.v] = voiceLabels[r.v] ?? r.v;

    log.info('narrative-propagation', 'request complete', { ms: Date.now() - t0, agencyId, rows: rows.length });
    return NextResponse.json({
      narrative: { id: narrative.id, name: narrative.name, status: narrative.status },
      redirectedFrom: narrative.was_merged ? id : null,
      asOf: endYmd,
      rows,
      voices,
    }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (err) {
    log.error('narrative-propagation', 'handler failed', { msg: (err as Error).message, agencyId });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
