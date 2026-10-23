/**
 * Sentimiento (oct-2026): los dos análisis que la página suma a sus bloques de
 * siempre, en funciones puras.
 *
 *  - Quién movió el NSS: el cambio del NSS contra el periodo previo repartido
 *    por dónde se dijo. NSS = Σ_g (pos_g − neg_g) / N, así que el aporte de
 *    cada grupo es (pos − neg)/N de este periodo menos lo mismo del previo, y
 *    los aportes suman exactamente el cambio.
 *  - Emociones, 12 semanas: menciones con cada emoción por semana, semanas de
 *    7 días que terminan el último día de la ventana.
 */
import { classifyVoice, type VoiceRow } from '@/lib/scorecard/voices';

export type WhereKey = 'agencia' | 'comentarios' | 'prensa' | 'gobierno' | 'otras';
export const WHERE_KEYS: WhereKey[] = ['agencia', 'comentarios', 'prensa', 'gobierno', 'otras'];

/**
 * Canales propios de la agencia según Brandwatch: lo que llega por estas vías
 * son sus publicaciones o los comentarios en ellas (FACEBOOK_PUBLIC e
 * INSTAGRAM_GRAPH_PUBLIC son de terceros).
 */
export const OWN_PUB_TYPES = new Set(['FACEBOOK', 'INSTAGRAM_GRAPH_BUSINESS', 'LINKEDIN']);

/** Dónde se dijo: lo que publica la agencia, lo que le comentan en sus canales o lo que se dice fuera (por voz). */
export function whereOf(row: Pick<VoiceRow, 'author' | 'author_fullname' | 'domain' | 'page_type'> & { pub_type?: string | null }, agencySlug: string, agencyName: string | null): WhereKey {
  const v = classifyVoice(row, agencySlug, agencyName).cat;
  if (v === 'agencia') return 'agencia';
  if (row.pub_type && OWN_PUB_TYPES.has(row.pub_type)) return 'comentarios';
  if (v === 'prensa') return 'prensa';
  if (v === 'gobierno') return 'gobierno';
  return 'otras';
}

export interface ToneCount { n: number; pos: number; neg: number }
export interface WhereGroup {
  key: WhereKey;
  cur: ToneCount;
  prev: ToneCount;
  /** (pos − neg) / N del periodo, en puntos de NSS. */
  now: number;
  before: number;
  delta: number;
}
export interface NssShift {
  cur: ToneCount & { nss: number | null };
  prev: ToneCount & { nss: number | null };
  groups: WhereGroup[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const nssOf = (t: ToneCount) => (t.n ? ((t.pos - t.neg) / t.n) * 100 : null);

export function buildNssShift(rows: Array<{ where: WhereKey; cur: boolean; n: number; pos: number; neg: number }>): NssShift {
  const z = (): ToneCount => ({ n: 0, pos: 0, neg: 0 });
  const by = Object.fromEntries(WHERE_KEYS.map((k) => [k, { cur: z(), prev: z() }])) as Record<WhereKey, { cur: ToneCount; prev: ToneCount }>;
  const cur = z(), prev = z();
  for (const r of rows) {
    const t = r.cur ? by[r.where].cur : by[r.where].prev, all = r.cur ? cur : prev;
    t.n += r.n; t.pos += r.pos; t.neg += r.neg;
    all.n += r.n; all.pos += r.pos; all.neg += r.neg;
  }
  const groups = WHERE_KEYS.filter((k) => by[k].cur.n || by[k].prev.n).map((key) => {
    const g = by[key];
    const now = cur.n ? ((g.cur.pos - g.cur.neg) / cur.n) * 100 : 0;
    const before = prev.n ? ((g.prev.pos - g.prev.neg) / prev.n) * 100 : 0;
    return { key, cur: g.cur, prev: g.prev, now: r1(now), before: r1(before), delta: r1(now - before) };
  });
  const c = nssOf(cur), p = nssOf(prev);
  // Redondear cada aporte por separado podía dejar la cascada a 0.1 del NSS de
  // arriba (DF 1D: aportes +15.2 para un cambio de −73.5 → −58.2 = +15.3; QA
  // oct-2026). El residuo se reparte en pasos de 0.1 entre los aportes que más
  // perdieron al redondear, para que sumen exactamente r1(c) − r1(p).
  if (c != null && p != null && groups.length) {
    const raw = groups.map((g) => {
      const now = cur.n ? ((by[g.key].cur.pos - by[g.key].cur.neg) / cur.n) * 100 : 0;
      const before = prev.n ? ((by[g.key].prev.pos - by[g.key].prev.neg) / prev.n) * 100 : 0;
      return now - before;
    });
    let steps = Math.round((r1(r1(c) - r1(p)) - groups.reduce((a, g) => a + g.delta, 0)) * 10);
    const order = groups.map((_, i) => i).sort((a, b) => steps > 0
      ? (raw[b] - groups[b].delta) - (raw[a] - groups[a].delta)
      : (raw[a] - groups[a].delta) - (raw[b] - groups[b].delta));
    for (let k = 0; steps !== 0 && k < order.length * 2; k++) {
      const g = groups[order[k % order.length]];
      g.delta = r1(g.delta + (steps > 0 ? 0.1 : -0.1));
      steps += steps > 0 ? -1 : 1;
    }
  }
  return { cur: { ...cur, nss: c == null ? null : r1(c) }, prev: { ...prev, nss: p == null ? null : r1(p) }, groups };
}

const addDays = (ymd: string, d: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + d * 864e5).toISOString().slice(0, 10);
/** La etiqueta de siempre (la de /api/eco-data): minúsculas sin comillas, primera letra en mayúscula. */
export const emotionLabel = (raw: string) => {
  const e = String(raw || '').trim().toLowerCase();
  return e.charAt(0).toUpperCase() + e.slice(1);
};

export interface EmotionWeeks {
  weeks: Array<{ start: string; end: string }>;
  rows: Array<{ emotion: string; counts: number[]; total: number }>;
}
/**
 * Cuenta por semana (la última termina en `endYmd`). Orden: primero las que
 * aparecen en la última semana (de más a menos), luego el resto por total.
 */
export function bucketEmotionWeeks(rows: Array<{ d: string; emotion: string; c: number }>, endYmd: string, nWeeks = 12, top = 8): EmotionWeeks {
  const weeks = Array.from({ length: nWeeks }, (_, i) => {
    const end = addDays(endYmd, -7 * (nWeeks - 1 - i));
    return { start: addDays(end, -6), end };
  });
  const firstDay = weeks[0].start;
  const by = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.emotion || r.d < firstDay || r.d > endYmd) continue;
    const idx = nWeeks - 1 - Math.floor((Date.parse(endYmd + 'T00:00:00Z') - Date.parse(r.d + 'T00:00:00Z')) / (7 * 864e5));
    const key = emotionLabel(r.emotion);
    const arr = by.get(key) ?? Array(nWeeks).fill(0);
    arr[idx] += Number(r.c) || 0;
    by.set(key, arr);
  }
  const out = [...by.entries()].map(([emotion, counts]) => ({ emotion, counts, total: counts.reduce((a, b) => a + b, 0) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.counts[nWeeks - 1] - a.counts[nWeeks - 1] || b.total - a.total || a.emotion.localeCompare(b.emotion))
    .slice(0, top);
  return { weeks, rows: out };
}
