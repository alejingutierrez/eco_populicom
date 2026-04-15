# DDECPR Multi-Tenant Integration

**Date:** 2026-04-15
**Status:** Draft
**Author:** Claude + Alejandro

## Goal

Add DDECPR (Departamento de Desarrollo Económico y Comercio de Puerto Rico) as a second tenant in ECO, ingesting all 4 Brandwatch queries, with agency-specific topics and full frontend agency switching. Verify end-to-end in production (AWS).

## Context

ECO currently runs single-tenant for AAA. The database schema already supports multi-tenant (`agencies` table with `brandwatch_query_ids` JSONB array, `mentions.agency_id` FK), but the ingestion Lambda, processor Lambda, and frontend are hardcoded to AAA.

### DDECPR Brandwatch Configuration

| Query ID | Name | Type | Content |
|----------|------|------|---------|
| 2003921640 | DDECPR | monitor | External mentions across all sources |
| 2003930254 | DDEC | publicfacebook | Facebook page (553558728043206) |
| 2003930261 | Depto. Desarrollo Económico y Comercio | linkedin | LinkedIn brand page |
| 2003930255 | desarrollopr | instagram | Instagram (@desarrollopr) |

Project ID: `1998405210`

## Design

### 1. Database Changes

#### 1a. Topics table — add `agency_id`

Add `agency_id UUID NOT NULL REFERENCES agencies(id)` to `topics` table. Migration steps:
1. Add column as nullable first
2. Backfill existing rows with AAA's agency UUID
3. Set column to NOT NULL
4. Drop existing unique index on `slug`
5. Create new unique index on `(agency_id, slug)`

Subtopics don't need `agency_id` — they reference topics which now belong to an agency. The existing `UNIQUE(topic_id, slug)` constraint on subtopics is sufficient.

#### 1b. Seed DDECPR agency

```sql
INSERT INTO agencies (name, slug, brandwatch_project_id, brandwatch_query_ids)
VALUES (
  'Departamento de Desarrollo Económico y Comercio',
  'ddecpr',
  1998405210,
  '[2003921640, 2003930254, 2003930261, 2003930255]'::jsonb
) ON CONFLICT (slug) DO NOTHING;
```

#### 1c. Seed DDECPR topics

| Slug | Name | Description |
|------|------|-------------|
| permisos-reforma | Permisos / Reforma | Sistema de permisos, PS 1173, simplificación, #conpermiso |
| incentivos-economicos | Incentivos Económicos | Ley 60, Act 20/22, incentivos contributivos, atracción de inversión |
| desarrollo-empresarial | Desarrollo Empresarial | Apoyo a PyMEs, emprendimiento, startups, incubadoras |
| comercio-exterior | Comercio Exterior | Exportaciones, importaciones, zona de comercio, relaciones comerciales |
| turismo-economia | Turismo / Economía | Impacto turístico en desarrollo económico |
| empleo-fuerza-laboral | Empleo / Fuerza Laboral | Desempleo, capacitación, fuga de talento, workforce development |
| gestion-secretario | Gestión del Secretario | Declaraciones, nombramientos, gestión de Negrón Reichard |
| legislacion-economica | Legislación Económica | Proyectos de ley, vistas públicas, regulación económica |
| inversion-extranjera | Inversión Extranjera | FDI, empresas nuevas, relocalizaciones, zonas industriales |
| criticas-controversias | Críticas / Controversias | Quejas, señalamientos, controversias, auditorías |

No subtopics for DDECPR in this phase — will define after observing initial data patterns.

#### 1d. Update AAA topics with agency_id

Migration backfills `agency_id` on all existing topics rows with AAA's UUID.

### 2. Shared Package Changes

#### 2a. `packages/shared/src/topics.ts`

Convert `TOPICS` array to `TOPICS_BY_AGENCY: Record<string, TopicDef[]>`:

```typescript
export const TOPICS_BY_AGENCY: Record<string, TopicDef[]> = {
  aaa: [ /* existing AAA topics */ ],
  ddecpr: [ /* new DDECPR topics */ ],
};

// Backwards compat
export const TOPICS = TOPICS_BY_AGENCY.aaa;

// Per-agency slug lists for validation
export const TOPIC_SLUGS_BY_AGENCY: Record<string, string[]> = Object.fromEntries(
  Object.entries(TOPICS_BY_AGENCY).map(([key, topics]) => [key, topics.map(t => t.slug)])
);

// Backwards compat
export const TOPIC_SLUGS = TOPIC_SLUGS_BY_AGENCY.aaa;
```

### 3. Ingestion Lambda — Multi-Agency

**File:** `infra/lambda/ingestion/index.ts`

Current: reads `BRANDWATCH_PROJECT_ID` and `BRANDWATCH_QUERY_ID` from env vars, fetches one query.

New behavior:

1. Connect to DB, query: `SELECT slug, brandwatch_project_id, brandwatch_query_ids FROM agencies WHERE is_active = true AND brandwatch_project_id IS NOT NULL`
2. For each agency, for each queryId in `brandwatch_query_ids`:
   - Create `BrandwatchClient` with `projectId` from the agency
   - Read cursor from `ingestion_cursors` (already keyed by `query_id`)
   - Fetch mentions pages
   - Store to S3 at `brandwatch/{agencySlug}/{queryId}/{date}/page-N.json`
   - Send to SQS (mention JSON already contains `queryId` from Brandwatch)
   - Update cursor
3. Log summary per agency: `"Agency ddecpr: ingested 42 mentions across 4 queries"`

**Removed env vars:** `BRANDWATCH_PROJECT_ID`, `BRANDWATCH_QUERY_ID` from CDK.
**Kept env var:** `BRANDWATCH_TOKEN` (shared across all projects in the account).

### 4. Processor Lambda — Dynamic Agency Resolution

**File:** `infra/lambda/processor/index.ts`

Current: uses `AGENCY_ID` from env var for all mentions.

New behavior:

1. On cold start, load agency map: `SELECT id, slug, brandwatch_query_ids FROM agencies WHERE is_active = true`
2. Build `Map<number, { agencyId: string; agencySlug: string }>` mapping each queryId to its agency
3. For each SQS record, read `mention.queryId`, look up agency from the map
4. If no match found, log warning and skip the record
5. Use resolved `agencyId` for dedup check, mention insert, and alert queue

**Removed env var:** `AGENCY_ID` from CDK.

#### 4a. Dynamic NLP Prompt

The processor prompt currently says "Analiza esta mención sobre la Autoridad de Acueductos y Alcantarillados (AAA)."

New: Load `TOPICS_BY_AGENCY[agencySlug]` and build the prompt dynamically:
- Agency name from DB
- Topic slugs list from `TOPICS_BY_AGENCY`
- Subtopic slugs list from `TOPICS_BY_AGENCY`
- Pertinence description referencing the agency name

The validation function `validateNlpResult` also switches to the agency-specific topic/subtopic slug lists.

### 5. Frontend Changes

#### 5a. New API endpoint: `GET /api/agencies`

Returns active agencies: `[{ slug, name, logoUrl }]`. Cached with `s-maxage=3600`.

#### 5b. AgencyContext

New React context in `apps/web/src/contexts/AgencyContext.tsx`:
- Fetches agencies from `/api/agencies` on mount
- Stores selected `agencySlug` in state + `localStorage`
- Provides `{ agencies, selectedAgency, setAgency }` to children

#### 5c. EcoHeader — dynamic selector

Replace hardcoded `<Select>` options with agencies from context. On change, update context (which triggers dashboard re-fetch).

#### 5d. Dashboard API — agency filter

`/api/dashboard/route.ts` receives `agency` query param (slug).

Changes:
- Resolve `agencyId` from slug
- Add `eq(mentions.agencyId, agencyId)` to all mention queries
- Add `eq(dailyMetricSnapshots.agencyId, agencyId)` to snapshot queries
- Filter options (sources, topics, municipalities) also scoped by agency
- Topics list filtered by agency

#### 5e. Settings page

Replace hardcoded AAA info with dynamic data from the selected agency (name, Brandwatch project ID, query IDs, mention count).

### 6. CDK Changes

**File:** `infra/lib/workers-stack.ts`

Ingestion Lambda environment:
- Remove: `BRANDWATCH_PROJECT_ID`, `BRANDWATCH_QUERY_ID`
- Keep: `BRANDWATCH_TOKEN`, `RAW_BUCKET`, `INGESTION_QUEUE_URL`, `DB_SECRET_ARN`

Processor Lambda environment:
- Remove: `AGENCY_ID`
- Keep: `DB_SECRET_ARN`, `ALERTS_QUEUE_URL`, `BEDROCK_MODEL_ID`

### 7. Deploy & Verification Sequence

1. Deploy migration Lambda — creates DDECPR agency, adds `agency_id` to topics, seeds DDECPR topics, backfills AAA topics
2. Deploy CDK — updated ingestion + processor Lambdas
3. Manually invoke ingestion Lambda — verify all 5 queries run (1 AAA + 4 DDECPR)
4. Monitor CloudWatch logs for both ingestion and processor
5. Verify in DB:
   - `SELECT count(*), agency_id FROM mentions GROUP BY agency_id` — 2 agencies
   - `SELECT * FROM ingestion_cursors` — 5 rows
   - `SELECT slug, agency_id FROM topics` — topics split by agency
6. Deploy frontend
7. Verify dashboard loads for both agencies via selector
8. Verify metrics calculator runs correctly for both agencies (already loops all agencies)

### Success Criteria

- DDECPR ingestion runs every 5 minutes alongside AAA
- All 4 DDECPR queries produce mentions in the DB with correct `agency_id`
- NLP analysis uses DDECPR-specific topics
- Dashboard shows DDECPR data when selected, AAA data when selected
- No regression in AAA data or dashboard functionality
- Ingestion cursors tracked independently per query
- CloudWatch logs clearly show per-agency ingestion stats

## Out of Scope

- DDECPR-specific subtopics (phase 2 after data observation)
- User-agency assignment / access control (MVP uses free selector)
- Agency-specific alert configurations
- Agency-specific branding (logo, colors) in dashboard
- Backfill of historical DDECPR mentions prior to integration date
