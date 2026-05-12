/**
 * Metrics Calculator Lambda
 *
 * Computes 8 composite metrics from raw mention data and upserts
 * daily snapshots into daily_metric_snapshots table.
 *
 * Trigger: EventBridge every 10 minutes (offset from ingestion).
 *
 * Las fórmulas de cálculo viven en `@eco/shared/metrics` (single source of
 * truth, compartido con `/api/eco-data` y `/api/ai/metric-insight`).
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import {
  calculateMetrics,
  type DailyAggregates,
  type HistoricalSnapshot,
} from '@eco/shared';

const sm = new SecretsManagerClient({});
const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;

let dbUrl: string | null = null;

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

// `calculateMetrics` (la fórmula completa) y los tipos `DailyAggregates` /
// `HistoricalSnapshot` viven en `@eco/shared/metrics`. Mismo algoritmo,
// reutilizado también por /api/eco-data y /api/ai/metric-insight.

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }),
  );
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}
