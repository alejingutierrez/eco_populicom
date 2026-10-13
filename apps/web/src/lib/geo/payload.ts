/**
 * Geografía (oct-2026): lo que calcula /api/geo/analysis a partir de un
 * cliente de base de datos (vive aquí para poder correrlo contra prod desde un
 * script). Universo, ventana y filtros: los de /api/eco-geo — sin duplicados,
 * sin pertinencia baja, días calendario de Puerto Rico, fuente por page_type y
 * tópico/subtópico «any-touch» — para que todo cuadre con el mapa.
 */
import { sourceMatchTerms, type PgClientLike } from '@eco/shared';
import { buildGeoMunis, spansFor, type GeoMuniOut, type GeoWindow } from './analysis';

export interface GeoFilters { source?: string | null; topic?: string | null; subtopic?: string | null }

const LOCAL_DAY = `(m.published_at AT TIME ZONE 'America/Puerto_Rico')::date`;

/** Predicado común (universo + filtros de contenido). Los parámetros empiezan en $1 = agencia. */
export function basePredicate(f: GeoFilters, params: unknown[]): string {
  const parts = [
    `m.agency_id = $1::uuid`,
    `m.is_duplicate = false`,
    `(m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')`,
  ];
  if (f.source && f.source !== 'all') {
    const { negate, terms } = sourceMatchTerms(f.source);
    if (terms.length) {
      const ors = terms.map((t) => { params.push(t.value); return `LOWER(COALESCE(m.page_type, '')) ${t.op === 'like' ? 'LIKE' : '='} $${params.length}`; });
      parts.push(negate ? `NOT (${ors.join(' OR ')})` : `(${ors.join(' OR ')})`);
    }
  }
  if (f.topic) {
    params.push(f.topic);
    parts.push(`EXISTS (SELECT 1 FROM mention_topics mt JOIN topics t ON t.id = mt.topic_id WHERE mt.mention_id = m.id AND t.slug = $${params.length})`);
  }
  if (f.subtopic) {
    params.push(f.subtopic);
    parts.push(`EXISTS (SELECT 1 FROM mention_topics mt JOIN subtopics st ON st.id = mt.subtopic_id WHERE mt.mention_id = m.id AND st.name = $${params.length})`);
  }
  return parts.join('\n   AND ');
}

export interface GeoAnalysis {
  window: GeoWindow & { days: number; baseStart: string; baseEnd: string };
  /** Del periodo: menciones, cuántas nombran algún municipio, cuántos municipios y cuántas nombran más de uno. */
  coverage: { total: number; geo: number; munis: number; multi: number };
  weeks: Array<{ start: string; end: string }>;
  munis: GeoMuniOut[];
}

export async function computeGeoAnalysis(pool: PgClientLike, agencyId: string, w: GeoWindow, f: GeoFilters): Promise<GeoAnalysis> {
  const sp = spansFor(w);
  const pDays: unknown[] = [agencyId];
  const predDays = basePredicate(f, pDays);
  const i = pDays.length;
  const daysSql = `
SELECT mu.slug, ${LOCAL_DAY}::text AS d, COUNT(*)::int AS n,
       COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('positivo','positive'))::int AS pos,
       COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative'))::int AS neg
  FROM mention_municipalities mm
  JOIN municipalities mu ON mu.id = mm.municipality_id
  JOIN mentions m ON m.id = mm.mention_id
 WHERE ${predDays}
   AND ${LOCAL_DAY} >= $${i + 1}::date AND ${LOCAL_DAY} <= $${i + 2}::date
 GROUP BY 1, 2`;
  const pCov: unknown[] = [agencyId];
  const predCov = basePredicate(f, pCov);
  const j = pCov.length;
  const covSql = `
SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE g.k > 0)::int AS geo,
       COUNT(*) FILTER (WHERE g.k > 1)::int AS multi
  FROM mentions m
  LEFT JOIN LATERAL (SELECT COUNT(*)::int AS k FROM mention_municipalities mm WHERE mm.mention_id = m.id) g ON true
 WHERE ${predCov}
   AND ${LOCAL_DAY} >= $${j + 1}::date AND ${LOCAL_DAY} <= $${j + 2}::date`;
  const [days, cov, cat] = await Promise.all([
    pool.query<{ slug: string; d: string; n: number; pos: number; neg: number }>(daysSql, [...pDays, sp.firstDay, w.endYmd]),
    pool.query<{ total: number; geo: number; multi: number }>(covSql, [...pCov, w.startYmd, w.endYmd]),
    pool.query<{ slug: string; name: string; region: string; population: number | null }>(`SELECT slug, name, region, population FROM municipalities`, []),
  ]);
  const munis = buildGeoMunis(
    days.rows.map((r) => ({ ...r, d: String(r.d).slice(0, 10) })),
    cat.rows.map((c) => ({ ...c, population: c.population == null ? null : Number(c.population) })),
    w, sp,
  );
  const c = cov.rows[0] ?? { total: 0, geo: 0, multi: 0 };
  return {
    window: { ...w, days: sp.days, baseStart: sp.baseStart, baseEnd: sp.baseEnd },
    coverage: { total: Number(c.total) || 0, geo: Number(c.geo) || 0, munis: munis.filter((m) => m.n > 0).length, multi: Number(c.multi) || 0 },
    weeks: sp.weeks,
    munis,
  };
}
