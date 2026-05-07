/**
 * Metrics Calculator Lambda
 *
 * Computes 8 composite metrics from raw mention data and upserts
 * daily snapshots into daily_metric_snapshots table.
 *
 * Trigger: EventBridge every 10 minutes (offset from ingestion).
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({});
const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;

let dbUrl: string | null = null;

interface DailyAggregates {
  totalMentions: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  highPertinenceCount: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalReach: number;
  totalImpact: number;
  totalEngagementScore: number;
}

interface HistoricalSnapshot {
  date: string;
  totalMentions: number;
  negativeCount: number;
  nss: number | null;
  totalReach: number;
  totalEngagementScore: number;
  engagementRate: number | null;
}

// Returns -1, 0, or +1 for the BHI reach component sign. NSS≤−20 penaliza,
// NSS>0 premia, neutro/leve negativo no aporta dirección. Esto es la decisión
// clave del backtest V1c: usar el NSS de hoy (reactivo) en lugar de nss_30d
// (que solo reacciona a tendencia larga y no captura crisis del mismo día).
function nssSign(nss: number | null): -1 | 0 | 1 {
  if (nss == null) return 0;
  if (nss > 0) return 1;
  if (nss < -20) return -1;
  return 0;
}

export const handler = async (event?: { backfill?: boolean }): Promise<{ statusCode: number; body: string }> => {
  const isBackfill = event?.backfill === true;
  console.log(`Metrics calculator invoked${isBackfill ? ' (backfill mode)' : ''}`);

  if (!dbUrl) {
    dbUrl = await getDatabaseUrl();
  }

  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // Get all active agencies
    const agenciesResult = await client.query(
      "SELECT id FROM agencies WHERE is_active = true",
    );

    if (isBackfill) {
      // Backfill: compute for every AST (America/Puerto_Rico) calendar day that
      // has mentions. Grouping in UTC would shift late-evening AST mentions
      // into the next UTC day and create mismatched snapshot rows.
      const datesResult = await client.query(
        `SELECT DISTINCT (published_at AT TIME ZONE 'America/Puerto_Rico')::date AS d
         FROM mentions
         ORDER BY d ASC`,
      );
      const dates = datesResult.rows.map((r: any) =>
        typeof r.d === 'string' ? r.d : r.d.toISOString().split('T')[0],
      );

      let computed = 0;
      for (const agency of agenciesResult.rows) {
        for (const date of dates) {
          await computeForAgency(client, agency.id, date);
          computed++;
        }
      }

      console.log(`Backfilled ${computed} snapshots across ${dates.length} days`);
      return { statusCode: 200, body: `Backfilled ${computed} snapshots across ${dates.length} days` };
    }

    // Normal mode: compute for today only. "Today" is the AST calendar day
    // (not UTC) so the running snapshot matches the frontend and Brandwatch.
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Puerto_Rico',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    let computed = 0;
    for (const agency of agenciesResult.rows) {
      await computeForAgency(client, agency.id, today);
      computed++;
    }

    console.log(`Computed metrics for ${computed} agencies on ${today}`);
    return { statusCode: 200, body: `Computed metrics for ${computed} agencies` };
  } finally {
    await client.end();
  }
};

async function computeForAgency(client: any, agencyId: string, today: string): Promise<void> {
  // Step 1: Get today's raw aggregates from mentions table
  const agg = await getDailyAggregates(client, agencyId, today);

  // Step 2: Get historical snapshots (last 30 days) for rolling windows
  const history = await getHistoricalSnapshots(client, agencyId, today);

  // Step 3: Calculate all 8 metrics
  const metrics = calculateMetrics(agg, history);

  // Step 4: Upsert into daily_metric_snapshots
  await client.query(
    `INSERT INTO daily_metric_snapshots (
      agency_id, date,
      total_mentions, positive_count, neutral_count, negative_count,
      high_pertinence_count, total_likes, total_comments, total_shares,
      total_reach, total_impact, total_engagement_score,
      nss, brand_health_index, reputation_momentum,
      engagement_rate, amplification_rate, engagement_velocity,
      crisis_risk_score, volume_anomaly_zscore,
      nss_7d, nss_30d,
      polarization_index,
      crisis_severity, crisis_velocity, crisis_relevance, crisis_confidence,
      computed_at
    ) VALUES (
      $1, $2,
      $3, $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12, $13,
      $14, $15, $16,
      $17, $18, $19,
      $20, $21,
      $22, $23,
      $24,
      $25, $26, $27, $28,
      NOW()
    )
    ON CONFLICT (agency_id, date) DO UPDATE SET
      total_mentions = $3, positive_count = $4, neutral_count = $5, negative_count = $6,
      high_pertinence_count = $7, total_likes = $8, total_comments = $9, total_shares = $10,
      total_reach = $11, total_impact = $12, total_engagement_score = $13,
      nss = $14, brand_health_index = $15, reputation_momentum = $16,
      engagement_rate = $17, amplification_rate = $18, engagement_velocity = $19,
      crisis_risk_score = $20, volume_anomaly_zscore = $21,
      nss_7d = $22, nss_30d = $23,
      polarization_index = $24,
      crisis_severity = $25, crisis_velocity = $26,
      crisis_relevance = $27, crisis_confidence = $28,
      computed_at = NOW()`,
    [
      agencyId, today,
      agg.totalMentions, agg.positiveCount, agg.neutralCount, agg.negativeCount,
      agg.highPertinenceCount, agg.totalLikes, agg.totalComments, agg.totalShares,
      agg.totalReach, agg.totalImpact, agg.totalEngagementScore,
      metrics.nss, metrics.brandHealthIndex, metrics.reputationMomentum,
      metrics.engagementRate, metrics.amplificationRate, metrics.engagementVelocity,
      metrics.crisisRiskScore, metrics.volumeAnomalyZscore,
      metrics.nss7d, metrics.nss30d,
      metrics.polarizationIndex,
      metrics.crisisSeverity, metrics.crisisVelocity,
      metrics.crisisRelevance, metrics.crisisConfidence,
    ],
  );
}

async function getDailyAggregates(client: any, agencyId: string, date: string): Promise<DailyAggregates> {
  // Group by the Puerto Rico calendar day (AST, UTC-4), not UTC. Otherwise
  // mentions published 20:00–23:59 AST shift into the next UTC date and the
  // daily snapshot no longer matches what Brandwatch (and our own AST frontend)
  // reports for that day.
  const result = await client.query(
    `SELECT
      COUNT(*)::int AS total_mentions,
      COUNT(*) FILTER (WHERE nlp_sentiment = 'positivo')::int AS positive_count,
      COUNT(*) FILTER (WHERE nlp_sentiment = 'neutral')::int AS neutral_count,
      COUNT(*) FILTER (WHERE nlp_sentiment = 'negativo')::int AS negative_count,
      COUNT(*) FILTER (WHERE nlp_pertinence = 'alta')::int AS high_pertinence_count,
      COALESCE(SUM(likes), 0)::int AS total_likes,
      COALESCE(SUM(comments), 0)::int AS total_comments,
      COALESCE(SUM(shares), 0)::int AS total_shares,
      COALESCE(SUM(reach_estimate), 0)::bigint AS total_reach,
      COALESCE(SUM(impact), 0)::float AS total_impact,
      COALESCE(SUM(engagement_score), 0)::float AS total_engagement_score
    FROM mentions
    WHERE agency_id = $1
      AND (published_at AT TIME ZONE 'America/Puerto_Rico')::date = $2::date`,
    [agencyId, date],
  );

  const row = result.rows[0];
  return {
    totalMentions: row.total_mentions,
    positiveCount: row.positive_count,
    neutralCount: row.neutral_count,
    negativeCount: row.negative_count,
    highPertinenceCount: row.high_pertinence_count,
    totalLikes: row.total_likes,
    totalComments: row.total_comments,
    totalShares: row.total_shares,
    totalReach: Number(row.total_reach),
    totalImpact: row.total_impact,
    totalEngagementScore: row.total_engagement_score,
  };
}

async function getHistoricalSnapshots(client: any, agencyId: string, today: string): Promise<HistoricalSnapshot[]> {
  const result = await client.query(
    `SELECT date, total_mentions, negative_count, nss, total_reach,
            total_engagement_score, engagement_rate
     FROM daily_metric_snapshots
     WHERE agency_id = $1 AND date < $2
     ORDER BY date DESC
     LIMIT 30`,
    [agencyId, today],
  );

  return result.rows.map((r: any) => ({
    date: r.date,
    totalMentions: r.total_mentions,
    negativeCount: r.negative_count,
    nss: r.nss != null ? Number(r.nss) : null,
    totalReach: Number(r.total_reach),
    totalEngagementScore: Number(r.total_engagement_score),
    engagementRate: r.engagement_rate != null ? Number(r.engagement_rate) : null,
  }));
}

interface ComputedMetrics {
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

function calculateMetrics(agg: DailyAggregates, history: HistoricalSnapshot[]): ComputedMetrics {
  const { totalMentions, positiveCount, negativeCount, highPertinenceCount } = agg;
  const { totalLikes, totalComments, totalShares, totalReach, totalEngagementScore } = agg;

  // If no mentions today, return nulls (no data to compute)
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

  // #1 Net Sentiment Score (NSS): -100 to +100
  const nss = ((positiveCount - negativeCount) / totalMentions) * 100;

  // Rolling NSS from history
  const nssValues = history.filter((h) => h.nss != null).map((h) => h.nss!);
  const nss7d = nssValues.length > 0
    ? average(nssValues.slice(0, Math.min(7, nssValues.length)))
    : null;
  const nss30d = nssValues.length > 0
    ? average(nssValues.slice(0, Math.min(30, nssValues.length)))
    : null;

  // #3 Reputation Momentum: NSS today - NSS 7 days ago
  const nss7dAgo = nssValues.length >= 7 ? nssValues[6] : (nssValues.length > 0 ? nssValues[nssValues.length - 1] : null);
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

  // #10 Engagement Velocity — z-score 30d (cambio mayo 2026).
  // La fórmula previa (today−avg7d)/avg7d·100 producía picos ridículos por
  // outliers (max histórico 8087.93%). Z-score acota la distribución y permite
  // umbrales comparables entre agencias. Backtest 482 días: max 8088→34, std
  // 482→1.99. Requiere ≥7 días de historia con menciones para evitar varianza
  // inestable.
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

  // #2 Brand Health Index — V2 (cambio mayo 2026, backtest decision V1c).
  // Bug previo: reachGrowth premiaba el ataque (más menciones negativas →
  // reach_norm más alto → BHI más alto). Fix: reach normalizado lleva el SIGNO
  // del NSS de hoy multiplicado por log10(reach_30d) saturado. Crítico usar
  // sign(NSS_hoy) y no sign(nss_30d) — la 30d-avg no reacciona el día de la
  // crisis y deja el BHI casi intacto. Backtest 14-abr-2026: V0 buggy 0.71,
  // V1c fixed 0.53. Pesos 40/25/20/15 (PPTX) ganan a 30/30/20/20 (cliente):
  // F1 0.25 vs 0.24, rNSS +0.53 vs +0.51.
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

  // #22 Volume Anomaly Z-Score (entrada para velocity de crisis)
  const volumeHistory = history.map((h) => h.totalMentions);
  let volumeAnomalyZscore: number | null = null;
  if (volumeHistory.length >= 7) {
    const avgVol = average(volumeHistory);
    const stdVol = stddev(volumeHistory);
    volumeAnomalyZscore = stdVol > 0
      ? (totalMentions - avgVol) / stdVol
      : 0;
  }

  // #21 Crisis Risk Score — gate condicional + suma ponderada saturada en
  // [0,1]. Backtest 482 días vs ground truth de crisis (neg≥30 OR (neg_share≥
  // 0.40 AND total≥20)): F1 0.79, precision 0.65, recall 1.00, 0 falsos
  // negativos. La fórmula previa (negSpike·pertFactor·reachFactor) daba F1
  // 0.37, recall 0.60 — perdía 6 de 15 días de crisis. Pesos 50/30/20:
  // todos los combos V2 daban el mismo F1, los del PPTX son los más
  // defendibles. Subcomponentes severity/velocity/relevance/confidence se
  // guardan para auditoría.
  const negShare = negativeCount / totalMentions;
  const pertShare = highPertinenceCount / totalMentions;
  const gateOpen = (negShare > 0.30 && totalMentions >= 20) || negativeCount >= 30;

  let crisisRiskScore: number | null = 0;
  let crisisSeverity: number | null = 0;
  let crisisVelocity: number | null = 0;
  let crisisRelevance: number | null = 0;
  let crisisConfidence: number | null = 0;
  if (gateOpen) {
    crisisSeverity = Math.min(negShare / 0.7, 1.0);
    const volZ = (volumeAnomalyZscore ?? 0);
    crisisVelocity = Math.max(0, Math.min(volZ / 3, 1.0));
    crisisRelevance = Math.min(pertShare / 0.5, 1.0);
    const raw = crisisSeverity * 0.5 + crisisVelocity * 0.3 + crisisRelevance * 0.2;
    crisisConfidence = totalMentions > 1 ? Math.min(Math.log10(totalMentions) / 2, 1.0) : 0;
    crisisRiskScore = raw * crisisConfidence;
  }

  // Polarization Index — (pos+neg)/total*100. Distingue polarización (50/50
  // pos vs neg) de apatía (todo neutral) cuando NSS≈0. Backtest 14-abr-2026:
  // 70.1% (día de crisis); 13-ene-2026 con NSS+78: 22%.
  const polarizationIndex = ((positiveCount + negativeCount) / totalMentions) * 100;

  return {
    nss: round(nss),
    brandHealthIndex: round(brandHealthIndex),
    reputationMomentum: reputationMomentum != null ? round(reputationMomentum) : null,
    engagementRate: engagementRate != null ? round(engagementRate) : null,
    amplificationRate: amplificationRate != null ? round(amplificationRate) : null,
    engagementVelocity: engagementVelocity != null ? round(engagementVelocity, 3) : null,
    crisisRiskScore: round(crisisRiskScore, 3),
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

// ---- Utility functions ----

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

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }),
  );
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}
