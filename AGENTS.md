# AGENTS.md — ECO Platform

## Project Overview

**ECO** is a social media monitoring and social listening platform built for the Government of Puerto Rico. It enables ~120 government agencies to track conversations, topics, mentions, complaints, and sentiment about their programs and services across social media, news, forums, and blogs.

**Built by:** Populicom (external consultant/vendor)
**Client:** Government of Puerto Rico

## Architecture

### Tech Stack
- **Frontend:** Next.js (React) — deployed to AWS
- **Backend:** Node.js (Lambda functions via CDK)
- **Database:** PostgreSQL (RDS)
- **Infrastructure:** AWS CDK (TypeScript)
- **Auth:** AWS Cognito (email/password)
- **AI/NLP:** Claude via AWS Bedrock — custom sentiment analysis tuned for Puerto Rican Spanish/Spanglish
- **Data Source:** Brandwatch API (primary) + free news APIs (secondary)
- **Pilot Agency:** AAA (Autoridad de Acueductos y Alcantarillados) — Project ID: 1998403803, Query: "Directas AAA" (2003911540)
- **Queues:** SQS for async processing (ingestion, alerts, exports)
- **Storage:** S3 (raw data, exports)

### Key Design Decisions
- **Multi-tenant from day one:** Architecture must support 120 agencies even though MVP starts with 1. Tenant isolation at the database level (row-level security or schema-per-tenant).
- **Brandwatch as data source:** All social media data comes from Brandwatch API. ECO does NOT scrape social media directly.
- **Custom sentiment with Claude/Bedrock:** Brandwatch provides baseline sentiment, but ECO re-processes mentions through Claude (Bedrock) for Puerto Rican Spanish/Spanglish cultural sensitivity. Both scores are stored.
- **Ingestion cadence:** Poll Brandwatch API every 15-30 minutes.
- **Serverless-first:** Lambda for compute, SQS for async, RDS for persistence. No EC2/ECS.

### Data Flow
```
Brandwatch API → Lambda (Ingestion) → SQS → Lambda (Processing + Claude/Bedrock NLP) → PostgreSQL
                                                                                          ↓
                                                                              Next.js Dashboard ← User
                                                                                          ↓
                                                                              SQS (Alerts) → Lambda → Email (SES)
```

## User Roles
| Role | Permissions |
|------|-------------|
| **Admin** | Full access: manage users, configure agencies, set up alerts, view all data, export reports |
| **Analyst** | View all data, create/manage alerts, generate reports, configure topics |
| **Viewer** | Read-only access to dashboards, mentions, and reports |

## MVP Scope (Phase 1 — 4-8 weeks)
1. **Dashboard** — KPIs, trends, sentiment overview, top sources, recent mentions
2. **Mentions** — Filterable feed of social media posts with sentiment, source, engagement
3. **Sentiment Analysis** — Breakdown by positive/negative/neutral, by source, over time, by agency
4. **Geographic Classification** — Mentions mapped to PR municipalities
5. **Topics** — Topic clustering, trending topics, word clouds
6. **Email Alerts** — Configurable alerts for spikes, negative sentiment, keyword triggers

## Phase 2 (Post-MVP)
- Advanced reports with PDF/Excel export
- Scheduled reports via email
- Agency comparison views
- Dark mode
- SSO/Active Directory integration
- Real-time websocket updates
- Competitive benchmarking between agencies

## Development Team
- **1 developer** (Alejandro Gutierrez) + AI agents (Claude Code)
- No dedicated QA, DevOps, or design team — AI-assisted across all functions

## Conventions

### Code Style
- TypeScript everywhere (frontend + backend + CDK)
- ESLint + Prettier
- Conventional commits
- Feature branches → PR → main

### File Structure (Target)
```
eco_populicom/
├── apps/
│   ├── web/                 # Next.js frontend
│   └── api/                 # Lambda functions
├── packages/
│   ├── shared/              # Shared types, utils
│   ├── database/            # Prisma/Drizzle schema + migrations
│   └── brandwatch/          # Brandwatch API client
├── infra/                   # CDK infrastructure
├── docs/                    # Documentation
├── AGENTS.md
├── BACKLOG.md
├── STATUS.md
├── AWS.md
└── .env
```

### Database
- PostgreSQL on RDS
- ORM: TBD (Prisma or Drizzle)
- Multi-tenant: Row-level security with `agency_id` on all tables

### AI Agent Guidelines
- Always check BACKLOG.md before starting work to understand priorities
- Check STATUS.md for current state of the project
- Check AWS.md for infrastructure details
- Run tests before committing
- Never commit .env files or secrets
- Use CDK for all infrastructure changes — no manual AWS console changes
- When writing NLP/sentiment code, always consider Puerto Rican Spanish and Spanglish
