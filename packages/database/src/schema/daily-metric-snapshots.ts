import {
  pgTable,
  uuid,
  date,
  integer,
  bigint,
  doublePrecision,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { agencies } from './agencies';

export const dailyMetricSnapshots = pgTable(
  'daily_metric_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id),
    date: date('date').notNull(),

    // Raw daily aggregates
    totalMentions: integer('total_mentions').notNull().default(0),
    positiveCount: integer('positive_count').notNull().default(0),
    neutralCount: integer('neutral_count').notNull().default(0),
    negativeCount: integer('negative_count').notNull().default(0),
    highPertinenceCount: integer('high_pertinence_count').notNull().default(0),
    totalLikes: integer('total_likes').notNull().default(0),
    totalComments: integer('total_comments').notNull().default(0),
    totalShares: integer('total_shares').notNull().default(0),
    totalReach: bigint('total_reach', { mode: 'number' }).notNull().default(0),
    totalImpact: doublePrecision('total_impact').notNull().default(0),
    totalEngagementScore: doublePrecision('total_engagement_score').notNull().default(0),

    // Computed metrics
    nss: doublePrecision('nss'),
    brandHealthIndex: doublePrecision('brand_health_index'),
    reputationMomentum: doublePrecision('reputation_momentum'),
    engagementRate: doublePrecision('engagement_rate'),
    amplificationRate: doublePrecision('amplification_rate'),
    engagementVelocity: doublePrecision('engagement_velocity'),
    crisisRiskScore: doublePrecision('crisis_risk_score'),
    volumeAnomalyZscore: doublePrecision('volume_anomaly_zscore'),

    // Rolling window caches
    nss7d: doublePrecision('nss_7d'),
    nss30d: doublePrecision('nss_30d'),

    // Metadata
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_daily_metrics_agency_date').on(t.agencyId, t.date),
    index('idx_daily_metrics_agency_crisis').on(t.agencyId, t.crisisRiskScore),
  ],
);
