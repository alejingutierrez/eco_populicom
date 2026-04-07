# AGENTS.md — ECO Platform

## Project Overview

**ECO** is a social media monitoring and social listening platform built for the Government of Puerto Rico. It enables ~120 government agencies to track conversations, topics, mentions, complaints, and sentiment about their programs and services across social media, news, forums, and blogs.

**Built by:** Populicom (external consultant/vendor)
**Client:** Government of Puerto Rico
**Pilot Agency:** AAA (Autoridad de Acueductos y Alcantarillados)

## Architecture

### Tech Stack
- **Frontend:** Next.js 15 (App Router, React 19) — deployed to ECS Fargate (ARM64 Graviton)
- **Backend:** Node.js Lambda functions via CDK (TypeScript, esbuild bundling)
- **Database:** PostgreSQL 16 (RDS db.t4g.medium) — Drizzle ORM
- **Infrastructure:** AWS CDK v2 (TypeScript) — 8 stacks
- **Auth:** AWS Cognito (email/password, 3 roles)
- **AI/NLP:** Claude Opus 4.6 via AWS Bedrock (`us.anthropic.claude-opus-4-6-v1`)
- **Data Source:** Brandwatch API — "Directas AAA" query (ID: 2003911540)
- **Queues:** SQS (ingestion + DLQ, alerts + DLQ)
- **Storage:** S3 (raw Brandwatch data, exports)
- **Email:** SES for alert notifications
- **UI:** Tailwind CSS v4, Recharts, Lucide icons, dark mode
- **Monorepo:** npm workspaces (packages/shared, packages/database, packages/brandwatch)

### Key Design Decisions
- **Multi-tenant from day one:** Row-level security with `agency_id` on all tables. 120 agencies planned.
- **Brandwatch as data source:** All social media data comes from Brandwatch API. ECO does NOT scrape social media directly.
- **Claude Opus for NLP:** Every mention is processed by Claude Opus 4.6 via Bedrock for sentiment (3 levels), emotions (7 types), pertinence (alta/media/baja), topic classification (10 + 30 subtopics), and municipality extraction. Both Brandwatch and Claude scores stored.
- **Ingestion cadence:** Poll Brandwatch every 5 minutes via EventBridge.
- **Topic taxonomy:** 10 fixed topics + 30 subtopics derived from analysis of ~200 real Brandwatch mentions.
- **Deduplication:** SHA-256 hash of normalized text, flagged but shown.
- **ORM:** Drizzle ORM with PostgreSQL (schema-as-code, type-safe).

### Data Flow
```
Brandwatch API → Lambda (Ingestion, every 5min)
    → S3 (raw JSON) + SQS (mention per message)
        → Lambda (Processor + Claude Opus 4.6 via Bedrock)
            → PostgreSQL (mentions + topics + municipalities)
                → Next.js Dashboard (ECS Fargate + ALB) ← User
            → SQS (alerts queue, if negative + high pertinence)
                → Lambda (Alerts) → SES Email
```

### Infrastructure Stacks (CDK)
| Stack | Resources |
|-------|-----------|
| **EcoNetwork** | VPC (10.0.0.0/16), 2 public + 2 private subnets, NAT Gateway, 4 security groups |
| **EcoDatabase** | RDS PostgreSQL 16 (db.t4g.medium, ARM64), Secrets Manager |
| **EcoAuth** | Cognito user pool + 3 groups (admin, analyst, viewer) |
| **EcoStorage** | S3 eco-raw (365d retention), S3 eco-exports (90d) |
| **EcoMessaging** | 4 SQS queues (ingestion + DLQ, alerts + DLQ) |
| **EcoWorkers** | 3 Lambdas (ingestion, processor, alerts) with NodejsFunction bundling |
| **EcoCompute** | ECS Fargate cluster + ALB + ECR (Next.js frontend) |
| **EcoMonitoring** | CloudWatch dashboard, 5 alarms, SNS topic |

### Database Schema (11 tables)
```
agencies            — Multi-tenant root (slug, brandwatch_project_id)
users               — Cognito sub mapping (email, role, agency_id)
mentions            — Core table (~40 cols: BW raw + NLP results)
topics              — 10 fixed topics
subtopics           — ~30 subtopics linked to topics
mention_topics      — Junction with confidence score
municipalities      — 78 PR municipios with coordinates
mention_municipalities — Junction with source (brandwatch/nlp)
alert_rules         — Configurable triggers (JSONB config)
alert_history       — Triggered alerts log
ingestion_cursors   — Tracks last poll timestamp per query
```

## User Roles
| Role | Permissions |
|------|-------------|
| **Admin** | Full access: manage users, configure agencies, set alerts, view all data, export reports |
| **Analyst** | View data, create/manage alerts, generate reports, configure topics |
| **Viewer** | Read-only access to dashboards, mentions, and reports |

## MVP Scope (Phase 1)
1. **Dashboard** — KPIs, trends, sentiment donut, top sources, recent mentions
2. **Mentions** — Filterable feed with sentiment/source/pertinence filters + pagination
3. **Sentiment Analysis** — Timeline, by source, emotions radar, BW vs Claude comparison
4. **Topics** — Grid with counts + detailed table with subtopics
5. **Geographic Classification** — Municipality bars + by-region breakdown
6. **Alerts** — Rule management UI + history table
7. **Settings** — Agency info, NLP config display

## Phase 2 (Post-MVP)
- HTTPS + custom domain
- Auth middleware on API routes
- Historical data backfill (2025 Brandwatch data)
- Agency selector (multi-tenant UI)
- Global search
- Mention detail panel
- Mention actions (tag, archive, reviewed)
- Advanced reports with PDF/Excel export
- Scheduled reports via email
- Agency comparison views
- SSO/Active Directory integration
- Real-time websocket updates
- PR municipality SVG choropleth map
- Mobile-responsive views

## Development Team
- **1 developer** (Alejandro Gutierrez) + AI agents (Claude Code)
- No dedicated QA, DevOps, or design team — AI-assisted across all functions

## Conventions

### Code Style
- TypeScript everywhere (frontend + backend + CDK + packages)
- Monorepo with npm workspaces
- Conventional commits (`feat:`, `fix:`, `docs:`)
- Feature branches → PR → main

### File Structure
```
eco_populicom/
├── apps/
│   └── web/                    # Next.js 15 frontend (App Router)
│       ├── src/app/            # Pages + API routes
│       ├── src/components/     # UI components
│       ├── src/lib/            # Auth, utils
│       ├── Dockerfile          # Multi-stage for ECS Fargate
│       └── next.config.ts
├── packages/
│   ├── shared/                 # Types, topic taxonomy, municipalities data
│   ├── database/               # Drizzle schema, migrations, seed, client
│   └── brandwatch/             # Brandwatch API client (auth, pagination, retry)
├── infra/
│   ├── bin/eco.ts              # CDK app entry (8 stacks)
│   ├── lib/                    # CDK stack definitions
│   ├── lambda/
│   │   ├── ingestion/          # Brandwatch polling (TypeScript)
│   │   ├── processor/          # NLP with Claude Opus (TypeScript)
│   │   ├── alerts/             # Alert evaluation + SES (TypeScript)
│   │   └── migration/          # Schema creation + seed (temporary)
│   └── test/                   # Jest CDK tests (8 files, all passing)
├── docs/
│   └── superpowers/specs/      # Design specs
├── AGENTS.md                   # This file
├── BACKLOG.md                  # Feature backlog
├── STATUS.md                   # Current project status
├── AWS.md                      # AWS infrastructure details
├── BRANDWATCH_API.md           # Brandwatch API reference
├── package.json                # Root workspace config
└── .env                        # Credentials (NEVER commit)
```

### Deployment

**Frontend (Next.js → ECS Fargate):**
- Deploys automatically via GitHub Actions on push to `main`
- Workflow: `.github/workflows/deploy.yml` ("Deploy ECO Web to ECS")
- Pipeline: push → Docker build → ECR push → ECS task definition update → Fargate rolling deploy
- To deploy: just `git push origin main` — no manual steps needed
- To check deploy status: `export GH_TOKEN=$(grep GITHUB_TOKEN .env | cut -d= -f2) && gh run list --limit 5`
- The GITHUB_TOKEN is in `.env` — always use it for `gh` commands

**Infrastructure (CDK):**
- `cd infra && npx cdk deploy --all` (requires AWS credentials)
- Lambdas auto-bundled via CDK `NodejsFunction` (esbuild → deploy)

**Database migrations:** Via `eco-migration` Lambda (temporary, invoke manually)

### AI Agent Guidelines
- Always check STATUS.md for current state before starting work
- Check BACKLOG.md for priorities
- Check AWS.md for infrastructure details
- Run `npx tsc --noEmit` before committing
- Run `npm -w infra test` for CDK tests
- Never commit .env files or secrets
- Use CDK for all infrastructure changes — no manual AWS console changes
- When writing NLP/sentiment code, consider Puerto Rican Spanish and Spanglish
- Use Drizzle ORM for all database queries
- All Lambda code is TypeScript in `infra/lambda/`
- Frontend components go in `apps/web/src/components/`
- API routes go in `apps/web/src/app/api/`
- AWS credentials must be exported before CDK commands:
  ```
  export AWS_ACCESS_KEY_ID=... && export AWS_SECRET_ACCESS_KEY=... && export AWS_REGION=us-east-1
  ```
