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
 *
 * V5 (oct-2026, re-backtest post-quiebre del 20-abr-2026):
 *   - UN solo universo: los índices se calculan sobre las menciones
 *     pertinentes (sin duplicados, pertinencia NLP ≠ 'baja'), las mismas que
 *     se cuentan y se abren en el producto.
 *   - Brand Health con los componentes de la PROPIA ventana (antes tomaba NSS,
 *     engagement y alcance de los 30 días previos) y el alcance continuo.
 *   - Riesgo de crisis sin el término de relevancia (sumaba un piso fijo de
 *     0.15–0.20), severidad mitad absoluta y mitad contra lo usual de la
 *     agencia, y velocidad medida sobre las NEGATIVAS.
 *   - Polarización real: que haya dos bandos, no cuánta opinión hay.
 *   - Una ventana con menos de MIN_WINDOW_MENTIONS menciones no publica índices.
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
   * Menciones con pertinencia 'alta' o 'media'. V4 lo usaba como denominador
   * de la severidad de crisis para que el ruido de pertinencia baja no la
   * diluyera; desde V5 el universo entero ya excluye la pertinencia baja, así
   * que se conserva solo como dato informativo.
   */
  relevantMentionsCount: number;
  /** Negativas dentro de relevantMentionsCount (informativo). */
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
  /** Retirado en V5 (era un piso fijo del riesgo de crisis); siempre null. */
  crisisRelevance: number | null;
  crisisConfidence: number | null;
  /** Proporción de negativas de la ventana (0–1). */
  crisisNegShare: number | null;
  /** Proporción de negativas de lo usual de la agencia: los hasta 30 días previos (0–1). */
  crisisBaselineNegShare: number | null;
}

/** Menciones mínimas para publicar los índices de una ventana. */
export const MIN_WINDOW_MENTIONS = 20;

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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
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
  windowDays = 1,
): ComputedMetrics {
  const { totalMentions, positiveCount, negativeCount, highPertinenceCount } = agg;
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
      crisisNegShare: null,
      crisisBaselineNegShare: null,
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

  // #2 BHI V5 (oct-2026): los cuatro componentes salen de la PROPIA ventana.
  // V2 tomaba el NSS, el engagement y el alcance de los 30 días PREVIOS, así
  // que en una ventana de 7 días ~85% del índice era historia y podía subir
  // mientras el NSS de la ventana bajaba (SGPR: 7 de 13 semanas en contra).
  //   NSS normalizado 0–1                                     · 0.40
  //   engagement = interacciones / alcance, tope 5%            · 0.25
  //   alcance: amplifica el tono, continuo                     · 0.20
  //   proporción de pertinencia alta                           · 0.15
  // El alcance ya no es un escalón de 3 niveles del signo del NSS: un alcance
  // grande empuja el componente en la dirección del NSS y en proporción a él
  // (NSS 0 → 0.5). Se escala a 30 días para que 7D y 30D compartan escala.
  const nssNormalized = (nss + 100) / 200;
  const engNormalized = engagementRate != null ? Math.min(engagementRate / 5.0, 1.0) : 0.5;
  const reach30 = totalReach * 30 / Math.max(1, windowDays);
  const reachMagnitude = reach30 > 0 ? clamp01(Math.log10(reach30) / 7) : 0;
  const reachNormalized = (1 + (nss / 100) * reachMagnitude) / 2;
  const pertinenceRatio = highPertinenceCount / totalMentions;

  const brandHealthIndex = nssNormalized * 0.40
    + engNormalized * 0.25
    + reachNormalized * 0.20
    + pertinenceRatio * 0.15;

  // #22 Volume Anomaly z-score. La historia es POR DÍA; cuando la ventana del
  // usuario abarca varios días, `totalMentions` es una SUMA de N días y
  // compararla contra medias por-día disparaba volZ → crisisVelocity saturaba a
  // 1.0 en cualquier vista 1M/1A (inflaba el Crisis Score windowed con un +0.30
  // espurio). Normalizamos a tasa por-día. windowDays=1 (lambda diario / alert
  // gate) deja el cálculo idéntico — cambio acotado al recálculo del dashboard.
  const volumeHistory = history.map((h) => h.totalMentions);
  let volumeAnomalyZscore: number | null = null;
  if (volumeHistory.length >= 7) {
    const avgVol = average(volumeHistory);
    const stdVol = stddev(volumeHistory);
    const volPerDay = windowDays > 1 ? totalMentions / windowDays : totalMentions;
    volumeAnomalyZscore = stdVol > 0 ? (volPerDay - avgVol) / stdVol : 0;
  }

  // #21 Crisis Risk — V5 (oct-2026, re-backtest post-quiebre).
  //
  // V4 = (0.5·severidad + 0.3·velocidad + 0.2·relevancia)·confianza. Medido
  // sobre ventanas de 7 días desde el 20-abr-2026:
  //   - la relevancia (pertinencia alta / 0.5) satura casi siempre, así que
  //     sumaba un piso fijo de 0.15–0.20: Gobernadora no bajó de «Elevado» en
  //     ninguna semana; AAA y SGPR pasaron ~85% de las semanas en Alerta/Crisis;
  //   - la severidad era el % de negativas reescalado (r 0.93–0.99), así que
  //     una agencia siempre criticada (AAA) vivía en crisis;
  //   - la velocidad medía picos de VOLUMEN total: una gira con mucha prensa
  //     favorable subía el riesgo.
  // V5:
  //   severidad = ½ absoluta (negativas / 0.7)
  //             + ½ contra lo usual ((negativas − negativas de los hasta 30
  //               días previos) / 0.25: 25 puntos sobre lo usual satura)
  //   velocidad = z de las NEGATIVAS por día contra los 30 días previos / 3
  //               (desviación mínima 1 para que un historial plano no dispare)
  //   riesgo    = confianza · (0.5·severidad + 0.5·velocidad)
  // Efecto (7D, post-quiebre): semanas en Normal DDEC 29→74%, Gobernadora
  // 0→78%, AAA 0→67%; los mismos eventos siguen arriba (26-may DDEC, 5-may
  // Gobernadora, 17-jun y 11-ago AAA, 17-jul SGPR).
  //
  // Las bandas no cambian: NORMAL <0.25 · ELEVADO <0.40 · ALERTA <0.60 · CRISIS.
  const negShare = negativeCount / totalMentions;
  const crisisHistory = history.slice(0, 30);
  const histMentions = sum(crisisHistory.map((h) => h.totalMentions));
  const histNegatives = sum(crisisHistory.map((h) => h.negativeCount));
  const baselineNegShare = crisisHistory.length >= 7 && histMentions > 0 ? histNegatives / histMentions : null;
  const severityAbs = Math.min(negShare / 0.7, 1.0);
  const severityRel = baselineNegShare != null ? clamp01((negShare - baselineNegShare) / 0.25) : 0;
  const crisisSeverity = baselineNegShare != null ? 0.5 * severityAbs + 0.5 * severityRel : severityAbs;
  let crisisVelocity = 0;
  if (crisisHistory.length >= 7) {
    const negHistory = crisisHistory.map((h) => h.negativeCount);
    const negPerDay = windowDays > 1 ? negativeCount / windowDays : negativeCount;
    const zNeg = (negPerDay - average(negHistory)) / Math.max(stddev(negHistory), 1);
    crisisVelocity = clamp01(zNeg / 3);
  }
  const crisisConfidence: number = totalMentions > 1 ? Math.min(Math.log10(totalMentions) / 2, 1.0) : 0;
  const crisisRiskScore: number = (0.5 * crisisSeverity + 0.5 * crisisVelocity) * crisisConfidence;

  // Polarization Index V5: que haya DOS bandos. 0 = una sola postura (o todo
  // neutral); 100 = mitad a favor y mitad en contra, sin neutrales. La V1,
  // (pos+neg)/total, medía cuánta opinión hay y con casi cero positivas era el
  // % de negativas otra vez (r 0.94–1.00).
  const polarizationIndex = (2 * Math.min(positiveCount, negativeCount) / totalMentions) * 100;

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
    crisisRelevance: null,
    crisisConfidence: round(crisisConfidence, 3),
    crisisNegShare: round(negShare, 3),
    crisisBaselineNegShare: baselineNegShare != null ? round(baselineNegShare, 3) : null,
  };
}

// ============================================================
// Loader para una ventana arbitraria [startYmd, endYmd]
// ============================================================

/**
 * Devuelve los aggregates de la ventana `[startYmd, endYmd]` (inclusivos, en
 * TZ Puerto Rico) sumando sobre la tabla mentions. Misma semántica de fechas
 * que `buildSentimentReport` — el endpoint llama a `closedWindowYmdInTZ`
 * para obtener los bordes — y, desde V5, el mismo universo pertinente.
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
       AND (nlp_pertinence IS NULL OR nlp_pertinence <> 'baja')
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
  /** Suma de engagement_score del periodo (para la velocidad % vs período anterior). */
  totalEngagementScore: number;
  /** engagement_score promedio por mención del periodo, o null si no hay menciones.
   *  Es el insumo de `formatVelocity` (cambio % vs la misma medida del período previo). */
  engagementPerMention: number | null;
  /** true cuando la ventana tiene menciones pero menos de MIN_WINDOW_MENTIONS:
   *  los índices vienen en null («muestra insuficiente»), los totales no. */
  lowSample: boolean;
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
  // Días inclusivos de la ventana, para normalizar la velocidad de crisis y el
  // z-score de volumen a tasa por-día (ver calculateMetrics #22).
  const dayMs = 86400000;
  const windowDays = Math.max(
    1,
    Math.round((Date.parse(endYmd + 'T00:00:00Z') - Date.parse(startYmd + 'T00:00:00Z')) / dayMs) + 1,
  );
  // Con menos de MIN_WINDOW_MENTIONS los índices no se publican: con 5
  // menciones una sola negativa mueve el NSS 20 puntos.
  const lowSample = agg.totalMentions > 0 && agg.totalMentions < MIN_WINDOW_MENTIONS;
  const metrics = lowSample ? calculateMetrics({ ...agg, totalMentions: 0 }, history, windowDays) : calculateMetrics(agg, history, windowDays);
  return {
    ...metrics,
    lowSample,
    totals: {
      total: agg.totalMentions,
      positive: agg.positiveCount,
      neutral: agg.neutralCount,
      negative: agg.negativeCount,
    },
    totalReach: agg.totalReach,
    totalEngagementScore: agg.totalEngagementScore,
    engagementPerMention: agg.totalMentions > 0 ? agg.totalEngagementScore / agg.totalMentions : null,
  };
}
