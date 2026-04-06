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
      // Backfill: compute for every day that has mentions
      const datesResult = await client.query(
        "SELECT DISTINCT DATE(published_at) as d FROM mentions ORDER BY d ASC",
      );
      const dates = datesResult.rows.map((r: any) => r.d.toISOString().split('T')[0]);

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

    // Normal mode: compute for today only
    const today = new Date().toISOString().split('T')[0];

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
    ],
  );
}

async function getDailyAggregates(client: any, agencyId: string, date: string): Promise<DailyAggregates> {
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
    WHERE agency_id = $1 AND DATE(published_at) = $2`,
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

  // #10 Engagement Velocity
  const avgEngToday = totalEngagementScore / totalMentions;
  const historicalEng = history.slice(0, 7)
    .filter((h) => h.totalMentions > 0)
    .map((h) => h.totalEngagementScore / h.totalMentions);
  const avgEng7d = historicalEng.length > 0 ? average(historicalEng) : null;
  const engagementVelocity = avgEng7d != null && avgEng7d > 0.01
    ? ((avgEngToday - avgEng7d) / avgEng7d) * 100
    : null;

  // #2 Brand Health Index (0.0 to 1.0)
  const effectiveNss30d = nss30d ?? nss;
  const nssNormalized = (effectiveNss30d + 100) / 200;
  const engRate30d = history.length > 0
    ? average(history.slice(0, 30).filter((h) => h.engagementRate != null).map((h) => h.engagementRate!))
    : engagementRate;
  const engNormalized = engRate30d != null ? Math.min(engRate30d / 5.0, 1.0) : 0;

  const reach7d = sum(history.slice(0, 7).map((h) => h.totalReach));
  const reachPrev7d = sum(history.slice(7, 14).map((h) => h.totalReach));
  const reachGrowth = reachPrev7d > 0 ? (reach7d - reachPrev7d) / reachPrev7d : 0;
  const reachNormalized = Math.max(Math.min((reachGrowth + 1) / 2, 1.0), 0.0);

  const pertinenceRatio = highPertinenceCount / totalMentions;

  const brandHealthIndex = nssNormalized * 0.40
    + engNormalized * 0.25
    + reachNormalized * 0.20
    + pertinenceRatio * 0.15;

  // #21 Crisis Risk Score
  const avgNegative30d = history.length > 0
    ? average(history.slice(0, 30).map((h) => h.negativeCount))
    : null;
  const negativeSpikeFactor = avgNegative30d != null && avgNegative30d > 0
    ? negativeCount / avgNegative30d
    : (negativeCount > 0 ? 2.0 : 0);
  const pertinenceFactor = highPertinenceCount / totalMentions;
  const reachFactor = totalReach > 0 ? Math.log10(totalReach) / 6 : 0;
  const crisisRiskScore = negativeSpikeFactor * pertinenceFactor * reachFactor;

  // #22 Volume Anomaly Z-Score
  const volumeHistory = history.map((h) => h.totalMentions);
  let volumeAnomalyZscore: number | null = null;
  if (volumeHistory.length >= 7) {
    const avgVol = average(volumeHistory);
    const stdVol = stddev(volumeHistory);
    volumeAnomalyZscore = stdVol > 0
      ? (totalMentions - avgVol) / stdVol
      : 0;
  }

  return {
    nss: round(nss),
    brandHealthIndex: round(brandHealthIndex),
    reputationMomentum: reputationMomentum != null ? round(reputationMomentum) : null,
    engagementRate: engagementRate != null ? round(engagementRate) : null,
    amplificationRate: amplificationRate != null ? round(amplificationRate) : null,
    engagementVelocity: engagementVelocity != null ? round(engagementVelocity) : null,
    crisisRiskScore: round(crisisRiskScore),
    volumeAnomalyZscore: volumeAnomalyZscore != null ? round(volumeAnomalyZscore) : null,
    nss7d: nss7d != null ? round(nss7d) : null,
    nss30d: nss30d != null ? round(nss30d) : null,
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
