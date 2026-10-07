/**
 * Scorecard (oct-2026): todo lo que /api/scorecard calcula, a partir de un
 * cliente de base de datos. Vive aquí (y no en la ruta) para poder correrlo
 * contra prod desde un script sin desplegar.
 *
 * Universos, los mismos del resto del dashboard: los ÍNDICES (NSS, crisis,
 * Brand Health, polarización) salen de `calculateMetrics` sobre las menciones
 * sin duplicados (su universo calibrado, como loadAggregatesForWindow); los
 * CONTEOS (menciones, quién habló) van sobre el universo pertinente.
 */
import { addDaysYmd, loadDailySentimentSeries, loadMetricsForWindow, type PgClientLike } from '@eco/shared';
import { BASELINE_FROM, BASELINE_MAX_WEEKS, WEEKS_SHOWN, buildWeeks, type DayAggregates, type SnapshotRow } from './weeks';
import { buildVoices, type VoiceRow } from './voices';

const TZ = 'America/Puerto_Rico';

// Agregados por día con la misma definición que loadAggregatesForWindow, para
// calcular muchas semanas con una sola consulta.
export const DAILY_AGG_SQL = `
SELECT to_char((published_at AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS date,
       COUNT(*)::int AS total_mentions,
       COUNT(*) FILTER (WHERE COALESCE(nlp_sentiment, bw_sentiment) IN ('positivo','positive'))::int AS positive_count,
       COUNT(*) FILTER (WHERE COALESCE(nlp_sentiment, bw_sentiment) IN ('neutral'))::int AS neutral_count,
       COUNT(*) FILTER (WHERE COALESCE(nlp_sentiment, bw_sentiment) IN ('negativo','negative'))::int AS negative_count,
       COUNT(*) FILTER (WHERE nlp_pertinence = 'alta')::int AS high_pertinence_count,
       COUNT(*) FILTER (WHERE nlp_pertinence IN ('alta','media'))::int AS relevant_mentions_count,
       COUNT(*) FILTER (WHERE nlp_pertinence IN ('alta','media') AND COALESCE(nlp_sentiment, bw_sentiment) IN ('negativo','negative'))::int AS relevant_negative_count,
       COALESCE(SUM(likes), 0)::int AS total_likes,
       COALESCE(SUM(comments), 0)::int AS total_comments,
       COALESCE(SUM(shares), 0)::int AS total_shares,
       COALESCE(SUM(reach_estimate), 0)::bigint AS total_reach,
       COALESCE(SUM(impact), 0)::float AS total_impact,
       COALESCE(SUM(engagement_score), 0)::float AS total_engagement_score
  FROM mentions
 WHERE agency_id = $1
   AND is_duplicate = false
   AND (published_at AT TIME ZONE '${TZ}')::date >= $2::date
   AND (published_at AT TIME ZONE '${TZ}')::date <= $3::date
 GROUP BY 1`;

export const SNAP_SQL = `
SELECT to_char(date, 'YYYY-MM-DD') AS date, total_mentions, negative_count, nss, total_reach,
       total_engagement_score, engagement_rate, brand_health_index, crisis_risk_score, polarization_index
  FROM daily_metric_snapshots
 WHERE agency_id = $1 AND date >= $2::date AND date <= $3::date`;

// Quién habló: una fila por día y autor, en el universo pertinente.
export const VOICES_SQL = `
SELECT to_char((m.published_at AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS day,
       m.author, m.author_fullname, m.domain, m.page_type,
       COUNT(*)::int AS n,
       COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative'))::int AS neg,
       COALESCE(SUM(COALESCE(m.likes, 0) + COALESCE(m.comments, 0) + COALESCE(m.shares, 0)), 0)::int AS inter,
       COUNT(*) FILTER (WHERE COALESCE(m.likes, 0) + COALESCE(m.comments, 0) + COALESCE(m.shares, 0) = 0)::int AS zero
  FROM mentions m
 WHERE m.agency_id = $1
   AND m.is_duplicate = false
   AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
   AND (m.published_at AT TIME ZONE '${TZ}')::date >= $2::date
   AND (m.published_at AT TIME ZONE '${TZ}')::date <= $3::date
 GROUP BY 1, 2, 3, 4, 5`;

// Voces vistas en las 5 semanas antes de la ventana, para contar las nuevas.
export const PRIOR_VOICES_SQL = `
SELECT DISTINCT m.author, m.author_fullname, m.domain, m.page_type
  FROM mentions m
 WHERE m.agency_id = $1
   AND m.is_duplicate = false
   AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
   AND (m.published_at AT TIME ZONE '${TZ}')::date >= $2::date
   AND (m.published_at AT TIME ZONE '${TZ}')::date <= $3::date`;

export async function computeScorecard(pool: PgClientLike, agencyId: string, startYmd: string, endYmd: string, prevStartYmd: string, prevEndYmd: string) {
  // Semanas: las 12 que se muestran y, para lo usual, hasta un año hacia atrás
  // sin cruzar el quiebre de serie. La historia de cada semana necesita los 30
  // días de snapshots anteriores a su inicio.
  const shownFrom = addDaysYmd(endYmd, -(7 * WEEKS_SHOWN - 1));
  const yearFrom = addDaysYmd(endYmd, -(7 * (BASELINE_MAX_WEEKS + 1) - 1));
  const baseFrom = BASELINE_FROM > yearFrom ? BASELINE_FROM : yearFrom;
  const aggFrom = shownFrom < baseFrom ? shownFrom : baseFrom;
  const countsFrom = aggFrom < prevStartYmd ? aggFrom : prevStartYmd;
  const snapFrom = addDaysYmd(countsFrom, -45);
  const priorFrom = addDaysYmd(startYmd, -35), priorTo = addDaysYmd(startYmd, -1);

  const [agencyRes, aggRes, snapRes, counts, prevMetrics, voicesRes, priorRes] = await Promise.all([
    pool.query<{ slug: string; name: string | null }>('SELECT slug, name FROM agencies WHERE id = $1', [agencyId]),
    pool.query<Record<string, string | number>>(DAILY_AGG_SQL, [agencyId, aggFrom, endYmd]),
    pool.query<Record<string, string | number | null>>(SNAP_SQL, [agencyId, snapFrom, endYmd]),
    loadDailySentimentSeries(pool, agencyId, countsFrom, endYmd),
    loadMetricsForWindow(pool, agencyId, prevStartYmd, prevEndYmd),
    pool.query<VoiceRow>(VOICES_SQL, [agencyId, prevStartYmd, endYmd]),
    pool.query<VoiceRow>(PRIOR_VOICES_SQL, [agencyId, priorFrom, priorTo]),
  ]);
  const n = (v: unknown) => (v == null ? 0 : Number(v));
  const nn = (v: unknown) => (v == null ? null : Number(v));
  const days: DayAggregates[] = aggRes.rows.map((r) => ({
    date: String(r.date), totalMentions: n(r.total_mentions), positiveCount: n(r.positive_count), neutralCount: n(r.neutral_count),
    negativeCount: n(r.negative_count), highPertinenceCount: n(r.high_pertinence_count), relevantMentionsCount: n(r.relevant_mentions_count),
    relevantNegativeCount: n(r.relevant_negative_count), totalLikes: n(r.total_likes), totalComments: n(r.total_comments),
    totalShares: n(r.total_shares), totalReach: n(r.total_reach), totalImpact: n(r.total_impact), totalEngagementScore: n(r.total_engagement_score),
  }));
  const snaps: SnapshotRow[] = snapRes.rows.map((r) => ({
    date: String(r.date), totalMentions: n(r.total_mentions), negativeCount: n(r.negative_count), nss: nn(r.nss),
    totalReach: n(r.total_reach), totalEngagementScore: n(r.total_engagement_score), engagementRate: nn(r.engagement_rate),
    brandHealthIndex: nn(r.brand_health_index), crisisRiskScore: nn(r.crisis_risk_score), polarizationIndex: nn(r.polarization_index),
  }));
  const weeks = buildWeeks({ days, snaps, counts, endYmd });

  // Serie diaria de la ventana previa, con la misma forma que TIMELINE de eco-data.
  const snapByDate = new Map(snaps.map((s) => [s.date, s]));
  const prevTimeline = counts.filter((c) => c.date >= prevStartYmd && c.date <= prevEndYmd).map((c) => {
    const s = snapByDate.get(c.date);
    return {
      fullDate: `${c.date}T00:00:00.000Z`,
      nss: s?.nss ?? null,
      brandHealthIndex: s?.brandHealthIndex ?? null,
      crisisRiskScore: s?.crisisRiskScore ?? null,
      polarizationIndex: s?.polarizationIndex ?? null,
      totalMentions: c.positive + c.neutral + c.negative,
      positivo: c.positive, neutral: c.neutral, negativo: c.negative,
    };
  });
  const prevCount = counts.filter((c) => c.date >= prevStartYmd && c.date <= prevEndYmd).reduce((s, c) => s + c.positive + c.neutral + c.negative, 0);

  const agency = agencyRes.rows[0] ?? { slug: '', name: null };
  const curDays: string[] = [];
  for (let d = startYmd; d <= endYmd; d = addDaysYmd(d, 1)) curDays.push(d);
  const voices = buildVoices({
    cur: voicesRes.rows.filter((r) => r.day >= startYmd), prev: voicesRes.rows.filter((r) => r.day <= prevEndYmd),
    prior: priorRes.rows, days: curDays, agencySlug: agency.slug, agencyName: agency.name,
  });

  return {
    window: { from: startYmd, to: endYmd, prevFrom: prevStartYmd, prevTo: prevEndYmd },
    prev: {
      nss: prevMetrics.nss,
      crisis: prevMetrics.crisisRiskScore,
      bhi: prevMetrics.brandHealthIndex,
      polarization: prevMetrics.polarizationIndex,
      mentions: prevCount,
      timeline: prevTimeline,
    },
    weeks,
    voices,
  };
}
