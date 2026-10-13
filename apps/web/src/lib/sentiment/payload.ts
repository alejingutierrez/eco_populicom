/**
 * Sentimiento (oct-2026): lo que calcula /api/sentiment/analysis a partir de un
 * cliente de base de datos (vive aquí para poder correrlo contra prod desde un
 * script). Universo y ventana: los de /api/eco-data — sin duplicados, sin
 * pertinencia baja, días calendario de Puerto Rico — para que la cascada
 * empiece y termine en el mismo NSS que muestra la página.
 */
import { MIN_WINDOW_MENTIONS, type PgClientLike } from '@eco/shared';
import { buildNssShift, bucketEmotionWeeks, emotionLabel, whereOf, type EmotionWeeks, type NssShift } from './analysis';

const BASE = `m.agency_id = $1::uuid
   AND m.is_duplicate = false
   AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')`;
const LOCAL_DAY = `(m.published_at AT TIME ZONE 'America/Puerto_Rico')::date`;
const POS = `COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('positivo','positive')`;
const NEG = `COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative')`;

// Las dos ventanas son contiguas: [prevStart, start) es la previa y [start, end] la actual.
export const WHERE_SQL = `
SELECT m.author, m.author_fullname, m.domain, m.page_type, m.pub_type,
       (${LOCAL_DAY} >= $3::date) AS cur,
       COUNT(*)::int AS n,
       COUNT(*) FILTER (WHERE ${POS})::int AS pos,
       COUNT(*) FILTER (WHERE ${NEG})::int AS neg
  FROM mentions m
 WHERE ${BASE}
   AND ${LOCAL_DAY} >= $2::date AND ${LOCAL_DAY} <= $4::date
 GROUP BY 1, 2, 3, 4, 5, 6`;

// Emociones por día (12 semanas hasta el fin de la ventana) y, de la ventana, cuántas menciones traen emoción y con qué tono.
export const EMOTION_DAYS_SQL = `
SELECT ${LOCAL_DAY}::text AS d, lower(trim(e.value::text, '"')) AS emotion, COUNT(*)::int AS c
  FROM mentions m, jsonb_array_elements(CASE WHEN jsonb_typeof(m.nlp_emotions) = 'array' THEN m.nlp_emotions ELSE '[]'::jsonb END) AS e
 WHERE ${BASE}
   AND ${LOCAL_DAY} >= $2::date AND ${LOCAL_DAY} <= $3::date
 GROUP BY 1, 2`;
export const EMOTION_TONE_SQL = `
SELECT lower(trim(e.value::text, '"')) AS emotion, COUNT(*)::int AS n,
       COUNT(*) FILTER (WHERE ${POS})::int AS pos, COUNT(*) FILTER (WHERE ${NEG})::int AS neg
  FROM mentions m, jsonb_array_elements(CASE WHEN jsonb_typeof(m.nlp_emotions) = 'array' THEN m.nlp_emotions ELSE '[]'::jsonb END) AS e
 WHERE ${BASE}
   AND ${LOCAL_DAY} >= $2::date AND ${LOCAL_DAY} <= $3::date
 GROUP BY 1`;
export const WITH_EMOTION_SQL = `
SELECT COUNT(*) FILTER (WHERE jsonb_typeof(m.nlp_emotions) = 'array' AND jsonb_array_length(m.nlp_emotions) > 0)::int AS with_emotion,
       COUNT(*)::int AS total
  FROM mentions m
 WHERE ${BASE}
   AND ${LOCAL_DAY} >= $2::date AND ${LOCAL_DAY} <= $3::date`;

export interface SentimentWindow { startYmd: string; endYmd: string; prevStartYmd: string; prevEndYmd: string }
export interface SentimentAnalysis {
  window: SentimentWindow;
  /** Con menos de MIN_WINDOW_MENTIONS en alguno de los dos periodos el NSS no se publica (igual que /api/eco-data). */
  lowSample: boolean;
  shift: NssShift;
  withEmotion: number;
  total: number;
  /** Tono de las menciones con cada emoción, en la ventana. */
  emotionTone: Array<{ emotion: string; n: number; pos: number; neg: number }>;
  emotionWeeks: EmotionWeeks;
}

const addDays = (ymd: string, d: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + d * 864e5).toISOString().slice(0, 10);

export async function computeSentimentAnalysis(
  pool: PgClientLike,
  agency: { id: string; slug: string; name: string | null },
  w: SentimentWindow,
): Promise<SentimentAnalysis> {
  const firstWeekDay = addDays(w.endYmd, -(12 * 7 - 1));
  const [where, emoDays, emoTone, withEmo] = await Promise.all([
    pool.query<{ author: string | null; author_fullname: string | null; domain: string | null; page_type: string | null; pub_type: string | null; cur: boolean; n: number; pos: number; neg: number }>(
      WHERE_SQL, [agency.id, w.prevStartYmd, w.startYmd, w.endYmd]),
    pool.query<{ d: string; emotion: string; c: number }>(EMOTION_DAYS_SQL, [agency.id, firstWeekDay, w.endYmd]),
    pool.query<{ emotion: string; n: number; pos: number; neg: number }>(EMOTION_TONE_SQL, [agency.id, w.startYmd, w.endYmd]),
    pool.query<{ with_emotion: number; total: number }>(WITH_EMOTION_SQL, [agency.id, w.startYmd, w.endYmd]),
  ]);
  const shift = buildNssShift(where.rows.map((r) => ({
    where: whereOf(r, agency.slug, agency.name), cur: !!r.cur, n: Number(r.n) || 0, pos: Number(r.pos) || 0, neg: Number(r.neg) || 0,
  })));
  const lowSample = shift.cur.n < MIN_WINDOW_MENTIONS || shift.prev.n < MIN_WINDOW_MENTIONS;
  // Las etiquetas se pliegan igual que en /api/eco-data; dos grafías de la misma emoción se suman.
  const tone = new Map<string, { emotion: string; n: number; pos: number; neg: number }>();
  for (const r of emoTone.rows) {
    if (!r.emotion) continue;
    const k = emotionLabel(r.emotion), t = tone.get(k) ?? { emotion: k, n: 0, pos: 0, neg: 0 };
    t.n += Number(r.n) || 0; t.pos += Number(r.pos) || 0; t.neg += Number(r.neg) || 0;
    tone.set(k, t);
  }
  return {
    window: w,
    lowSample,
    shift,
    withEmotion: Number(withEmo.rows[0]?.with_emotion ?? 0),
    total: Number(withEmo.rows[0]?.total ?? 0),
    emotionTone: [...tone.values()].sort((a, b) => b.n - a.n),
    emotionWeeks: bucketEmotionWeeks(emoDays.rows.map((r) => ({ d: String(r.d).slice(0, 10), emotion: r.emotion, c: Number(r.c) || 0 })), w.endYmd),
  };
}
