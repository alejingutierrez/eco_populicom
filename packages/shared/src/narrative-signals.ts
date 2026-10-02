/**
 * Reglas de dato de la página Narrativas (oct-2026). Funciones puras: las usa
 * /api/narrative/overview para que la serie, el tablero, la propagación y el
 * mapa cuenten exactamente lo mismo.
 *
 * Cada regla corrige un error que un panel de revisión encontró en la maqueta
 * con datos reales de DDEC:
 *  - «Solo fecha»: algunos medios publican con hora 00:00 UTC (sin hora real).
 *    En hora de Puerto Rico eso cae el día ANTERIOR a las 8 p.m., y una nota
 *    del 24 aparecía el 23 como «primera mención» y como crecimiento falso.
 *  - Un artículo con dos URL (El Vocero: dos slugs, mismo `article_<uuid>`)
 *    contaba dos veces.
 *  - Una página de etiqueta (`…/tag/…`, título «… Archives») salía como «la
 *    que inició» una narrativa.
 *  - «Voz» contaba un mismo medio varias veces según el canal o la grafía
 *    (Telemundo Pr / Telemundo PR / telemundopr).
 */

import { decodeEntities } from './article-text';

export const NARRATIVE_TZ = 'America/Puerto_Rico';

export interface MentionWhen {
  /** YYYY-MM-DD del día al que pertenece la mención. */
  day: string;
  /** HH:MM en hora de Puerto Rico; null cuando la mención es «solo fecha». */
  time: string | null;
}

/**
 * Día y hora de una mención. Si `published_at` es exactamente medianoche UTC
 * se trata como «solo fecha»: el día es la fecha UTC y no hay hora.
 */
// Un solo formateador para todas las filas: construir un Intl.DateTimeFormat
// por mención costaba segundos en las ~8 mil filas de Gobernadora.
const PR_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: NARRATIVE_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function mentionWhen(publishedAt: Date | string): MentionWhen {
  const d = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) {
    return { day: d.toISOString().slice(0, 10), time: null };
  }
  const p: Record<string, string> = {};
  for (const part of PR_PARTS.formatToParts(d)) if (part.type !== 'literal') p[part.type] = part.value;
  const hh = p.hour === '24' ? '00' : p.hour;
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${hh}:${p.minute}` };
}

/** Llave de deduplicación: el `article_<uuid>` si la URL lo trae, si no la URL. */
export function articleKey(url: string | null | undefined, fallback: string): string {
  if (!url) return fallback;
  const m = url.match(/article_[0-9a-f-]{20,}/i);
  return m ? m[0].toLowerCase() : url.trim();
}

/** Página de etiqueta o categoría: no es un artículo y no puede «iniciar» nada. */
export function isTagPage(url: string | null | undefined, title: string | null | undefined): boolean {
  if (url && /\/(tag|tags|category|categoria|categorias)\//i.test(url)) return true;
  if (title && /\bArchives\s*$/.test(title.trim())) return true;
  return false;
}

const stripAccents = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

/** Minúsculas y sin acentos: la forma en que se comparan nombres y keywords. */
export const foldText = (s: string): string => stripAccents((s ?? '').toLowerCase());

/** Normaliza un nombre de autor o dominio a una llave comparable. */
export function normalizeVoice(raw: string | null | undefined): string {
  let s = (raw ?? '').trim();
  if (!s) return '';
  s = decodeEntities(s);
  s = s.replace(/\(.*?\)/g, '');
  s = s.replace(/^redacci[oó]n\s*(?:,\s*|del?\s+)?/i, '');
  s = s.replace(/^(?:autor|author|por|by)\s*:\s*|^(?:por|by)\s+/i, '');
  s = s.trim().replace(/\.(com|tv|pr|net|org)(\.pr)?$/i, '');
  return stripAccents(s.toLowerCase()).replace(/[^a-z0-9]/g, '');
}

/**
 * Alias de un mismo medio con varias grafías o cuentas. Las llaves son
 * `normalizeVoice` de cada variante; el valor es la llave canónica.
 */
export const VOICE_ALIASES: Record<string, string> = {
  telemundo: 'telemundopr',
  noticentroporwapa: 'noticentrowapa',
  wapatv: 'noticentrowapa',
  radioisla1320: 'radioislatv',
  radioisla: 'radioislatv',
  elvocerodepuertorico: 'elvocero',
  elvoceropr: 'elvocero',
  notiuno630: 'notiuno',
  noticelpr: 'noticel',
  metropr: 'metro',
  metropuertorico: 'metro',
  primerahorapr: 'primerahora',
  elnuevodiapr: 'elnuevodia',
  jayfonsecapr: 'jayfonseca',
  jayfonsecaprbskysocial: 'jayfonseca',
  yosoymolusco: 'moluscotv',
  jenniffergonzalez: 'jenniffergonzalezcolon',
  jennifergonzalezcolon: 'jenniffergonzalezcolon',
  departamentodedesarrolloeconomicoycomercio: 'desarrollopr',
  ddecpuertorico: 'desarrollopr',
  lafortaleza: 'lafortalezadepr',
};

/** Nombre visible para las llaves canónicas conocidas. */
export const VOICE_LABELS: Record<string, string> = {
  telemundopr: 'Telemundo PR',
  noticentrowapa: 'Noticentro (WAPA)',
  radioislatv: 'Radio Isla 1320',
  elvocero: 'El Vocero',
  primerahora: 'Primera Hora',
  elnuevodia: 'El Nuevo Día',
  esnoticiapr: 'Es Noticia PR',
  notiuno: 'NotiUno',
  noticel: 'NotiCel',
  metro: 'Metro Puerto Rico',
  jayfonseca: 'Jay Fonseca',
  waloradio: 'WALO Radio',
  wipr: 'WIPR',
  victoria840: 'Victoria 840',
  wapadigital: 'WAPA Digital',
  moluscotv: 'Molusco TV',
  jenniffergonzalezcolon: 'Jenniffer González Colón',
  desarrollopr: 'DDEC (cuentas propias)',
  lafortalezadepr: 'La Fortaleza de PR',
};

/** Cómo se nombra a la propia agencia cuando ella inició una narrativa. */
export const AGENCY_SHORT_LABEL: Record<string, string> = {
  ddecpr: 'DDEC', aaa: 'AAA', gobernadora: 'Gobernadora', sgpr: 'SGPR',
};
/** El mismo nombre con su artículo, para la prosa («no la inició el DDEC»). */
export const AGENCY_ARTICLE_LABEL: Record<string, string> = {
  ddecpr: 'el DDEC', aaa: 'la AAA', gobernadora: 'la Gobernadora', sgpr: 'la SGPR',
};

/** Cuentas propias por agencia (además de la que coincide con su nombre). */
export const AGENCY_OWN_VOICES: Record<string, string[]> = {
  ddecpr: ['desarrollopr', 'ddecpr', 'ddec'],
  aaa: ['aaapr', 'acueductospr', 'autoridaddeacueductosyalcantarillados'],
  gobernadora: ['jenniffergonzalezcolon', 'jgo', 'fortalezapr', 'lafortalezadepr', 'gobiernodepuertorico'],
  sgpr: ['secretariadelagobernacion', 'secretariadelagobernacionpr'],
};

/** Voces institucionales de política (para el origen «Política»). */
export const POLITICS_VOICES = new Set([
  'senadopuertorico', 'senadodepuertorico', 'camaraderepresentantes', 'camaraderepresentantesdepuertorico',
  'jenniffergonzalezcolon',
]);

// Brandwatch pone el tiempo de lectura en `author` para El Nuevo Día y
// Primera Hora («2 minutes»): eso no es una voz, manda el dominio.
const READING_TIME_RE = /^\s*\d+\s*(min(ute)?s?|minutos?)\s*$/i;

/** ¿El texto de autor sirve como voz? (no vacío y no un tiempo de lectura). */
export function usableAuthor(author: string | null | undefined): boolean {
  return !!author && !READING_TIME_RE.test(author) && normalizeVoice(author) !== '';
}

/** Llave canónica de la voz de una mención: autor, si no el dominio. */
export function voiceKey(author: string | null | undefined, domain: string | null | undefined): string {
  const k = (usableAuthor(author) ? normalizeVoice(author) : '') || normalizeVoice(domain) || 'desconocido';
  return VOICE_ALIASES[k] ?? k;
}

/** ¿La voz es una cuenta de la propia agencia? */
export function isOwnVoice(key: string, agencySlug: string, agencyName: string | null | undefined): boolean {
  if (!key) return false;
  if (agencyName && normalizeVoice(agencyName) === key) return true;
  return (AGENCY_OWN_VOICES[agencySlug] ?? []).includes(key);
}

// Las palabras que también son nombres de persona o de lugar van ancladas
// («Rosalyn Lopez Victoria» comentando en Facebook no es Victoria 840).
const MEDIA_RE = /perla|noti|telemundo|wapa|vocero|primera ?hora|nuevo ?d[ií]a|radio|walo|\bmetro\b|sin ?comillas|calce|pelota|es ?noticia|wipr|univision|teleonce|cybernews|rtz|news|peri[oó]dico|redacci[oó]n|victoria ?840|magazine|jagual|foro noticioso|\btimes\b|agenda ?oriental|la isla\b|isla ?news|daily star|\bla semana\b|v[ií]gia/i;

/** ¿La mención viene de un medio (nota de prensa, o la cuenta de un medio en redes)? */
export function isMediaMention(pageType: string | null | undefined, displayName: string | null | undefined): boolean {
  const pt = (pageType ?? '').toLowerCase();
  return pt === 'news' || pt === 'blog' || MEDIA_RE.test(displayName ?? '');
}

/** Carril de la propagación: 0 noticias · 1 Facebook · 2 Instagram · 3 otras redes. */
export function channelOf(pageType: string | null | undefined): 0 | 1 | 2 | 3 {
  const pt = (pageType ?? '').toLowerCase();
  if (pt === 'news' || pt === 'blog') return 0;
  if (pt.startsWith('facebook')) return 1;
  if (pt.startsWith('instagram')) return 2;
  return 3;
}

export type NarrativeOrigin = 'propia' | 'prensa' | 'politica' | 'redes';

/** Quién inició la narrativa, a partir de su primera mención real. */
export function originOf(args: {
  key: string; pageType: string | null | undefined; displayName: string | null | undefined;
  agencySlug: string; agencyName: string | null | undefined;
}): NarrativeOrigin {
  if (isOwnVoice(args.key, args.agencySlug, args.agencyName)) return 'propia';
  if (POLITICS_VOICES.has(args.key)) return 'politica';
  if (isMediaMention(args.pageType, args.displayName)) return 'prensa';
  return 'redes';
}

/** Una sola regla de «negativo» para toda la página: ≥ 30% con al menos 8 menciones. */
export const NARRATIVE_NEG_RULE = { share: 0.3, minN: 8 } as const;
export function isNegativeShare(neg: number, n: number): boolean {
  return n >= NARRATIVE_NEG_RULE.minN && neg / n >= NARRATIVE_NEG_RULE.share;
}
