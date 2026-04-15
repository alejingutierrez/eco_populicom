# DDECPR Multi-Tenant Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DDECPR as a second tenant with multi-agency ingestion, agency-specific NLP topics, and frontend agency switching.

**Architecture:** The ingestion Lambda queries all active agencies from the DB and iterates their Brandwatch queries. The processor resolves agency from `mention.queryId` via a lookup map. The frontend uses a React context for agency selection, passing the slug to all API routes which filter data accordingly.

**Tech Stack:** TypeScript, AWS Lambda (Node 22), PostgreSQL (RDS), CDK, Next.js (App Router), Ant Design, React Query, Drizzle ORM

**Spec:** `docs/superpowers/specs/2026-04-15-ddecpr-multi-tenant.md`

---

## File Map

### Create
- `apps/web/src/contexts/AgencyContext.tsx` — React context for agency selection
- `apps/web/src/app/api/agencies/route.ts` — GET endpoint returning active agencies

### Modify
- `packages/shared/src/topics.ts` — Convert to `TOPICS_BY_AGENCY` map
- `packages/database/src/schema/topics.ts` — Add `agencyId` column
- `packages/database/src/seed/run.ts` — Seed DDECPR agency + topics
- `infra/lambda/migration/index.ts` — Migration for `agency_id` on topics + DDECPR seed
- `infra/lambda/ingestion/index.ts` — Multi-agency query loop
- `infra/lambda/processor/index.ts` — Dynamic agency resolution + per-agency NLP prompt
- `infra/lib/workers-stack.ts` — Remove hardcoded env vars
- `apps/web/src/components/providers/Providers.tsx` — Wrap with AgencyProvider
- `apps/web/src/components/layout/EcoHeader.tsx` — Dynamic agency selector
- `apps/web/src/app/(dashboard)/dashboard/page.tsx` — Pass agency to API
- `apps/web/src/app/api/dashboard/route.ts` — Filter by agency
- `apps/web/src/app/(dashboard)/settings/page.tsx` — Dynamic agency info

---

## Task 1: Add DDECPR topics to shared package

**Files:**
- Modify: `packages/shared/src/topics.ts`

- [ ] **Step 1: Add DDECPR topics and restructure exports**

Replace the entire file content with the agency-keyed structure:

```typescript
// ============================================================
// ECO Platform — Topic & Subtopic Taxonomy (Multi-Agency)
// ============================================================

export interface TopicDef {
  slug: string;
  name: string;
  description: string;
  displayOrder: number;
  subtopics: SubtopicDef[];
}

export interface SubtopicDef {
  slug: string;
  name: string;
  description: string;
  displayOrder: number;
}

const AAA_TOPICS: TopicDef[] = [
  {
    slug: 'averias-interrupciones',
    name: 'Averías / Interrupciones',
    description: 'Fallas técnicas que interrumpen el servicio de agua',
    displayOrder: 1,
    subtopics: [
      { slug: 'bombeo-represas', name: 'Bombeo / Represas', description: 'Fallas en bombas, represas (Carraízo, etc.)', displayOrder: 1 },
      { slug: 'plantas-filtracion', name: 'Plantas de Filtración', description: 'Plantas fuera de servicio o con capacidad reducida', displayOrder: 2 },
      { slug: 'tuberias-fugas', name: 'Tuberías / Fugas', description: 'Roturas de tuberías, fugas en la red', displayOrder: 3 },
      { slug: 'apagones-infraestructura', name: 'Apagones en Infraestructura', description: 'Fallas eléctricas que afectan operación de plantas/bombas', displayOrder: 4 },
    ],
  },
  {
    slug: 'calidad-agua',
    name: 'Calidad del Agua',
    description: 'Problemas relacionados con la calidad del agua potable',
    displayOrder: 2,
    subtopics: [
      { slug: 'turbidez', name: 'Turbidez', description: 'Alta turbidez en fuentes de agua cruda', displayOrder: 1 },
      { slug: 'contaminacion', name: 'Contaminación', description: 'Contaminación química o biológica', displayOrder: 2 },
      { slug: 'presion-baja', name: 'Presión Baja', description: 'Baja presión de agua en sectores', displayOrder: 3 },
    ],
  },
  {
    slug: 'conflictos-inter-agencia',
    name: 'Conflictos Inter-Agencia',
    description: 'Disputas entre AAA y otras entidades gubernamentales',
    displayOrder: 3,
    subtopics: [
      { slug: 'aaa-vs-luma', name: 'AAA vs LUMA', description: 'Conflictos con LUMA Energy por fallas eléctricas', displayOrder: 1 },
      { slug: 'aaa-vs-municipios', name: 'AAA vs Municipios', description: 'Disputas con alcaldes y gobiernos municipales', displayOrder: 2 },
      { slug: 'aaa-vs-legislatura', name: 'AAA vs Legislatura', description: 'Cuestionamientos desde Cámara o Senado', displayOrder: 3 },
    ],
  },
  {
    slug: 'infraestructura',
    name: 'Infraestructura',
    description: 'Inversiones, obras y mejoras a la infraestructura de agua',
    displayOrder: 4,
    subtopics: [
      { slug: 'obras-nuevas', name: 'Obras Nuevas', description: 'Construcción de nueva infraestructura', displayOrder: 1 },
      { slug: 'renovacion', name: 'Renovación', description: 'Renovación de tuberías, plantas, equipos existentes', displayOrder: 2 },
      { slug: 'fondos-federales', name: 'Fondos FEMA / Federales', description: 'Asignaciones de fondos FEMA u otros federales', displayOrder: 3 },
      { slug: 'inversiones', name: 'Inversiones', description: 'Inversiones generales en infraestructura', displayOrder: 4 },
    ],
  },
  {
    slug: 'servicio-cliente',
    name: 'Servicio al Cliente',
    description: 'Experiencia del cliente con los servicios de la agencia',
    displayOrder: 5,
    subtopics: [
      { slug: 'facturacion-depositos', name: 'Facturación / Depósitos', description: 'Tarifas, depósitos de conexión, pagos', displayOrder: 1 },
      { slug: 'quejas', name: 'Quejas', description: 'Quejas generales del público sobre el servicio', displayOrder: 2 },
      { slug: 'comunicacion-deficiente', name: 'Comunicación Deficiente', description: 'Falta de información oportuna a abonados', displayOrder: 3 },
    ],
  },
  {
    slug: 'crisis-emergencias',
    name: 'Crisis / Emergencias',
    description: 'Situaciones de emergencia que afectan el servicio',
    displayOrder: 6,
    subtopics: [
      { slug: 'sin-agua-prolongado', name: 'Sin Agua Prolongado', description: 'Comunidades sin agua por más de 24 horas', displayOrder: 1 },
      { slug: 'contingencia', name: 'Contingencia', description: 'Planes de contingencia activados', displayOrder: 2 },
      { slug: 'camiones-cisterna', name: 'Camiones Cisterna', description: 'Distribución de agua vía camiones oasis/cisterna', displayOrder: 3 },
    ],
  },
  {
    slug: 'gestion-administracion',
    name: 'Gestión / Administración',
    description: 'Aspectos administrativos y gerenciales de la agencia',
    displayOrder: 7,
    subtopics: [
      { slug: 'nombramientos', name: 'Nombramientos', description: 'Nombramientos y cambios de personal ejecutivo', displayOrder: 1 },
      { slug: 'vistas-publicas', name: 'Vistas Públicas / Cámara', description: 'Comparecencias ante la legislatura', displayOrder: 2 },
      { slug: 'auditorias', name: 'Auditorías', description: 'Auditorías e investigaciones', displayOrder: 3 },
      { slug: 'declaraciones-ejecutivas', name: 'Declaraciones Ejecutivas', description: 'Declaraciones del presidente u otros ejecutivos de AAA', displayOrder: 4 },
    ],
  },
  {
    slug: 'legislacion',
    name: 'Legislación',
    description: 'Proyectos de ley y regulación relacionados con la agencia',
    displayOrder: 8,
    subtopics: [
      { slug: 'proyectos-ley', name: 'Proyectos de Ley', description: 'Legislación propuesta que afecta a la agencia', displayOrder: 1 },
      { slug: 'resoluciones', name: 'Resoluciones', description: 'Resoluciones del Senado o Cámara', displayOrder: 2 },
      { slug: 'transparencia', name: 'Transparencia', description: 'Medidas de transparencia y rendición de cuentas', displayOrder: 3 },
    ],
  },
  {
    slug: 'impacto-comunitario',
    name: 'Impacto Comunitario',
    description: 'Efecto de las operaciones de la agencia en las comunidades',
    displayOrder: 9,
    subtopics: [
      { slug: 'municipios-afectados', name: 'Municipios Afectados', description: 'Municipios específicos impactados por interrupciones', displayOrder: 1 },
      { slug: 'sectores-residenciales', name: 'Sectores Residenciales', description: 'Residenciales y urbanizaciones afectadas', displayOrder: 2 },
      { slug: 'infraestructura-critica', name: 'Infraestructura Crítica', description: 'Impacto en aeropuertos, hospitales, escuelas', displayOrder: 3 },
    ],
  },
  {
    slug: 'medio-ambiente',
    name: 'Medio Ambiente',
    description: 'Temas ambientales relacionados con recursos hídricos',
    displayOrder: 10,
    subtopics: [
      { slug: 'embalses', name: 'Embalses', description: 'Niveles de embalses, sedimentación', displayOrder: 1 },
      { slug: 'rios', name: 'Ríos', description: 'Condición de ríos y cuencas', displayOrder: 2 },
      { slug: 'sequia', name: 'Sequía', description: 'Periodos de sequía y racionamiento', displayOrder: 3 },
    ],
  },
];

const DDECPR_TOPICS: TopicDef[] = [
  {
    slug: 'permisos-reforma',
    name: 'Permisos / Reforma',
    description: 'Sistema de permisos, PS 1173, simplificación, #conpermiso',
    displayOrder: 1,
    subtopics: [],
  },
  {
    slug: 'incentivos-economicos',
    name: 'Incentivos Económicos',
    description: 'Ley 60, Act 20/22, incentivos contributivos, atracción de inversión',
    displayOrder: 2,
    subtopics: [],
  },
  {
    slug: 'desarrollo-empresarial',
    name: 'Desarrollo Empresarial',
    description: 'Apoyo a PyMEs, emprendimiento, startups, incubadoras',
    displayOrder: 3,
    subtopics: [],
  },
  {
    slug: 'comercio-exterior',
    name: 'Comercio Exterior',
    description: 'Exportaciones, importaciones, zona de comercio, relaciones comerciales',
    displayOrder: 4,
    subtopics: [],
  },
  {
    slug: 'turismo-economia',
    name: 'Turismo / Economía',
    description: 'Impacto turístico en desarrollo económico',
    displayOrder: 5,
    subtopics: [],
  },
  {
    slug: 'empleo-fuerza-laboral',
    name: 'Empleo / Fuerza Laboral',
    description: 'Desempleo, capacitación, fuga de talento, workforce development',
    displayOrder: 6,
    subtopics: [],
  },
  {
    slug: 'gestion-secretario',
    name: 'Gestión del Secretario',
    description: 'Declaraciones, nombramientos, gestión de Negrón Reichard',
    displayOrder: 7,
    subtopics: [],
  },
  {
    slug: 'legislacion-economica',
    name: 'Legislación Económica',
    description: 'Proyectos de ley, vistas públicas, regulación económica',
    displayOrder: 8,
    subtopics: [],
  },
  {
    slug: 'inversion-extranjera',
    name: 'Inversión Extranjera',
    description: 'FDI, empresas nuevas, relocalizaciones, zonas industriales',
    displayOrder: 9,
    subtopics: [],
  },
  {
    slug: 'criticas-controversias',
    name: 'Críticas / Controversias',
    description: 'Quejas, señalamientos, controversias, auditorías',
    displayOrder: 10,
    subtopics: [],
  },
];

/** All topics keyed by agency slug */
export const TOPICS_BY_AGENCY: Record<string, TopicDef[]> = {
  aaa: AAA_TOPICS,
  ddecpr: DDECPR_TOPICS,
};

/** Backwards compat — AAA topics */
export const TOPICS = AAA_TOPICS;

/** Per-agency topic slug lists for NLP validation */
export const TOPIC_SLUGS_BY_AGENCY: Record<string, string[]> = Object.fromEntries(
  Object.entries(TOPICS_BY_AGENCY).map(([key, topics]) => [key, topics.map((t) => t.slug)]),
);

/** Backwards compat — AAA topic slugs */
export const TOPIC_SLUGS = TOPIC_SLUGS_BY_AGENCY.aaa;

/** Per-agency subtopic slug lists for NLP validation */
export const SUBTOPIC_SLUGS_BY_AGENCY: Record<string, string[]> = Object.fromEntries(
  Object.entries(TOPICS_BY_AGENCY).map(([key, topics]) => [
    key,
    topics.flatMap((t) => t.subtopics.map((s) => s.slug)),
  ]),
);

/** Flat list of all subtopic slugs (prefixed with topic) for validation */
export const SUBTOPIC_SLUGS = TOPICS.flatMap((t) =>
  t.subtopics.map((s) => `${t.slug}/${s.slug}`),
);
```

- [ ] **Step 2: Verify shared package compiles**

Run: `cd /Volumes/MyApps/eco_populicom && npx turbo build --filter=@eco/shared`

Expected: Build succeeds. Existing imports of `TOPICS`, `TOPIC_SLUGS`, `SUBTOPIC_SLUGS` still work via backwards compat exports.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/topics.ts
git commit -m "feat: add DDECPR topics and convert to TOPICS_BY_AGENCY map"
```

---

## Task 2: Add `agency_id` to topics schema + update seed

**Files:**
- Modify: `packages/database/src/schema/topics.ts`
- Modify: `packages/database/src/seed/run.ts`

- [ ] **Step 1: Add agencyId to topics Drizzle schema**

In `packages/database/src/schema/topics.ts`, replace the entire file:

```typescript
import { pgTable, serial, varchar, text, integer, boolean, uuid, unique } from 'drizzle-orm/pg-core';
import { agencies } from './agencies';

export const topics = pgTable(
  'topics',
  {
    id: serial('id').primaryKey(),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    description: text('description'),
    displayOrder: integer('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [unique('uq_topic_agency_slug').on(t.agencyId, t.slug)],
);

export const subtopics = pgTable(
  'subtopics',
  {
    id: serial('id').primaryKey(),
    topicId: integer('topic_id').notNull().references(() => topics.id),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    description: text('description'),
    displayOrder: integer('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [unique('uq_subtopic_topic_slug').on(t.topicId, t.slug)],
);
```

- [ ] **Step 2: Update seed script to handle multi-agency topics**

Replace `packages/database/src/seed/run.ts`:

```typescript
import { getDb } from '../client.js';
import { agencies, topics, subtopics, municipalities } from '../schema/index.js';
import { TOPICS_BY_AGENCY } from '@eco/shared';
import { MUNICIPALITIES } from '@eco/shared';
import { eq } from 'drizzle-orm';

async function seed() {
  const db = getDb();

  console.log('Seeding municipalities...');
  for (const m of MUNICIPALITIES) {
    await db
      .insert(municipalities)
      .values({
        name: m.name,
        slug: m.slug,
        region: m.region,
        latitude: m.latitude,
        longitude: m.longitude,
        population: m.population,
      })
      .onConflictDoNothing({ target: municipalities.slug });
  }
  console.log(`  -> ${MUNICIPALITIES.length} municipalities seeded`);

  // Seed agencies
  const agencyConfigs = [
    {
      name: 'Autoridad de Acueductos y Alcantarillados',
      slug: 'aaa',
      brandwatchProjectId: 1998403803,
      brandwatchQueryIds: [2003911540],
    },
    {
      name: 'Departamento de Desarrollo Económico y Comercio',
      slug: 'ddecpr',
      brandwatchProjectId: 1998405210,
      brandwatchQueryIds: [2003921640, 2003930254, 2003930261, 2003930255],
    },
  ];

  for (const cfg of agencyConfigs) {
    console.log(`Seeding agency: ${cfg.slug}...`);
    await db
      .insert(agencies)
      .values(cfg)
      .onConflictDoNothing({ target: agencies.slug });

    // Get agency ID
    const [agency] = await db
      .select({ id: agencies.id })
      .from(agencies)
      .where(eq(agencies.slug, cfg.slug));

    if (!agency) {
      console.error(`  -> Failed to find agency ${cfg.slug}`);
      continue;
    }

    // Seed topics for this agency
    const agencyTopics = TOPICS_BY_AGENCY[cfg.slug] ?? [];
    for (const t of agencyTopics) {
      const [inserted] = await db
        .insert(topics)
        .values({
          agencyId: agency.id,
          name: t.name,
          slug: t.slug,
          description: t.description,
          displayOrder: t.displayOrder,
        })
        .onConflictDoNothing()
        .returning({ id: topics.id });

      if (inserted) {
        for (const s of t.subtopics) {
          await db
            .insert(subtopics)
            .values({
              topicId: inserted.id,
              name: s.name,
              slug: s.slug,
              description: s.description,
              displayOrder: s.displayOrder,
            })
            .onConflictDoNothing();
        }
      }
    }
    const totalSubs = agencyTopics.reduce((sum, t) => sum + t.subtopics.length, 0);
    console.log(`  -> ${agencyTopics.length} topics, ${totalSubs} subtopics seeded for ${cfg.slug}`);
  }

  console.log('Seed complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify database package compiles**

Run: `cd /Volumes/MyApps/eco_populicom && npx turbo build --filter=@eco/database`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/database/src/schema/topics.ts packages/database/src/seed/run.ts
git commit -m "feat: add agency_id to topics schema and multi-agency seed"
```

---

## Task 3: Update migration Lambda with DDECPR seed + topics migration

**Files:**
- Modify: `infra/lambda/migration/index.ts`

- [ ] **Step 1: Add migration for agency_id on topics and DDECPR seed**

Find the end of the `runMigrations` function (after `CREATE INDEX IF NOT EXISTS idx_daily_metrics_agency_crisis`) and add before the closing `console.log('Schema migrations completed successfully')`:

```typescript
  // --- Multi-tenant: add agency_id to topics ---
  await client.query(`
    ALTER TABLE topics ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id);
  `);

  // Backfill existing topics with AAA agency_id
  await client.query(`
    UPDATE topics SET agency_id = (SELECT id FROM agencies WHERE slug = 'aaa')
    WHERE agency_id IS NULL;
  `);

  // Make agency_id NOT NULL after backfill
  await client.query(`
    ALTER TABLE topics ALTER COLUMN agency_id SET NOT NULL;
  `);

  // Drop old unique constraint on slug, replace with (agency_id, slug)
  await client.query(`DROP INDEX IF EXISTS topics_slug_key;`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_topic_agency_slug ON topics(agency_id, slug);
  `);
```

In the `runSeed` function, after the AAA agency seed block, add:

```typescript
  // Seed DDECPR agency
  await client.query(`
    INSERT INTO agencies (name, slug, brandwatch_project_id, brandwatch_query_ids)
    VALUES ('Departamento de Desarrollo Económico y Comercio', 'ddecpr', 1998405210, '[2003921640, 2003930254, 2003930261, 2003930255]'::jsonb)
    ON CONFLICT (slug) DO NOTHING;
  `);
  console.log('  -> DDECPR agency seeded');

  // Seed DDECPR topics
  const ddecprTopics = [
    ['permisos-reforma', 'Permisos / Reforma', 'Sistema de permisos, PS 1173, simplificación, #conpermiso', 1],
    ['incentivos-economicos', 'Incentivos Económicos', 'Ley 60, Act 20/22, incentivos contributivos, atracción de inversión', 2],
    ['desarrollo-empresarial', 'Desarrollo Empresarial', 'Apoyo a PyMEs, emprendimiento, startups, incubadoras', 3],
    ['comercio-exterior', 'Comercio Exterior', 'Exportaciones, importaciones, zona de comercio', 4],
    ['turismo-economia', 'Turismo / Economía', 'Impacto turístico en desarrollo económico', 5],
    ['empleo-fuerza-laboral', 'Empleo / Fuerza Laboral', 'Desempleo, capacitación, fuga de talento', 6],
    ['gestion-secretario', 'Gestión del Secretario', 'Declaraciones, nombramientos, gestión de Negrón Reichard', 7],
    ['legislacion-economica', 'Legislación Económica', 'Proyectos de ley, vistas públicas, regulación económica', 8],
    ['inversion-extranjera', 'Inversión Extranjera', 'FDI, empresas nuevas, relocalizaciones, zonas industriales', 9],
    ['criticas-controversias', 'Críticas / Controversias', 'Quejas, señalamientos, controversias, auditorías', 10],
  ];

  const ddecprAgencyResult = await client.query("SELECT id FROM agencies WHERE slug = 'ddecpr'");
  const ddecprAgencyId = ddecprAgencyResult.rows[0]?.id;
  if (ddecprAgencyId) {
    for (const [slug, name, description, order] of ddecprTopics) {
      await client.query(
        `INSERT INTO topics (agency_id, name, slug, description, display_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [ddecprAgencyId, name, slug, description, order],
      );
    }
    console.log(`  -> ${ddecprTopics.length} DDECPR topics seeded`);
  }
```

- [ ] **Step 2: Commit**

```bash
git add infra/lambda/migration/index.ts
git commit -m "feat: migration adds agency_id to topics and seeds DDECPR"
```

---

## Task 4: Refactor ingestion Lambda to multi-agency

**Files:**
- Modify: `infra/lambda/ingestion/index.ts`

- [ ] **Step 1: Replace ingestion handler with multi-agency loop**

Replace the entire file:

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { BrandwatchClient } from '@eco/brandwatch';
import type { BrandwatchMention } from '@eco/shared';

const s3 = new S3Client({});
const sqs = new SQSClient({});
const sm = new SecretsManagerClient({});

const RAW_BUCKET = process.env.RAW_BUCKET!;
const INGESTION_QUEUE_URL = process.env.INGESTION_QUEUE_URL!;
const BRANDWATCH_TOKEN = process.env.BRANDWATCH_TOKEN!;
const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;

interface AgencyRow {
  slug: string;
  brandwatch_project_id: number;
  brandwatch_query_ids: number[];
}

interface CursorRow {
  last_mention_date: string;
}

export const handler = async (event: unknown): Promise<{ statusCode: number; body: string }> => {
  console.log('Ingestion handler invoked', JSON.stringify(event));

  const dbUrl = await getDatabaseUrl();
  const agencies = await loadActiveAgencies(dbUrl);

  if (agencies.length === 0) {
    return { statusCode: 200, body: 'No active agencies with Brandwatch config' };
  }

  const now = new Date();
  const endDate = now.toISOString();
  const summaries: string[] = [];

  for (const agency of agencies) {
    const bw = new BrandwatchClient({
      token: BRANDWATCH_TOKEN,
      projectId: agency.brandwatch_project_id,
    });

    let agencyTotal = 0;

    for (const queryId of agency.brandwatch_query_ids) {
      const cursor = await readCursor(dbUrl, queryId);

      let startDate: string;
      if (cursor) {
        const cursorDate = new Date(cursor.last_mention_date);
        cursorDate.setMinutes(cursorDate.getMinutes() - 1);
        startDate = cursorDate.toISOString();
      } else {
        // First run: fetch last 24 hours
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        startDate = yesterday.toISOString();
      }

      console.log(`[${agency.slug}] Query ${queryId}: fetching from ${startDate} to ${endDate}`);

      let totalMentions = 0;
      let pageIndex = 0;
      let lastMentionDate = startDate;

      for await (const mentions of bw.fetchMentionPages({
        queryId,
        startDate,
        endDate,
        pageSize: 100,
        orderBy: 'date',
        orderDirection: 'asc',
      })) {
        // Store raw JSON in S3
        const datePrefix = now.toISOString().split('T')[0];
        const s3Key = `brandwatch/${agency.slug}/${queryId}/${datePrefix}/page-${pageIndex}.json`;
        await s3.send(
          new PutObjectCommand({
            Bucket: RAW_BUCKET,
            Key: s3Key,
            Body: JSON.stringify({ results: mentions, fetchedAt: now.toISOString() }),
            ContentType: 'application/json',
          }),
        );

        // Send each mention to SQS (batch of 10 max)
        const batches = chunk(mentions, 10);
        for (const batch of batches) {
          await sqs.send(
            new SendMessageBatchCommand({
              QueueUrl: INGESTION_QUEUE_URL,
              Entries: batch.map((mention, idx) => ({
                Id: `msg-${pageIndex}-${idx}-${mention.resourceId}`.slice(0, 80),
                MessageBody: JSON.stringify(mention),
              })),
            }),
          );
        }

        // Track last mention date for cursor update
        const lastMention = mentions[mentions.length - 1];
        if (lastMention?.date) {
          lastMentionDate = lastMention.date;
        }

        totalMentions += mentions.length;
        pageIndex++;
        console.log(`[${agency.slug}] Query ${queryId} page ${pageIndex}: ${mentions.length} mentions (total: ${totalMentions})`);
      }

      // Update cursor
      if (totalMentions > 0) {
        await updateCursor(dbUrl, queryId, lastMentionDate, totalMentions);
      }

      agencyTotal += totalMentions;
    }

    const msg = `${agency.slug}: ${agencyTotal} mentions across ${agency.brandwatch_query_ids.length} queries`;
    summaries.push(msg);
    console.log(`Agency ${msg}`);
  }

  const summary = summaries.join(' | ');
  console.log(`Ingestion complete: ${summary}`);
  return { statusCode: 200, body: summary };
};

// ---- Database helpers ----

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }),
  );
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}

async function loadActiveAgencies(dbUrl: string): Promise<AgencyRow[]> {
  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT slug, brandwatch_project_id, brandwatch_query_ids
       FROM agencies
       WHERE is_active = true AND brandwatch_project_id IS NOT NULL AND brandwatch_query_ids IS NOT NULL`,
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

async function readCursor(dbUrl: string, queryId: number): Promise<CursorRow | null> {
  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query(
      'SELECT last_mention_date FROM ingestion_cursors WHERE query_id = $1',
      [queryId],
    );
    return result.rows[0] ?? null;
  } finally {
    await client.end();
  }
}

async function updateCursor(
  dbUrl: string,
  queryId: number,
  lastMentionDate: string,
  mentionsFetched: number,
): Promise<void> {
  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO ingestion_cursors (query_id, last_mention_date, last_run_at, mentions_fetched, status)
       VALUES ($1, $2, NOW(), $3, 'idle')
       ON CONFLICT (query_id)
       DO UPDATE SET last_mention_date = $2, last_run_at = NOW(), mentions_fetched = ingestion_cursors.mentions_fetched + $3, status = 'idle'`,
      [queryId, lastMentionDate, mentionsFetched],
    );
  } finally {
    await client.end();
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
```

- [ ] **Step 2: Commit**

```bash
git add infra/lambda/ingestion/index.ts
git commit -m "feat: ingestion Lambda iterates all active agencies"
```

---

## Task 5: Refactor processor Lambda for dynamic agency + NLP

**Files:**
- Modify: `infra/lambda/processor/index.ts`

- [ ] **Step 1: Replace processor with dynamic agency resolution and per-agency NLP**

Key changes:
1. Remove `AGENCY_ID` env var usage
2. Add `loadAgencyMap()` that builds `Map<queryId, { id, slug, name }>`
3. `analyzeWithClaude()` receives agency name and topic slugs
4. `validateNlpResult()` uses per-agency topic slugs

Replace the entire file:

```typescript
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createHash } from 'crypto';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import type { BrandwatchMention, NlpAnalysis, Sentiment, Emotion } from '@eco/shared';
import { TOPIC_SLUGS_BY_AGENCY, SUBTOPIC_SLUGS_BY_AGENCY, TOPICS_BY_AGENCY } from '@eco/shared';

const bedrock = new BedrockRuntimeClient({});
const sqs = new SQSClient({});
const sm = new SecretsManagerClient({});

const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
const ALERTS_QUEUE_URL = process.env.ALERTS_QUEUE_URL!;
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1';

let dbUrl: string | null = null;

interface AgencyInfo {
  id: string;
  slug: string;
  name: string;
}

// Cache: queryId -> agency info (built on cold start)
let agencyMap: Map<number, AgencyInfo> | null = null;

export const handler = async (event: SQSEvent): Promise<void> => {
  console.log(`Processing ${event.Records.length} records`);

  if (!dbUrl) {
    dbUrl = await getDatabaseUrl();
  }

  if (!agencyMap) {
    agencyMap = await loadAgencyMap(dbUrl);
    console.log(`Agency map loaded: ${agencyMap.size} query-to-agency mappings`);
  }

  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    for (const record of event.Records) {
      await processRecord(record, client);
    }
  } finally {
    await client.end();
  }
};

async function loadAgencyMap(dbUrl: string): Promise<Map<number, AgencyInfo>> {
  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT id, slug, name, brandwatch_query_ids FROM agencies WHERE is_active = true AND brandwatch_query_ids IS NOT NULL`,
    );
    const map = new Map<number, AgencyInfo>();
    for (const row of result.rows) {
      const queryIds: number[] = row.brandwatch_query_ids;
      for (const qid of queryIds) {
        map.set(qid, { id: row.id, slug: row.slug, name: row.name });
      }
    }
    return map;
  } finally {
    await client.end();
  }
}

async function processRecord(record: SQSRecord, pgClient: any): Promise<void> {
  const mention: BrandwatchMention = JSON.parse(record.body);
  const resourceId = mention.resourceId;

  // Resolve agency from queryId
  const agency = agencyMap!.get(mention.queryId);
  if (!agency) {
    console.warn(`Unknown queryId ${mention.queryId} for mention ${resourceId}, skipping`);
    return;
  }

  console.log(`[${agency.slug}] Processing mention ${resourceId} from ${mention.domain}`);

  // Check if already processed (idempotency)
  const existing = await pgClient.query(
    'SELECT id FROM mentions WHERE bw_resource_id = $1',
    [resourceId],
  );
  if (existing.rows.length > 0) {
    console.log(`Mention ${resourceId} already exists, skipping`);
    return;
  }

  // Compute text hash for deduplication
  const textForHash = normalizeText((mention.title ?? '') + ' ' + (mention.snippet ?? ''));
  const textHash = createHash('sha256').update(textForHash).digest('hex');

  // Check for duplicate text within same agency
  const duplicate = await pgClient.query(
    'SELECT id FROM mentions WHERE text_hash = $1 AND agency_id = $2 LIMIT 1',
    [textHash, agency.id],
  );
  const isDuplicate = duplicate.rows.length > 0;
  const duplicateOfId = isDuplicate ? duplicate.rows[0].id : null;

  // Call Claude Opus via Bedrock for NLP analysis
  const nlp = await analyzeWithClaude(mention, agency);

  // Insert mention
  const mentionResult = await pgClient.query(
    `INSERT INTO mentions (
      agency_id, bw_resource_id, bw_guid, bw_query_id, bw_query_name,
      title, snippet, url, original_url,
      author, author_fullname, author_gender, author_avatar_url,
      domain, page_type, content_source, content_source_name, pub_type, subtype,
      likes, comments, shares, engagement_score, impact, reach_estimate, potential_audience, monthly_visitors,
      bw_country, bw_country_code, bw_region, bw_city, bw_city_code,
      bw_sentiment,
      nlp_sentiment, nlp_emotions, nlp_pertinence, nlp_summary,
      text_hash, is_duplicate, duplicate_of_id,
      media_urls, has_image, has_video,
      published_at, processed_at, language
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9,
      $10, $11, $12, $13,
      $14, $15, $16, $17, $18, $19,
      $20, $21, $22, $23, $24, $25, $26, $27,
      $28, $29, $30, $31, $32,
      $33,
      $34, $35, $36, $37,
      $38, $39, $40,
      $41, $42, $43,
      $44, NOW(), $45
    ) RETURNING id`,
    [
      agency.id, mention.resourceId, mention.guid, mention.queryId, mention.queryName,
      mention.title, mention.snippet, mention.url, mention.originalUrl,
      mention.author, mention.fullname, mention.gender, mention.avatarUrl,
      mention.domain, mention.pageType, mention.contentSource, mention.contentSourceName, mention.pubType, mention.subtype,
      mention.likes ?? 0, mention.comments ?? 0, mention.shares ?? 0,
      mention.engagementScore ?? 0, mention.impact ?? 0, mention.reachEstimate ?? 0,
      mention.potentialAudience ?? 0, mention.monthlyVisitors ?? 0,
      mention.country, mention.countryCode, mention.region, mention.city, mention.cityCode,
      mention.sentiment,
      nlp.sentiment, JSON.stringify(nlp.emotions), nlp.pertinence, nlp.summary,
      textHash, isDuplicate, duplicateOfId,
      JSON.stringify(mention.mediaUrls ?? []),
      (mention.mediaUrls?.length ?? 0) > 0 && mention.subtype === 'photo',
      mention.subtype === 'video',
      mention.date ? new Date(mention.date) : new Date(), mention.language ?? 'es',
    ],
  );

  const mentionId = mentionResult.rows[0].id;

  // Insert topic associations (agency-scoped)
  for (const topic of nlp.topics) {
    const topicRow = await pgClient.query(
      'SELECT id FROM topics WHERE slug = $1 AND agency_id = $2',
      [topic.topic_slug, agency.id],
    );
    if (topicRow.rows.length === 0) continue;

    let subtopicId = null;
    if (topic.subtopic_slug) {
      const subRow = await pgClient.query(
        'SELECT id FROM subtopics WHERE slug = $1 AND topic_id = $2',
        [topic.subtopic_slug, topicRow.rows[0].id],
      );
      subtopicId = subRow.rows[0]?.id ?? null;
    }

    await pgClient.query(
      `INSERT INTO mention_topics (mention_id, topic_id, subtopic_id, confidence)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [mentionId, topicRow.rows[0].id, subtopicId, topic.confidence],
    );
  }

  // Insert municipality associations
  for (const muniSlug of nlp.municipalities) {
    const muniRow = await pgClient.query(
      'SELECT id FROM municipalities WHERE slug = $1',
      [muniSlug],
    );
    if (muniRow.rows.length > 0) {
      await pgClient.query(
        `INSERT INTO mention_municipalities (mention_id, municipality_id, source)
         VALUES ($1, $2, 'nlp') ON CONFLICT DO NOTHING`,
        [mentionId, muniRow.rows[0].id],
      );
    }
  }

  // Also insert Brandwatch geo as municipality if available
  if (mention.city) {
    const citySlug = slugify(mention.city);
    const bwMuniRow = await pgClient.query(
      'SELECT id FROM municipalities WHERE slug = $1',
      [citySlug],
    );
    if (bwMuniRow.rows.length > 0) {
      await pgClient.query(
        `INSERT INTO mention_municipalities (mention_id, municipality_id, source)
         VALUES ($1, $2, 'brandwatch') ON CONFLICT DO NOTHING`,
        [mentionId, bwMuniRow.rows[0].id],
      );
    }
  }

  // Push to alerts queue if high pertinence + negative sentiment
  if (nlp.pertinence === 'alta' && nlp.sentiment === 'negativo') {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: ALERTS_QUEUE_URL,
        MessageBody: JSON.stringify({
          mentionId,
          agencyId: agency.id,
          sentiment: nlp.sentiment,
          emotions: nlp.emotions,
          topics: nlp.topics,
          publishedAt: mention.date,
        }),
      }),
    );
  }

  console.log(`[${agency.slug}] Mention ${resourceId} processed: sentiment=${nlp.sentiment}, pertinence=${nlp.pertinence}, topics=${nlp.topics.length}`);
}

async function analyzeWithClaude(mention: BrandwatchMention, agency: AgencyInfo): Promise<NlpAnalysis> {
  const agencyTopics = TOPICS_BY_AGENCY[agency.slug] ?? [];
  const topicSlugs = agencyTopics.map((t) => t.slug);
  const subtopicSlugs = agencyTopics.flatMap((t) => t.subtopics.map((s) => s.slug));

  const topicsList = agencyTopics
    .map((t) => {
      const subs = t.subtopics.length > 0
        ? ` (subtopicos: ${t.subtopics.map((s) => s.slug).join(', ')})`
        : '';
      return `${t.slug}: ${t.description}${subs}`;
    })
    .join('\n');

  const prompt = `Eres un analista de social listening especializado en Puerto Rico.
Analiza esta mención sobre ${agency.name}.

MENCIÓN:
Título: ${mention.title ?? '(sin título)'}
Texto: ${mention.snippet ?? '(sin texto)'}
Fuente: ${mention.contentSourceName ?? mention.domain} (${mention.domain})
Autor: ${mention.author ?? 'Desconocido'}
Fecha: ${mention.date}

Responde SOLO con JSON válido (sin markdown, sin backticks):
{
  "sentiment": "negativo" | "neutral" | "positivo",
  "emotions": [],
  "pertinence": "alta" | "media" | "baja",
  "topics": [{ "topic_slug": "...", "subtopic_slug": "...", "confidence": 0.0 }],
  "municipalities": [],
  "summary": "Resumen de una línea"
}

REGLAS:
- emotions: del set [frustración, enojo, alivio, gratitud, preocupación, sarcasmo, indiferencia]. Máximo 3.
- pertinence: "alta" si la mención TRATA sobre ${agency.name}. "media" si es secundaria. "baja" si se menciona de paso.
- topics: usar SOLO estos slugs:
${topicsList}
${subtopicSlugs.length > 0 ? `- subtopic_slug: ${subtopicSlugs.join(', ')}` : '- subtopic_slug: null (no hay subtopicos definidos para esta agencia)'}
- municipalities: slugs de los 78 municipios de PR (ej: san-juan, ponce, bayamon). Solo los que se mencionan o infieren del contexto.
- confidence: 0.0 a 1.0
- Máximo 3 tópicos por mención.`;

  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }),
    }),
  );

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const text = responseBody.content[0].text;

  try {
    const cleanText = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleanText) as NlpAnalysis;
    return validateNlpResult(parsed, agency.slug);
  } catch (err) {
    console.error(`Failed to parse NLP response for ${mention.resourceId}:`, text);
    return {
      sentiment: 'neutral',
      emotions: [],
      pertinence: 'media',
      topics: [],
      municipalities: [],
      summary: 'Error en análisis NLP',
    };
  }
}

function validateNlpResult(raw: NlpAnalysis, agencySlug: string): NlpAnalysis {
  const validSentiments: Sentiment[] = ['negativo', 'neutral', 'positivo'];
  const validEmotions: Emotion[] = [
    'frustración', 'enojo', 'alivio', 'gratitud', 'preocupación', 'sarcasmo', 'indiferencia',
  ];
  const validPertinence = ['alta', 'media', 'baja'];
  const validTopics = TOPIC_SLUGS_BY_AGENCY[agencySlug] ?? [];

  return {
    sentiment: validSentiments.includes(raw.sentiment) ? raw.sentiment : 'neutral',
    emotions: (raw.emotions ?? []).filter((e) => validEmotions.includes(e)).slice(0, 3),
    pertinence: validPertinence.includes(raw.pertinence) ? raw.pertinence : 'media',
    topics: (raw.topics ?? [])
      .filter((t) => validTopics.includes(t.topic_slug))
      .slice(0, 3)
      .map((t) => ({
        ...t,
        confidence: Math.max(0, Math.min(1, t.confidence ?? 0.5)),
      })),
    municipalities: (raw.municipalities ?? []).filter((m) =>
      // Keep MUNICIPALITY_SLUGS import if needed, or just pass through since DB will reject invalid ones
      typeof m === 'string' && m.length > 0,
    ),
    summary: (raw.summary ?? '').slice(0, 500),
  };
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }),
  );
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add infra/lambda/processor/index.ts
git commit -m "feat: processor resolves agency dynamically from queryId"
```

---

## Task 6: Update CDK — remove hardcoded env vars

**Files:**
- Modify: `infra/lib/workers-stack.ts`

- [ ] **Step 1: Remove BRANDWATCH_PROJECT_ID, BRANDWATCH_QUERY_ID, and AGENCY_ID**

In `infra/lib/workers-stack.ts`, replace the ingestion function environment (lines 56-63):

```typescript
      environment: {
        RAW_BUCKET: props.rawBucket.bucketName,
        INGESTION_QUEUE_URL: props.ingestionQueue.queueUrl,
        DB_SECRET_ARN: props.dbSecret.secretArn,
        BRANDWATCH_TOKEN: process.env.BRANDWATCH_TOKEN ?? '',
      },
```

Replace the processor function environment (lines 92-97):

```typescript
      environment: {
        DB_SECRET_ARN: props.dbSecret.secretArn,
        ALERTS_QUEUE_URL: props.alertsQueue.queueUrl,
        BEDROCK_MODEL_ID: 'us.anthropic.claude-opus-4-6-v1',
      },
```

- [ ] **Step 2: Commit**

```bash
git add infra/lib/workers-stack.ts
git commit -m "refactor: remove hardcoded agency env vars from CDK"
```

---

## Task 7: Frontend — AgencyContext + API endpoint

**Files:**
- Create: `apps/web/src/contexts/AgencyContext.tsx`
- Create: `apps/web/src/app/api/agencies/route.ts`
- Modify: `apps/web/src/components/providers/Providers.tsx`

- [ ] **Step 1: Create agencies API endpoint**

Create `apps/web/src/app/api/agencies/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { agencies } from '@eco/database';
import { eq } from 'drizzle-orm';

export async function GET() {
  const db = getDb();

  const result = await db
    .select({
      slug: agencies.slug,
      name: agencies.name,
      logoUrl: agencies.logoUrl,
      brandwatchProjectId: agencies.brandwatchProjectId,
      brandwatchQueryIds: agencies.brandwatchQueryIds,
    })
    .from(agencies)
    .where(eq(agencies.isActive, true));

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
  });
}
```

- [ ] **Step 2: Create AgencyContext**

Create `apps/web/src/contexts/AgencyContext.tsx`:

```typescript
'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

interface Agency {
  slug: string;
  name: string;
  logoUrl: string | null;
  brandwatchProjectId: number | null;
  brandwatchQueryIds: number[] | null;
}

interface AgencyContextValue {
  agencies: Agency[];
  selectedAgency: string;
  setAgency: (slug: string) => void;
  isLoading: boolean;
}

const AgencyContext = createContext<AgencyContextValue>({
  agencies: [],
  selectedAgency: 'aaa',
  setAgency: () => {},
  isLoading: true,
});

export function AgencyProvider({ children }: { children: ReactNode }) {
  const [selectedAgency, setSelectedAgency] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('eco-agency') ?? 'aaa';
    }
    return 'aaa';
  });

  const { data: agencies = [], isLoading } = useQuery<Agency[]>({
    queryKey: ['agencies'],
    queryFn: () => fetch('/api/agencies').then((r) => r.json()),
    staleTime: 60 * 60 * 1000, // 1 hour
  });

  const setAgency = (slug: string) => {
    setSelectedAgency(slug);
    if (typeof window !== 'undefined') {
      localStorage.setItem('eco-agency', slug);
    }
  };

  // If saved agency no longer exists, reset to first available
  useEffect(() => {
    if (agencies.length > 0 && !agencies.find((a) => a.slug === selectedAgency)) {
      setAgency(agencies[0].slug);
    }
  }, [agencies, selectedAgency]);

  return (
    <AgencyContext.Provider value={{ agencies, selectedAgency, setAgency, isLoading }}>
      {children}
    </AgencyContext.Provider>
  );
}

export function useAgency() {
  return useContext(AgencyContext);
}
```

- [ ] **Step 3: Wrap Providers with AgencyProvider**

In `apps/web/src/components/providers/Providers.tsx`, add the import and wrap:

```typescript
'use client';

import { ConfigProvider, App as AntApp } from 'antd';
import esES from 'antd/locale/es_ES';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ecoTheme } from '@/theme/eco-theme';
import { AgencyProvider } from '@/contexts/AgencyContext';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: true,
        refetchInterval: 5 * 60 * 1000,
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === 'undefined') return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={ecoTheme} locale={esES}>
        <AntApp>
          <AgencyProvider>{children}</AgencyProvider>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/contexts/AgencyContext.tsx apps/web/src/app/api/agencies/route.ts apps/web/src/components/providers/Providers.tsx
git commit -m "feat: add AgencyContext and /api/agencies endpoint"
```

---

## Task 8: Frontend — dynamic agency selector in header

**Files:**
- Modify: `apps/web/src/components/layout/EcoHeader.tsx`

- [ ] **Step 1: Replace hardcoded selector with dynamic one**

Replace the entire file:

```typescript
'use client';

import { usePathname } from 'next/navigation';
import { Layout, Breadcrumb, Select, DatePicker, Avatar, Space, Tooltip } from 'antd';
import { Building2, Calendar } from 'lucide-react';
import dayjs from 'dayjs';
import { useAgency } from '@/contexts/AgencyContext';

const { Header } = Layout;
const { RangePicker } = DatePicker;

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/mentions': 'Menciones',
  '/sentiment': 'Sentimiento',
  '/topics': 'Tópicos',
  '/geography': 'Geografía',
  '/alerts': 'Alertas',
  '/settings': 'Configuración',
};

export function EcoHeader() {
  const pathname = usePathname();
  const pageTitle = PAGE_TITLES[pathname] ?? 'Dashboard';
  const { agencies, selectedAgency, setAgency, isLoading } = useAgency();

  return (
    <Header
      className="eco-header"
      style={{
        background: '#fff',
        padding: '0 28px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: 56,
        lineHeight: 'normal',
      }}
    >
      {/* Left: Breadcrumbs + Title */}
      <div>
        <Breadcrumb
          items={[{ title: 'Inicio' }, { title: pageTitle }]}
          style={{ marginBottom: 2 }}
        />
        <div
          style={{
            fontSize: 17,
            fontWeight: 700,
            color: '#0E1E2C',
            letterSpacing: -0.3,
            lineHeight: 1.2,
          }}
        >
          {pageTitle}
        </div>
      </div>

      {/* Right: Agency selector + Date range + User */}
      <Space size={10}>
        {/* Agency selector */}
        <Select
          value={selectedAgency}
          onChange={setAgency}
          loading={isLoading}
          style={{ minWidth: 200 }}
          suffixIcon={<Building2 size={14} color="#0A7EA4" />}
          options={agencies.map((a) => ({
            value: a.slug,
            label: a.name,
          }))}
        />

        {/* Date range picker */}
        <RangePicker
          defaultValue={[dayjs().startOf('month'), dayjs()]}
          format="MMM D, YYYY"
          suffixIcon={<Calendar size={14} color="#64748B" />}
          style={{ minWidth: 240 }}
        />

        {/* User avatar */}
        <Tooltip title="A. Gutierrez — Admin">
          <Avatar
            size={32}
            className="eco-avatar-gradient"
            style={{ cursor: 'pointer', fontSize: 11, fontWeight: 700 }}
          >
            AG
          </Avatar>
        </Tooltip>
      </Space>
    </Header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/layout/EcoHeader.tsx
git commit -m "feat: dynamic agency selector in header"
```

---

## Task 9: Dashboard API + page — filter by agency

**Files:**
- Modify: `apps/web/src/app/api/dashboard/route.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/page.tsx`

- [ ] **Step 1: Add agency filter to dashboard API**

At the top of the `GET` function in `apps/web/src/app/api/dashboard/route.ts`, after `const compare = ...` line, add agency resolution:

```typescript
  const agencySlug = searchParams.get('agency') ?? 'aaa';

  // Resolve agency ID
  const [agencyRow] = await db
    .select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.slug, agencySlug))
    .limit(1);

  if (!agencyRow) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
  }
  const agencyId = agencyRow.id;
```

Add `agencies` to imports from `@eco/database`.

In `buildMentionFilters`, add `agencyId` parameter and add the filter:

```typescript
function buildMentionFilters(params: URLSearchParams, dateStart: Date, agencyId: string) {
  const conditions = [
    gte(mentions.publishedAt, dateStart),
    eq(mentions.agencyId, agencyId),
  ];

  const sentiment = params.get('sentiment');
  if (sentiment) conditions.push(eq(mentions.nlpSentiment, sentiment));

  const source = params.get('source');
  if (source) conditions.push(eq(mentions.contentSourceName, source));

  const pertinence = params.get('pertinence');
  if (pertinence) conditions.push(eq(mentions.nlpPertinence, pertinence));

  return conditions;
}
```

Update all calls to `buildMentionFilters` to pass `agencyId`.

For the snapshot fast path, add agency filter:

```typescript
    const snapshots = await db
      .select()
      .from(dailyMetricSnapshots)
      .where(and(
        gte(dailyMetricSnapshots.date, startStr),
        eq(dailyMetricSnapshots.agencyId, agencyId),
      ))
      .orderBy(desc(dailyMetricSnapshots.date));
```

For the topic treemap, add agency filter to the join:

```typescript
      .where(and(
        gte(mentions.publishedAt, start),
        eq(mentions.agencyId, agencyId),
      ))
```

For the compare section, add agency filter:

```typescript
      const prevSnapshots = await db
        .select()
        .from(dailyMetricSnapshots)
        .where(
          and(
            gte(dailyMetricSnapshots.date, prevStartStr),
            lte(dailyMetricSnapshots.date, prevEndStr),
            eq(dailyMetricSnapshots.agencyId, agencyId),
          ),
        )
        .orderBy(desc(dailyMetricSnapshots.date));
```

For topic filter options, filter by agency:

```typescript
      db
        .select({ slug: topics.slug, name: topics.name })
        .from(topics)
        .where(eq(topics.agencyId, agencyId))
        .orderBy(topics.name),
```

- [ ] **Step 2: Pass agency to dashboard API from page**

In `apps/web/src/app/(dashboard)/dashboard/page.tsx`, add agency to the query:

Add import at the top:

```typescript
import { useAgency } from '@/contexts/AgencyContext';
```

Inside the component, after the existing useState hooks:

```typescript
  const { selectedAgency } = useAgency();
```

In the `queryString` useMemo, add `selectedAgency` to deps and add to params:

```typescript
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('agency', selectedAgency);
    params.set('period', filters.period);
    if (filters.customRange) {
      params.set('startDate', filters.customRange[0]);
      params.set('endDate', filters.customRange[1]);
    }
    if (filters.sentiment) params.set('sentiment', filters.sentiment);
    if (filters.source) params.set('source', filters.source);
    if (filters.topic) params.set('topic', filters.topic);
    if (filters.municipality) params.set('municipality', filters.municipality);
    if (filters.pertinence) params.set('pertinence', filters.pertinence);
    if (filters.compare) params.set('compare', 'true');
    return params.toString();
  }, [filters, selectedAgency]);
```

Update the queryKey to include agency:

```typescript
    queryKey: ['dashboard', selectedAgency, queryString],
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/dashboard/route.ts apps/web/src/app/(dashboard)/dashboard/page.tsx
git commit -m "feat: filter dashboard by selected agency"
```

---

## Task 10: Settings page — dynamic agency info

**Files:**
- Modify: `apps/web/src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Replace hardcoded content with dynamic data**

Replace the entire file:

```typescript
'use client';

import { Card, Descriptions, Tag, Row, Col, Typography, Skeleton } from 'antd';
import { useAgency } from '@/contexts/AgencyContext';

const { Title, Text } = Typography;

export default function SettingsPage() {
  const { agencies, selectedAgency, isLoading } = useAgency();
  const agency = agencies.find((a) => a.slug === selectedAgency);

  if (isLoading) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Title level={4} style={{ color: '#0E1E2C', margin: 0 }}>
        Configuracion
      </Title>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={12}>
          <Card
            title="Agencia"
            styles={{ header: { color: '#0E1E2C' } }}
          >
            <Descriptions column={1} colon={false} size="small">
              <Descriptions.Item label="Nombre">
                {agency?.name ?? 'N/A'}
              </Descriptions.Item>
              <Descriptions.Item label="Slug">
                <Tag color="blue">{agency?.slug?.toUpperCase() ?? 'N/A'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Brandwatch Project ID">
                <Text code>{agency?.brandwatchProjectId ?? 'N/A'}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Brandwatch Query IDs">
                {agency?.brandwatchQueryIds?.map((qid) => (
                  <Text code key={qid} style={{ marginRight: 4 }}>{qid}</Text>
                )) ?? 'N/A'}
              </Descriptions.Item>
              <Descriptions.Item label="Polling">
                Cada 5 minutos
              </Descriptions.Item>
              <Descriptions.Item label="Estado">
                <Tag color="success">Activo</Tag>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title="NLP"
            styles={{ header: { color: '#0E1E2C' } }}
          >
            <Descriptions column={1} colon={false} size="small">
              <Descriptions.Item label="Modelo">
                Claude Opus (Bedrock)
              </Descriptions.Item>
              <Descriptions.Item label="Proveedor">
                <Tag color="purple">AWS Bedrock</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Sentimiento">
                3 niveles + 7 emociones
              </Descriptions.Item>
              <Descriptions.Item label="Topicos">
                Personalizados por agencia
              </Descriptions.Item>
              <Descriptions.Item label="Estado">
                <Tag color="success">Conectado</Tag>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      <Row>
        <Col span={24}>
          <Card
            title="Plataforma"
            styles={{ header: { color: '#0E1E2C' } }}
          >
            <Descriptions column={1} colon={false} size="small">
              <Descriptions.Item label="Version">
                <Tag>v0.2.0</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Producto">
                ECO — Social Listening Platform
              </Descriptions.Item>
              <Descriptions.Item label="Organizacion">
                <Text style={{ color: '#64748B' }}>
                  Gobierno de Puerto Rico &middot; Populicom
                </Text>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/(dashboard)/settings/page.tsx
git commit -m "feat: dynamic settings page based on selected agency"
```

---

## Task 11: Deploy and verify end-to-end

- [ ] **Step 1: Deploy migration Lambda**

```bash
cd /Volumes/MyApps/eco_populicom/infra
npx cdk deploy EcoMigrationStack --require-approval never
```

- [ ] **Step 2: Run migration to create DDECPR and update topics**

```bash
aws lambda invoke --function-name eco-migration \
  --payload '{"action":"migrate-and-seed"}' \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout
```

Expected: Status 200, "Schema migrations completed successfully"

- [ ] **Step 3: Verify DDECPR exists in DB**

```bash
aws lambda invoke --function-name eco-migration \
  --payload '{"action":"custom-query","query":"SELECT slug, name, brandwatch_project_id, brandwatch_query_ids FROM agencies WHERE is_active = true"}' \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout
```

Expected: Two rows — `aaa` and `ddecpr` with correct Brandwatch IDs.

- [ ] **Step 4: Verify topics have agency_id**

```bash
aws lambda invoke --function-name eco-migration \
  --payload '{"action":"custom-query","query":"SELECT t.slug, a.slug as agency_slug FROM topics t JOIN agencies a ON t.agency_id = a.id ORDER BY a.slug, t.display_order"}' \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout
```

Expected: 10 AAA topics + 10 DDECPR topics, each with correct agency slug.

- [ ] **Step 5: Deploy workers stack (ingestion + processor)**

```bash
cd /Volumes/MyApps/eco_populicom/infra
npx cdk deploy EcoWorkersStack --require-approval never
```

- [ ] **Step 6: Manually invoke ingestion to trigger first DDECPR fetch**

```bash
aws lambda invoke --function-name eco-ingestion \
  --payload '{}' \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout
```

Expected: Output includes both `aaa: N mentions` and `ddecpr: N mentions`.

- [ ] **Step 7: Check CloudWatch logs for processor**

```bash
aws logs tail /aws/lambda/eco-processor --since 5m --follow
```

Expected: Logs show `[ddecpr] Processing mention ...` entries with correct topic assignments.

- [ ] **Step 8: Verify mentions in DB**

```bash
aws lambda invoke --function-name eco-migration \
  --payload '{"action":"custom-query","query":"SELECT a.slug, count(*) FROM mentions m JOIN agencies a ON m.agency_id = a.id GROUP BY a.slug"}' \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout
```

Expected: Both `aaa` and `ddecpr` have mention counts.

- [ ] **Step 9: Verify ingestion cursors**

```bash
aws lambda invoke --function-name eco-migration \
  --payload '{"action":"custom-query","query":"SELECT query_id, last_mention_date, mentions_fetched FROM ingestion_cursors ORDER BY query_id"}' \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout
```

Expected: 5 rows (1 for AAA + 4 for DDECPR).

- [ ] **Step 10: Deploy frontend**

```bash
cd /Volumes/MyApps/eco_populicom
npx turbo build --filter=web
# Then deploy via Vercel or your deployment method
```

- [ ] **Step 11: Verify frontend agency switching**

Open the dashboard in browser. The agency selector should show both AAA and DDECPR. Switching to DDECPR should reload dashboard data showing DDECPR mentions, topics, and metrics.

- [ ] **Step 12: Run metrics calculator backfill for DDECPR**

```bash
aws lambda invoke --function-name eco-metrics-calculator \
  --payload '{"backfill":true}' \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout
```

Expected: Backfills daily snapshots for both agencies.

- [ ] **Step 13: Final commit**

```bash
git add -A
git commit -m "feat: complete DDECPR multi-tenant integration"
```
