# BACKLOG.md — ECO Platform

## Legend
- `P0` — Critical for MVP, must ship
- `P1` — Important, ship if time allows in MVP
- `P2` — Phase 2, post-MVP

---

## Infrastructure (P0)

- [ ] **INFRA-001:** Set up CDK project with multi-stack architecture (Network, Database, Auth, API, Frontend)
- [ ] **INFRA-002:** PostgreSQL RDS instance (db.t4g.medium) with multi-tenant schema
- [ ] **INFRA-003:** Cognito user pool with email/password auth + agency assignment
- [ ] **INFRA-004:** S3 buckets for raw data ingestion and exports
- [ ] **INFRA-005:** SQS queues for ingestion pipeline and alert processing
- [ ] **INFRA-006:** Lambda functions scaffolding (ingestion, processing, alerts, exports)
- [ ] **INFRA-007:** CloudFront + S3 or Amplify for Next.js deployment
- [ ] **INFRA-008:** SES configuration for alert emails

## Database (P0)

- [ ] **DB-001:** Design multi-tenant schema with row-level security
- [ ] **DB-002:** Core tables: agencies, users, mentions, topics, alerts, alert_rules
- [ ] **DB-003:** Mention table: source, text, author, sentiment_brandwatch, sentiment_eco, agency_id, municipality, topic_ids, engagement_metrics, created_at
- [ ] **DB-004:** Indexes for common queries: by agency, by date range, by sentiment, by source, by municipality
- [ ] **DB-005:** Seed data for PR municipalities (78 municipios)
- [ ] **DB-006:** Seed data for initial agencies

## Brandwatch Integration (P0)

- [ ] **BW-001:** Brandwatch API client library (auth, rate limiting, pagination)
- [ ] **BW-002:** Ingestion Lambda: poll Brandwatch every 15-30 min for new mentions
- [ ] **BW-003:** Data mapping: Brandwatch mention → ECO mention schema
- [ ] **BW-004:** Deduplication logic for mentions
- [ ] **BW-005:** Error handling and dead-letter queue for failed ingestions
- [ ] **BW-006:** Backfill capability for historical data

## AI/NLP — Sentiment with Claude/Bedrock (P0)

- [ ] **NLP-001:** Bedrock integration for Claude API calls
- [ ] **NLP-002:** Prompt engineering for PR Spanish/Spanglish sentiment analysis
- [ ] **NLP-003:** Processing Lambda: re-analyze mentions with Claude for ECO sentiment score
- [ ] **NLP-004:** Topic classification via Claude (assign topics to mentions)
- [ ] **NLP-005:** Geographic classification (extract municipality from mention text/location)
- [ ] **NLP-006:** Batch processing to handle Bedrock rate limits and cost optimization
- [ ] **NLP-007:** Store both Brandwatch and ECO sentiment scores

## Frontend — Dashboard (P0)

- [ ] **FE-001:** Next.js project setup with Tailwind CSS, authentication middleware
- [ ] **FE-002:** Layout: sidebar navigation + top bar + content area
- [ ] **FE-003:** Dashboard page: KPI stat cards (total mentions, sentiment, trending topic, active alerts)
- [ ] **FE-004:** Dashboard: Mentions over time chart (line chart, selectable time ranges)
- [ ] **FE-005:** Dashboard: Sentiment breakdown donut chart
- [ ] **FE-006:** Dashboard: Top sources horizontal bar chart
- [ ] **FE-007:** Dashboard: Recent mentions feed with sentiment badges
- [ ] **FE-008:** Agency selector in top bar (multi-tenant filter)
- [ ] **FE-009:** Global search functionality

## Frontend — Mentions (P0)

- [ ] **FE-010:** Mentions page: filterable feed of individual posts
- [ ] **FE-011:** Filters: date range, source, sentiment, agency, keyword search
- [ ] **FE-012:** Mention detail panel: full post, engagement metrics, sentiment (BW + ECO), thread context
- [ ] **FE-013:** Infinite scroll / pagination for mentions feed
- [ ] **FE-014:** Mention actions: tag, archive, mark as reviewed

## Frontend — Sentiment (P0)

- [ ] **FE-015:** Sentiment page: overall breakdown (positive/negative/neutral percentages)
- [ ] **FE-016:** Sentiment over time (stacked area chart)
- [ ] **FE-017:** Sentiment by source (bar chart comparing sources)
- [ ] **FE-018:** Sentiment by agency (horizontal bar chart)
- [ ] **FE-019:** Most negative mentions table (drill down)

## Frontend — Topics (P0)

- [ ] **FE-020:** Topics page: trending topics with volume and trend indicators
- [ ] **FE-021:** Word cloud visualization
- [ ] **FE-022:** Topic detail: mentions for a specific topic with timeline
- [ ] **FE-023:** Topic clustering visualization (bubble chart or similar)

## Frontend — Geography (P0)

- [ ] **FE-024:** PR municipality map with mention density heatmap
- [ ] **FE-025:** Municipality drill-down: top mentions, sentiment, sources for selected municipality
- [ ] **FE-026:** Top municipalities by activity sidebar

## Alerts (P0)

- [ ] **ALERT-001:** Alert rules engine: configurable triggers (volume spike, negative sentiment threshold, keyword match)
- [ ] **ALERT-002:** Alert processing Lambda: evaluate rules against incoming mentions
- [ ] **ALERT-003:** Email notifications via SES
- [ ] **ALERT-004:** Alert management UI: create, edit, pause, delete rules
- [ ] **ALERT-005:** Alert history and timeline

## Auth & Multi-tenancy (P0)

- [ ] **AUTH-001:** Cognito integration with Next.js (sign in, sign up, password reset)
- [ ] **AUTH-002:** User management: assign users to agencies and roles
- [ ] **AUTH-003:** Row-level data filtering by agency_id in all API queries
- [ ] **AUTH-004:** Admin panel: user CRUD for agency admins

---

## Phase 2 (P2)

- [ ] **P2-001:** Reports: template-based report generation (PDF/Excel)
- [ ] **P2-002:** Scheduled reports via email (weekly/monthly digests)
- [ ] **P2-003:** Agency comparison dashboards
- [ ] **P2-004:** Dark mode for all screens
- [ ] **P2-005:** SSO / Active Directory integration
- [ ] **P2-006:** Real-time updates via WebSockets
- [ ] **P2-007:** Advanced topic modeling with custom taxonomies
- [ ] **P2-008:** Crisis detection and escalation workflow
- [ ] **P2-009:** API for third-party integrations
- [ ] **P2-010:** Mobile-responsive views
- [ ] **P2-011:** Audit log for all user actions
- [ ] **P2-012:** Data retention policies and archiving
