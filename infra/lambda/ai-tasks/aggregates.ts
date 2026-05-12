/**
 * Helpers de agregación para la acción `period-insights`. Duplica el patrón
 * del weekly-report lambda (loadSamples, buildAggregates) — no se factoriza a
 * @eco/shared todavía porque el shape exacto de las queries es local; un PR
 * futuro puede DRY-ear si conviene.
 *
 * Las funciones aquí toman un pg.Client y devuelven exactamente lo que
 * `buildSentimentInsightsPrompt` y `buildDailySummaryPrompt` esperan.
 */
import { buildSentimentReport } from '@eco/shared';
import type { PgClientLike, SentimentReport } from '@eco/shared';
import type { MentionSample, WeeklyAggregates } from '@eco/shared';

export function agencyShortName(slug: string): string {
  // Reglas heurísticas del weekly-report para acortar el nombre de la agencia.
  if (slug.startsWith('ddec')) return 'DDEC';
  if (slug.startsWith('dtop')) return 'DTOP';
  if (slug.startsWith('dac')) return 'DACo';
  if (slug.startsWith('aaa')) return 'AAA';
  return slug.toUpperCase().slice(0, 6);
}

export function normalizeSentiment(s: string | null | undefined): 'negative' | 'neutral' | 'positive' | null {
  if (s === 'negativo' || s === 'negative') return 'negative';
  if (s === 'positivo' || s === 'positive') return 'positive';
  if (s === 'neutral') return 'neutral';
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildPeriodAggregates(
  client: any,
  agency: { id: string; slug: string; name: string },
  startDate: string,
  endDate: string,
  prevStartDate: string,
  prevEndDate: string,
): Promise<WeeklyAggregates> {
  const sentimentReport: SentimentReport = await buildSentimentReport(
    client as PgClientLike, agency.id, startDate, endDate, prevStartDate, prevEndDate,
  );

  const byTopic = sentimentReport.topicsTable
    .filter((t) => !t.isOther && !t.isUnclassified)
    .slice(0, 10)
    .map((t) => ({
      topic: t.topic,
      subtopics: t.subtopics ? t.subtopics.split(' · ') : [],
      total: t.total,
      negative: t.negative,
      neutral: t.neutral,
      positive: t.positive,
    }));

  const byMuniRows = await client.query(
    `SELECT mu.name AS municipality,
            COUNT(DISTINCT m.id)::int AS total,
            COUNT(DISTINCT m.id) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) = 'negativo')::int AS negative
       FROM mentions m
       JOIN mention_municipalities mm ON mm.mention_id = m.id
       JOIN municipalities mu ON mu.id = mm.municipality_id
      WHERE m.agency_id = $1
        AND m.published_at >= ($2::date)
        AND m.published_at <  (($3::date) + INTERVAL '1 day')
      GROUP BY mu.id, mu.name
      ORDER BY negative DESC, total DESC
      LIMIT 10`,
    [agency.id, startDate, endDate],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byMunicipality = byMuniRows.rows.map((r: any) => ({
    municipality: r.municipality, total: r.total, negative: r.negative,
  }));

  const topAuthorsRows = await client.query(
    `SELECT author, COUNT(*)::int AS mentions,
            (SELECT COALESCE(m2.nlp_sentiment, m2.bw_sentiment)
               FROM mentions m2
              WHERE m2.agency_id = $1 AND m2.author = m.author
                AND m2.published_at >= ($2::date)
                AND m2.published_at <  (($3::date) + INTERVAL '1 day')
              GROUP BY 1
              ORDER BY COUNT(*) DESC
              LIMIT 1) AS dominant_sentiment
       FROM mentions m
      WHERE agency_id = $1
        AND author IS NOT NULL AND author <> ''
        AND published_at >= ($2::date)
        AND published_at <  (($3::date) + INTERVAL '1 day')
      GROUP BY author
      ORDER BY mentions DESC
      LIMIT 8`,
    [agency.id, startDate, endDate],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topAuthors = topAuthorsRows.rows.map((r: any) => ({
    author: r.author,
    mentions: r.mentions,
    sentiment: (normalizeSentiment(r.dominant_sentiment) ?? 'neutral') as 'negative' | 'neutral' | 'positive',
  }));

  const topSourcesRows = await client.query(
    `SELECT COALESCE(content_source_name, domain) AS source, COUNT(*)::int AS mentions
       FROM mentions
      WHERE agency_id = $1
        AND published_at >= ($2::date)
        AND published_at <  (($3::date) + INTERVAL '1 day')
        AND COALESCE(content_source_name, domain) IS NOT NULL
      GROUP BY source
      ORDER BY mentions DESC
      LIMIT 8`,
    [agency.id, startDate, endDate],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topSources = topSourcesRows.rows.map((r: any) => ({ source: r.source, mentions: r.mentions }));

  const emotionsRows = await client.query(
    `SELECT emo::text AS emotion, COUNT(*)::int AS cnt
       FROM mentions m, jsonb_array_elements_text(COALESCE(m.nlp_emotions, '[]'::jsonb)) AS emo
      WHERE m.agency_id = $1
        AND m.published_at >= ($2::date)
        AND m.published_at <  (($3::date) + INTERVAL '1 day')
      GROUP BY emo
      ORDER BY cnt DESC
      LIMIT 6`,
    [agency.id, startDate, endDate],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topEmotions = emotionsRows.rows.map((r: any) => ({
    emotion: String(r.emotion).replace(/^"|"$/g, ''),
    count: r.cnt,
  }));

  return {
    periodStart: startDate,
    periodEnd: endDate,
    agencyName: agency.name,
    agencyShortName: agencyShortName(agency.slug),
    totals: sentimentReport.totals,
    deltaVsPrevWeek: sentimentReport.deltaVsPrev,
    dailySeries: sentimentReport.dailySeries.map((d) => ({
      date: d.date,
      negative: d.negative,
      neutral: d.neutral,
      positive: d.positive,
    })),
    byTopic,
    byMunicipality,
    topAuthors,
    topSources,
    topEmotions,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadSamples(
  client: any,
  agencyId: string,
  startDate: string,
  endDate: string,
): Promise<{ negative: MentionSample[]; neutral: MentionSample[]; positive: MentionSample[] }> {
  const result: Record<string, MentionSample[]> = { negative: [], neutral: [], positive: [] };
  const map: Record<string, 'negativo' | 'neutral' | 'positivo'> = {
    negative: 'negativo', neutral: 'neutral', positive: 'positivo',
  };
  for (const key of Object.keys(result) as Array<keyof typeof result>) {
    const r = await client.query(
      `SELECT m.id, m.published_at, m.title, m.snippet, m.author, m.content_source_name, m.url,
              m.page_type, m.engagement_score, m.nlp_pertinence, m.nlp_emotions,
              COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
              t.name AS topic, s.name AS subtopic, mu.name AS municipality
         FROM mentions m
         LEFT JOIN LATERAL (
           SELECT topic_id, subtopic_id FROM mention_topics WHERE mention_id = m.id ORDER BY confidence DESC NULLS LAST LIMIT 1
         ) mt ON true
         LEFT JOIN topics t ON t.id = mt.topic_id
         LEFT JOIN subtopics s ON s.id = mt.subtopic_id
         LEFT JOIN LATERAL (
           SELECT municipality_id FROM mention_municipalities WHERE mention_id = m.id LIMIT 1
         ) mm ON true
         LEFT JOIN municipalities mu ON mu.id = mm.municipality_id
        WHERE m.agency_id = $1
          AND m.published_at >= ($2::date)
          AND m.published_at <  (($3::date) + INTERVAL '1 day')
          AND COALESCE(m.nlp_sentiment, m.bw_sentiment) = $4
          AND m.nlp_pertinence IN ('alta','media')
        ORDER BY COALESCE(m.engagement_score, 0) DESC, m.published_at DESC
        LIMIT 20`,
      [agencyId, startDate, endDate, map[key]],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result[key] = r.rows.map((row: any) => ({
      id: row.id,
      createdAt: (row.published_at as Date).toISOString(),
      text: `${row.title ? row.title + ' — ' : ''}${row.snippet ?? ''}`.trim(),
      sentiment: key as 'negative' | 'neutral' | 'positive',
      topic: row.topic,
      subtopic: row.subtopic,
      municipality: row.municipality,
      author: row.author,
      source: row.content_source_name,
      url: row.url,
      pageType: row.page_type,
      engagement: row.engagement_score != null ? Number(row.engagement_score) : null,
      pertinence: (row.nlp_pertinence as 'alta' | 'media' | 'baja' | null) ?? null,
      emotions: Array.isArray(row.nlp_emotions) ? row.nlp_emotions : [],
    }));
  }
  return result as { negative: MentionSample[]; neutral: MentionSample[]; positive: MentionSample[] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadTodaySamples(client: any, agencyId: string, endYmd: string): Promise<MentionSample[]> {
  const r = await client.query(
    `SELECT m.id, m.published_at, m.title, m.snippet, m.author, m.content_source_name,
            COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
            t.name AS topic, mu.name AS municipality
       FROM mentions m
       LEFT JOIN LATERAL (
         SELECT topic_id FROM mention_topics WHERE mention_id = m.id ORDER BY confidence DESC NULLS LAST LIMIT 1
       ) mt ON true
       LEFT JOIN topics t ON t.id = mt.topic_id
       LEFT JOIN LATERAL (
         SELECT municipality_id FROM mention_municipalities WHERE mention_id = m.id LIMIT 1
       ) mm ON true
       LEFT JOIN municipalities mu ON mu.id = mm.municipality_id
      WHERE m.agency_id = $1
        AND m.nlp_pertinence IN ('alta','media')
        AND m.published_at >= ($2::date)
        AND m.published_at <  (($2::date) + INTERVAL '1 day')
      ORDER BY COALESCE(m.engagement_score, 0) DESC
      LIMIT 12`,
    [agencyId, endYmd],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return r.rows.map((row: any) => ({
    id: row.id,
    createdAt: (row.published_at as Date).toISOString(),
    text: `${row.title ? row.title + ' — ' : ''}${row.snippet ?? ''}`.trim(),
    sentiment: (normalizeSentiment(row.sentiment) ?? 'neutral') as 'negative' | 'neutral' | 'positive',
    topic: row.topic ?? null,
    municipality: row.municipality ?? null,
    author: row.author ?? null,
    source: row.content_source_name ?? null,
  }));
}
