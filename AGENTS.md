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

### Frontend: dónde vive cada pantalla (LEER ANTES DE CREAR UI)

El frontend tiene **dos mundos** que se ven idénticos en URL pero son
arquitecturalmente distintos. Si no respetas esta división, tu pantalla
nueva sale "por fuera del dashboard" — caso recurrente que produce el
sandwich visual entre Antd default y el tema Costa/Gaceta del prototype.

**1. Dashboard prototype (`apps/web/public/eco-prototype/`)**
- Vanilla React + JSX precompilado con Babel (`scripts/compile-prototype.js`)
- Tema: CSS variables en `index.html` (líneas 13–88): `--accent`, `--pos`,
  `--neg`, `--ff-sans` (Instrument Sans), `--rail-bg`, `--r` (radius), …
- Shell completo (sidebar + header + drawer + command palette) en `shell.js`
- Screens: `OverviewScreen`, `DashboardScreen`, `MentionsScreen`,
  `SentimentScreen`, `TopicsScreen`, `GeographyScreen`, `AlertsScreen`,
  `SettingsScreen`, `NarrativeScreen` — todos en `screens.js`
- Rutas servidas por Next.js rewrites (ver `apps/web/next.config.ts`):
  `/overview`, `/dashboard`, `/mentions`, etc. → `/eco-prototype/index.html`
- Componentes reutilizables: `KpiCard`, `Card`, etc. (definidos en `shell.js`
  o `screens.js`) — **úsalos** si tu feature vive dentro del shell

**2. Páginas Next.js puras (`apps/web/src/app/...`)**
- App Router + React 19 + Antd v6 (`Layout`, `Form`, `Table`, etc.)
- Tema Antd en `src/theme/eco-theme.ts` (no coincide con el del prototype:
  `colorPrimary: #0A7EA4` vs `--accent: #0B5F80` del prototype)
- Rutas: cualquier path bajo `src/app/` que NO esté en el rewrite del
  `next.config.ts`
- Hoy se usan para: `/settings/reports`, `/settings/alerts`,
  `/admin/mentions/import`, `/sign-in`, `/api/*`

**Regla canónica: ¿cuál usar para mi feature nueva?**

| Caso | Dónde implementarlo |
|---|---|
| Vista principal de datos (dashboard, KPIs, listas con filtros) | Screen vanilla en `screens.js` con shell. Usa `KpiCard`, `Card`, paleta `var(--accent)` |
| Form de configuración / admin terciario (alertas, reportes, imports, usuarios) | Página Next.js con Antd **+ embed via iframe** dentro de un Screen del prototype (patrón `?embed=1`) |
| Endpoint API / server action | `apps/web/src/app/api/...` siempre |

**Cómo embeber una página Next.js dentro del shell del prototype** (patrón
canónico usado por `/settings/reports`, `/settings/alerts`,
`/admin/mentions/import`):

1. En la página Next.js, leer `searchParams.get('embed') === '1'` y
   ajustar layout — sin `Header` propio, fondo transparente, sin `min-height:
   100vh`. Patrón:
   ```tsx
   const isEmbedded = searchParams?.get('embed') === '1';
   const bg = isEmbedded ? 'transparent' : '#F4F7FA';
   return (
     <Layout style={{ minHeight: isEmbedded ? 'auto' : '100vh', background: bg }}>
       {!isEmbedded && <Header ... />}
       <Content style={{ padding: isEmbedded ? 12 : 28, maxWidth: isEmbedded ? '100%' : 1280 }}>
         {/* contenido */}
       </Content>
     </Layout>
   );
   ```
2. Los `<Link>` o `router.push` dentro de la página deben preservar `?embed=1`
   para que la navegación interna del iframe no rompa el shell padre.
3. En `screens.js`, agregar un Screen (o un tab) que renderice:
   ```jsx
   <iframe
     src="/<tu-ruta>?embed=1"
     style={{ width: '100%', height: 1100, border: 'none', background: 'transparent' }}
   />
   ```
   Envuelto en un `card`/`card-hd` para que herede el shell.
4. Si necesitas reload externo (ej. desde un botón en el header del Screen):
   `iframeRef.current.src = iframeRef.current.src`.
5. Agregar entrada de navegación si aplica: 
   - Si vive bajo Configuración: añadir sección en `SettingsScreen.sections`
     en `screens.js` (~línea 2596).
   - Si necesita acceso directo desde el sidebar: añadir al array `nav` en
     `shell.js` (~línea 37) **y** mapear el screen en `app.js`.

**Por qué pasa esto cada vez** (causa raíz):
- No hay `<AppShell>` React-side compartido entre los dos mundos. Cada
  página Next.js que se crea desde cero "naturalmente" renderiza su propio
  `Layout` Antd con header blanco — el dev no se da cuenta de que vive
  fuera del shell del prototype.
- El theme de Antd y las CSS vars del prototype son sistemas paralelos sin
  pasarela. Cambiar tokens en uno no propaga al otro.
- La convención "embed iframe + `?embed=1`" está implícita en
  `/settings/reports` pero no documentada — quien copia ese patrón lo
  replica, quien no lo conoce inventa una pantalla suelta.

**Si refactoras este modelo en el futuro:** la salida limpia es escribir
el shell del prototype como componente Next.js compartido y montar los
screens dentro de él. Pero es un refactor grande — la receta actual
(iframe + `?embed=1`) cumple el propósito sin re-escribir el prototype.

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

### Worktrees: sincronizar SIEMPRE antes de empezar

Los worktrees (`.claude/worktrees/<name>/`) se crean desde la rama base en el
momento del `git worktree add`. `main` avanza muy rápido (a veces 20+ commits
en pocos días vía PRs squash-merged). Si empiezas a editar sin sincronizar,
vas a planear sobre código viejo y/o vas a tener que pelear conflictos al
hacer PR.

**Patrón obligatorio al iniciar trabajo en un worktree:**

```bash
# 1. Fetch main por HTTPS (SSH no funciona en esta máquina — push falla).
set -a; source /Users/alegut/MyApps/eco_populicom/.env; set +a
git fetch https://${GITHUB_TOKEN}@github.com/alejingutierrez/eco_populicom.git main

# 2. Ver cuántos commits estás atrás. Si es > 0, sincronizar.
git log --oneline HEAD..FETCH_HEAD | head

# 3. Si la rama del worktree solo tiene commits cuya intención ya está en main
#    (commits "chore" duplicados por squash-merge), reset --hard es la ruta
#    limpia. NO se pierde código — el contenido vive en main con otro SHA.
git reset --hard FETCH_HEAD

# 4. Si la rama tiene trabajo propio NO mergeado todavía, rebase y resolver:
#    git rebase FETCH_HEAD
#    (resolver conflictos a mano, aceptando "theirs" para cualquier archivo
#    que ya esté en main bajo otro nombre/SHA)

# 5. Symlink node_modules (workspaces se resuelven al monorepo principal):
ln -sfn /Users/alegut/MyApps/eco_populicom/node_modules \
  /Users/alegut/MyApps/eco_populicom/.claude/worktrees/<worktree>/node_modules
```

**Por qué NO usar SSH (`git fetch origin`):** el remoto está configurado como
`git@github.com:...` y en esta máquina la auth SSH falla con "Permission
denied (publickey)". Siempre HTTPS con el `GITHUB_TOKEN` del `.env`.

**Por qué `reset --hard` es seguro aquí (en esta única situación):** los
commits que el worktree tiene por defecto al crearse son típicamente
commits que ya existen en `main` bajo otro SHA por squash-merge. Verifica
con `git log HEAD..FETCH_HEAD --oneline` que no hay trabajo propio nuevo
en HEAD antes de resetear. Si hay trabajo propio, rebase con resolución
manual; nunca pierdas datos no representados en main.

**Excepción CLAUDE.md:** la regla general dice no usar `reset --hard` sin
autorización. Para el caso específico "sincronizar worktree recién creado
con main", el caso de uso está pre-autorizado por el usuario (caso
2026-05-20).

When in doubt, ask before running the command.
