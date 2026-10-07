/**
 * Scorecard (oct-2026): quién habló en la ventana.
 *
 * Cuatro tipos de voz, por quién publica la mención:
 *  - la agencia: sus propias cuentas (las mismas que Narrativas reconoce como
 *    voz propia);
 *  - prensa: notas de medios y las cuentas de los medios en redes;
 *  - gobierno y política: legislatura, partidos, municipios, la Fortaleza y
 *    otras dependencias;
 *  - ciudadanía y otras cuentas: el resto.
 * A los ciudadanos nunca se los nombra: en la lista de voces salen como «Una
 * persona» (ECO no apunta a individuos).
 */
import { decodeEntities, isMediaMention, isOwnVoice, POLITICS_VOICES, usableAuthor, voiceKey } from '@eco/shared';

export type VoiceCat = 'agencia' | 'prensa' | 'gobierno' | 'ciudadania';
export const VOICE_CATS: { k: VoiceCat; label: string }[] = [
  { k: 'agencia', label: 'La agencia' },
  { k: 'prensa', label: 'Prensa' },
  { k: 'gobierno', label: 'Gobierno y política' },
  { k: 'ciudadania', label: 'Ciudadanía y otras cuentas' },
];

// Cuentas institucionales y políticas por su nombre visible. «Departamento de»
// excluye al propio DDEC, que ya es voz de la agencia cuando la consulta es suya.
const GOV_RE = /senado|c[aá]mara de representantes|partido|gobernadora|jenniffer|fortaleza|alcald|municipio|legislador|representante|senador|gobierno de puerto rico|departamento de|oficina de|autoridad de|compa[nñ][ií]a de fomento|pridco|junta de/i;

/** Fila agregada que devuelve el SQL: una por día y autor. */
export interface VoiceRow {
  day: string;
  author: string | null;
  author_fullname: string | null;
  domain: string | null;
  page_type: string | null;
  n: number | string;
  neg: number | string;
  inter: number | string;
  zero: number | string;
}

export interface Classified { cat: VoiceCat; key: string; display: string }

export function classifyVoice(r: Pick<VoiceRow, 'author' | 'author_fullname' | 'domain' | 'page_type'>, agencySlug: string, agencyName: string | null): Classified {
  const author = usableAuthor(r.author_fullname) ? r.author_fullname : usableAuthor(r.author) ? r.author : null;
  const display = decodeEntities((author || r.domain || '').trim()).trim();
  const key = voiceKey(author, r.domain);
  if (isOwnVoice(key, agencySlug, agencyName)) return { cat: 'agencia', key, display };
  if (isMediaMention(r.page_type, display)) return { cat: 'prensa', key, display };
  if (POLITICS_VOICES.has(key) || GOV_RE.test(display)) return { cat: 'gobierno', key, display };
  return { cat: 'ciudadania', key, display };
}

export interface VoicesPayload {
  cats: { k: VoiceCat; label: string; n: number; neg: number; inter: number; voices: number; nPrev: number; negPrev: number }[];
  daily: ({ date: string } & Record<VoiceCat, number>)[];
  concentration: { total: number; top1: number; top5: number; zero: number; n: number };
  top: { name: string | null; cat: VoiceCat; n: number; inter: number; neg: number }[];
  distinct: number;
  distinctPrev: number;
  newVoices: number;
}

const num = (v: number | string | null | undefined) => Number(v) || 0;

/**
 * @param cur  filas de la ventana actual
 * @param prev filas de la ventana previa
 * @param prior llaves de voz vistas en las 5 semanas antes de la ventana (voces nuevas)
 * @param days los días de la ventana actual, en orden
 */
export function buildVoices(args: {
  cur: VoiceRow[]; prev: VoiceRow[]; prior: Pick<VoiceRow, 'author' | 'author_fullname' | 'domain' | 'page_type'>[];
  days: string[]; agencySlug: string; agencyName: string | null;
}): VoicesPayload {
  const { cur, prev, prior, days, agencySlug, agencyName } = args;
  const cls = (r: Pick<VoiceRow, 'author' | 'author_fullname' | 'domain' | 'page_type'>) => classifyVoice(r, agencySlug, agencyName);
  const cats = VOICE_CATS.map((c) => ({ ...c, n: 0, neg: 0, inter: 0, voices: 0, nPrev: 0, negPrev: 0 }));
  const byCat = new Map(cats.map((c) => [c.k, c]));
  const voiceSets = new Map<VoiceCat, Set<string>>(VOICE_CATS.map((c) => [c.k, new Set()]));
  const dailyMap = new Map(days.map((d) => [d, { date: d, agencia: 0, prensa: 0, gobierno: 0, ciudadania: 0 }]));
  const byVoice = new Map<string, { cat: VoiceCat; display: string; n: number; inter: number; neg: number }>();
  let total = 0, zero = 0, n = 0;
  for (const r of cur) {
    const c = cls(r), cnt = num(r.n);
    const cat = byCat.get(c.cat)!;
    cat.n += cnt; cat.neg += num(r.neg); cat.inter += num(r.inter);
    voiceSets.get(c.cat)!.add(c.key);
    const day = dailyMap.get(r.day);
    if (day) day[c.cat] += cnt;
    const v = byVoice.get(c.key) ?? { cat: c.cat, display: c.display, n: 0, inter: 0, neg: 0 };
    v.n += cnt; v.inter += num(r.inter); v.neg += num(r.neg);
    if (!v.display && c.display) v.display = c.display;
    byVoice.set(c.key, v);
    total += num(r.inter); zero += num(r.zero); n += cnt;
  }
  for (const c of cats) c.voices = voiceSets.get(c.k)!.size;
  const prevKeys = new Set<string>();
  for (const r of prev) {
    const c = cls(r), cat = byCat.get(c.cat)!;
    cat.nPrev += num(r.n); cat.negPrev += num(r.neg); prevKeys.add(c.key);
  }
  const priorKeys = new Set(prior.map((r) => cls(r).key));
  const ranked = [...byVoice.values()].sort((a, b) => b.inter - a.inter || b.n - a.n);
  return {
    cats,
    daily: [...dailyMap.values()],
    concentration: {
      total,
      top1: ranked[0]?.inter ?? 0,
      top5: ranked.slice(0, 5).reduce((s, v) => s + v.inter, 0),
      zero, n,
    },
    top: ranked.slice(0, 6).map((v) => ({ name: v.cat === 'ciudadania' ? null : v.display || null, cat: v.cat, n: v.n, inter: v.inter, neg: v.neg })),
    distinct: byVoice.size,
    distinctPrev: prevKeys.size,
    newVoices: [...byVoice.keys()].filter((k) => !priorKeys.has(k)).length,
  };
}
