# STATUS.md — ECO Platform

**Last updated:** 2026-04-01

## Current Phase: MVP Development — Live in Production

### Summary
Platform is live in AWS with full data pipeline operational. Brandwatch ingestion polls every 5 minutes, Claude Opus 4.6 processes mentions via Bedrock, and the Next.js dashboard is accessible via ALB.

---

## Live URLs & Credentials

| Resource | Value |
|----------|-------|
| **Frontend (ALB)** | `http://eco-alb-1881782703.us-east-1.elb.amazonaws.com` |
| **Login email** | `agutierrez@populicom.com` |
| **Login password** | `EcoAdmin2026!` |
| **Cognito Pool** | `us-east-1_exuhIKYQ8` |
| **Cognito Client** | `1t4v0kt8nn9nnmtet8t3l5g7u3` |
| **AAA Agency UUID** | `a6608690-616b-454f-b587-82fb626376ba` |

---

## What's Done

### Infrastructure (All 8 CDK Stacks Deployed)
- [x] INFRA-001: CDK project with 8-stack architecture
- [x] INFRA-002: PostgreSQL RDS (db.t4g.medium, ARM64 Graviton)
- [x] INFRA-003: Cognito user pool + 3 groups (admin, analyst, viewer)
- [x] INFRA-004: S3 buckets (eco-raw, eco-exports)
- [x] INFRA-005: SQS queues (ingestion + DLQ, alerts + DLQ)
- [x] INFRA-006: 3 Lambda functions (ingestion, processor, alerts) — fully implemented
- [x] INFRA-007: ECS Fargate + ALB for Next.js frontend
- [x] CloudWatch dashboard + alarms + SNS notifications

### Database (11 Tables, Seeded)
- [x] DB-001: Multi-tenant schema with row-level security support
- [x] DB-002: Core tables: agencies, users, mentions, topics, subtopics, municipalities, mention_topics, mention_municipalities, alert_rules, alert_history, ingestion_cursors
- [x] DB-003: Mention table with ~40 columns (BW raw + NLP results)
- [x] DB-004: 6 indexes on mentions (agency_id, published_at, nlp_sentiment, page_type, text_hash, domain)
- [x] DB-005: 77 of 78 PR municipalities seeded with coordinates and population
- [x] DB-006: AAA agency seeded
- [x] 10 topics + 30 subtopics seeded (taxonomy derived from real data analysis)

### Brandwatch Integration (Operational)
- [x] BW-001: API client library with pagination, rate limiting, exponential backoff
- [x] BW-002: Ingestion Lambda polls every 5 minutes via EventBridge
- [x] BW-003: Full data mapping from Brandwatch mention → ECO schema
- [x] BW-004: Deduplication via SHA-256 text hash
- [x] BW-005: Error handling + DLQ configured
- [ ] BW-006: Backfill capability for historical data

### NLP Pipeline (Operational with Claude Opus 4.6)
- [x] NLP-001: Bedrock integration (inference profile: `us.anthropic.claude-opus-4-6-v1`)
- [x] NLP-002: Prompt engineered for PR Spanish/Spanglish (7 emotions, 10 topics, 78 municipios)
- [x] NLP-003: Processor Lambda with SQS trigger (batch 10, concurrency 2)
- [x] NLP-004: Topic + subtopic classification with confidence scores
- [x] NLP-005: Municipality extraction from text + Brandwatch geo
- [x] NLP-006: Single Claude call per mention (~4s, all 5 NLP tasks in one prompt)
- [x] NLP-007: Both BW and Claude sentiment stored

### Frontend (Live on ECS Fargate)
- [x] FE-001: Next.js 15 App Router + Tailwind CSS v4 + dark mode
- [x] FE-002: Sidebar layout with 7 navigation items
- [x] FE-003: Dashboard KPI cards (total mentions, negative %, engagement, reach)
- [x] FE-004: Timeline chart (mentions per day, Recharts)
- [x] FE-005: Sentiment donut chart
- [x] FE-006: Top sources bar chart
- [x] FE-007: Recent mentions feed with sentiment badges
- [x] FE-010: Mentions page with filterable feed
- [x] FE-011: Filters: sentiment, source, pertinence, search
- [x] FE-013: Pagination
- [x] FE-015-017: Sentiment page with stacked area, by-source, emotions radar, BW vs Claude comparison
- [x] FE-020: Topics page with grid + table
- [x] FE-024-026: Geography page with municipality bar + by-region breakdown
- [x] ALERT-004: Alerts UI (list rules, toggle active, history)
- [x] Settings page
- [x] Sign-in page with Cognito

### Auth
- [x] AUTH-001: Cognito integration (sign-in page, JWT in cookies)
- [x] Admin user created (agutierrez@populicom.com)

---

## What's In Progress

| Item | Status | Notes |
|------|--------|-------|
| Mention accumulation | Running | Pipeline ingesting ~15 mentions/day from Brandwatch |
| Auth middleware | Not yet | API routes don't enforce auth yet — open for MVP testing |

---

## What's Next (Priority Order)

1. **Accumulate mentions** — Let pipeline run for a few days to build up data for meaningful dashboards
2. **Auth middleware** — Protect API routes with Cognito JWT verification
3. **Backfill historical data** — Ingest 2025 mentions from Brandwatch for historical analysis
4. **HTTPS** — Add SSL certificate + Route 53 domain for production URL
5. **FE-008: Agency selector** — Multi-tenant UI for switching between agencies
6. **FE-009: Global search** — Full-text search across mentions
7. **FE-012: Mention detail panel** — Sheet/modal with full mention details
8. **FE-014: Mention actions** — Tag, archive, mark as reviewed
9. **ALERT-001-003:** Full alert rules engine + SES email notifications
10. **AUTH-002-004:** User management, RLS enforcement, admin panel
11. **Domain + HTTPS** — Configure custom domain with SSL

---

## Blockers

| Blocker | Impact | Resolution |
|---------|--------|------------|
| No HTTPS | Security | Need domain + ACM certificate + ALB HTTPS listener |
| Low mention volume | Dashboard UX | Pipeline running, data accumulating. Consider backfill. |

---

## Key Decisions Made

1. **Tech stack:** Next.js 15 + Node.js Lambda + PostgreSQL + CDK
2. **Multi-tenant from day one:** RLS support with agency_id, 120 agencies planned
3. **Data source:** Brandwatch "Directas AAA" query only (~15 mentions/day)
4. **AI/NLP:** Claude Opus 4.6 via Bedrock for all processing (quality over cost)
5. **Auth:** Cognito email/password, 3 roles
6. **Polling:** Every 5 minutes via EventBridge
7. **Sentiment:** 3 levels (negativo/neutral/positivo) + 7 emotions
8. **Pertinence:** Claude classifies alta/media/baja per mention
9. **Topics:** 10 fixed + 30 subtopics (derived from real Brandwatch data analysis of ~200 mentions)
10. **Duplicates:** Flagged via SHA-256 text hash, shown with indicator
11. **Geography:** Brandwatch geo + NLP extraction to 78 PR municipalities
12. **ORM:** Drizzle ORM
13. **Frontend:** Dark mode, sidebar layout, Recharts for charts
14. **Compute:** ECS Fargate (ARM64 Graviton) for frontend, Lambda for workers
