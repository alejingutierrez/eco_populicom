/**
 * Agregaciones PROFUNDAS para el reporte analítico exportable (PDF).
 *
 * `buildSentimentReport` (sentiment-report.ts) cubre lo que el correo diario
 * necesita: termómetro, tendencia diaria y tabla de tópicos. El reporte
 * exportable necesita además el material que hoy vive disperso en las queries
 * de `/api/eco-data`: canales, actores, emociones, geografía, subtópicos,
 * distribución horaria, picos y las menciones que efectivamente movieron el
 * período.
 *
 * Este módulo lo consolida en UNA función (`buildReportDetail`) que corre todas
 * las queries en paralelo sobre `PgClientLike`, así que sirve igual al route
 * handler del web app (pool de Drizzle) que a un lambda (pg.Client) si algún
 * día el reporte se manda por correo.
 *
 * UNIVERSO: idéntico al de los conteos del producto — `is_duplicate = false` y
 * pertinencia distinta de 'baja' (decisión D2 de la auditoría de consistencia
 * 2026-08). Las métricas compuestas (NSS/BHI/crisis) NO se calculan aquí:
 * salen de `loadMetricsForWindow`, que conserva su universo calibrado por
 * backtest.
 *
 * FECHAS: `startYmd`/`endYmd` son días calendario inclusivos en TZ Puerto Rico
 * (AST, UTC-4 sin DST), igual que en `buildSentimentReport`. El filtro es
 * `published_at >= start AND < end + 1 día` — fecha de la MENCIÓN, nunca fecha
 * de ingesta.
 */

import type { PgClientLike } from './sentiment-report';
import { sourceKey, sourceLabel } from '../sources';
import { formatDayLabel } from '../format-period';

// ============================================================
// Tipos
// ============================================================

export interface ChannelRow {
  /** Key canónica de la fuente ('facebook', 'news', …). */
  key: string;
  /** Etiqueta de UI ('Facebook', 'Noticias', …). */
  label: string;
  total: number;
  negative: number;
  neutral: number;
  positive: number;
  /** Suma de likes + comentarios + compartidas del canal. */
  engagement: number;
  /** Alcance estimado agregado del canal. */
  reach: number;
}

export interface AuthorRow {
  author: string;
  /** Canal dominante del autor ('twitter', 'news', …). */
  channel: string;
  total: number;
  negative: number;
  positive: number;
  engagement: number;
}

export interface DomainRow {
  domain: string;
  total: number;
  negative: number;
  engagement: number;
}

export interface EmotionRow {
  emotion: string;
  count: number;
  /** % sobre el total de emociones detectadas en la ventana. */
  share: number;
}

export interface PlaceRow {
  name: string;
  region: string;
  total: number;
  negative: number;
  neutral: number;
  positive: number;
}

export interface RegionRow {
  region: string;
  total: number;
  negative: number;
  neutral: number;
  positive: number;
  /** Municipios distintos con menciones en la región. */
  municipalities: number;
}

export interface SubtopicRow {
  topic: string;
  subtopic: string;
  total: number;
  negative: number;
  neutral: number;
  positive: number;
}

export interface TopMentionRow {
  id: string;
  title: string;
  snippet: string | null;
  author: string | null;
  domain: string | null;
  channel: string;
  url: string | null;
  sentiment: 'negative' | 'neutral' | 'positive' | null;
  pertinence: string | null;
  engagement: number;
  reach: number;
  /** YYYY-MM-DD en TZ PR. */
  date: string;
  topic: string | null;
  emotions: string[];
}

export interface DayPeak {
  /** YYYY-MM-DD en TZ PR. */
  date: string;
  dayLabel: string;
  total: number;
  negative: number;
  /** Desviación del día respecto al promedio de la ventana, en múltiplos de σ. */
  zScore: number;
}

export interface ReportDetail {
  channels: ChannelRow[];
  authors: AuthorRow[];
  domains: DomainRow[];
  emotions: EmotionRow[];
  /** Total de etiquetas de emoción detectadas (una mención puede traer varias). */
  emotionsTagged: number;
  municipalities: PlaceRow[];
  regions: RegionRow[];
  subtopics: SubtopicRow[];
  /** Menciones con más engagement de la ventana. */
  topByEngagement: TopMentionRow[];
  /** Menciones negativas con más engagement — el material de riesgo. */
  topNegative: TopMentionRow[];
  /** Menciones por hora del día (0-23) en TZ PR. */
  byHour: number[];
  /** Menciones por día de la semana (0 = domingo, convención JS). */
  byDow: number[];
  /** Los 3 días más atípicos de la ventana por volumen. */
  peaks: DayPeak[];
  /** Menciones sin clasificar por el NLP (denominador de confianza del reporte). */
  unclassified: number;
  /** Menciones que el NLP aún no evaluó para sentimiento. */
  withoutSentiment: number;
  /** Alcance agregado y engagement agregado de la ventana (universo pertinente). */
  totals: { reach: number; engagement: number; mentions: number };
}

// ============================================================
// Helpers
// ============================================================

/**
 * Fragmento WHERE del universo pertinente. Copia deliberada del helper de
 * sentiment-report.ts (que es privado): si un día se unifican, que sea con un
 * único cambio y no con dos definiciones que puedan divergir en silencio.
 */
function pertinentSql(alias = ''): string {
  return `AND ${alias}is_duplicate = false
          AND (${alias}nlp_pertinence IS NULL OR ${alias}nlp_pertinence <> 'baja')`;
}

/** Ventana de fechas sobre published_at, con la mención como fecha de verdad. */
function windowSql(alias = '', startParam = '$2', endParam = '$3'): string {
  return `AND ${alias}published_at >= (${startParam}::date)
          AND ${alias}published_at <  ((${endParam}::date) + INTERVAL '1 day')`;
}

const ENGAGEMENT = `(COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0))`;
const ENGAGEMENT_M = `(COALESCE(m.likes,0) + COALESCE(m.comments,0) + COALESCE(m.shares,0))`;
const SENTIMENT = `COALESCE(nlp_sentiment, bw_sentiment)`;
const SENTIMENT_M = `COALESCE(m.nlp_sentiment, m.bw_sentiment)`;

type SentimentKey = 'negative' | 'neutral' | 'positive';

function normalizeSentiment(s: string | null): SentimentKey | null {
  if (!s) return null;
  const v = s.toLowerCase();
  if (v.startsWith('neg')) return 'negative';
  if (v.startsWith('pos')) return 'positive';
  if (v.startsWith('neu')) return 'neutral';
  return null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ============================================================
// Queries
// ============================================================

interface ChannelRaw {
  page_type: string | null;
  s: string | null;
  c: number | string;
  eng: number | string;
  reach: number | string;
}

async function loadChannels(
  client: PgClientLike, agencyId: string, startYmd: string, endYmd: string,
): Promise<ChannelRow[]> {
  const r = await client.query<ChannelRaw>(
    `SELECT page_type,
            ${SENTIMENT} AS s,
            COUNT(*)::int AS c,
            COALESCE(SUM(${ENGAGEMENT}), 0)::bigint AS eng,
            COALESCE(SUM(COALESCE(reach_estimate, 0)), 0)::bigint AS reach
       FROM mentions
      WHERE agency_id = $1
        ${windowSql()}
        ${pertinentSql()}
      GROUP BY page_type, ${SENTIMENT}`,
    [agencyId, startYmd, endYmd],
  );

  // page_type crudo → key canónica: 'instagram_public' e 'instagram' son el
  // mismo canal (sources.ts es la única autoridad de ese mapeo).
  const byKey = new Map<string, ChannelRow>();
  for (const row of r.rows) {
    const key = sourceKey(row.page_type);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { key, label: sourceLabel(key), total: 0, negative: 0, neutral: 0, positive: 0, engagement: 0, reach: 0 };
      byKey.set(key, bucket);
    }
    const c = num(row.c);
    bucket.total += c;
    bucket.engagement += num(row.eng);
    bucket.reach += num(row.reach);
    const s = normalizeSentiment(row.s);
    if (s) bucket[s] += c;
  }
  return Array.from(byKey.values()).sort((a, b) => b.total - a.total);
}

interface AuthorRaw {
  author: string | null;
  page_type: string | null;
  c: number | string;
  neg: number | string;
  pos: number | string;
  eng: number | string;
}

async function loadAuthors(
  client: PgClientLike, agencyId: string, startYmd: string, endYmd: string, limit: number,
): Promise<AuthorRow[]> {
  // COALESCE(author_fullname, author): el nombre mostrable primero; muchas
  // cuentas de prensa traen handle en `author` y nombre real en el fullname.
  const r = await client.query<AuthorRaw>(
    `SELECT COALESCE(NULLIF(TRIM(author_fullname), ''), NULLIF(TRIM(author), '')) AS author,
            (ARRAY_AGG(page_type ORDER BY page_type))[1] AS page_type,
            COUNT(*)::int AS c,
            COUNT(*) FILTER (WHERE ${SENTIMENT} = 'negativo')::int AS neg,
            COUNT(*) FILTER (WHERE ${SENTIMENT} = 'positivo')::int AS pos,
            COALESCE(SUM(${ENGAGEMENT}), 0)::bigint AS eng
       FROM mentions
      WHERE agency_id = $1
        ${windowSql()}
        ${pertinentSql()}
        AND COALESCE(NULLIF(TRIM(author_fullname), ''), NULLIF(TRIM(author), '')) IS NOT NULL
      GROUP BY 1
      ORDER BY c DESC, eng DESC
      LIMIT ${limit}`,
    [agencyId, startYmd, endYmd],
  );
  return r.rows.map((row) => ({
    author: row.author ?? '—',
    channel: sourceLabel(sourceKey(row.page_type)),
    total: num(row.c),
    negative: num(row.neg),
    positive: num(row.pos),
    engagement: num(row.eng),
  }));
}

async function loadDomains(
  client: PgClientLike, agencyId: string, startYmd: string, endYmd: string, limit: number,
): Promise<DomainRow[]> {
  const r = await client.query<{ domain: string | null; c: number | string; neg: number | string; eng: number | string }>(
    `SELECT NULLIF(TRIM(domain), '') AS domain,
            COUNT(*)::int AS c,
            COUNT(*) FILTER (WHERE ${SENTIMENT} = 'negativo')::int AS neg,
            COALESCE(SUM(${ENGAGEMENT}), 0)::bigint AS eng
       FROM mentions
      WHERE agency_id = $1
        ${windowSql()}
        ${pertinentSql()}
        AND NULLIF(TRIM(domain), '') IS NOT NULL
      GROUP BY 1
      ORDER BY c DESC
      LIMIT ${limit}`,
    [agencyId, startYmd, endYmd],
  );
  return r.rows.map((row) => ({
    domain: row.domain ?? '—',
    total: num(row.c),
    negative: num(row.neg),
    engagement: num(row.eng),
  }));
}

async function loadEmotions(
  client: PgClientLike, agencyId: string, startYmd: string, endYmd: string,
): Promise<{ rows: EmotionRow[]; tagged: number }> {
  // nlp_emotions es un jsonb array de strings; jsonb_array_elements lo aplana.
  // El trim de comillas convierte '"enojo"' → 'enojo'.
  const r = await client.query<{ emotion: string; c: number | string }>(
    `SELECT lower(trim(e.value::text, '"')) AS emotion, COUNT(*)::int AS c
       FROM mentions m, jsonb_array_elements(COALESCE(m.nlp_emotions, '[]'::jsonb)) AS e
      WHERE m.agency_id = $1
        ${windowSql('m.')}
        ${pertinentSql('m.')}
      GROUP BY 1
      ORDER BY c DESC
      LIMIT 12`,
    [agencyId, startYmd, endYmd],
  );
  const tagged = r.rows.reduce((s, row) => s + num(row.c), 0);
  const rows = r.rows.map((row) => ({
    emotion: row.emotion.charAt(0).toUpperCase() + row.emotion.slice(1),
    count: num(row.c),
    share: tagged > 0 ? (num(row.c) / tagged) * 100 : 0,
  }));
  return { rows, tagged };
}

async function loadPlaces(
  client: PgClientLike, agencyId: string, startYmd: string, endYmd: string,
): Promise<{ municipalities: PlaceRow[]; regions: RegionRow[] }> {
  const r = await client.query<{
    name: string; region: string | null; s: string | null; c: number | string;
  }>(
    `SELECT mu.name AS name,
            mu.region AS region,
            ${SENTIMENT_M} AS s,
            COUNT(*)::int AS c
       FROM mention_municipalities mm
       JOIN mentions m ON m.id = mm.mention_id
       JOIN municipalities mu ON mu.id = mm.municipality_id
      WHERE m.agency_id = $1
        ${windowSql('m.')}
        ${pertinentSql('m.')}
      GROUP BY mu.name, mu.region, ${SENTIMENT_M}`,
    [agencyId, startYmd, endYmd],
  );

  const byMuni = new Map<string, PlaceRow>();
  const byRegion = new Map<string, RegionRow & { _munis: Set<string> }>();
  for (const row of r.rows) {
    const region = (row.region ?? '').trim() || 'Sin región';
    const c = num(row.c);
    const s = normalizeSentiment(row.s);

    let m = byMuni.get(row.name);
    if (!m) { m = { name: row.name, region, total: 0, negative: 0, neutral: 0, positive: 0 }; byMuni.set(row.name, m); }
    m.total += c;
    if (s) m[s] += c;

    let g = byRegion.get(region);
    if (!g) { g = { region, total: 0, negative: 0, neutral: 0, positive: 0, municipalities: 0, _munis: new Set() }; byRegion.set(region, g); }
    g.total += c;
    if (s) g[s] += c;
    g._munis.add(row.name);
  }

  return {
    municipalities: Array.from(byMuni.values()).sort((a, b) => b.total - a.total),
    regions: Array.from(byRegion.values())
      .map(({ _munis, ...rest }) => ({ ...rest, municipalities: _munis.size }))
      .sort((a, b) => b.total - a.total),
  };
}

async function loadSubtopics(
  client: PgClientLike, agencyId: string, startYmd: string, endYmd: string, limit: number,
): Promise<SubtopicRow[]> {
  // Cada mención cuenta bajo su par (tópico, subtópico) de mayor confianza —
  // misma regla de dedup top-confidence que la tabla de tópicos del correo,
  // para que los subtotales no sumen más que el total de la ventana.
  const r = await client.query<{
    topic: string | null; subtopic: string | null; c: number | string;
    neg: number | string; neu: number | string; pos: number | string;
  }>(
    `WITH primaries AS (
       SELECT m.id AS mention_id,
              ${SENTIMENT_M} AS sentiment,
              (SELECT mt.subtopic_id FROM mention_topics mt
                WHERE mt.mention_id = m.id AND mt.subtopic_id IS NOT NULL
                ORDER BY mt.confidence DESC NULLS LAST, mt.topic_id ASC LIMIT 1) AS subtopic_id
         FROM mentions m
        WHERE m.agency_id = $1
          ${windowSql('m.')}
          ${pertinentSql('m.')}
     )
     SELECT t.name AS topic,
            s.name AS subtopic,
            COUNT(*)::int AS c,
            COUNT(*) FILTER (WHERE p.sentiment = 'negativo')::int AS neg,
            COUNT(*) FILTER (WHERE p.sentiment = 'neutral')::int  AS neu,
            COUNT(*) FILTER (WHERE p.sentiment = 'positivo')::int AS pos
       FROM primaries p
       JOIN subtopics s ON s.id = p.subtopic_id
       LEFT JOIN topics t ON t.id = s.topic_id
      GROUP BY t.name, s.name
      ORDER BY c DESC
      LIMIT ${limit}`,
    [agencyId, startYmd, endYmd],
  );
  return r.rows.map((row) => ({
    topic: row.topic ?? 'Sin tópico',
    subtopic: row.subtopic ?? '—',
    total: num(row.c),
    negative: num(row.neg),
    neutral: num(row.neu),
    positive: num(row.pos),
  }));
}

interface TopMentionRaw {
  id: string;
  title: string | null;
  snippet: string | null;
  author: string | null;
  domain: string | null;
  page_type: string | null;
  url: string | null;
  s: string | null;
  pertinence: string | null;
  eng: number | string;
  reach: number | string;
  d: string;
  topic: string | null;
  emotions: unknown;
}

function mapTopMention(row: TopMentionRaw): TopMentionRow {
  return {
    id: row.id,
    title: (row.title ?? '').trim() || '(sin título)',
    snippet: row.snippet,
    author: row.author,
    domain: row.domain,
    channel: sourceLabel(sourceKey(row.page_type)),
    url: row.url,
    sentiment: normalizeSentiment(row.s),
    pertinence: row.pertinence,
    engagement: num(row.eng),
    reach: num(row.reach),
    date: row.d,
    topic: row.topic,
    emotions: Array.isArray(row.emotions) ? (row.emotions as string[]) : [],
  };
}

async function loadTopMentions(
  client: PgClientLike, agencyId: string, startYmd: string, endYmd: string,
  opts: { onlyNegative: boolean; limit: number },
): Promise<TopMentionRow[]> {
  const negFilter = opts.onlyNegative ? `AND ${SENTIMENT_M} = 'negativo'` : '';
  const r = await client.query<TopMentionRaw>(
    `SELECT m.id::text AS id,
            m.title, m.snippet, m.url, m.domain, m.page_type,
            COALESCE(NULLIF(TRIM(m.author_fullname), ''), NULLIF(TRIM(m.author), '')) AS author,
            ${SENTIMENT_M} AS s,
            m.nlp_pertinence AS pertinence,
            ${ENGAGEMENT_M}::bigint AS eng,
            COALESCE(m.reach_estimate, 0)::bigint AS reach,
            to_char(m.published_at AT TIME ZONE 'America/Puerto_Rico', 'YYYY-MM-DD') AS d,
            (SELECT t.name FROM mention_topics mt
               JOIN topics t ON t.id = mt.topic_id
              WHERE mt.mention_id = m.id
              ORDER BY mt.confidence DESC NULLS LAST, mt.topic_id ASC LIMIT 1) AS topic,
            COALESCE(m.nlp_emotions, '[]'::jsonb) AS emotions
       FROM mentions m
      WHERE m.agency_id = $1
        ${windowSql('m.')}
        ${pertinentSql('m.')}
        ${negFilter}
      ORDER BY ${ENGAGEMENT_M} DESC, m.reach_estimate DESC NULLS LAST, m.published_at DESC
      LIMIT ${opts.limit}`,
    [agencyId, startYmd, endYmd],
  );
  return r.rows.map(mapTopMention);
}

async function loadTimeShape(
  client: PgClientLike, agencyId: string, startYmd: string, endYmd: string,
): Promise<{ byHour: number[]; byDow: number[] }> {
  const r = await client.query<{ h: number | string; dow: number | string; c: number | string }>(
    `SELECT EXTRACT(HOUR FROM (published_at AT TIME ZONE 'America/Puerto_Rico'))::int AS h,
            EXTRACT(DOW  FROM (published_at AT TIME ZONE 'America/Puerto_Rico'))::int AS dow,
            COUNT(*)::int AS c
       FROM mentions
      WHERE agency_id = $1
        ${windowSql()}
        ${pertinentSql()}
      GROUP BY 1, 2`,
    [agencyId, startYmd, endYmd],
  );
  const byHour = Array(24).fill(0) as number[];
  const byDow = Array(7).fill(0) as number[];
  for (const row of r.rows) {
    const h = num(row.h); const dow = num(row.dow); const c = num(row.c);
    if (h >= 0 && h < 24) byHour[h] += c;
    if (dow >= 0 && dow < 7) byDow[dow] += c;
  }
  return { byHour, byDow };
}

async function loadCoverage(
  client: PgClientLike, agencyId: string, startYmd: string, endYmd: string,
): Promise<{ unclassified: number; withoutSentiment: number; reach: number; engagement: number; mentions: number }> {
  const r = await client.query<{
    unclassified: number | string; without_sentiment: number | string;
    reach: number | string; eng: number | string; total: number | string;
  }>(
    `SELECT COUNT(*) FILTER (
              WHERE NOT EXISTS (SELECT 1 FROM mention_topics mt WHERE mt.mention_id = m.id)
            )::int AS unclassified,
            COUNT(*) FILTER (WHERE ${SENTIMENT_M} IS NULL)::int AS without_sentiment,
            COALESCE(SUM(COALESCE(m.reach_estimate, 0)), 0)::bigint AS reach,
            COALESCE(SUM(${ENGAGEMENT_M}), 0)::bigint AS eng,
            COUNT(*)::int AS total
       FROM mentions m
      WHERE m.agency_id = $1
        ${windowSql('m.')}
        ${pertinentSql('m.')}`,
    [agencyId, startYmd, endYmd],
  );
  const row = r.rows[0];
  return {
    unclassified: num(row?.unclassified),
    withoutSentiment: num(row?.without_sentiment),
    reach: num(row?.reach),
    engagement: num(row?.eng),
    mentions: num(row?.total),
  };
}

// ============================================================
// Picos — se derivan de la serie diaria que ya trae buildSentimentReport,
// así que no cuestan una query extra.
// ============================================================

/**
 * Los `count` días cuyo volumen más se desvía del promedio de la ventana.
 * El z-score usa σ poblacional de la propia ventana: con menos de 3 días no
 * hay dispersión que medir y devuelve lista vacía en vez de un pico ficticio.
 */
export function findPeaks(
  dailySeries: Array<{ date: string; negative: number; neutral: number; positive: number }>,
  count = 3,
): DayPeak[] {
  if (dailySeries.length < 3) return [];
  const totals = dailySeries.map((d) => d.negative + d.neutral + d.positive);
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const variance = totals.reduce((a, b) => a + (b - mean) ** 2, 0) / totals.length;
  const sd = Math.sqrt(variance);
  return dailySeries
    .map((d, i) => ({
      date: d.date,
      dayLabel: formatDayLabel(d.date),
      total: totals[i],
      negative: d.negative,
      zScore: sd > 0 ? Number(((totals[i] - mean) / sd).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.zScore - a.zScore)
    .slice(0, count)
    .filter((p) => p.total > 0);
}

// ============================================================
// API pública
// ============================================================

/**
 * Corre todas las agregaciones del reporte en paralelo. `dailySeries` viene de
 * `buildSentimentReport` — se pasa en vez de re-consultarla para que los picos
 * y la tendencia del reporte salgan literalmente de los mismos números que la
 * tabla y la gráfica.
 */
export async function buildReportDetail(
  client: PgClientLike,
  agencyId: string,
  startYmd: string,
  endYmd: string,
  dailySeries: Array<{ date: string; negative: number; neutral: number; positive: number }>,
): Promise<ReportDetail> {
  const [
    channels, authors, domains, emotions, places, subtopics,
    topByEngagement, topNegative, timeShape, coverage,
  ] = await Promise.all([
    loadChannels(client, agencyId, startYmd, endYmd),
    loadAuthors(client, agencyId, startYmd, endYmd, 12),
    loadDomains(client, agencyId, startYmd, endYmd, 10),
    loadEmotions(client, agencyId, startYmd, endYmd),
    loadPlaces(client, agencyId, startYmd, endYmd),
    loadSubtopics(client, agencyId, startYmd, endYmd, 16),
    loadTopMentions(client, agencyId, startYmd, endYmd, { onlyNegative: false, limit: 12 }),
    loadTopMentions(client, agencyId, startYmd, endYmd, { onlyNegative: true, limit: 8 }),
    loadTimeShape(client, agencyId, startYmd, endYmd),
    loadCoverage(client, agencyId, startYmd, endYmd),
  ]);

  return {
    channels,
    authors,
    domains,
    emotions: emotions.rows,
    emotionsTagged: emotions.tagged,
    municipalities: places.municipalities,
    regions: places.regions,
    subtopics,
    topByEngagement,
    topNegative,
    byHour: timeShape.byHour,
    byDow: timeShape.byDow,
    peaks: findPeaks(dailySeries),
    unclassified: coverage.unclassified,
    withoutSentiment: coverage.withoutSentiment,
    totals: {
      reach: coverage.reach,
      engagement: coverage.engagement,
      mentions: coverage.mentions,
    },
  };
}
