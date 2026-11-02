/**
 * Fixtures REALES (agregados, sin texto ni autores) de producción para las
 * pruebas del universo pertinente. Salen de SELECT acotados con
 * `GROUP BY` sobre `mentions` (2-nov-2026); cada fila es un grupo con su
 * conteo, no una mención. `expandGroups` las vuelve menciones sintéticas para
 * ejercitar los predicados en memoria.
 *
 * Ventanas (días PR, límites 04:00Z):
 *  - DDEC actual  25–31 oct (correo del 1-nov: 647 = 456 neu + 56 neg + 135 pos)
 *  - DDEC previa  18–24 oct
 *  - DF actual    26 oct–1 nov (correo del 2-nov: 362 = 166 neu + 195 neg + 1 pos)
 *  - DF previa    19–25 oct
 *
 * Tupla: [page_type, pub_type, url con #channels_comment, guid con #,
 *         is_duplicate, nlp_pertinence ('NULL' = sin clasificar),
 *         sentimiento COALESCE(nlp, bw) ('NULL' = ninguno), n]
 */
export type MentionGroup = readonly [
  pageType: string, pubType: string | null, urlComment: boolean, guidHash: boolean,
  isDuplicate: boolean, pertinence: string, sentiment: string, n: number,
];

export interface SyntheticMention {
  page_type: string;
  pub_type: string | null;
  url: string | null;
  bw_guid: string | null;
  is_duplicate: boolean;
  nlp_pertinence: string | null;
  sentiment: string | null;
}

/** Expande los grupos en menciones sintéticas (una por unidad de `n`). */
export function expandGroups(groups: readonly MentionGroup[]): SyntheticMention[] {
  const out: SyntheticMention[] = [];
  for (const [pageType, pubType, urlComment, guidHash, dup, pert, s, n] of groups) {
    for (let i = 0; i < n; i++) {
      out.push({
        page_type: pageType,
        pub_type: pubType,
        url: urlComment ? 'https://www.facebook.com/123#channels_comment_456' : 'https://example.org/x',
        bw_guid: guidHash ? '17900000000000000#17800000000000000' : '17900000000000000',
        is_duplicate: dup,
        nlp_pertinence: pert === 'NULL' ? null : pert,
        sentiment: s === 'NULL' ? null : s,
      });
    }
  }
  return out;
}

export const DDEC_CUR_GROUPS: readonly MentionGroup[] = [
  ["facebook", "FACEBOOK", true, false, false, "alta", "neutral", 220],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, true, false, "alta", "neutral", 80],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, true, false, "alta", "positivo", 60],
  ["facebook", "FACEBOOK", true, false, false, "baja", "neutral", 56],
  ["facebook", "FACEBOOK", true, false, false, "alta", "positivo", 51],
  ["facebook", "FACEBOOK", true, false, true, "alta", "neutral", 48],
  ["facebook", "FACEBOOK", true, false, false, "alta", "negativo", 36],
  ["facebook", "FACEBOOK", true, false, false, "media", "neutral", 35],
  ["facebook", "FACEBOOK", true, false, false, "baja", "negativo", 31],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "baja", "neutral", 27],
  ["facebook", "FACEBOOK", false, false, false, "alta", "neutral", 22],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, false, false, "alta", "neutral", 21],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, true, true, "alta", "positivo", 19],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, true, false, "media", "neutral", 18],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "alta", "neutral", 16],
  ["facebook", "FACEBOOK", true, false, false, "media", "negativo", 14],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "media", "neutral", 13],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "alta", "neutral", 12],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "baja", "neutral", 9],
  ["facebook", "FACEBOOK", true, false, false, "media", "positivo", 9],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, true, true, "alta", "neutral", 8],
  ["instagram", "INSTAGRAM_GRAPH_MENTION_CAPTION", false, false, false, "baja", "neutral", 7],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "media", "neutral", 7],
  ["linkedin", "LINKEDIN", false, false, false, "alta", "neutral", 7],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, true, false, "media", "positivo", 7],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, true, false, "baja", "neutral", 6],
  ["facebook", "FACEBOOK", true, false, false, "baja", "positivo", 6],
  ["facebook", "FACEBOOK", true, false, true, "alta", "positivo", 4],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, true, false, "media", "negativo", 3],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "baja", "neutral", 2],
  ["facebook", "FACEBOOK", true, false, true, "baja", "neutral", 2],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, true, false, "alta", "negativo", 2],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, true, false, "baja", "negativo", 2],
  ["instagram", "INSTAGRAM_GRAPH_MENTION_CAPTION", false, false, false, "media", "positivo", 2],
  ["instagram", "INSTAGRAM_GRAPH_MENTION_COMMENT", false, true, false, "baja", "neutral", 2],
  ["linkedin", "LINKEDIN", false, false, false, "baja", "positivo", 2],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "baja", "negativo", 2],
  ["instagram", "INSTAGRAM_GRAPH_MENTION_CAPTION", false, false, false, "media", "neutral", 1],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "alta", "positivo", 1],
  ["instagram", "INSTAGRAM_GRAPH_MENTION_COMMENT", false, true, false, "alta", "neutral", 1],
  ["facebook", "FACEBOOK", false, false, false, "alta", "positivo", 1],
  ["blog", "BOARDREADER_BLOGS", false, false, false, "alta", "neutral", 1],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "media", "negativo", 1],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "media", "positivo", 1],
  ["facebook", "FACEBOOK", true, false, true, "media", "neutral", 1],
  ["linkedin", "LINKEDIN", false, false, false, "alta", "positivo", 1],
  ["linkedin", "LINKEDIN", false, false, false, "baja", "neutral", 1],
  ["facebook", "FACEBOOK", true, false, true, "alta", "negativo", 1],
  ["linkedin", "LINKEDIN", false, false, true, "alta", "neutral", 1],
  ["linkedin", "LINKEDIN", false, false, true, "baja", "positivo", 1],
  ["news", "WISE_NEWS_CLA", false, false, false, "media", "neutral", 1],
  ["facebook", "FACEBOOK", true, false, true, "baja", "positivo", 1],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, false, true, "alta", "neutral", 1],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, false, false, "alta", "positivo", 1],
  ["instagram", "INSTAGRAM_GRAPH_MENTION_CAPTION", false, false, false, "alta", "neutral", 1],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "media", "positivo", 1],
];

export const DDEC_PREV_GROUPS: readonly MentionGroup[] = [
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "baja", "neutral", 41],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, false, false, "alta", "neutral", 22],
  ["facebook", "FACEBOOK", true, false, false, "baja", "neutral", 22],
  ["facebook", "FACEBOOK", false, false, false, "alta", "neutral", 22],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "alta", "neutral", 19],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "alta", "neutral", 19],
  ["facebook", "FACEBOOK", true, false, false, "baja", "negativo", 18],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "baja", "neutral", 16],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "media", "neutral", 13],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "media", "neutral", 13],
  ["facebook", "FACEBOOK", true, false, false, "alta", "neutral", 9],
  ["linkedin", "LINKEDIN", false, false, false, "alta", "neutral", 8],
  ["instagram", "INSTAGRAM_GRAPH_MENTION_CAPTION", false, false, false, "media", "neutral", 5],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, true, false, "alta", "positivo", 5],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "baja", "negativo", 4],
  ["facebook", "FACEBOOK", true, false, false, "alta", "negativo", 4],
  ["instagram", "INSTAGRAM_GRAPH_MENTION_CAPTION", false, false, false, "baja", "neutral", 4],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, true, false, "baja", "negativo", 3],
  ["facebook", "FACEBOOK", true, false, false, "media", "neutral", 3],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, true, false, "alta", "negativo", 3],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "media", "negativo", 2],
  ["facebook", "FACEBOOK", true, false, true, "baja", "negativo", 2],
  ["facebook", "FACEBOOK", true, false, true, "alta", "neutral", 2],
  ["instagram", "INSTAGRAM_GRAPH_MENTION_CAPTION", false, false, false, "media", "positivo", 2],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, true, "alta", "neutral", 2],
  ["news", "WISE_NEWS_CLA", false, false, false, "baja", "neutral", 2],
  ["instagram", "INSTAGRAM_GRAPH_MENTION_COMMENT", false, true, false, "baja", "negativo", 1],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "alta", "neutral", 1],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "baja", "neutral", 1],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "media", "negativo", 1],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "media", "neutral", 1],
  ["linkedin", "LINKEDIN", false, false, false, "baja", "neutral", 1],
  ["linkedin", "LINKEDIN", false, false, false, "media", "positivo", 1],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "baja", "negativo", 1],
  ["facebook", "FACEBOOK", true, false, false, "media", "negativo", 1],
  ["news", "WISE_NEWS_PUBLIC", false, false, true, "media", "neutral", 1],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, true, false, "alta", "neutral", 1],
  ["reddit", "REDDIT_V4_TOPIC", false, false, false, "media", "neutral", 1],
  ["blog", "BOARDREADER_BLOGS", false, false, false, "baja", "neutral", 1],
  ["instagram", "INSTAGRAM_GRAPH_BUSINESS", false, true, false, "media", "negativo", 1],
  ["instagram", "INSTAGRAM_GRAPH_MENTION_CAPTION", false, false, false, "alta", "positivo", 1],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, true, "media", "neutral", 1],
  ["instagram", "INSTAGRAM_GRAPH_MENTION_CAPTION", false, false, false, "baja", "positivo", 1],
];

export const DF_CUR_GROUPS: readonly MentionGroup[] = [
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "alta", "neutral", 77],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "alta", "negativo", 75],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "alta", "negativo", 72],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "baja", "neutral", 47],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "baja", "neutral", 30],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "media", "neutral", 30],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "alta", "neutral", 21],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "alta", "negativo", 20],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "alta", "neutral", 16],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "media", "neutral", 14],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "media", "negativo", 13],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "media", "negativo", 9],
  ["bluesky", "BLUESKY_POST", false, true, false, "alta", "neutral", 5],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "media", "negativo", 4],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, true, "alta", "neutral", 3],
  ["blog", "BOARDREADER_BLOGS", false, false, false, "baja", "neutral", 3],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "baja", "negativo", 2],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "media", "neutral", 2],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "baja", "neutral", 2],
  ["reddit", "REDDIT_V4_REPLY", false, false, false, "baja", "neutral", 1],
  ["bluesky", "BLUESKY_POST", false, true, false, "alta", "negativo", 1],
  ["bluesky", "BLUESKY_POST", false, true, false, "media", "neutral", 1],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "alta", "positivo", 1],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, true, "alta", "negativo", 1],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, true, "baja", "neutral", 1],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, true, "media", "neutral", 1],
  ["forum", "FORUMSB", false, false, false, "baja", "neutral", 1],
  ["news", "WISE_NEWS_PUBLIC", false, false, true, "alta", "negativo", 1],
  ["blog", "BOARDREADER_BLOGS", false, false, false, "alta", "negativo", 1],
];

export const DF_PREV_GROUPS: readonly MentionGroup[] = [
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "alta", "negativo", 117],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "alta", "negativo", 112],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "alta", "negativo", 98],
  ["news", null, false, false, false, "alta", "negativo", 75],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "alta", "neutral", 70],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "alta", "neutral", 65],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "baja", "neutral", 48],
  ["twitter", null, false, false, false, "alta", "negativo", 44],
  ["youtube", null, false, false, false, "alta", "negativo", 44],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "alta", "neutral", 38],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "alta", "negativo", 34],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "alta", "negativo", 30],
  ["news", null, false, false, false, "baja", "neutral", 28],
  ["news", null, false, false, false, "alta", "neutral", 26],
  ["bluesky", "BLUESKY_POST", false, true, false, "alta", "neutral", 21],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "alta", "neutral", 19],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "media", "neutral", 15],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "media", "negativo", 15],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "alta", "neutral", 15],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "baja", "neutral", 12],
  ["news", null, false, false, false, "media", "negativo", 10],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "media", "neutral", 10],
  ["bluesky", "BLUESKY_POST", false, true, false, "alta", "negativo", 8],
  ["youtube", null, false, false, false, "alta", "neutral", 6],
  ["youtube", null, false, false, false, "media", "negativo", 6],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "baja", "neutral", 6],
  ["news", null, false, false, false, "baja", "negativo", 6],
  ["tiktok", null, false, false, false, "alta", "negativo", 6],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, true, "alta", "neutral", 5],
  ["news", null, false, false, false, "media", "neutral", 5],
  ["twitter", null, false, false, false, "alta", "neutral", 5],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, true, "media", "neutral", 4],
  ["news", "WISE_NEWS_PUBLIC", false, false, false, "baja", "negativo", 4],
  ["youtube", "VCOMMENT", false, false, false, "alta", "negativo", 3],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "media", "positivo", 3],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "media", "negativo", 3],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, true, "alta", "negativo", 3],
  ["reddit", "REDDIT_V4_REPLY", false, false, false, "media", "negativo", 2],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, true, "alta", "neutral", 2],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "media", "neutral", 2],
  ["blog", "BOARDREADER_BLOGS", false, false, false, "alta", "negativo", 2],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "baja", "neutral", 2],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, true, "alta", "negativo", 2],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, true, "alta", "negativo", 2],
  ["youtube", "VIDEO", false, false, false, "media", "negativo", 2],
  ["facebook", "FACEBOOK", true, false, false, "alta", "negativo", 2],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "media", "negativo", 2],
  ["youtube", null, false, false, false, "baja", "neutral", 2],
  ["blog", "BOARDREADER_BLOGS", false, false, false, "baja", "neutral", 2],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, false, "media", "negativo", 2],
  ["bluesky", "BLUESKY_POST", false, true, false, "baja", "neutral", 1],
  ["twitter", null, false, false, false, "media", "negativo", 1],
  ["twitter", null, false, false, false, "media", "neutral", 1],
  ["twitter", null, false, false, true, "alta", "negativo", 1],
  ["twitter", null, false, false, true, "media", "negativo", 1],
  ["youtube", "VCOMMENT", false, false, false, "baja", "neutral", 1],
  ["youtube", "VCOMMENT", false, false, false, "media", "negativo", 1],
  ["youtube", "VIDEO", false, false, false, "alta", "negativo", 1],
  ["blog", "BOARDREADER_BLOGS", false, false, false, "media", "neutral", 1],
  ["blog", "BOARDREADER_BLOGS", false, false, false, "media", "negativo", 1],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, true, "alta", "neutral", 1],
  ["youtube", null, false, false, false, "media", "neutral", 1],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, true, "media", "negativo", 1],
  ["instagram_public", "INSTAGRAM_GRAPH_PUBLIC", false, false, true, "media", "neutral", 1],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, true, "baja", "neutral", 1],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, true, "media", "positivo", 1],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, true, "baja", "neutral", 1],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, true, "alta", "negativo", 1],
  ["reddit", "REDDIT_V4_REPLY", false, false, false, "alta", "neutral", 1],
  ["reddit", "REDDIT_V4_TOPIC", false, false, false, "alta", "negativo", 1],
  ["reddit", "REDDIT_V4_TOPIC", false, false, false, "media", "negativo", 1],
  ["facebook_public", "FACEBOOK_PUBLIC", false, false, false, "alta", "positivo", 1],
  ["tiktok", null, false, false, true, "alta", "negativo", 1],
  ["tiktok", null, false, false, true, "media", "negativo", 1],
];

/** DDEC 25–31 oct: municipio PRINCIPAL (menor id) × sentimiento, universo estricto. */
export const DDEC_MUNICIPALITY_ROWS: Array<{ name: string | null; region: string | null; s: string | null; c: number }> = [
  { name: null, region: null, s: "neutral", c: 271 },
  { name: "San Juan", region: "Metro", s: "neutral", c: 125 },
  { name: null, region: null, s: "positivo", c: 124 },
  { name: null, region: null, s: "negativo", c: 52 },
  { name: "Aibonito", region: "Central", s: "neutral", c: 12 },
  { name: "Ceiba", region: "Este", s: "neutral", c: 12 },
  { name: "Salinas", region: "Sur", s: "neutral", c: 8 },
  { name: "Humacao", region: "Este", s: "neutral", c: 4 },
  { name: "Camuy", region: "Norte", s: "neutral", c: 4 },
  { name: "Peñuelas", region: "Sur", s: "neutral", c: 4 },
  { name: "Aibonito", region: "Central", s: "negativo", c: 3 },
  { name: "Ponce", region: "Sur", s: "neutral", c: 3 },
  { name: "Caguas", region: "Este", s: "neutral", c: 2 },
  { name: "Aibonito", region: "Central", s: "positivo", c: 2 },
  { name: "Carolina", region: "Metro", s: "neutral", c: 2 },
  { name: "Ceiba", region: "Este", s: "positivo", c: 2 },
  { name: "Aguadilla", region: "Oeste", s: "neutral", c: 2 },
  { name: "Mayagüez", region: "Oeste", s: "neutral", c: 1 },
  { name: "Naranjito", region: "Central", s: "neutral", c: 1 },
  { name: "Aguadilla", region: "Oeste", s: "positivo", c: 1 },
  { name: "Bayamón", region: "Metro", s: "positivo", c: 1 },
  { name: "Salinas", region: "Sur", s: "positivo", c: 1 },
  { name: "Añasco", region: "Oeste", s: "neutral", c: 1 },
  { name: "San Juan", region: "Metro", s: "positivo", c: 1 },
  { name: "Toa Baja", region: "Metro", s: "neutral", c: 1 },
  { name: "Canóvanas", region: "Norte", s: "positivo", c: 1 },
  { name: "Ciales", region: "Central", s: "positivo", c: 1 },
  { name: "Florida", region: "Central", s: "neutral", c: 1 },
  { name: "Hatillo", region: "Norte", s: "neutral", c: 1 },
  { name: "Humacao", region: "Este", s: "positivo", c: 1 },
  { name: "Luquillo", region: "Norte", s: "negativo", c: 1 },
  { name: "Manatí", region: "Norte", s: "neutral", c: 1 },
];

/** Serie diaria (días PR) del correo del 1-nov, tal como se envió (= universo). */
export const DDEC_DAILY_SERIES = [
  { date: "2026-10-25", dayLabel: "dom 25", negative: 2, neutral: 8, positive: 3 },
  { date: "2026-10-26", dayLabel: "lun 26", negative: 3, neutral: 60, positive: 37 },
  { date: "2026-10-27", dayLabel: "mar 27", negative: 12, neutral: 104, positive: 39 },
  { date: "2026-10-28", dayLabel: "mié 28", negative: 20, neutral: 119, positive: 28 },
  { date: "2026-10-29", dayLabel: "jue 29", negative: 9, neutral: 122, positive: 17 },
  { date: "2026-10-30", dayLabel: "vie 30", negative: 4, neutral: 27, positive: 5 },
  { date: "2026-10-31", dayLabel: "sáb 31", negative: 6, neutral: 16, positive: 6 },
];

/** Tabla de tópicos del correo del 1-nov (top 7 + «Otros»): suma 647. */
export const DDEC_TOPICS_TABLE = [
  { topic: "Gestión del Secretario", subtopics: '', total: 251, secondaryCount: 0, negative: 20, neutral: 144, positive: 87 },
  { topic: "Incentivos Económicos", subtopics: '', total: 227, secondaryCount: 0, negative: 15, neutral: 183, positive: 29 },
  { topic: "Desarrollo Empresarial", subtopics: '', total: 118, secondaryCount: 0, negative: 4, neutral: 98, positive: 16 },
  { topic: "Empleo / Fuerza Laboral", subtopics: '', total: 18, secondaryCount: 0, negative: 0, neutral: 15, positive: 3 },
  { topic: "Críticas / Controversias", subtopics: '', total: 17, secondaryCount: 0, negative: 17, neutral: 0, positive: 0 },
  { topic: "Inversión Extranjera", subtopics: '', total: 6, secondaryCount: 0, negative: 0, neutral: 6, positive: 0 },
  { topic: "Comercio Exterior", subtopics: '', total: 4, secondaryCount: 0, negative: 0, neutral: 4, positive: 0 },
  { topic: "Otros tópicos (2)", subtopics: '', total: 6, secondaryCount: 0, negative: 0, neutral: 6, positive: 0, isOther: true },
];

/** `topSources` del lambda de entonces (SIN filtro de pertinencia): sumaba 795, no 647. */
export const DDEC_LEGACY_TOP_SOURCES = [
  { source: "Facebook", mentions: 476 },
  { source: "Instagram", mentions: 214 },
  { source: "Online News", mentions: 56 },
  { source: "Facebook Public", mentions: 33 },
  { source: "LinkedIn", mentions: 11 },
  { source: "Instagram Public", mentions: 4 },
  { source: "Blogs", mentions: 1 },
];
