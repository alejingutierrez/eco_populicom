/**
 * Menciones (oct-2026): lo que calcula /api/mentions/analysis a partir de un
 * cliente de base de datos (vive aquí para poder correrlo contra prod desde un
 * script). Universo: el mismo del feed — sin duplicados y sin pertinencia
 * baja — y la misma ventana que /api/eco-mentions.
 */
import { sourceKey, type PgClientLike } from '@eco/shared';
import { classifyVoice, type VoiceCat } from '@/lib/scorecard/voices';
import { stopSurfacesFor } from '@/lib/wordcloud/stopwords';
import {
  ANALYSIS_MAX_DAYS, STORY_MAX_DISTANCE, STORY_MAX_HOURS,
  SPANISH_STOP, astYmd, buildAmplify, buildDays, buildShift, countTerms, groupStories, stopSet, termRows,
  type AmplifyPayload, type DayRow, type ShiftRow,
} from './analysis';

const BASE = `m.agency_id = $1::uuid
   AND m.is_duplicate = false
   AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')`;

export const ROWS_SQL = `
SELECT m.id::text AS id, m.published_at AS ts, COALESCE(m.nlp_sentiment, m.bw_sentiment) AS s,
       m.author, m.author_fullname, m.domain, m.page_type,
       (COALESCE(m.likes, 0) + COALESCE(m.comments, 0) + COALESCE(m.shares, 0))::int AS inter,
       left(COALESCE(m.title, ''), 300) AS title, left(COALESCE(m.snippet, ''), 600) AS snippet
  FROM mentions m
 WHERE ${BASE}
   AND m.published_at >= $2 AND m.published_at < $3
 ORDER BY m.published_at`;

// Parejas de la misma historia: embeddings cercanos y a menos de N horas.
export const PAIRS_SQL = `
WITH w AS (
  SELECT m.id, m.published_at, m.embedding
    FROM mentions m
   WHERE ${BASE}
     AND m.published_at >= $2 AND m.published_at < $3
     AND m.embedding IS NOT NULL
)
SELECT a.id::text AS a, b.id::text AS b
  FROM w a
  JOIN w b ON b.id <> a.id
          AND b.published_at >= a.published_at
          AND (b.published_at > a.published_at OR b.id > a.id)
          AND b.published_at <= a.published_at + ($4::int * INTERVAL '1 hour')
 WHERE (a.embedding <=> b.embedding) <= $5::float8`;

// Texto de la ventana previa (mismo largo, inmediatamente antes) para comparar el lenguaje.
export const PREV_TEXT_SQL = `
SELECT left(COALESCE(m.title, ''), 300) AS title, left(COALESCE(m.snippet, ''), 600) AS snippet
  FROM mentions m
 WHERE ${BASE} AND m.published_at >= $2 AND m.published_at < $3`;

/** Palabras genéricas que no dicen de qué se habla; se suman a las de la nube solo en este análisis. */
export const SHIFT_EXTRA_STOP = [
  'puede', 'pueden', 'podrá', 'través', 'traves', 'próximo', 'próxima', 'próximos', 'hacia', 'incluye', 'incluyen',
  'incluido', 'tema', 'temas', 'forma', 'parte', 'mayor', 'gran', 'grandes', 'mismo', 'misma', 'además',
  'tras', 'hacer', 'hace', 'hizo', 'será', 'están', 'estar', 'mientras', 'luego', 'tanto', 'dijo', 'indicó',
  'explicó', 'informó', 'aseguró', 'añadió', 'señaló', 'nuevo', 'nueva', 'nuevos', 'nuevas', 'años', 'año', 'día',
  'días', 'semana', 'hoy', 'ahora', 'aquí', 'allí', 'sólo', 'solo', 'vez', 'veces', 'esto', 'eso', 'cosa', 'cosas',
];

export interface AnalysisPoint {
  id: string; ts: string; inter: number; sent: 'positivo' | 'neutral' | 'negativo';
  voice: VoiceCat; src: string; title: string; author: string;
}
export interface MentionsAnalysis {
  window: { from: string; to: string; days: number; limited: boolean; maxDays: number };
  total: number;
  days: DayRow[];
  points: AnalysisPoint[] | null;
  stories: string[][] | null;
  amplify: AmplifyPayload | null;
  shift: { nNow: number; nPrev: number; up: ShiftRow[]; down: ShiftRow[] } | null;
}

// Facebook pone títulos genéricos («Photos from X's post»); en el mapa no dicen
// nada, así que ahí se usa el texto.
const GENERIC_TITLE = /^(photos?|videos?|reels?) from .+'s post$|^.+ (updated (his|her|their) (profile|cover) (picture|photo)|shared a (post|link|memory))\.?$/i;
// El título del punto se corta por puntos de código (Array.from), no por unidades
// UTF-16: los posts usan letras matemáticas (𝐁) y un corte a la mitad deja un
// sustituto suelto en el JSON.
const sentOf = (s: string | null): AnalysisPoint['sent'] =>
  s === 'negativo' || s === 'negative' ? 'negativo' : s === 'positivo' || s === 'positive' ? 'positivo' : 'neutral';

/**
 * @param since inicio de la ventana (incluido)
 * @param until fin de la ventana (excluido)
 */
export async function computeMentionsAnalysis(
  pool: PgClientLike,
  agency: { id: string; slug: string; name: string | null },
  since: Date,
  until: Date,
): Promise<MentionsAnalysis> {
  const days = Math.max(1, Math.round((until.getTime() - since.getTime()) / 864e5));
  const limited = days > ANALYSIS_MAX_DAYS;
  const fromYmd = astYmd(since), toYmd = astYmd(new Date(until.getTime() - 1));
  const s = since.toISOString(), u = until.toISOString();

  const res = await pool.query<{ id: string; ts: string | Date; s: string | null; author: string | null; author_fullname: string | null; domain: string | null; page_type: string | null; inter: number | string; title: string | null; snippet: string | null }>(ROWS_SQL, [agency.id, s, u]);
  const points: AnalysisPoint[] = res.rows.map((r) => {
    const v = classifyVoice(r, agency.slug, agency.name);
    const title = (r.title || '').trim(), snippet = (r.snippet || '').trim();
    return {
      id: r.id, ts: new Date(r.ts).toISOString(), inter: Number(r.inter) || 0, sent: sentOf(r.s),
      voice: v.cat, src: sourceKey(r.page_type), title: Array.from(title && !GENERIC_TITLE.test(title) ? title : snippet || title).slice(0, 140).join(''), author: v.display || r.domain || '',
    };
  });
  // Una ventana muy larga se resume por semana en la SPA; aquí, como máximo 400 días.
  const dayFrom = (Date.parse(toYmd) - Date.parse(fromYmd)) / 864e5 > 399
    ? new Date(Date.parse(toYmd + 'T00:00:00Z') - 399 * 864e5).toISOString().slice(0, 10) : fromYmd;
  const out: MentionsAnalysis = {
    window: { from: fromYmd, to: toYmd, days, limited, maxDays: ANALYSIS_MAX_DAYS },
    total: points.length,
    days: buildDays(points, dayFrom, toYmd),
    points: null, stories: null, amplify: null, shift: null,
  };
  if (limited) return out;

  const prevSince = new Date(since.getTime() - (until.getTime() - since.getTime())).toISOString();
  const [pairs, prevText] = await Promise.all([
    pool.query<{ a: string; b: string }>(PAIRS_SQL, [agency.id, s, u, STORY_MAX_HOURS, STORY_MAX_DISTANCE]),
    pool.query<{ title: string | null; snippet: string | null }>(PREV_TEXT_SQL, [agency.id, prevSince, s]),
  ]);
  const stories = groupStories(pairs.rows.map((p) => [p.a, p.b] as [string, string]));
  const byId = new Map(points.map((p) => [p.id, p]));
  out.points = points;
  out.stories = stories;
  out.amplify = buildAmplify(stories, byId);
  // Lenguaje: título y texto (no los resúmenes de IA), mismas palabras vacías que la nube.
  const stop = stopSet([...SPANISH_STOP, ...stopSurfacesFor(agency.slug), ...SHIFT_EXTRA_STOP]);
  const cur = countTerms(res.rows.map((r) => ({ text: `${r.title || ''} ${r.snippet || ''}`, neg: sentOf(r.s) === 'negativo' })), stop);
  const prev = countTerms(prevText.rows.map((r) => ({ text: `${r.title || ''} ${r.snippet || ''}` })), stop);
  const nPrev = prevText.rows.length;
  out.shift = { nNow: points.length, nPrev, ...buildShift(termRows(cur, prev), points.length, nPrev) };
  return out;
}
