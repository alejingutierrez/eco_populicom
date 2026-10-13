/**
 * Menciones (oct-2026): los análisis de la página, en funciones puras.
 *
 *  - Historias: dos menciones son la misma historia si sus embeddings están a
 *    distancia coseno ≤ STORY_MAX_DISTANCE y salieron a menos de
 *    STORY_MAX_HOURS. Se encadenan (enlace simple): A~B y B~C forman una
 *    historia. Calibrado en DDEC 6–12 oct: hasta 0.10 son copias del mismo
 *    texto; 0.10–0.16 la misma noticia contada con otras palabras (incluida la
 *    versión en inglés); desde ~0.18 son eventos distintos de una misma campaña
 *    (Luquillo frente a Ciales).
 *  - Quién amplifica a quién: en cada historia repetida, la voz que publicó
 *    primero y las voces que la repitieron.
 *  - Lenguaje que sube y baja: menciones que usan cada palabra por cada 100
 *    menciones, esta ventana contra la anterior de igual largo.
 *  - Por día: menciones y negativas por día calendario de Puerto Rico.
 */
import type { VoiceCat } from '@/lib/scorecard/voices';

export const STORY_MAX_DISTANCE = 0.16;
export const STORY_MAX_HOURS = 48;
/** Los análisis de historias, atención y lenguaje se calculan hasta este largo de ventana. */
export const ANALYSIS_MAX_DAYS = 31;

const VOICES: VoiceCat[] = ['agencia', 'prensa', 'gobierno', 'ciudadania'];

/** Día calendario en Puerto Rico (UTC-4 todo el año, sin horario de verano). */
export function astYmd(d: Date | string): string {
  const t = typeof d === 'string' ? Date.parse(d) : d.getTime();
  return new Date(t - 4 * 3600e3).toISOString().slice(0, 10);
}

/** Une las parejas en historias (enlace simple). Devuelve solo las de 2+ menciones, cada una ordenada por id. */
export function groupStories(pairs: Array<[string, string]>): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  for (const [a, b] of pairs) {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) { const r = find(id); groups.set(r, [...(groups.get(r) ?? []), id]); }
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort());
}

export interface DayRow { date: string; n: number; neg: number }
/** Menciones y negativas por día AST, con los días vacíos de la ventana en cero. */
export function buildDays(rows: Array<{ ts: string; sent: string }>, fromYmd: string, toYmd: string): DayRow[] {
  const by = new Map<string, DayRow>();
  for (let d = fromYmd; d <= toYmd; d = new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10)) {
    by.set(d, { date: d, n: 0, neg: 0 });
    if (by.size > 400) break;
  }
  for (const r of rows) {
    const day = by.get(astYmd(r.ts));
    if (!day) continue;
    day.n++;
    if (r.sent === 'negativo') day.neg++;
  }
  return [...by.values()];
}

export interface AmplifyCell { n: number; inter: number; stories: number }
export interface AmplifyPayload {
  /** Historias repetidas que originó cada voz. */
  origins: Record<VoiceCat, number>;
  /** cells[origen][quienRepite] */
  cells: Record<VoiceCat, Record<VoiceCat, AmplifyCell>>;
}
/** La voz que publicó primero cada historia y quiénes la repitieron (con sus interacciones). */
export function buildAmplify(stories: string[][], byId: Map<string, { ts: string; voice: VoiceCat; inter: number }>): AmplifyPayload {
  const origins = Object.fromEntries(VOICES.map((v) => [v, 0])) as Record<VoiceCat, number>;
  const cells = Object.fromEntries(VOICES.map((o) => [o, Object.fromEntries(VOICES.map((a) => [a, { n: 0, inter: 0, stories: 0 }]))])) as AmplifyPayload['cells'];
  for (const g of stories) {
    const ms = g.map((id) => byId.get(id)).filter((m): m is { ts: string; voice: VoiceCat; inter: number } => !!m).sort((a, b) => (a.ts < b.ts ? -1 : 1));
    if (ms.length < 2) continue;
    const o = ms[0].voice;
    origins[o]++;
    const touched = new Set<VoiceCat>();
    for (const m of ms.slice(1)) { const c = cells[o][m.voice]; c.n++; c.inter += m.inter; touched.add(m.voice); }
    for (const v of touched) cells[o][v].stories++;
  }
  return { origins, cells };
}

export interface TermRow { term: string; now: number; prev: number; neg: number }
export interface ShiftRow extends TermRow { delta: number; isNew: boolean }
/**
 * Palabras que suben y bajan. `delta` = menciones con la palabra por cada 100
 * menciones de esta ventana, menos lo mismo en la anterior: así una semana más
 * grande no hace «subir» todo. Solo palabras con base mínima en alguna ventana.
 */
export function buildShift(rows: TermRow[], nNow: number, nPrev: number, top = 10): { up: ShiftRow[]; down: ShiftRow[] } {
  if (!nNow || !nPrev) return { up: [], down: [] };
  const minNow = Math.max(3, Math.ceil(nNow * 0.02)), minPrev = Math.max(3, Math.ceil(nPrev * 0.02));
  const all = rows
    .filter((r) => r.now >= minNow || r.prev >= minPrev)
    .map((r) => ({ ...r, delta: Math.round(((r.now / nNow) * 100 - (r.prev / nPrev) * 100) * 10) / 10, isNew: r.prev === 0 }));
  return {
    up: all.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta || b.now - a.now).slice(0, top),
    down: all.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta || b.prev - a.prev).slice(0, top),
  };
}

/** Palabras funcionales del español (lo que la configuración `spanish` de Postgres ya quita en la nube). */
export const SPANISH_STOP = (
  'a al algo algunas algunos ante antes aquel aquella aquellas aquellos aqui así aun aunque bajo bien cada como con contra cual cuales ' +
  'cuando de del desde donde dos el ella ellas ellos en entre era eran es esa esas ese eso esos esta estaba estado estas este esto estos ' +
  'fue fueron ha había han hasta hay la las le les lo los mas me mi mis mucho muchos muy nada ni no nos nosotros nuestra nuestras nuestro ' +
  'nuestros o otra otras otro otros para pero poco por porque que quien quienes se sea según ser si sido sin sobre su sus también tan te ' +
  'tener tiene tienen todo todos tu tus un una unas uno unos usted ustedes y ya yo él éste ésta qué cómo cuál dónde quién'
).split(' ');

const fold = (w: string) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/** Clave de un término: sin tildes y con el plural plegado (permisos → permiso, empresas → empresa). */
export function termKey(word: string): string {
  const w = fold(word.toLowerCase());
  if (w.length > 5 && w.endsWith('es') && !w.endsWith('ies')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}
export function tokenize(text: string): string[] {
  return (String(text || '').replace(/https?:\/\/\S+|www\.\S+|\S+@\S+/gi, ' ').match(/[a-záéíóúüñ]{3,}/gi) || []).map((w) => w.toLowerCase());
}
export interface TermCount { df: number; neg: number; surfaces: Map<string, number> }
/** Menciones que usan cada término (una vez por mención) y cuántas de ellas son negativas. */
export function countTerms(docs: Array<{ text: string; neg?: boolean }>, stop: Set<string>): Map<string, TermCount> {
  const out = new Map<string, TermCount>();
  for (const d of docs) {
    const seen = new Set<string>();
    for (const w of tokenize(d.text)) {
      const k = termKey(w);
      if (stop.has(k) || stop.has(fold(w))) continue;
      let c = out.get(k);
      if (!c) { c = { df: 0, neg: 0, surfaces: new Map() }; out.set(k, c); }
      c.surfaces.set(w, (c.surfaces.get(w) ?? 0) + 1);
      if (seen.has(k)) continue;
      seen.add(k); c.df++; if (d.neg) c.neg++;
    }
  }
  return out;
}
/** Une los conteos de las dos ventanas en filas con la forma más usada como palabra visible. */
export function termRows(cur: Map<string, TermCount>, prev: Map<string, TermCount>): TermRow[] {
  const keys = new Set([...cur.keys(), ...prev.keys()]);
  const rows: TermRow[] = [];
  for (const k of keys) {
    const a = cur.get(k), b = prev.get(k);
    const surf = new Map<string, number>();
    for (const m of [a?.surfaces, b?.surfaces]) if (m) for (const [w, n] of m) surf.set(w, (surf.get(w) ?? 0) + n);
    const term = [...surf.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length)[0]?.[0] ?? k;
    rows.push({ term, now: a?.df ?? 0, prev: b?.df ?? 0, neg: a?.neg ?? 0 });
  }
  return rows;
}
/** Conjunto de palabras vacías ya plegado, listo para countTerms. */
export function stopSet(words: string[]): Set<string> {
  const s = new Set<string>();
  for (const w of words) { s.add(fold(w.toLowerCase())); s.add(termKey(w)); }
  return s;
}
