/**
 * Página Narrativas (oct-2026): todo lo que se calcula a partir de las
 * menciones vive aquí, en funciones puras, para que la serie (01), el tablero
 * (02), la propagación (03) y el mapa (04) cuenten exactamente lo mismo y para
 * poder probarlo sin base de datos. Las rutas solo traen filas.
 *
 * Las reglas de historias, cajón y posible duplicado se calibraron contra
 * datos de prod (DDEC top-40: precisión 1.00, recobertura 0.98; Gobernadora
 * top-80: 1.00 / 0.83). Los umbrales tienen poco margen —con un coseno bajo de
 * 0.47 en vez de 0.44 la saga Negrón·Domenech se parte—, así que no se tocan
 * sin volver a calibrar.
 */

import {
  AGENCY_ARTICLE_LABEL, AGENCY_SHORT_LABEL, addDaysYmd, articleKey, channelOf, decodeEntities, foldText, isMediaMention, isNegativeShare,
  isOwnVoice, isTagPage, mentionWhen, NARRATIVE_TZ, originOf, usableAuthor, voiceKey, VOICE_LABELS, ymdInTimeZone,
  type NarrativeOrigin,
} from '@eco/shared';

// ---------------------------------------------------------------------------
// Constantes de la página
// ---------------------------------------------------------------------------

/** Días de la serie de historias (01). */
export const SERIES_DAYS = 30;
/** Semanas del mapa (04): la semana en curso y las 25 anteriores. */
export const MAP_WEEKS = 26;
/** Narrativas vivas y terminadas que entran a la serie. */
export const SERIES_LIVE_N = 6;
export const SERIES_ENDED_N = 2;
/** Una terminada entra a la serie solo si tuvo al menos 3 menciones en esos 30 días (1 o 2 no se ven). */
export const SERIES_ENDED_MIN = 3;
/** Un carril del mapa necesita 15 menciones en las 26 semanas (salvo que esté en la serie o viva). */
export const MAP_MIN_N = 15;
/** Carriles que el mapa muestra antes de «Ver todas». */
export const MAP_CORE_MAX = 40;

const LIVE_STATUSES = new Set(['emerging', 'active', 'peaking', 'revived', 'declining']);
export type BoardColumn = 'emerging' | 'active' | 'declining';
const COLUMN_OF: Record<string, BoardColumn> = {
  emerging: 'emerging', active: 'active', peaking: 'active', revived: 'active', declining: 'declining',
};

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
  publicaciones crisis fondos empleados investiga investigacion sistema empresas nuevo nueva anuncia promueve millones
  inicia agencias senado camara exige pide plan programa evento servicio recuperacion restablecimiento averia nivel
  niveles`.split(/\s+/).filter(Boolean).map((t) => stem(foldText(t))));

/** Keywords que no distinguen una historia de otra. */
export const GENERIC_KW = new Set([
  'estado de emergencia', 'renuncia', 'fondos federales', 'desarrollo economico', 'desarrollo económico y comercio',
  'departamento de desarrollo economico y comercio', 'la fortaleza', 'gobernadora', 'gobernadora de puerto rico',
  'gobernadora puerto rico', 'gobierno de puerto rico', 'puerto rico', 'ddec', 'pridco', 'compania de fomento industrial',
  'aaa', 'autoridad de acueductos y alcantarillados', 'pnp', 'ppd', 'jenniffer gonzalez colon', 'jenniffer gonzalez',
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

const dayMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
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
    const gapD = Math.max(0, Math.max(A.bornMs, B.bornMs) - Math.min(A.lastMs, B.lastMs)) / 86_400_000;
    if (gapD > STORY_MAX_LIFE_GAP_D) continue;
    if (!A.peakStart || !B.peakStart || Math.abs(daysBetween(A.peakStart, B.peakStart)) > STORY_MAX_PEAK_DIST_D) continue;
    let ok = p.sim >= STORY_COS_HI;
    if (!ok && p.sim >= STORY_COS_LO) {
      const ta = terms.get(A.id), tb = terms.get(B.id);
      ok = !!ta && !!tb && [...ta].some((t) => tb.has(t));
    }
    if (ok) parent.set(find(A.id), find(B.id));
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

// ---------------------------------------------------------------------------
// Agregado de la página
// ---------------------------------------------------------------------------

export interface OverviewNarrative {
  id: string;
  name: string;
  summary: string | null;
  status: string;
  column: BoardColumn | null;
  createdDay: string | null;
  bornDay: string;
  lastDay: string;
  origin: NarrativeOrigin;
  starter: string;
  starterTime: string | null;
  /** Menciones de toda la vida (universo de la página, deduplicadas). */
  life: number;
  d30: number[];
  m30: number;
  m7: number;
  m7p: number;
  neg7: number;
  pos7: number;
  press7: number;
  voices7: number;
  /** Menciones por semana del mapa, de la más antigua a la más reciente. */
  w: number[];
  wn: number[];
  n180: number;
  storyId: string | null;
  dupOf: { id: string; name: string } | null;
  inSeries: boolean;
  inBoard: boolean;
  inMap: boolean;
  inMapCore: boolean;
}

export interface OverviewInput {
  agency: { slug: string; name: string | null };
  endYmd: string;
  rows: RawMentionRow[];
  metas: NarrMeta[];
  /** Nombre y keywords de TODAS las narrativas vivas de la agencia (frecuencia de términos). */
  agencyNames: { name: string; keywords: string[] | null }[];
  pairs: SimPair[];
  /** Menciones del universo por día (todas, estén o no en una narrativa). */
  contextDays: { day: string; total: number; in_narr: number }[];
  statusCounts: { status: string; n: number; first_born: Date | string | null }[];
}

export interface OverviewPayload {
  /** `short`: cómo se nombra a la agencia cuando ella inició una narrativa («DDEC»); `article`, con artículo («el DDEC»). */
  agency: { slug: string; name: string | null; short: string; article: string };
  asOf: string;
  windows: {
    series: { from: string; to: string; days: string[] };
    week: { from: string; to: string };
    prevWeek: { from: string; to: string };
    map: { from: string; to: string; weeks: string[]; partialDays: number | null };
  };
  narratives: OverviewNarrative[];
  series: string[];
  board: Record<BoardColumn, string[]>;
  lanes: string[];
  stories: Story[];
  context: { week: string; total: number; inNarr: number }[];
  alertId: string | null;
  cajones: { id: string; name: string; life: number; bornDay: string }[];
  counts: { live: number; dormant: number; dormantSince: string | null };
}

const toMs = (v: Date | string | null | undefined): number | null => {
  if (v == null) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};
/** Día en hora de Puerto Rico de un instante (detección, primera narrativa). */
const toYmd = (v: Date | string | null | undefined): string | null => {
  const t = toMs(v);
  return t == null ? null : ymdInTimeZone(new Date(t), NARRATIVE_TZ);
};

/** Arma el payload de /api/narrative/overview. */
export function buildOverview(input: OverviewInput): OverviewPayload {
  const { endYmd } = input;
  const seriesFrom = addDaysYmd(endYmd, -(SERIES_DAYS - 1));
  const seriesDays = Array.from({ length: SERIES_DAYS }, (_, i) => addDaysYmd(seriesFrom, i));
  const weekFrom = addDaysYmd(endYmd, -6), prevTo = addDaysYmd(endYmd, -7), prevFrom = addDaysYmd(endYmd, -13);
  const lastMonday = mondayOf(endYmd);
  const weeks = Array.from({ length: MAP_WEEKS }, (_, i) => addDaysYmd(lastMonday, -7 * (MAP_WEEKS - 1 - i)));
  const mapFrom = weeks[0];
  const partial = daysBetween(lastMonday, endYmd) + 1;

  const { byNarr, voiceLabels } = processRows(input.rows, {
    agencySlug: input.agency.slug, agencyName: input.agency.name, endYmd,
  });
  const metaById = new Map(input.metas.map((m) => [m.id, m]));
  const seriesIdx = new Map(seriesDays.map((d, i) => [d, i]));

  interface Work extends OverviewNarrative { cajon: boolean; peakStart: string | null; ownedShare: number; meta: NarrMeta }
  const work: Work[] = [];
  const cajones: OverviewPayload['cajones'] = [];
  for (const [nid, rows] of byNarr) {
    const meta = metaById.get(nid);
    if (!meta || !rows.length) continue;
    const first = firstMention(rows)!;
    const caj = cajonStats(rows);
    const d30 = seriesDays.map(() => 0);
    const w = weeks.map(() => 0), wn = weeks.map(() => 0);
    let m7 = 0, m7p = 0, neg7 = 0, pos7 = 0, press7 = 0, owned = 0;
    const voices7 = new Set<string>();
    for (const r of rows) {
      if (r.owned) owned++;
      const si = seriesIdx.get(r.day);
      if (si !== undefined) d30[si]++;
      if (r.day >= weekFrom && r.day <= endYmd) {
        m7++; voices7.add(r.voice);
        if (r.sentiment === 'n') neg7++;
        if (r.sentiment === 'p') pos7++;
        if (r.media) press7++;
      } else if (r.day >= prevFrom && r.day <= prevTo) m7p++;
      if (r.day >= mapFrom) {
        const wi = Math.floor(daysBetween(mapFrom, r.day) / 7);
        if (wi >= 0 && wi < MAP_WEEKS) { w[wi]++; if (r.sentiment === 'n') wn[wi]++; }
      }
    }
    const lastDay = rows[rows.length - 1].day;
    if (caj.isCajon) {
      cajones.push({ id: nid, name: meta.name, life: rows.length, bornDay: first.day });
      continue;
    }
    work.push({
      id: nid,
      name: meta.name,
      summary: meta.summary,
      status: meta.status,
      column: COLUMN_OF[meta.status] ?? null,
      createdDay: toYmd(meta.created_at),
      bornDay: first.day,
      lastDay,
      origin: originOf({
        key: first.voice, pageType: first.pageType, displayName: first.display,
        agencySlug: input.agency.slug, agencyName: input.agency.name,
      }),
      starter: voiceLabels[first.voice] ?? first.voice,
      starterTime: first.time,
      life: rows.length,
      d30, m30: d30.reduce((a, b) => a + b, 0),
      m7, m7p, neg7, pos7, press7, voices7: voices7.size,
      w, wn, n180: w.reduce((a, b) => a + b, 0),
      storyId: null, dupOf: null,
      inSeries: false, inBoard: false, inMap: false, inMapCore: false,
      cajon: false,
      peakStart: peak14(rows.map((r) => r.day)).start,
      ownedShare: owned / rows.length,
      meta,
    });
  }

  const byId = new Map(work.map((n) => [n.id, n]));

  // 02 · Tablero: las vivas (naciendo, activas, apagándose).
  const live = work.filter((n) => LIVE_STATUSES.has(n.status) && n.column);
  const board: Record<BoardColumn, string[]> = { emerging: [], active: [], declining: [] };
  for (const n of [...live].sort((a, b) => b.m7 - a.m7 || b.life - a.life || a.name.localeCompare(b.name))) {
    board[n.column!].push(n.id);
    n.inBoard = true;
  }

  // 01 · Serie: las 6 vivas con más menciones en 30 días y las 2 que terminaron más recientemente.
  const seriesLive = live.filter((n) => n.m30 > 0)
    .sort((a, b) => b.m30 - a.m30 || b.life - a.life || a.name.localeCompare(b.name)).slice(0, SERIES_LIVE_N);
  const seriesEnded = work.filter((n) => n.status === 'dormant' && n.m30 >= SERIES_ENDED_MIN)
    .sort((a, b) => b.lastDay.localeCompare(a.lastDay) || b.life - a.life || a.name.localeCompare(b.name))
    .slice(0, SERIES_ENDED_N);
  const series = [...seriesLive, ...seriesEnded].map((n) => n.id);
  for (const id of series) byId.get(id)!.inSeries = true;

  // Alerta: nace una narrativa que no inició la agencia, con negativas y ≥ 8 menciones en 7 días.
  const alert = live.filter((n) => n.column === 'emerging' && n.origin !== 'propia' && n.neg7 > 0 && n.m7 >= 8)
    .sort((a, b) => b.m7 - a.m7 || b.neg7 - a.neg7)[0];

  // 04 · Mapa: 15+ menciones en las 26 semanas, más las de la serie y el tablero.
  // La vista inicial (`inMapCore`) lleva la serie y la alerta y se completa con
  // las más grandes hasta 40; el SPA añade la elegida si quedó fuera.
  const lastWeekIdx = (n: Work) => n.w.reduce((m, c, i) => (c ? i : m), -1);
  const laneNarrs = work.filter((n) => n.n180 > 0 && (n.n180 >= MAP_MIN_N || n.inSeries || n.inBoard))
    .sort((a, b) => lastWeekIdx(b) - lastWeekIdx(a) || b.n180 - a.n180 || a.name.localeCompare(b.name));
  for (const n of laneNarrs) n.inMap = true;
  const core = new Set(laneNarrs.filter((n) => n.inSeries || n.id === alert?.id).map((n) => n.id));
  for (const n of [...laneNarrs].sort((a, b) => b.n180 - a.n180 || a.name.localeCompare(b.name))) {
    if (core.size >= MAP_CORE_MAX) break;
    core.add(n.id);
  }
  for (const n of laneNarrs) n.inMapCore = core.has(n.id);
  const lanes = laneNarrs.map((n) => n.id);

  // Contexto del mapa: todas las menciones de la agencia por semana.
  const ctx = weeks.map((wk) => ({ week: wk, total: 0, inNarr: 0 }));
  for (const c of input.contextDays) {
    if (c.day < mapFrom || c.day > endYmd) continue;
    const wi = Math.floor(daysBetween(mapFrom, c.day) / 7);
    if (wi < 0 || wi >= MAP_WEEKS) continue;
    ctx[wi].total += Number(c.total) || 0;
    ctx[wi].inNarr += Number(c.in_narr) || 0;
  }

  // Historias y duplicados SOLO entre las narrativas de la página (sin
  // cajones), como en la calibración (top 40-80 por menciones): con todas las
  // que tocan el mapa, narrativas diminutas y ocultas encadenaban historias
  // sin relación (Trump Accounts → resolución → estadidad).
  const included = work.filter((n) => n.inSeries || n.inBoard || n.inMap);
  const cands: StoryCandidate[] = included.map((n) => ({
    id: n.id,
    name: n.name,
    keywords: n.meta.keywords ?? [],
    bornMs: toMs(n.meta.born_at) ?? dayMs(n.bornDay),
    lastMs: toMs(n.meta.last_mention_at) ?? dayMs(n.lastDay),
    peakStart: n.peakStart,
    size: n.n180,
    life: n.life,
    ownedShare: n.ownedShare,
  }));
  const terms = distinctiveTerms(cands, input.agencyNames);
  const shownStories = groupStories(cands, input.pairs, terms);
  for (const st of shownStories) for (const id of st.memberIds) byId.get(id)!.storyId = st.id;
  const dups = findDuplicates(cands, input.pairs);
  for (const n of included) {
    const d = dups.get(n.id);
    if (d && byId.has(d.id)) n.dupOf = { id: d.id, name: byId.get(d.id)!.name };
  }
  const dormantRow = input.statusCounts.find((s) => s.status === 'dormant');

  return {
    agency: {
      ...input.agency,
      short: AGENCY_SHORT_LABEL[input.agency.slug] ?? (input.agency.slug || '').toUpperCase(),
      article: AGENCY_ARTICLE_LABEL[input.agency.slug] ?? `la agencia ${(input.agency.slug || '').toUpperCase()}`,
    },
    asOf: endYmd,
    windows: {
      series: { from: seriesFrom, to: endYmd, days: seriesDays },
      week: { from: weekFrom, to: endYmd },
      prevWeek: { from: prevFrom, to: prevTo },
      map: { from: mapFrom, to: endYmd, weeks, partialDays: partial < 7 ? partial : null },
    },
    narratives: included.map(({ cajon: _c, peakStart: _p, ownedShare: _o, meta: _m, ...pub }) => pub),
    series,
    board,
    lanes,
    stories: shownStories,
    context: ctx,
    alertId: alert?.id ?? null,
    cajones: cajones.sort((a, b) => b.life - a.life),
    counts: {
      live: live.length,
      dormant: Number(dormantRow?.n ?? 0),
      dormantSince: toYmd(dormantRow?.first_born ?? null),
    },
  };
}

// ---------------------------------------------------------------------------
// Propagación (03)
// ---------------------------------------------------------------------------

export interface PropagationRow {
  d: string;
  t: string | null;
  c: 0 | 1 | 2 | 3;
  s: 'n' | 'p' | 'u';
  e: number;
  v: string;
  m: 0 | 1;
  j: 0 | 1;
  o: 0 | 1;
  ti: string | null;
  u: string | null;
}

/** Filas compactas de una narrativa para la propagación. */
export function propagationRows(rows: NarrRow[]): PropagationRow[] {
  return rows.map((r) => ({
    d: r.day, t: r.time, c: r.channel, s: r.sentiment, e: r.inter, v: r.voice,
    m: r.media ? 1 : 0, j: r.tag ? 1 : 0, o: r.own ? 1 : 0, ti: r.title,
    u: r.url && /^https?:\/\//i.test(r.url) ? r.url : null,
  }));
}
