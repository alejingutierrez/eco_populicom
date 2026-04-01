# BACKLOG.md — ECO Platform

## Legend
- `P0` — Critical for MVP, must ship
- `P1` — Important, ship if time allows in MVP
- `P2` — Phase 2, post-MVP
- ✅ = Done, 🔄 = In Progress, ⬜ = Not Started

---

## Infrastructure (P0) ✅ COMPLETE

- [x] **INFRA-001:** CDK project with 8-stack architecture (Network, Database, Auth, Storage, Messaging, Workers, Compute, Monitoring)
- [x] **INFRA-002:** PostgreSQL RDS (db.t4g.medium, ARM64 Graviton, PostgreSQL 16)
- [x] **INFRA-003:** Cognito user pool + 3 groups (admin, analyst, viewer)
- [x] **INFRA-004:** S3 buckets (eco-raw, eco-exports) with lifecycle policies
- [x] **INFRA-005:** SQS queues (ingestion + DLQ, alerts + DLQ)
- [x] **INFRA-006:** 3 Lambda functions (ingestion, processor, alerts) — fully implemented in TypeScript
- [x] **INFRA-007:** ECS Fargate + ALB for Next.js frontend (ARM64 Graviton)
- [x] **INFRA-008:** CloudWatch dashboard + 5 alarms + SNS email notifications

## Database (P0) ✅ COMPLETE

- [x] **DB-001:** Multi-tenant schema with row-level security support (agency_id on all tables)
- [x] **DB-002:** 11 tables: agencies, users, mentions, topics, subtopics, municipalities, mention_topics, mention_municipalities, alert_rules, alert_history, ingestion_cursors
- [x] **DB-003:** Mention table: ~40 columns (BW raw fields + NLP results + dedup + media)
- [x] **DB-004:** 6 indexes: agency_id, published_at, nlp_sentiment, page_type, text_hash, domain
- [x] **DB-005:** 77 PR municipalities seeded with coordinates and population
- [x] **DB-006:** AAA agency seeded with Brandwatch project/query IDs

## Brandwatch Integration (P0) 🔄 MOSTLY COMPLETE

- [x] **BW-001:** API client library (auth, pagination, rate limiting, exponential backoff)
- [x] **BW-002:** Ingestion Lambda polls every 5 min via EventBridge
- [x] **BW-003:** Full data mapping: Brandwatch mention → ECO schema (~40 fields)
- [x] **BW-004:** Deduplication via SHA-256 text hash
- [x] **BW-005:** Error handling + DLQ (3 retries → dead letter queue)
- [ ] **BW-006:** Backfill capability for historical data (2025)

## AI/NLP — Sentiment with Claude/Bedrock (P0) ✅ COMPLETE

- [x] **NLP-001:** Bedrock integration (Claude Opus 4.6, inference profile `us.anthropic.claude-opus-4-6-v1`)
- [x] **NLP-002:** Prompt engineered for PR Spanish/Spanglish (7 emotions, taxonomy-based classification)
- [x] **NLP-003:** Processor Lambda with SQS trigger (batch 10, concurrency 2, ~4s/mention)
- [x] **NLP-004:** Topic + subtopic classification with confidence scores (10 topics, 30 subtopics)
- [x] **NLP-005:** Municipality extraction from text + Brandwatch geo data
- [x] **NLP-006:** Single Claude call per mention (all 5 NLP tasks in one prompt)
- [x] **NLP-007:** Both Brandwatch and Claude sentiment stored side-by-side

## Frontend — Dashboard (P0) ✅ COMPLETE

- [x] **FE-001:** Next.js 15 + Tailwind CSS v4 + dark mode + Cognito auth
- [x] **FE-002:** Sidebar layout with 7 navigation items + logout
- [x] **FE-003:** Dashboard: KPI cards (total mentions, negative %, engagement, reach)
- [x] **FE-004:** Dashboard: Mentions over time line chart (Recharts)
- [x] **FE-005:** Dashboard: Sentiment breakdown donut chart
- [x] **FE-006:** Dashboard: Top sources bar chart
- [x] **FE-007:** Dashboard: Recent mentions feed with sentiment badges
- [ ] **FE-008:** Agency selector in header (multi-tenant filter)
- [ ] **FE-009:** Global search functionality

## Frontend — Mentions (P0) 🔄 MOSTLY COMPLETE

- [x] **FE-010:** Mentions page: filterable feed of individual posts
- [x] **FE-011:** Filters: sentiment, source, pertinence, text search
- [ ] **FE-012:** Mention detail panel (Sheet with full post, engagement, NLP results)
- [x] **FE-013:** Pagination (previous/next)
- [ ] **FE-014:** Mention actions: tag, archive, mark as reviewed

## Frontend — Sentiment (P0) ✅ COMPLETE

- [x] **FE-015:** Sentiment page: stacked area chart over time
- [x] **FE-016:** Sentiment by source (grouped bar chart)
- [x] **FE-017:** Emotions radar chart
- [x] **FE-018:** Brandwatch vs Claude comparison bar chart
- [ ] **FE-019:** Most negative mentions table (drill down)

## Frontend — Topics (P0) ✅ COMPLETE

- [x] **FE-020:** Topics page: grid with counts + sentiment
- [x] **FE-021:** Detailed table with subtopics and counts
- [ ] **FE-022:** Topic detail: mentions for a specific topic with timeline
- [ ] **FE-023:** Topic clustering visualization

## Frontend — Geography (P0) ✅ COMPLETE

- [x] **FE-024:** Top municipalities by mention count (bar chart)
- [x] **FE-025:** By-region breakdown cards
- [ ] **FE-026:** PR municipality SVG choropleth map

## Alerts (P0) 🔄 PARTIAL

- [x] **ALERT-001:** Alert rules engine in Lambda (volume spike, negative sentiment, keyword)
- [x] **ALERT-002:** Alert processing Lambda with SQS trigger
- [x] **ALERT-003:** SES email notification support in Lambda
- [x] **ALERT-004:** Alert management UI (list rules, toggle active/inactive)
- [x] **ALERT-005:** Alert history table
- [ ] **ALERT-006:** Alert creation form UI (type selection, config, emails)

## Auth & Multi-tenancy (P0) 🔄 PARTIAL

- [x] **AUTH-001:** Cognito sign-in page + JWT in cookies
- [ ] **AUTH-002:** Auth middleware on API routes (JWT verification)
- [ ] **AUTH-003:** Row-level data filtering by agency_id in API queries
- [ ] **AUTH-004:** Admin panel: user CRUD for agency admins

---

## Phase 1.5 — Polish & Production Readiness (P1)

- [ ] **P1-001:** HTTPS with custom domain (Route 53 + ACM + ALB HTTPS listener)
- [ ] **P1-002:** Backfill historical Brandwatch data (2025)
- [ ] **P1-003:** Auth middleware enforcing JWT on all API routes
- [ ] **P1-004:** RLS enforcement (SET LOCAL app.current_agency_id per request)
- [ ] **P1-005:** PR municipality SVG choropleth map component
- [ ] **P1-006:** Mention detail Sheet/modal
- [ ] **P1-007:** Alert creation form with rule type selection
- [ ] **P1-008:** Global search across mentions
- [ ] **P1-009:** Error boundaries on all pages
- [ ] **P1-010:** Loading skeletons for charts
- [ ] **P1-011:** SES domain verification for alert emails
- [ ] **P1-012:** Favicon and OG image

---

## Phase 2 (P2)

- [ ] **P2-001:** Reports: template-based report generation (PDF/Excel)
- [ ] **P2-002:** Scheduled reports via email (weekly/monthly digests)
- [ ] **P2-003:** Agency comparison dashboards
- [ ] **P2-004:** SSO / Active Directory integration
- [ ] **P2-005:** Real-time updates via WebSockets
- [ ] **P2-006:** Advanced topic modeling with custom taxonomies per agency
- [ ] **P2-007:** Crisis detection and escalation workflow
- [ ] **P2-008:** API for third-party integrations
- [ ] **P2-009:** Mobile-responsive views
- [ ] **P2-010:** Audit log for all user actions
- [ ] **P2-011:** Data retention policies and archiving
- [ ] **P2-012:** Multi-agency onboarding (add new Brandwatch queries per agency)
