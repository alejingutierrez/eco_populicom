/**
 * Reglas de historias, cajón y posible duplicado de las narrativas, y la
 * resolución de filas (día efectivo, deduplicación de artículos, voz). Nacieron
 * en la página Narrativas (#131, `apps/web/src/lib/narrative/overview.ts`) y se
 * mudaron aquí sin cambios (INT-01) para que el correo y el Overview agrupen
 * narrativas en asuntos con las MISMAS reglas que la página.
 *
 * Se calibraron contra datos de prod (DDEC top-40: precisión 1.00,
 * recobertura 0.98; Gobernadora top-80: 1.00 / 0.83). Los umbrales tienen poco
 * margen —con un coseno bajo de 0.47 en vez de 0.44 la saga Negrón·Domenech se
 * parte—, así que no se tocan sin volver a calibrar.
 */

import { decodeEntities } from '../article-text';
import { addDaysYmd } from '../dates';
import {
  articleKey, channelOf, foldText, isMediaMention, isOwnVoice, isTagPage, mentionWhen, usableAuthor, voiceKey, VOICE_LABELS,
} from '../narrative-signals';

// Historias (single-link con arista estricta).
export const STORY_COS_HI = 0.65;
export const STORY_COS_LO = 0.44;
export const STORY_MAX_LIFE_GAP_D = 21;
export const STORY_MAX_PEAK_DIST_D = 60;
// Cajón: activa en ≥ 8 semanas y su mejor ventana de 14 días tiene < 30% de sus menciones.
export const CAJON_MIN_WEEKS = 8;
export const CAJON_MAX_PEAK14_SHARE = 0.3;
// Posible duplicado (n ≥ 5 en ambos lados).
export const DUP_MIN_N = 5;
export const DUP_C1 = { peakDist: 1, cos: 0.72 };
export const DUP_C2 = { peakDist: 3, cos: 0.6, ownedDiff: 0.5 };
/** Canal propio: posts y comentarios en las cuentas de la agencia. */
export const OWNED_PAGE_TYPES = new Set(['facebook', 'instagram', 'linkedin']);

const STOP = new Set('de del la las el los en y a al por para con sin contra su sus un una e o que se pese tras ante sobre entre nuevo nueva lanza presenta'.split(' '));
const stem = (t: string) => t.slice(0, 6);
/** Tokens distintivos del nombre: sin stopwords, de 3 letras o más, recortados a 6. */
export function nameTokens(name: string): Set<string> {
  const out = new Set<string>();
  for (const t of foldText(name).match(/[a-z0-9$]+/g) ?? []) {
    if (t.length > 2 && !STOP.has(t)) out.add(stem(t));
  }
  return out;
}

/** Palabras de nombre que no distinguen una historia de otra (se comparan tras el stem). */
export const GENERIC_NAME = new Set(`renuncia renuncias ley leyes firma firman veta vetos medidas secretario secretaria
  nombramiento nombramientos gobernadora gobernador gobierno gonzalez colon jenniffer puerto rico ddec pridco aaa
  familia
  publicaciones crisis fondos empleados investiga investigacion sistema empresas nuevo nueva anuncia promueve millones
  inicia agencias senado camara exige pide plan programa evento servicio recuperacion restablecimiento averia nivel
  niveles`.split(/\s+/).filter(Boolean).map((t) => stem(foldText(t))));

/** Keywords que no distinguen una historia de otra. */
export const GENERIC_KW = new Set([
  'estado de emergencia', 'renuncia', 'fondos federales', 'desarrollo economico', 'desarrollo económico y comercio',
  'departamento de desarrollo economico y comercio', 'la fortaleza', 'gobernadora', 'gobernadora de puerto rico',
  'gobernadora puerto rico', 'gobierno de puerto rico', 'puerto rico', 'ddec', 'pridco', 'compania de fomento industrial',
  'aaa', 'autoridad de acueductos y alcantarillados', 'departamento de la familia', 'familia', 'pnp', 'ppd', 'jenniffer gonzalez colon', 'jenniffer gonzalez',
  'jenniffer gonzález-colón', 'jennifer gonzalez colon', 'senado de puerto rico', 'camara de representantes',
  'legislatura', 'ley', 'firma', 'crisis', 'corrupcion', 'economia', 'inversion', 'empleos', 'secretario',
  'nombramiento', 'agua', 'sequia', 'interrupciones programadas', 'servicio agua potable', 'niveles de agua',
].map(foldText));

/** Tokens que se ignoran al comparar nombres para el posible duplicado. */
const DUP_BOILER = new Set(['puerto', 'rico', 'ddec', 'pr', 'gonzal', 'colon', 'jennif', 'gobern']);

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

/** Una fila tal como la devuelve el SQL de las rutas (universo ya filtrado). */
export interface RawMentionRow {
  nid: string;
  id: string;
  published_at: Date | string;
  url: string | null;
  title: string | null;
  page_type: string | null;
  author: string | null;
  author_fullname: string | null;
  domain: string | null;
  sentiment: string | null;
  inter: number | string | null;
}

/** Una mención ya resuelta con las reglas de dato de la página. */
export interface NarrRow {
  id: string;
  day: string;
  /** HH:MM en hora de Puerto Rico; null = «solo fecha». */
  time: string | null;
  ts: number;
  channel: 0 | 1 | 2 | 3;
  sentiment: 'n' | 'p' | 'u';
  /** Interacciones (likes + comentarios + compartidos). */
  inter: number;
  voice: string;
  media: boolean;
  tag: boolean;
  own: boolean;
  owned: boolean;
  title: string | null;
  url: string | null;
  pageType: string;
  display: string;
}

export interface RowContext {
  agencySlug: string;
  agencyName: string | null;
  /** Último día con datos (YYYY-MM-DD, ayer en AST): lo posterior se descarta. */
  endYmd: string;
}

function sentimentCode(s: string | null): 'n' | 'p' | 'u' {
  const v = (s ?? '').toLowerCase();
  if (v.startsWith('neg')) return 'n';
  if (v.startsWith('pos')) return 'p';
  return 'u';
}

/** Orden de lectura: por día, y dentro del día por hora (las «solo fecha» al mediodía). */
export const rowOrder = (a: NarrRow, b: NarrRow) =>
  a.day.localeCompare(b.day) || (a.time ?? '12:00').localeCompare(b.time ?? '12:00') || a.ts - b.ts;

/**
 * Agrupa por narrativa, deduplica artículos (un `article_<uuid>` con dos URL
 * cuenta una vez, se queda la publicación más temprana), resuelve «solo fecha»
 * y descarta lo posterior a `endYmd`. Devuelve también el nombre visible de
 * cada voz: el de VOICE_LABELS o, si no, la grafía más frecuente.
 */
export function processRows(raw: RawMentionRow[], ctx: RowContext): {
  byNarr: Map<string, NarrRow[]>;
  voiceLabels: Record<string, string>;
} {
  const sorted = [...raw].sort((a, b) => new Date(a.published_at).getTime() - new Date(b.published_at).getTime());
  const seen = new Map<string, Set<string>>();
  const byNarr = new Map<string, NarrRow[]>();
  const spellings = new Map<string, Map<string, number>>();
  for (const r of sorted) {
    const when = mentionWhen(r.published_at);
    if (when.day > ctx.endYmd) continue;
    const key = articleKey(r.url, r.id);
    let s = seen.get(r.nid);
    if (!s) { s = new Set(); seen.set(r.nid, s); }
    if (s.has(key)) continue;
    s.add(key);
    const author = usableAuthor(r.author_fullname) ? r.author_fullname : usableAuthor(r.author) ? r.author : null;
    const display = decodeEntities((author || r.domain || '').trim()).trim().replace(/^(?:autor|author)\s*:\s*/i, '');
    const voice = voiceKey(author, r.domain);
    let sp = spellings.get(voice);
    if (!sp) { sp = new Map(); spellings.set(voice, sp); }
    // Solo grafías que de verdad nombran a esa voz («Redacción» sola no).
    if (display && voiceKey(display, null) === voice) sp.set(display, (sp.get(display) ?? 0) + 1);
    const pt = (r.page_type ?? '').toLowerCase();
    const row: NarrRow = {
      id: r.id,
      day: when.day,
      time: when.time,
      ts: new Date(r.published_at).getTime(),
      channel: channelOf(pt),
      sentiment: sentimentCode(r.sentiment),
      inter: Math.max(0, Number(r.inter) || 0),
      voice,
      media: isMediaMention(pt, display),
      tag: isTagPage(r.url, r.title),
      own: isOwnVoice(voice, ctx.agencySlug, ctx.agencyName),
      owned: OWNED_PAGE_TYPES.has(pt),
      title: r.title ? decodeEntities(r.title).trim().slice(0, 200) : null,
      url: r.url,
      pageType: pt,
      display,
    };
    let list = byNarr.get(r.nid);
    if (!list) { list = []; byNarr.set(r.nid, list); }
    list.push(row);
  }
  for (const list of byNarr.values()) list.sort(rowOrder);
  // El nombre visible no depende de qué filas trae cada consulta (el tablero
  // y la propagación deben nombrar igual a la misma voz): VOICE_LABELS, si no
  // la grafía con mayúsculas y minúsculas y con espacios, y entre ellas la
  // primera en orden.
  const voiceLabels: Record<string, string> = {};
  const mixed = (x: string) => /[a-záéíóúñ]/.test(x) && /[A-ZÁÉÍÓÚÑ]/.test(x);
  for (const [voice, sp] of spellings) {
    const best = [...sp.keys()].sort((a, b) => Number(mixed(b)) - Number(mixed(a))
      || Number(b.includes(' ')) - Number(a.includes(' ')) || (a < b ? -1 : a > b ? 1 : 0))[0];
    voiceLabels[voice] = VOICE_LABELS[voice] ?? best ?? voice;
  }
  return { byNarr, voiceLabels };
}

/**
 * La mención que inició la narrativa: la más temprana que no sea una página
 * de etiqueta; si ese día hay menciones con hora y «solo fecha», gana la que
 * tiene hora (la «solo fecha» no dice si fue antes o después).
 */
export function firstMention(rows: NarrRow[]): NarrRow | null {
  const real = rows.filter((r) => !r.tag);
  const pool = real.length ? real : rows;
  if (!pool.length) return null;
  return [...pool].sort((a, b) =>
    a.day.localeCompare(b.day) || (a.time === null ? 1 : 0) - (b.time === null ? 1 : 0)
    || (a.time ?? '').localeCompare(b.time ?? '') || a.ts - b.ts)[0];
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

/** Medianoche UTC de un día YYYY-MM-DD, en milisegundos. */
export const dayMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
export const daysBetween = (a: string, b: string) => Math.round((dayMs(b) - dayMs(a)) / 86_400_000);
/** Lunes de la semana del día (semanas de lunes a domingo). */
export function mondayOf(ymd: string): string {
  const dow = new Date(dayMs(ymd)).getUTCDay(); // 0 = domingo
  return addDaysYmd(ymd, -((dow + 6) % 7));
}

/** Inicio de la ventana de 14 días con más menciones, su conteo y su peso sobre el total. */
export function peak14(days: string[]): { start: string | null; n: number; share: number } {
  if (!days.length) return { start: null, n: 0, share: 0 };
  const sorted = [...days].sort();
  let best = 0, bestStart = sorted[0], j = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] === sorted[i - 1]) continue;
    const limit = addDaysYmd(sorted[i], 13);
    if (j < i) j = i;
    while (j < sorted.length && sorted[j] <= limit) j++;
    if (j - i > best) { best = j - i; bestStart = sorted[i]; }
  }
  return { start: bestStart, n: best, share: best / sorted.length };
}

/** ¿Narrativa «cajón» (agregador sin tema común)? Sobre toda su vida. */
export function cajonStats(rows: NarrRow[]): { weeks: number; peakShare: number; isCajon: boolean } {
  const weeks = new Set(rows.map((r) => mondayOf(r.day))).size;
  const { share } = peak14(rows.map((r) => r.day));
  return { weeks, peakShare: share, isCajon: weeks >= CAJON_MIN_WEEKS && share < CAJON_MAX_PEAK14_SHARE };
}

// ---------------------------------------------------------------------------
// Historias y posibles duplicados
// ---------------------------------------------------------------------------

export interface NarrMeta {
  id: string;
  name: string;
  summary: string | null;
  keywords: string[] | null;
  status: string;
  born_at: Date | string | null;
  last_mention_at: Date | string | null;
  created_at: Date | string | null;
}

export interface SimPair { a: string; b: string; sim: number }

export interface StoryCandidate {
  id: string;
  name: string;
  keywords: string[];
  bornMs: number;
  lastMs: number;
  peakStart: string | null;
  /** Menciones en el mapa (para nombrar la historia por su narrativa mayor). */
  size: number;
  life: number;
  ownedShare: number;
}

/** Términos distintivos de cada narrativa, con el tope de frecuencia de la agencia. */
export function distinctiveTerms(
  cands: { id: string; name: string; keywords: string[] }[],
  allAgency: { name: string; keywords: string[] | null }[],
): Map<string, Set<string>> {
  const dfn = new Map<string, number>(), dfk = new Map<string, number>();
  for (const n of allAgency) {
    for (const t of nameTokens(n.name)) dfn.set(t, (dfn.get(t) ?? 0) + 1);
    for (const k of new Set((n.keywords ?? []).map(foldText))) dfk.set(k, (dfk.get(k) ?? 0) + 1);
  }
  const cap = Math.max(5, 0.08 * allAgency.length);
  const out = new Map<string, Set<string>>();
  for (const c of cands) {
    const terms = new Set<string>();
    for (const t of nameTokens(c.name)) if ((dfn.get(t) ?? 0) <= cap && !GENERIC_NAME.has(t)) terms.add(`n:${t}`);
    for (const k of c.keywords.map(foldText)) if ((dfk.get(k) ?? 0) <= cap && !GENERIC_KW.has(k)) terms.add(`k:${k}`);
    out.set(c.id, terms);
  }
  return out;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface Story { id: string; name: string; subtitle: string | null; memberIds: string[] }

/**
 * ¿Dos narrativas son del mismo caso? Hay arista si (1) sus vidas están a ≤ 21
 * días, (2) sus picos de 14 días a ≤ 60 días, y (3) el coseno de centroides es
 * ≥ 0.65, o ≥ 0.44 compartiendo al menos un término distintivo. Es la regla
 * de `groupStories`, separada para que los asuntos abiertos (INT-01) la usen
 * con otra forma de agrupar.
 */
export function isStoryEdge(A: StoryCandidate, B: StoryCandidate, sim: number, terms: Map<string, Set<string>>): boolean {
  const gapD = Math.max(0, Math.max(A.bornMs, B.bornMs) - Math.min(A.lastMs, B.lastMs)) / 86_400_000;
  if (gapD > STORY_MAX_LIFE_GAP_D) return false;
  if (!A.peakStart || !B.peakStart || Math.abs(daysBetween(A.peakStart, B.peakStart)) > STORY_MAX_PEAK_DIST_D) return false;
  if (sim >= STORY_COS_HI) return true;
  if (sim < STORY_COS_LO) return false;
  const ta = terms.get(A.id), tb = terms.get(B.id);
  return !!ta && !!tb && [...ta].some((t) => tb.has(t));
}

/**
 * Agrupa narrativas del mismo caso. Hay arista si (1) sus vidas están a ≤ 21
 * días, (2) sus picos de 14 días a ≤ 60 días, y (3) el coseno de centroides es
 * ≥ 0.65, o ≥ 0.44 compartiendo al menos un término distintivo. Las
 * componentes conexas de 2 o más narrativas son historias. Los cajones no
 * deben llegar aquí.
 */
export function groupStories(
  cands: StoryCandidate[],
  pairs: SimPair[],
  terms: Map<string, Set<string>>,
): Story[] {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const parent = new Map(cands.map((c) => [c.id, c.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let y = x;
    while (parent.get(y) !== r) { const nx = parent.get(y)!; parent.set(y, r); y = nx; }
    return r;
  };
  for (const p of pairs) {
    const A = byId.get(p.a), B = byId.get(p.b);
    if (!A || !B || A.id === B.id) continue;
    if (isStoryEdge(A, B, p.sim, terms)) parent.set(find(A.id), find(B.id));
  }
  const comps = new Map<string, StoryCandidate[]>();
  for (const c of cands) {
    const r = find(c.id);
    const arr = comps.get(r) ?? [];
    arr.push(c);
    comps.set(r, arr);
  }
  const stories: Story[] = [];
  for (const members of comps.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => b.size - a.size || b.life - a.life || a.name.localeCompare(b.name));
    const biggest = members[0];
    let name = biggest.name, subtitle: string | null = null;
    if (members.length >= 3) {
      // La keyword (no genérica) presente en al menos 2/3 de los miembros.
      const count = new Map<string, number>(), display = new Map<string, string>();
      for (const m of members) {
        for (const k of new Set(m.keywords)) {
          const f = foldText(k).trim();
          if (!f || GENERIC_KW.has(f) || GENERIC_KW.has(f.replace(/s$/, ''))) continue;
          count.set(f, (count.get(f) ?? 0) + 1);
          if (!display.has(f)) display.set(f, k.trim());
        }
      }
      const need = (2 / 3) * members.length;
      const best = [...count.entries()].filter(([, n]) => n >= need)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      if (best) {
        const d = display.get(best[0])!;
        name = d.charAt(0).toUpperCase() + d.slice(1);
        subtitle = biggest.name;
      }
    }
    stories.push({ id: `story-${biggest.id}`, name, subtitle, memberIds: members.map((m) => m.id) });
  }
  return stories.sort((a, b) => b.memberIds.length - a.memberIds.length || a.name.localeCompare(b.name));
}

function dupTokens(name: string): Set<string> {
  const out = new Set<string>();
  for (const t of foldText(name).match(/[a-z0-9$]+/g) ?? []) {
    if (t.length <= 2 || STOP.has(t) || /^\d+$/.test(t)) continue;
    const s = stem(t);
    if (!DUP_BOILER.has(s)) out.add(s);
  }
  return out;
}

/**
 * Posibles duplicados: el agrupador parte un mismo hecho entre el canal propio
 * y la prensa, o en dos narrativas con el mismo nombre. Devuelve, para la
 * narrativa menor de cada par, la mayor de la que parece copia.
 */
export function findDuplicates(cands: StoryCandidate[], pairs: SimPair[]): Map<string, { id: string; sim: number }> {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const out = new Map<string, { id: string; sim: number }>();
  for (const p of pairs) {
    if (p.sim < DUP_C2.cos) continue;
    const A = byId.get(p.a), B = byId.get(p.b);
    if (!A || !B || A.life < DUP_MIN_N || B.life < DUP_MIN_N || !A.peakStart || !B.peakStart) continue;
    const dpk = Math.abs(daysBetween(A.peakStart, B.peakStart));
    const c1 = dpk <= DUP_C1.peakDist && p.sim >= DUP_C1.cos;
    let c2 = false;
    if (!c1 && dpk <= DUP_C2.peakDist) {
      const ta = dupTokens(A.name), tb = dupTokens(B.name);
      const inter = [...ta].filter((t) => tb.has(t)).length;
      const jac = inter / Math.max(1, new Set([...ta, ...tb]).size);
      c2 = Math.abs(A.ownedShare - B.ownedShare) >= DUP_C2.ownedDiff || jac >= 0.999;
    }
    if (!c1 && !c2) continue;
    const [small, big] = A.life < B.life || (A.life === B.life && A.id > B.id) ? [A, B] : [B, A];
    const prev = out.get(small.id);
    if (!prev || p.sim > prev.sim) out.set(small.id, { id: big.id, sim: p.sim });
  }
  return out;
}
