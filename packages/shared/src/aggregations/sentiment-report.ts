/**
 * Aggregations compartidos entre el lambda eco-weekly-report (correo diario)
 * y el endpoint /api/overview (espejo del correo en el dashboard).
 *
 * Contiene las queries SQL de:
 *  - termómetro (totales por sentimiento) y delta vs ventana previa
 *  - tendencia diaria (neg/neu/pos por día)
 *  - tabla de tópicos: top 7 + "Otros tópicos (N)" + "Sin clasificar",
 *    con conteo principal (top-confidence dedup) y secundario
 *    (menciones donde el tópico aparece pero no es el primary).
 *
 * Sentimiento: COALESCE(nlp_sentiment, bw_sentiment) — fallback a Brandwatch
 * cuando NLP aún no clasificó.
 *
 * Filtro de fechas: la ventana se interpreta SIEMPRE en zona AST (America/
 * Puerto_Rico). Los strings 'YYYY-MM-DD' representan días calendario AST.
 * El SQL convierte cada `published_at` (stored as UTC) a su fecha AST con
 * `(published_at AT TIME ZONE 'America/Puerto_Rico')::date` y la compara
 * contra los bordes `$2::date`/`$3::date`. Match con el filtro que usa
 * `loadAggregatesForWindow` en `@eco/shared/metrics` — paridad byte-por-byte
 * entre Overview, Scorecard y correo. NOTA: no usar `$2::date AT TIME ZONE`
 * porque retorna `timestamp without TZ`, que Postgres compara asumiendo TZ
 * del servidor (UTC) → recorta/agrega 4h en los bordes (bug previo).
 */

import { addDaysYmd } from '../dates';
import { formatDayLabel } from '../format-period';

/**
 * Mínima interfaz del cliente PostgreSQL — la satisface tanto `pg.Client`
 * (lambda) como un wrapper liviano sobre el pool de Drizzle (web app).
 */
export interface PgClientLike {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Etiquetas internas del módulo en inglés (negative/neutral/positive) para
 * matchear el shape que ya usa WeeklyAggregates y el LLM. NO se confunde con
 * el `Sentiment` global del paquete (en español: negativo/neutral/positivo)
 * que viven en `types.ts`. No se exporta.
 */
type SentimentKey = 'negative' | 'neutral' | 'positive';

export interface SentimentTotals {
  negative: number;
  neutral: number;
  positive: number;
  total: number;
}

export interface DailyPoint {
  /** YYYY-MM-DD en TZ PR. */
  date: string;
  /** "mié 29" — etiqueta lista para chart o tabla. */
  dayLabel: string;
  negative: number;
  neutral: number;
  positive: number;
}

export interface TopicTableRow {
  topic: string;
  /** "puentes · asfalto · drenaje" (top 3 subtopics). Vacío si la fila es agregada. */
  subtopics: string;
  /** Conteo principal: cada mención bajo su tópico de mayor confianza. */
  total: number;
  /**
   * Menciones donde el tópico aparece pero no como su top-confidence.
   * 0 para "Sin clasificar" (no aplica) y suma de los miembros para
   * "Otros tópicos (N)".
   */
  secondaryCount: number;
  negative: number;
  neutral: number;
  positive: number;
  /** True si la fila es la agregación de los tópicos fuera del top 7. */
  isOther?: boolean;
  /** True si la fila es la de menciones aún sin tópico. */
  isUnclassified?: boolean;
}

export interface SentimentReport {
  /** YYYY-MM-DD en TZ PR (inclusive). */
  periodStart: string;
  /** YYYY-MM-DD en TZ PR (inclusive). */
  periodEnd: string;
  totals: SentimentTotals;
  /** % change de cada sentimiento vs la ventana previa de la misma duración. */
  deltaVsPrev: { negative: number; neutral: number; positive: number };
  /** Una entrada por día calendario en TZ PR, en orden cronológico. */
  dailySeries: DailyPoint[];
  /** Top 7 tópicos clasificados + "Otros tópicos (N)" si aplica + "Sin clasificar" si > 0. */
  topicsTable: TopicTableRow[];
}

const TOP_N_TOPICS = 7;

// ============================================================
// Helpers
// ============================================================

function normalizeSentiment(s: string | null): SentimentKey | null {
  if (!s) return null;
  const v = s.toLowerCase();
  if (v.startsWith('neg')) return 'negative';
  if (v.startsWith('pos')) return 'positive';
  if (v.startsWith('neu')) return 'neutral';
  return null;
}

function foldSentiments(rows: Array<{ s: string | null; c: number | string }>): {
  negative: number;
  neutral: number;
  positive: number;
} {
  const out = { negative: 0, neutral: 0, positive: 0 };
  for (const row of rows) {
    const s = normalizeSentiment(row.s);
    if (s) out[s] += Number(row.c);
  }
  return out;
}

function deltaPct(curr: number, prev: number): number {
  if (prev === 0) {
    if (curr === 0) return 0;
    return 100;
  }
  return ((curr - prev) / prev) * 100;
}

// ============================================================
// Query: totales por sentimiento (mismo SQL que weekly-report:464)
// ============================================================

async function loadTotals(
  client: PgClientLike,
  agencyId: string,
  startYmd: string,
  endYmd: string,
): Promise<{ negative: number; neutral: number; positive: number }> {
  const r = await client.query<{ s: string | null; c: number | string }>(
    `SELECT COALESCE(nlp_sentiment, bw_sentiment) AS s, COUNT(*)::int AS c
       FROM mentions
      WHERE agency_id = $1
        AND is_duplicate = false
        AND (published_at AT TIME ZONE 'America/Puerto_Rico')::date >= $2::date
        AND (published_at AT TIME ZONE 'America/Puerto_Rico')::date <= $3::date
      GROUP BY 1`,
    [agencyId, startYmd, endYmd],
  );
  return foldSentiments(r.rows);
}

// ============================================================
// Query: tendencia diaria (mismo SQL que weekly-report:492)
// ============================================================

async function loadDailySeries(
  client: PgClientLike,
  agencyId: string,
  startYmd: string,
  endYmd: string,
): Promise<DailyPoint[]> {
  // Caso 1D (ventana de un solo día): devolvemos buckets horarios AST en vez
  // de un solo punto diario. Misma idea que el TIMELINE del Scorecard — una
  // gráfica con un solo punto no aporta señal cuando el usuario mira "Hoy".
  if (startYmd === endYmd) {
    return loadHourlySeriesForDay(client, agencyId, startYmd);
  }

  const rows = await client.query<{ d: string; s: string | null; c: number | string }>(
    `SELECT to_char(published_at AT TIME ZONE 'America/Puerto_Rico', 'YYYY-MM-DD') AS d,
            COALESCE(nlp_sentiment, bw_sentiment) AS s,
            COUNT(*)::int AS c
       FROM mentions
      WHERE agency_id = $1
        AND is_duplicate = false
        AND (published_at AT TIME ZONE 'America/Puerto_Rico')::date >= $2::date
        AND (published_at AT TIME ZONE 'America/Puerto_Rico')::date <= $3::date
      GROUP BY 1, 2
      ORDER BY 1`,
    [agencyId, startYmd, endYmd],
  );

  // Pre-fill todos los días de la ventana (incluso si tienen 0 menciones)
  // para que el chart renderice bien sin gaps.
  const daily = new Map<string, { negative: number; neutral: number; positive: number }>();
  for (let cur = startYmd; cur <= endYmd; cur = addDaysYmd(cur, 1)) {
    daily.set(cur, { negative: 0, neutral: 0, positive: 0 });
  }
  for (const row of rows.rows) {
    const bucket = daily.get(row.d);
    if (!bucket) continue;
    const s = normalizeSentiment(row.s);
    if (s) bucket[s] += Number(row.c);
  }
  return Array.from(daily.entries()).map(([date, v]) => ({
    date,
    dayLabel: formatDayLabel(date),
    ...v,
  }));
}

/**
 * Variante horaria de loadDailySeries — devuelve 24 buckets AST del día
 * `ymd`. Solo se llama cuando startYmd === endYmd. El frontend renderiza el
 * `dayLabel` ("HH:00") como eje X. `date` queda en formato ISO con hora para
 * que el click→slice pueda filtrar por (day, hour).
 */
async function loadHourlySeriesForDay(
  client: PgClientLike,
  agencyId: string,
  ymd: string,
): Promise<DailyPoint[]> {
  const rows = await client.query<{ h: number | string; s: string | null; c: number | string }>(
    `SELECT EXTRACT(HOUR FROM (published_at AT TIME ZONE 'America/Puerto_Rico'))::int AS h,
            COALESCE(nlp_sentiment, bw_sentiment) AS s,
            COUNT(*)::int AS c
       FROM mentions
      WHERE agency_id = $1
        AND is_duplicate = false
        AND (published_at AT TIME ZONE 'America/Puerto_Rico')::date = $2::date
      GROUP BY 1, 2
      ORDER BY 1`,
    [agencyId, ymd],
  );

  // Pre-fill horas 0..23 para que el chart pueda omitir las vacías si quiere
  // pero también renderizar una línea continua si las usamos.
  const hourly = new Map<number, { negative: number; neutral: number; positive: number }>();
  for (let h = 0; h < 24; h++) hourly.set(h, { negative: 0, neutral: 0, positive: 0 });
  for (const row of rows.rows) {
    const bucket = hourly.get(Number(row.h));
    if (!bucket) continue;
    const s = normalizeSentiment(row.s);
    if (s) bucket[s] += Number(row.c);
  }
  // Filtrar horas sin actividad para que la curva refleje cuándo arranca el
  // día (mismo criterio que el TIMELINE del Scorecard).
  return Array.from(hourly.entries())
    .filter(([, v]) => v.negative + v.neutral + v.positive > 0)
    .map(([h, v]) => ({
      date: `${ymd}T${String(h).padStart(2, '0')}:00:00-04:00`,
      dayLabel: `${String(h).padStart(2, '0')}:00`,
      ...v,
    }));
}

// ============================================================
// Query: tabla de tópicos con primaryCount + secondaryCount
// ============================================================

interface RawTopicRow {
  topic_id_key: number | string;
  topic: string;
  subtopics: string[] | null;
  primary_count: number | string;
  secondary_count: number | string;
  negative: number | string;
  neutral: number | string;
  positive: number | string;
}

async function loadTopicsTable(
  client: PgClientLike,
  agencyId: string,
  startYmd: string,
  endYmd: string,
): Promise<TopicTableRow[]> {
  // Estrategia (matchea weekly-report:734-823):
  //  - Cada mención cuenta UNA vez bajo su top-confidence topic (subquery con
  //    LIMIT 1 ordenando por confidence DESC NULLS LAST, topic_id ASC).
  //  - secondary_count = (multi-class total) - (primary_count). El multi-class
  //    total cuenta DISTINCT mentions que tocan ese topic_id sin importar
  //    confidence — incluye tanto las primarias como las secundarias.
  //  - Top 7 clasificados + "Otros tópicos (N)" si hay resto + "Sin clasificar"
  //    si > 0.
  const r = await client.query<RawTopicRow>(
    `WITH primaries AS (
       SELECT COALESCE(t.id::text, 'unclassified') AS topic_id_key,
              COALESCE(t.name, 'Sin clasificar') AS topic,
              ARRAY_AGG(DISTINCT s.name ORDER BY s.name) FILTER (WHERE s.name IS NOT NULL) AS subtopics,
              COUNT(*)::int AS primary_count,
              COUNT(*) FILTER (WHERE pt.sentiment = 'negativo')::int AS negative,
              COUNT(*) FILTER (WHERE pt.sentiment = 'neutral')::int AS neutral,
              COUNT(*) FILTER (WHERE pt.sentiment = 'positivo')::int AS positive
         FROM (
           SELECT m.id AS mention_id,
                  COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
                  (SELECT topic_id FROM mention_topics
                    WHERE mention_id = m.id
                    ORDER BY confidence DESC NULLS LAST, topic_id ASC LIMIT 1) AS topic_id,
                  (SELECT subtopic_id FROM mention_topics
                    WHERE mention_id = m.id
                    ORDER BY confidence DESC NULLS LAST, topic_id ASC LIMIT 1) AS subtopic_id
             FROM mentions m
            WHERE m.agency_id = $1
              AND m.is_duplicate = false
              AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date >= $2::date
              AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date <= $3::date
         ) pt
         LEFT JOIN topics t ON t.id = pt.topic_id
         LEFT JOIN subtopics s ON s.id = pt.subtopic_id
         GROUP BY t.id, t.name
     ),
     multi AS (
       SELECT mt.topic_id::text AS topic_id_key,
              COUNT(DISTINCT mt.mention_id)::int AS multi_count
         FROM mention_topics mt
         JOIN mentions m ON m.id = mt.mention_id
        WHERE m.agency_id = $1
          AND m.is_duplicate = false
          AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date >= $2::date
          AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date <= $3::date
        GROUP BY mt.topic_id
     )
     SELECT p.topic_id_key,
            p.topic,
            p.subtopics,
            p.primary_count,
            GREATEST(COALESCE(mu.multi_count, 0) - p.primary_count, 0)::int AS secondary_count,
            p.negative,
            p.neutral,
            p.positive
       FROM primaries p
       LEFT JOIN multi mu ON mu.topic_id_key = p.topic_id_key
      ORDER BY p.primary_count DESC`,
    [agencyId, startYmd, endYmd],
  );

  const allRows: TopicTableRow[] = r.rows.map((row): TopicTableRow => ({
    topic: row.topic,
    subtopics: ((row.subtopics ?? []) as string[]).slice(0, 3).join(' · '),
    total: Number(row.primary_count),
    secondaryCount: Number(row.secondary_count),
    negative: Number(row.negative),
    neutral: Number(row.neutral),
    positive: Number(row.positive),
    isUnclassified: row.topic === 'Sin clasificar',
  }));

  const classified = allRows.filter((row) => !row.isUnclassified);
  const unclassified = allRows.find((row) => row.isUnclassified);

  const top = classified.slice(0, TOP_N_TOPICS);
  const rest = classified.slice(TOP_N_TOPICS);

  const result: TopicTableRow[] = [...top];
  if (rest.length > 0) {
    result.push({
      topic: `Otros tópicos (${rest.length})`,
      subtopics: '',
      total: rest.reduce((s, r) => s + r.total, 0),
      secondaryCount: rest.reduce((s, r) => s + r.secondaryCount, 0),
      negative: rest.reduce((s, r) => s + r.negative, 0),
      neutral: rest.reduce((s, r) => s + r.neutral, 0),
      positive: rest.reduce((s, r) => s + r.positive, 0),
      isOther: true,
    });
  }
  if (unclassified && unclassified.total > 0) {
    result.push({
      ...unclassified,
      subtopics: 'En proceso de clasificación',
      // No tiene sentido reportar secundarias en menciones sin clasificar.
      secondaryCount: 0,
    });
  }
  return result;
}

// ============================================================
// API pública
// ============================================================

/**
 * Construye el reporte de sentimiento para una agencia y ventana de fechas.
 * Misma fuente de verdad que el correo eco-weekly-report y que /api/overview.
 *
 * `startYmd`/`endYmd` son días calendario en TZ Puerto Rico (inclusive en
 * ambos extremos). `prevStartYmd`/`prevEndYmd` definen la ventana previa para
 * computar deltas.
 */
export async function buildSentimentReport(
  client: PgClientLike,
  agencyId: string,
  startYmd: string,
  endYmd: string,
  prevStartYmd: string,
  prevEndYmd: string,
): Promise<SentimentReport> {
  const [curr, prev, dailySeries, topicsTable] = await Promise.all([
    loadTotals(client, agencyId, startYmd, endYmd),
    loadTotals(client, agencyId, prevStartYmd, prevEndYmd),
    loadDailySeries(client, agencyId, startYmd, endYmd),
    loadTopicsTable(client, agencyId, startYmd, endYmd),
  ]);

  const totals: SentimentTotals = {
    ...curr,
    total: curr.negative + curr.neutral + curr.positive,
  };

  const deltaVsPrev = {
    negative: deltaPct(curr.negative, prev.negative),
    neutral: deltaPct(curr.neutral, prev.neutral),
    positive: deltaPct(curr.positive, prev.positive),
  };

  return {
    periodStart: startYmd,
    periodEnd: endYmd,
    totals,
    deltaVsPrev,
    dailySeries,
    topicsTable,
  };
}
