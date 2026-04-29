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

### Using `.env` credentials responsibly (AI agents)

The `.env` at repo root holds long-lived AWS IAM keys + other secrets. They
are NOT rotated automatically, so an agent that leaks or misuses them
compromises the whole account until Alejandro notices. Treat them like
production root keys.

**Loading them into a Bash tool call** — one-liner, re-applied each command
(shell state does not persist between tool calls):

```
export $(grep -E '^AWS_' /Volumes/MyApps/eco_populicom/.env | xargs) && <aws/cdk command>
```

Or, if a script needs the full env:

```
set -a; source /Volumes/MyApps/eco_populicom/.env; set +a
```

**Rules every agent must follow:**

1. **Never print the raw values.** `echo $AWS_SECRET_ACCESS_KEY`, `env | grep AWS`,
   or similar leak them to the transcript. If you need to confirm they loaded,
   use `aws sts get-caller-identity` — that returns the account ID, not the key.
2. **Never write them to a file that could be committed.** Do not `echo` them
   into a Lambda payload JSON, a CDK config, or a debug log. The only file
   they live in is `.env` (gitignored).
3. **Never pass them via CLI args that get logged.** `--aws-access-key-id
   AKIA…` ends up in shell history and process tables. Use env vars instead
   (AWS CLI and CDK pick them up automatically).
4. **Only use them for the task the user asked for.** Do not browse other
   AWS resources "for context" — the blast radius of these keys is the entire
   account.
5. **Prefer read-only / diagnostic actions first** (`aws sts …`, Lambda
   `Invoke` with read-only payloads like `qa-date-alignment`). Destructive
   CLI commands (delete, force-deploy, reset-cursors) need explicit user
   authorization in the conversation — the presence of keys is not blanket
   consent.
6. **Don't create new IAM users, policies, or access keys.** Those outlive
   the session and are invisible to the user.
7. **If a command fails with `InvalidClientTokenId` or `ExpiredToken`,**
   stop and ask the user to refresh — do not retry with different keys or
   dig through other profiles.

When in doubt, ask before running the command.

### Pushing changes & opening PRs (AI agents)

The harness blocks `git push origin main` directly — every change, even
a one-line tweak, must land via a feature branch + PR. Don't try to work
around it. The flow below is what works end-to-end on this machine.

**Important:** `gh` is **not installed** here. Use the GitHub REST API with
`GITHUB_TOKEN` from `.env`. Repo is `alejingutierrez/eco_populicom`,
default branch is `main`.

#### 1. Always start work on a dedicated branch

Pick a conventional prefix (`feat/`, `fix/`, `chore/`, `docs/`, `refactor/`)
and a short slug. Branch from `origin/main`, not from the current worktree's
`claude/*` branch:

```bash
MAIN=/Users/alegut/MyApps/eco_populicom    # main worktree
git -C "$MAIN" fetch origin main
git -C "$MAIN" checkout -b <type>/<slug> origin/main
# ...edits...
git -C "$MAIN" add <paths>
git -C "$MAIN" commit -m "<conventional commit message>"
git -C "$MAIN" push -u origin <type>/<slug>
git -C "$MAIN" checkout main                        # leave main worktree clean
```

If you already committed to local `main` by mistake, recover without losing
the commit:

```bash
git -C "$MAIN" branch <type>/<slug> main            # capture the commit on a new branch
git -C "$MAIN" reset --hard origin/main             # clean main back to remote
git -C "$MAIN" push -u origin <type>/<slug>
```

#### 2. Open the PR via the REST API

Load `GITHUB_TOKEN` without printing it; verify with `/user` (returns only
the login):

```bash
export GITHUB_TOKEN=$(grep '^GITHUB_TOKEN=' /Users/alegut/MyApps/eco_populicom/.env | cut -d= -f2- | tr -d '"')
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user \
  | python3 -c "import json,sys; print('login:', json.load(sys.stdin).get('login'))"
```

Build the body with `python3` to avoid JSON-escape pain, then POST:

```bash
BODY=$(python3 -c '
import json
print(json.dumps({
  "title": "<conventional title>",
  "head": "<type>/<slug>",
  "base": "main",
  "body": "## Summary\n- ...\n\n## Test plan\n- [ ] ...\n",
}))
')

curl -s -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/alejingutierrez/eco_populicom/pulls \
  -d "$BODY" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('html_url') or d)"
```

Check mergeability + checks before asking for merge:

```bash
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/repos/alejingutierrez/eco_populicom/pulls/<N>" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('mergeable:', d.get('mergeable'), 'state:', d.get('mergeable_state'))"
```

#### 3. Wait for explicit user approval before merging

Pushing a branch and opening a PR is autonomous. **Merging to `main` is not.**
Even when `mergeable_state == clean` and CI passes, do not call the merge API
without an unambiguous "merge"/"squash"/"yes mergea" from the user in the
conversation. The harness will (and should) block silent merges.

When approved, squash-merge:

```bash
curl -s -X PUT \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/alejingutierrez/eco_populicom/pulls/<N>/merge \
  -d '{"merge_method":"squash"}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('merged:', d.get('merged'), 'sha:', d.get('sha'))"
```

#### 4. Clean up after merge

```bash
# Delete remote branch (expect HTTP 204)
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X DELETE \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/alejingutierrez/eco_populicom/git/refs/heads/<type>/<slug>

# Sync local main and drop the local branch
git -C "$MAIN" fetch --prune origin
git -C "$MAIN" pull --ff-only origin main
git -C "$MAIN" branch -D <type>/<slug>
```

#### Common gotchas

- **Worktrees vs main checkout.** `/Users/alegut/MyApps/eco_populicom` is the
  main worktree (on `main`). Sub-paths under `.claude/worktrees/` are separate
  worktrees on their own `claude/*` branches. Edits with absolute paths land
  in whichever worktree owns that path. Pick the right one before editing —
  always prefer the main worktree for ship-bound changes.
- **Don't reuse the worktree's `claude/*` branch as the PR head.** Those
  branches often point at `origin/main` exactly, so the diff is empty or
  confusing. Always open a fresh `<type>/<slug>` from `origin/main`.
- **Don't print the token.** `export GITHUB_TOKEN=$(...)` then let `curl`
  pick it up from the environment. Never `echo $GITHUB_TOKEN` and never pass
  it as a query string.
- **CI may not run on every path.** The `deploy.yml` workflow only triggers
  on changes under `apps/web/**`, `packages/**`, or `package-lock.json`.
  A docs- or `.gitignore`-only PR will show 0 checks — that's fine, not a bug.
