# Composite Metrics System - Design Spec

**Date:** 2026-04-01
**Author:** Alejandro + Claude
**Status:** Draft

## Context

ECO's pipeline ingests ~15 mentions/day from Brandwatch, processes them through Claude Opus 4.6 NLP (sentiment, emotions, pertinence, topics, municipalities), and stores enriched data in PostgreSQL. The dashboard currently shows basic aggregations (counts, averages) computed on-demand via API routes.

**Problem:** No pre-computed composite metrics exist. Decision-makers need higher-level indicators (reputation health, crisis risk, engagement trends) that combine multiple raw signals into actionable scores.

**Goal:** Implement 8 composite metrics with automatic calculation, historical snapshots, and rolling windows — served via a new API endpoint.

## Selected Metrics

### Category: Reputation & Brand Health (Strategic)

| # | Metric | Formula | Granularity |
|---|--------|---------|-------------|
| 1 | **Net Sentiment Score (NSS)** | `(positive - negative) / total * 100` | Daily + 7d/30d rolling |
| 2 | **Brand Health Index (BHI)** | Weighted composite: NSS_30d (40%) + engagement_rate (25%) + reach_growth (20%) + pertinence_ratio (15%) | Daily (uses 30d rolling inputs) |
| 3 | **Reputation Momentum** | `NSS(today) - NSS(7d ago)` | Daily |

### Category: Engagement (Operational/Strategic)

| # | Metric | Formula | Granularity |
|---|--------|---------|-------------|
| 6 | **Engagement Rate** | `(likes + comments + shares) / reach * 100` | Daily + 30d rolling |
| 8 | **Amplification Rate** | `shares / (likes + comments + shares) * 100` | Daily |
| 10 | **Engagement Velocity** | `(avg_engagement_today - avg_engagement_7d) / avg_engagement_7d * 100` | Daily |

### Category: Crisis & Early Warning (Operational)

| # | Metric | Formula | Granularity |
|---|--------|---------|-------------|
| 21 | **Crisis Risk Score** | `negative_spike_factor * pertinence_factor * reach_factor` | Daily |
| 22 | **Volume Anomaly Z-Score** | `(volume_today - avg_30d) / stddev_30d` | Daily |

## Architecture

### Approach: Daily snapshots with frequent upsert

- **Table** `daily_metric_snapshots` stores one row per agency per day
- **Lambda** `metrics-calculator` runs every 10 minutes (EventBridge), offset 5 min from ingestion
- Current day's row is upserted on each run; past days are frozen as historical record
- Rolling windows (7d, 30d) computed from historical snapshot rows
- New API route reads from snapshots table for instant responses

### Why this approach

- Consistent with existing Lambda + EventBridge patterns (ingestion, processor, alerts)
- Snapshots provide free historical trend data
- Upsert every 10 min keeps metrics near-real-time without expensive queries
- Scales to 120 agencies: each agency's calculation is independent

## Database Schema

### Table: `daily_metric_snapshots`

```
id                      UUID PRIMARY KEY DEFAULT gen_random_uuid()
agency_id               UUID NOT NULL REFERENCES agencies(id)
date                    DATE NOT NULL

-- Raw daily aggregates (base for calculations)
total_mentions          INTEGER DEFAULT 0
positive_count          INTEGER DEFAULT 0
neutral_count           INTEGER DEFAULT 0
negative_count          INTEGER DEFAULT 0
high_pertinence_count   INTEGER DEFAULT 0
total_likes             INTEGER DEFAULT 0
total_comments          INTEGER DEFAULT 0
total_shares            INTEGER DEFAULT 0
total_reach             BIGINT DEFAULT 0
total_impact            DOUBLE PRECISION DEFAULT 0
total_engagement_score  DOUBLE PRECISION DEFAULT 0

-- Computed metrics
nss                     DOUBLE PRECISION  -- Net Sentiment Score (-100 to +100)
brand_health_index      DOUBLE PRECISION  -- 0.0 to 1.0
reputation_momentum     DOUBLE PRECISION  -- NSS delta vs 7d ago
engagement_rate         DOUBLE PRECISION  -- percentage
amplification_rate      DOUBLE PRECISION  -- percentage
engagement_velocity     DOUBLE PRECISION  -- percentage change
crisis_risk_score       DOUBLE PRECISION  -- 0+ (>1.0 = alert, >2.0 = crisis)
volume_anomaly_zscore   DOUBLE PRECISION  -- standard deviations from mean

-- Rolling window caches
nss_7d                  DOUBLE PRECISION
nss_30d                 DOUBLE PRECISION

-- Metadata
computed_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW()

UNIQUE(agency_id, date)
```

**Indexes:**
- `(agency_id, date)` — unique composite, covers all lookups
- `(agency_id, crisis_risk_score)` — for alert queries

### Drizzle Schema Location

`packages/database/src/schema/daily-metric-snapshots.ts`

Exported and added to `packages/database/src/schema/index.ts`.

## Lambda: metrics-calculator

### Location

`infra/lambda/metrics-calculator/index.ts`

### Trigger

EventBridge rule: `rate(10 minutes)` — offset 5 minutes from ingestion Lambda.

### Algorithm

```
handler(event):
  1. Get all active agencies from agencies table
  2. For each agency:
     a. Query mentions WHERE agency_id = X AND date(published_at) = today
        → COUNT(*), COUNT(positive), COUNT(negative), COUNT(neutral),
          COUNT(pertinence='alta'), SUM(likes), SUM(comments), SUM(shares),
          SUM(reach_estimate), SUM(impact), SUM(engagement_score)

     b. Query daily_metric_snapshots WHERE agency_id = X
        ORDER BY date DESC LIMIT 30
        → historical snapshots for rolling windows

     c. Calculate 8 metrics:
        - NSS = (positive - negative) / max(total, 1) * 100
        - nss_7d = avg(last 7 days NSS)
        - nss_30d = avg(last 30 days NSS)
        - reputation_momentum = NSS - NSS_of_7_days_ago
        - engagement_rate = (likes+comments+shares) / max(reach, 1) * 100
        - amplification_rate = shares / max(likes+comments+shares, 1) * 100
        - engagement_velocity = (avg_eng_today - avg_eng_7d) / max(avg_eng_7d, 0.01) * 100
        - brand_health_index = weighted composite (see formula below)
        - crisis_risk_score = neg_spike * pertinence_factor * reach_factor
        - volume_anomaly_zscore = (today_vol - avg_30d) / max(stddev_30d, 1)

     d. UPSERT into daily_metric_snapshots ON CONFLICT (agency_id, date)

  3. Log: "Computed metrics for N agencies"
```

### Brand Health Index Formula

```
nss_normalized = (nss_30d + 100) / 200                              -- scale 0-1
eng_normalized = min(engagement_rate_30d / 5.0, 1.0)                -- cap at 5% target
reach_growth = (reach_7d - reach_prev_7d) / max(reach_prev_7d, 1)   -- % change
reach_normalized = max(min((reach_growth + 1) / 2, 1.0), 0.0)       -- scale 0-1
pertinence_ratio = high_pertinence_count_30d / max(total_30d, 1)

BHI = nss_normalized * 0.40
    + eng_normalized * 0.25
    + reach_normalized * 0.20
    + pertinence_ratio * 0.15
```

### Crisis Risk Score Formula

```
avg_negative_30d = avg of negative_count over last 30 snapshots
negative_spike_factor = negative_count / max(avg_negative_30d, 1)    -- >1 = spike

pertinence_factor = high_pertinence_count / max(total_mentions, 1)   -- 0-1

reach_factor = log10(max(total_reach, 1)) / 6                       -- normalized ~0-1

crisis_risk = negative_spike_factor * pertinence_factor * reach_factor

Thresholds:
  < 0.5  = normal
  0.5-1.0 = elevated
  1.0-2.0 = alert
  > 2.0   = crisis
```

### Volume Anomaly Z-Score Formula

```
avg_30d = mean of total_mentions over last 30 snapshots
stddev_30d = stddev of total_mentions over last 30 snapshots

z_score = (total_mentions - avg_30d) / max(stddev_30d, 1)

Interpretation:
  > 2.0  = significantly above normal
  > 3.0  = extreme anomaly
  < -2.0 = significantly below normal
```

## CDK Infrastructure

### Changes to `infra/lib/workers-stack.ts`

Add fourth Lambda function `metricsCalculatorFn`:
- Runtime: Node.js 22
- Memory: 256 MB
- Timeout: 60 seconds
- VPC: same as other Lambdas (database access)
- Environment: DATABASE_URL, same as processor
- EventBridge rule: `rate(10 minutes)`

### IAM

Same DB access as processor Lambda. No additional AWS service permissions needed.

## API Route

### `GET /api/metrics`

**Location:** `apps/web/src/app/api/metrics/route.ts`

**Query params:**
- `period`: `7d` | `30d` | `90d` (default: `30d`)

**Response:**
```json
{
  "current": {
    "date": "2026-04-01",
    "nss": 23.5,
    "brandHealthIndex": 0.67,
    "reputationMomentum": 5.2,
    "engagementRate": 2.1,
    "amplificationRate": 15.3,
    "engagementVelocity": -8.4,
    "crisisRiskScore": 0.3,
    "volumeAnomalyZScore": 0.8,
    "totalMentions": 15,
    "positiveCount": 6,
    "neutralCount": 5,
    "negativeCount": 4
  },
  "timeline": [
    {
      "date": "2026-03-25",
      "nss": 20.0,
      "brandHealthIndex": 0.62,
      "crisisRiskScore": 0.2,
      "engagementRate": 1.8,
      "totalMentions": 12
    }
  ],
  "rollingWindows": {
    "nss7d": 21.3,
    "nss30d": 18.7
  }
}
```

## Migration

Add to `infra/lambda/migration/index.ts`:
- CREATE TABLE `daily_metric_snapshots` with schema above
- CREATE UNIQUE INDEX on `(agency_id, date)`
- CREATE INDEX on `(agency_id, crisis_risk_score)`

## Drizzle Schema

New file `packages/database/src/schema/daily-metric-snapshots.ts`:
- Define table with Drizzle `pgTable()`
- Export from `packages/database/src/schema/index.ts`

## Files to Create/Modify

| Action | File |
|--------|------|
| CREATE | `packages/database/src/schema/daily-metric-snapshots.ts` |
| MODIFY | `packages/database/src/schema/index.ts` (add export) |
| MODIFY | `infra/lambda/migration/index.ts` (add table creation) |
| CREATE | `infra/lambda/metrics-calculator/index.ts` |
| MODIFY | `infra/lib/workers-stack.ts` (add Lambda + EventBridge) |
| CREATE | `apps/web/src/app/api/metrics/route.ts` |

## Verification

1. **Schema:** Deploy migration, verify table exists with `\d daily_metric_snapshots`
2. **Lambda:** Invoke manually, check snapshots table has rows for AAA agency
3. **Formulas:** With known test data, verify NSS = expected value
4. **API:** Call `GET /api/metrics?period=7d` and verify JSON response shape
5. **EventBridge:** Confirm rule fires every 10 minutes in CloudWatch logs
6. **Edge cases:** Zero mentions day, first day with no history (rolling windows default to null)
