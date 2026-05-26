/**
 * Single source of truth para las métricas compuestas del scorecard:
 *   NSS, Brand Health Index, Crisis Risk, Polarization Index,
 *   Engagement Rate / Velocity, Amplification Rate, Reputation Momentum,
 *   Volume Anomaly z-score.
 *
 * Antes vivían solo en infra/lambda/metrics-calculator/index.ts (cálculo
 * diario en zona AST). El scorecard del dashboard necesita las mismas
 * fórmulas evaluadas sobre la **ventana del period del usuario**, no solo
 * sobre el día calendario "hoy". Mover las fórmulas aquí permite:
 *   - lambda metrics-calculator sigue corriendo cada 10 min y produce
 *     un snapshot por día por agencia (sin cambio de comportamiento)
 *   - /api/eco-data y /api/ai/metric-insight las usan con ventana
 *     arbitraria [startYmd, endYmd]
 *
 * El módulo no importa el SDK de Bedrock ni Drizzle — sólo Postgres mínimo
 * via `PgClientLike` (mismo shape que ya define `aggregations/sentiment-report.ts`).
 */

import type { PgClientLike } from './aggregations/sentiment-report';

// ============================================================
// Tipos
// ============================================================

/** Conteos y sumas brutas de mentions sobre una ventana arbitraria. */
export interface DailyAggregates {
  totalMentions: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  highPertinenceCount: number;
  /**
   * Menciones cuya pertinencia es 'alta' o 'media'. Usado como denominador del
   * crisis severity para inmunizar el score contra picos de ruido de baja
   * pertinencia (shells vacíos de Twitter, comentarios irrelevantes, etc.).
   * Cuando un evento genera 10 menciones reales y 200 comentarios irrelevantes,
   * el severity sobre total se diluye; sobre alta+media refleja la realidad.
   */
  relevantMentionsCount: number;
  /** Negativas dentro de relevantMentionsCount. */
  relevantNegativeCount: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalReach: number;
  totalImpact: number;
  totalEngagementScore: number;
}

/** Una fila de daily_metric_snapshots usada como historia para rolling stats. */
export interface HistoricalSnapshot {
  date: string;
  totalMentions: number;
  negativeCount: number;
  nss: number | null;
  totalReach: number;
  totalEngagementScore: number;
  engagementRate: number | null;
}

/** Resultado de `calculateMetrics`. Match exacto del shape antiguo del lambda. */
export interface ComputedMetrics {
  nss: number | null;
  brandHealthIndex: number | null;
  reputationMomentum: number | null;
  engagementRate: number | null;
  amplificationRate: number | null;
  engagementVelocity: number | null;
  crisisRiskScore: number | null;
  volumeAnomalyZscore: number | null;
  nss7d: number | null;
  nss30d: number | null;
  polarizationIndex: number | null;
  crisisSeverity: number | null;
  crisisVelocity: number | null;
  crisisRelevance: number | null;
  crisisConfidence: number | null;
}

// ============================================================
// Utilidades
// ============================================================

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = average(values);
  const squaredDiffs = values.map((v) => (v - avg) ** 2);
  return Math.sqrt(average(squaredDiffs));
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Signo del NSS para el componente reach del BHI. NSS>0 premia, NSS<-20
 * penaliza, neutro/leve negativo no aporta dirección. Decisión del backtest
 * V1c: usar NSS del periodo (reactivo) en vez del nss_30d (lento, no captura
 * crisis del mismo día).
 */
function nssSign(nss: number | null): -1 | 0 | 1 {
  if (nss == null) return 0;
  if (nss > 0) return 1;
  if (nss < -20) return -1;
  return 0;
}

// ============================================================
// Núcleo: calculateMetrics (idéntico al del lambda original)
// ============================================================

/**
 * Computa las métricas compuestas a partir de los aggregates del periodo y
 * la historia de snapshots previos. Idéntica al algoritmo de
 * `infra/lambda/metrics-calculator/index.ts:calculateMetrics`; cualquier
 * cambio aquí debe ir acompañado de re-backtest.
 */
export function calculateMetrics(
  agg: DailyAggregates,
  history: HistoricalSnapshot[],
): ComputedMetrics {
  const { totalMentions, positiveCount, negativeCount, highPertinenceCount } = agg;
  const { relevantMentionsCount, relevantNegativeCount } = agg;
  const { totalLikes, totalComments, totalShares, totalReach, totalEngagementScore } = agg;

  if (totalMentions === 0) {
    return {
      nss: null,
      brandHealthIndex: null,
      reputationMomentum: null,
      engagementRate: null,
      amplificationRate: null,
      engagementVelocity: null,
      crisisRiskScore: null,
      volumeAnomalyZscore: null,
      nss7d: null,
      nss30d: null,
      polarizationIndex: null,
      crisisSeverity: null,
      crisisVelocity: null,
      crisisRelevance: null,
      crisisConfidence: null,
    };
  }

  // #1 NSS
  const nss = ((positiveCount - negativeCount) / totalMentions) * 100;

  const nssValues = history.filter((h) => h.nss != null).map((h) => h.nss!);
  const nss7d = nssValues.length > 0
    ? average(nssValues.slice(0, Math.min(7, nssValues.length)))
    : null;
  const nss30d = nssValues.length > 0
    ? average(nssValues.slice(0, Math.min(30, nssValues.length)))
    : null;

  // #3 Reputation Momentum
  const nss7dAgo = nssValues.length >= 7
    ? nssValues[6]
    : (nssValues.length > 0 ? nssValues[nssValues.length - 1] : null);
  const reputationMomentum = nss7dAgo != null ? nss - nss7dAgo : null;

  // #6 Engagement Rate
  const totalInteractions = totalLikes + totalComments + totalShares;
  const engagementRate = totalReach > 0
    ? (totalInteractions / totalReach) * 100
    : null;

  // #8 Amplification Rate
  const amplificationRate = totalInteractions > 0
    ? (totalShares / totalInteractions) * 100
    : null;

  // #10 Engagement Velocity (z-score sobre 30d)
  const avgEngToday = totalEngagementScore / totalMentions;
  const engPerMentionHistory = history
    .filter((h) => h.totalMentions > 0)
    .slice(0, 30)
    .map((h) => h.totalEngagementScore / h.totalMentions);
  let engagementVelocity: number | null = null;
  if (engPerMentionHistory.length >= 7) {
    const m = average(engPerMentionHistory);
    const s = stddev(engPerMentionHistory);
    engagementVelocity = s > 0 ? (avgEngToday - m) / s : 0;
  }

  // #2 BHI V2 (mayo 2026)
  const effectiveNss30d = nss30d ?? nss;
  const nssNormalized = (effectiveNss30d + 100) / 200;
  const engRate30d = history.length > 0
    ? average(history.slice(0, 30).filter((h) => h.engagementRate != null).map((h) => h.engagementRate!))
    : engagementRate;
  const engNormalized = engRate30d != null ? Math.min(engRate30d / 5.0, 1.0) : 0;

  const reach30d = history.length > 0
    ? sum(history.slice(0, 30).map((h) => h.totalReach))
    : totalReach;
  const reachLog = reach30d > 0 ? Math.log10(reach30d) : 0;
  const reachNormalized = Math.max(0, Math.min((nssSign(nss) * reachLog) / 7 + 0.5, 1.0));

  const pertinenceRatio = highPertinenceCount / totalMentions;

  const brandHealthIndex = nssNormalized * 0.40
    + engNormalized * 0.25
    + reachNormalized * 0.20
    + pertinenceRatio * 0.15;

  // #22 Volume Anomaly z-score
  const volumeHistory = history.map((h) => h.totalMentions);
  let volumeAnomalyZscore: number | null = null;
  if (volumeHistory.length >= 7) {
    const avgVol = average(volumeHistory);
    const stdVol = stddev(volumeHistory);
    volumeAnomalyZscore = stdVol > 0 ? (totalMentions - avgVol) / stdVol : 0;
  }

  // #21 Crisis Risk — V4 (mayo 2026, post-incidente shells vacíos):
  //
  // V3 calculaba `negShare = negativeCount / totalMentions` sobre TODAS las
  // menciones. Esto rompía en el caso DDEC del 26-may-2026: el feed de Twitter
  // empezó a entregar shells vacíos (sin title/snippet) — el processor los
  // marcaba is_duplicate=true por hash, pero los aggregates contaban shells y
  // duplicados igual que menciones reales. Resultado: 198 shells diluyeron 10
  // negativas reales a 5% share → severity 0.08 → el score no cruzó el umbral
  // de alerta a pesar de una crisis institucional en curso.
  //
  // V4 cambia DOS cosas:
  //   1. Los aggregates filtran is_duplicate = false (en SQL).
  //   2. `negShare` se calcula sobre menciones con pertinencia ∈ {alta, media}
  //      en lugar del total. Esto inmuniza el severity contra picos de ruido
  //      irrelevante (comentarios masivos de baja pertinencia, retweets sin
  //      contenido, spam) sin tocar el resto de la fórmula.
  //
  // La confidence sigue usando totalMentions para que ventanas con muy pocas
  // menciones relevantes no inflen el score (severity puede ser 1.0 con 1/1
  // negativo, pero confidence apaga eso).
  //
  // Las bandas semánticas siguen los mismos umbrales que antes:
  //   NORMAL  : score < 0.25
  //   ELEVADO : 0.25 ≤ score < 0.40
  //   ALERTA  : 0.40 ≤ score < 0.60
  //   CRISIS  : score ≥ 0.60
  // El backtest 482 días anterior usaba totalMentions como denominador; con
  // V4 los días con muy poco ruido (la mayoría del histórico de DDEC) no
  // cambian — solo se rectifican los días con pico de ruido.
  const negShare = relevantMentionsCount > 0
    ? relevantNegativeCount / relevantMentionsCount
    : 0;
  const pertShare = totalMentions > 0 ? highPertinenceCount / totalMentions : 0;
  const crisisSeverity: number = Math.min(negShare / 0.7, 1.0);
  const volZ = (volumeAnomalyZscore ?? 0);
  const crisisVelocity: number = Math.max(0, Math.min(volZ / 3, 1.0));
  const crisisRelevance: number = Math.min(pertShare / 0.5, 1.0);
  const crisisConfidence: number = totalMentions > 1 ? Math.min(Math.log10(totalMentions) / 2, 1.0) : 0;
  const rawCrisis = crisisSeverity * 0.5 + crisisVelocity * 0.3 + crisisRelevance * 0.2;
  const crisisRiskScore: number = rawCrisis * crisisConfidence;

  // Polarization Index
  const polarizationIndex = ((positiveCount + negativeCount) / totalMentions) * 100;

  return {
    nss: round(nss),
    brandHealthIndex: round(brandHealthIndex),
    reputationMomentum: reputationMomentum != null ? round(reputationMomentum) : null,
    engagementRate: engagementRate != null ? round(engagementRate) : null,
    amplificationRate: amplificationRate != null ? round(amplificationRate) : null,
    engagementVelocity: engagementVelocity != null ? round(engagementVelocity, 3) : null,
    crisisRiskScore: round(crisisRiskScore ?? 0, 3),
    volumeAnomalyZscore: volumeAnomalyZscore != null ? round(volumeAnomalyZscore) : null,
    nss7d: nss7d != null ? round(nss7d) : null,
    nss30d: nss30d != null ? round(nss30d) : null,
    polarizationIndex: round(polarizationIndex),
    crisisSeverity: round(crisisSeverity, 3),
    crisisVelocity: round(crisisVelocity, 3),
    crisisRelevance: round(crisisRelevance, 3),
    crisisConfidence: round(crisisConfidence, 3),
  };
}

// ============================================================
// Loader para una ventana arbitraria [startYmd, endYmd]
// ============================================================

/**
 * Devuelve los aggregates de la ventana `[startYmd, endYmd]` (inclusivos, en
 * TZ Puerto Rico) sumando sobre la tabla mentions. Misma semántica de fechas
 * que `buildSentimentReport` — el endpoint llama a `closedWindowYmdInTZ`
 * para obtener los bordes.
 */
export async function loadAggregatesForWindow(
  client: PgClientLike,
  agencyId: string,
  startYmd: string,
  endYmd: string,
): Promise<DailyAggregates> {
  const result = await client.query<{
    total_mentions: number | string;
    positive_count: number | string;
    neutral_count: number | string;
    negative_count: number | string;
    high_pertinence_count: number | string;
    relevant_mentions_count: number | string;
    relevant_negative_count: number | string;
    total_likes: number | string;
    total_comments: number | string;
    total_shares: number | string;
    total_reach: number | string;
    total_impact: number | string;
    total_engagement_score: number | string;
  }>(
    `SELECT
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
       AND (published_at AT TIME ZONE 'America/Puerto_Rico')::date >= $2::date
       AND (published_at AT TIME ZONE 'America/Puerto_Rico')::date <= $3::date`,
    [agencyId, startYmd, endYmd],
  );

  const row = result.rows[0];
  return {
    totalMentions: Number(row.total_mentions),
    positiveCount: Number(row.positive_count),
    neutralCount: Number(row.neutral_count),
    negativeCount: Number(row.negative_count),
    highPertinenceCount: Number(row.high_pertinence_count),
    relevantMentionsCount: Number(row.relevant_mentions_count),
    relevantNegativeCount: Number(row.relevant_negative_count),
    totalLikes: Number(row.total_likes),
    totalComments: Number(row.total_comments),
    totalShares: Number(row.total_shares),
    totalReach: Number(row.total_reach),
    totalImpact: Number(row.total_impact),
    totalEngagementScore: Number(row.total_engagement_score),
  };
}

/**
 * Devuelve los últimos 30 snapshots diarios ESTRICTAMENTE PREVIOS a
 * `startYmd`. Usado como historia para BHI/Crisis/EngagementVelocity sobre
 * una ventana del usuario.
 */
export async function loadHistoryBeforeWindow(
  client: PgClientLike,
  agencyId: string,
  startYmd: string,
): Promise<HistoricalSnapshot[]> {
  const result = await client.query<{
    date: string | Date;
    total_mentions: number | string;
    negative_count: number | string;
    nss: number | string | null;
    total_reach: number | string;
    total_engagement_score: number | string;
    engagement_rate: number | string | null;
  }>(
    `SELECT date, total_mentions, negative_count, nss, total_reach,
            total_engagement_score, engagement_rate
       FROM daily_metric_snapshots
      WHERE agency_id = $1 AND date < $2::date
      ORDER BY date DESC
      LIMIT 30`,
    [agencyId, startYmd],
  );

  return result.rows.map((r) => ({
    date: typeof r.date === 'string' ? r.date : (r.date as Date).toISOString().slice(0, 10),
    totalMentions: Number(r.total_mentions),
    negativeCount: Number(r.negative_count),
    nss: r.nss != null ? Number(r.nss) : null,
    totalReach: Number(r.total_reach),
    totalEngagementScore: Number(r.total_engagement_score),
    engagementRate: r.engagement_rate != null ? Number(r.engagement_rate) : null,
  }));
}

/** Resultado de `loadMetricsForWindow` — incluye totales para que el caller no tenga que re-querear. */
export interface WindowMetrics extends ComputedMetrics {
  totals: {
    total: number;
    positive: number;
    neutral: number;
    negative: number;
  };
  totalReach: number;
}

/**
 * Single source of truth para "estado actual de las métricas compuestas en
 * una ventana arbitraria del period del usuario". Combina
 * `loadAggregatesForWindow` + `loadHistoryBeforeWindow` + `calculateMetrics`.
 */
export async function loadMetricsForWindow(
  client: PgClientLike,
  agencyId: string,
  startYmd: string,
  endYmd: string,
): Promise<WindowMetrics> {
  const [agg, history] = await Promise.all([
    loadAggregatesForWindow(client, agencyId, startYmd, endYmd),
    loadHistoryBeforeWindow(client, agencyId, startYmd),
  ]);
  const metrics = calculateMetrics(agg, history);
  return {
    ...metrics,
    totals: {
      total: agg.totalMentions,
      positive: agg.positiveCount,
      neutral: agg.neutralCount,
      negative: agg.negativeCount,
    },
    totalReach: agg.totalReach,
  };
}
