/**
 * Geografía (oct-2026): los análisis que la página suma al mapa, en funciones
 * puras.
 *
 *  - Quién se movió: menciones del periodo contra lo usual. Lo usual = lo que
 *    tuvo el municipio en los días previos al periodo (12 semanas, o el largo
 *    del periodo si es más largo) llevado a la duración del periodo.
 *  - Los más nombrados, semana a semana: 12 semanas de 7 días que terminan el
 *    último día del periodo.
 *  - Por habitante: menciones por cada 10 mil habitantes.
 */

export const BASELINE_MIN_DAYS = 84;
export const WEEKS = 12;

const addDays = (ymd: string, d: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + d * 864e5).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

export interface GeoWindow { startYmd: string; endYmd: string }
export interface GeoSpans {
  days: number;
  baseStart: string; baseEnd: string; baseDays: number;
  weeks: Array<{ start: string; end: string }>;
  /** Primer día que hay que leer para cubrir lo usual y las 12 semanas. */
  firstDay: string;
}
export function spansFor(w: GeoWindow): GeoSpans {
  const days = diffDays(w.startYmd, w.endYmd) + 1;
  const baseDays = Math.max(BASELINE_MIN_DAYS, days);
  const baseEnd = addDays(w.startYmd, -1), baseStart = addDays(w.startYmd, -baseDays);
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const end = addDays(w.endYmd, -7 * (WEEKS - 1 - i));
    return { start: addDays(end, -6), end };
  });
  return { days, baseStart, baseEnd, baseDays, weeks, firstDay: baseStart < weeks[0].start ? baseStart : weeks[0].start };
}

export type MoveState = 'nuevo' | 'mas' | 'menos' | 'igual';
/** Cómo está el periodo contra lo usual: nuevo (sin menciones antes), el doble o más, la mitad o menos, o como siempre. */
export function moveState(n: number, usual: number, baseCount: number): MoveState {
  if (n > 0 && baseCount === 0) return 'nuevo';
  if (n >= Math.max(2, usual * 2)) return 'mas';
  if (usual >= 2 && n <= usual / 2) return 'menos';
  return 'igual';
}

export interface GeoMuniOut {
  slug: string; name: string; region: string; population: number | null;
  /** Menciones en el periodo (+ positivas / − negativas). */
  n: number; pos: number; neg: number;
  /** Menciones en los días de lo usual y lo usual llevado al largo del periodo. */
  base: number; usual: number; state: MoveState;
  weeks: number[];
}
/**
 * Junta los conteos por municipio y día en lo que pinta la página. Solo salen
 * los municipios con alguna mención en el periodo, en lo usual o en las 12
 * semanas.
 */
export function buildGeoMunis(
  rows: Array<{ slug: string; d: string; n: number; pos: number; neg: number }>,
  catalog: Array<{ slug: string; name: string; region: string; population: number | null }>,
  w: GeoWindow,
  sp: GeoSpans,
): GeoMuniOut[] {
  const by = new Map<string, GeoMuniOut>();
  const cat = new Map(catalog.map((c) => [c.slug, c]));
  for (const r of rows) {
    const c = cat.get(r.slug); if (!c) continue;
    let m = by.get(r.slug);
    if (!m) { m = { slug: c.slug, name: c.name, region: c.region, population: c.population, n: 0, pos: 0, neg: 0, base: 0, usual: 0, state: 'igual', weeks: Array(WEEKS).fill(0) }; by.set(r.slug, m); }
    const n = Number(r.n) || 0;
    if (r.d >= w.startYmd && r.d <= w.endYmd) { m.n += n; m.pos += Number(r.pos) || 0; m.neg += Number(r.neg) || 0; }
    if (r.d >= sp.baseStart && r.d <= sp.baseEnd) m.base += n;
    if (r.d >= sp.weeks[0].start && r.d <= w.endYmd) m.weeks[WEEKS - 1 - Math.floor(diffDays(r.d, w.endYmd) / 7)] += n;
  }
  for (const m of by.values()) {
    m.usual = Math.round((m.base * sp.days / sp.baseDays) * 10) / 10;
    m.state = moveState(m.n, m.base * sp.days / sp.baseDays, m.base);
  }
  return [...by.values()].sort((a, b) => b.n - a.n || b.base - a.base || a.name.localeCompare(b.name));
}

/** Menciones por cada 10 mil habitantes (null sin población). */
export const per10k = (n: number, population: number | null) => (population ? Math.round((n / population) * 1e5) / 10 : null);
