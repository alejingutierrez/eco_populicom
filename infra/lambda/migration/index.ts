/**
 * Migration Lambda — Runs Drizzle schema push + seed against RDS.
 * Invoked manually via AWS CLI, not scheduled.
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { buildEmbeddingInput, embedText, toPgvectorLiteral } from '../lib/embeddings';
import { TOPICS_BY_AGENCY, canonicalizeUrl } from '@eco/shared';

const sm = new SecretsManagerClient({});
const bedrock = new BedrockRuntimeClient({});
const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
// Haiku para clasificación constrained-enum (subtopic backfill). Es 20x más
// barato que Opus y suficiente para escoger entre 5-6 opciones predefinidas.
const SUBTOPIC_BACKFILL_MODEL_ID = process.env.SUBTOPIC_BACKFILL_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

export const handler = async (event: { action?: string; query?: string; queryIds?: number[]; limit?: number; agencySlug?: string; batchSize?: number }): Promise<{ statusCode: number; body: string }> => {
  const action = event.action ?? 'migrate-and-seed';
  console.log(`Migration handler invoked with action: ${action}`);

  const dbUrl = await getDatabaseUrl();

  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    if (action === 'migrate' || action === 'migrate-and-seed') {
      await runMigrations(client);
    }
    if (action === 'seed' || action === 'migrate-and-seed') {
      await runSeed(client);
    }
    if (action === 'status') {
      return await getStatus(client);
    }
    if (action === 'get-agency-id') {
      const res = await client.query("SELECT id FROM agencies WHERE slug = 'aaa'");
      return { statusCode: 200, body: res.rows[0]?.id ?? 'NOT_FOUND' };
    }
    if (action === 'custom-query' && event.query) {
      // Read-only queries for diagnostics
      const selectOnly = event.query.trim().toLowerCase();
      if (!selectOnly.startsWith('select')) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Only SELECT queries allowed' }) };
      }
      const res = await client.query(event.query);
      return { statusCode: 200, body: JSON.stringify({ rows: res.rows, rowCount: res.rowCount }) };
    }
    if (action === 'reset-cursors') {
      // Reset ingestion cursors for specified query IDs to re-ingest from scratch
      const queryIds = event.queryIds;
      if (!queryIds || queryIds.length === 0) {
        return { statusCode: 400, body: 'queryIds required' };
      }
      const del = await client.query(
        `DELETE FROM ingestion_cursors WHERE query_id = ANY($1::bigint[])`,
        [queryIds],
      );
      return { statusCode: 200, body: JSON.stringify({ deleted: del.rowCount, queryIds }) };
    }
    if (action === 'cleanup-empty-mentions') {
      // Delete mentions with no usable content (e.g. Twitter with no date/snippet/title)
      const del = await client.query(
        `DELETE FROM mentions WHERE snippet IS NULL AND title IS NULL RETURNING id`,
      );
      return { statusCode: 200, body: JSON.stringify({ deleted: del.rowCount }) };
    }
    if (action === 'qa-date-alignment') {
      // Side-by-side daily counts in AST vs UTC + flag mentions whose
      // published_at ≈ ingested_at (candidates for the old NOW() fallback bug).
      const days = (event as any).days ?? 20;

      const ast = await client.query(
        `SELECT (published_at AT TIME ZONE 'America/Puerto_Rico')::date::text AS d,
                COUNT(*)::int AS c
           FROM mentions
          WHERE published_at > NOW() - ($1 || ' days')::interval
          GROUP BY 1 ORDER BY 1 DESC`,
        [String(days)],
      );
      const utc = await client.query(
        `SELECT DATE(published_at)::text AS d, COUNT(*)::int AS c
           FROM mentions
          WHERE published_at > NOW() - ($1 || ' days')::interval
          GROUP BY 1 ORDER BY 1 DESC`,
        [String(days)],
      );
      const ingested = await client.query(
        `SELECT (ingested_at AT TIME ZONE 'America/Puerto_Rico')::date::text AS d,
                COUNT(*)::int AS c
           FROM mentions
          WHERE ingested_at > NOW() - ($1 || ' days')::interval
          GROUP BY 1 ORDER BY 1 DESC`,
        [String(days)],
      );
      const suspicious = await client.query(
        `SELECT (published_at AT TIME ZONE 'America/Puerto_Rico')::date::text AS d,
                COUNT(*)::int AS c
           FROM mentions
          WHERE ABS(EXTRACT(EPOCH FROM (ingested_at - published_at))) < 30
            AND published_at > NOW() - ($1 || ' days')::interval
          GROUP BY 1 ORDER BY 1 DESC`,
        [String(days)],
      );
      const snapshots = await client.query(
        `SELECT a.slug, s.date::text AS d, s.total_mentions
           FROM daily_metric_snapshots s
           JOIN agencies a ON a.id = s.agency_id
          WHERE s.date > (NOW() AT TIME ZONE 'America/Puerto_Rico')::date - ($1 || ' days')::interval
          ORDER BY a.slug, s.date DESC`,
        [String(days)],
      );
      return { statusCode: 200, body: JSON.stringify({
        ast: ast.rows,
        utc: utc.rows,
        ingested: ingested.rows,
        suspicious_now_fallback: suspicious.rows,
        snapshots: snapshots.rows,
      }, null, 2) };
    }
    if (action === 'create-reports-schema') {
      // Crea report_configs + report_send_log si no existen, y siembra una
      // config por defecto para cada agencia activa.
      await client.query(`
        CREATE TABLE IF NOT EXISTS report_configs (
          agency_id UUID PRIMARY KEY REFERENCES agencies(id) ON DELETE CASCADE,
          is_active BOOLEAN NOT NULL DEFAULT true,
          send_hour_local INTEGER NOT NULL DEFAULT 16,
          timezone VARCHAR(64) NOT NULL DEFAULT 'America/Bogota',
          template_key VARCHAR(64) NOT NULL DEFAULT 'weekly-sentiment-summary',
          recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
          from_email VARCHAR(255) NOT NULL DEFAULT 'agutierrez@populicom.com',
          from_name VARCHAR(255) NOT NULL DEFAULT 'Populicom Radar',
          updated_by UUID REFERENCES users(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_report_configs_active ON report_configs(is_active);`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS report_send_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
          sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          recipients JSONB NOT NULL,
          from_email VARCHAR(255) NOT NULL,
          template_key VARCHAR(64) NOT NULL,
          trigger VARCHAR(32) NOT NULL,
          status VARCHAR(32) NOT NULL,
          message_id VARCHAR(255),
          error TEXT,
          stats JSONB,
          triggered_by UUID REFERENCES users(id)
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_report_send_log_agency_id ON report_send_log(agency_id);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_report_send_log_sent_at ON report_send_log(sent_at);`);

      // Seed: para DDEC, activar config con el destinatario y hora 16:00.
      // Para otras agencias existentes, crear fila INACTIVA por defecto.
      const seed = await client.query(`
        INSERT INTO report_configs (agency_id, is_active, send_hour_local, timezone, recipients, from_email, from_name)
        SELECT id,
               CASE WHEN slug = 'ddecpr' THEN true ELSE false END,
               16,
               'America/Bogota',
               CASE WHEN slug = 'ddecpr' THEN '["agutierrez@populicom.com"]'::jsonb ELSE '[]'::jsonb END,
               'agutierrez@populicom.com',
               'Populicom Radar'
        FROM agencies
        WHERE is_active = true
        ON CONFLICT (agency_id) DO NOTHING
        RETURNING agency_id, is_active, recipients
      `);

      return { statusCode: 200, body: JSON.stringify({ seeded: seed.rowCount, rows: seed.rows }) };
    }
    if (action === 'reset-snapshots') {
      // Wipe daily_metric_snapshots so the metrics-calculator backfill rebuilds
      // them with the corrected AST-based date bucketing. Does NOT touch mentions.
      const del = await client.query(`DELETE FROM daily_metric_snapshots RETURNING id`);
      return { statusCode: 200, body: JSON.stringify({ deleted: del.rowCount }) };
    }
    if (action === 'add-briefing-modes') {
      // Idempotente: añade la columna `mode` a agency_briefings y un índice
      // por (agency_id, mode, generated_at DESC) para soportar los 3 modos
      // del Resumen ejecutivo del Scorecard: signal / emerging / crisis.
      // Filas históricas heredan el default 'signal'.
      const stmts = [
        `ALTER TABLE agency_briefings ADD COLUMN IF NOT EXISTS mode VARCHAR(10) NOT NULL DEFAULT 'signal'`,
        `CREATE INDEX IF NOT EXISTS idx_agency_briefings_mode ON agency_briefings (agency_id, mode, generated_at DESC)`,
      ];
      const applied: string[] = [];
      for (const s of stmts) { await client.query(s); applied.push(s); }
      const cols = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'agency_briefings' ORDER BY column_name`,
      );
      return { statusCode: 200, body: JSON.stringify({ applied, columns: cols.rows.map((r: any) => r.column_name) }, null, 2) };
    }
    if (action === 'add-formula-columns') {
      // Idempotente: añade columnas para Polarization Index y los subcomponentes
      // del nuevo Crisis Risk (severity/velocity/relevance/confidence) que sirven
      // como drilldown auditable. Crisis Risk Score y Brand Health Index ahora
      // usan fórmulas nuevas; los valores se regeneran en backfill (mismas
      // columnas, fórmulas distintas).
      const stmts = [
        `ALTER TABLE daily_metric_snapshots ADD COLUMN IF NOT EXISTS polarization_index DOUBLE PRECISION`,
        `ALTER TABLE daily_metric_snapshots ADD COLUMN IF NOT EXISTS crisis_severity DOUBLE PRECISION`,
        `ALTER TABLE daily_metric_snapshots ADD COLUMN IF NOT EXISTS crisis_velocity DOUBLE PRECISION`,
        `ALTER TABLE daily_metric_snapshots ADD COLUMN IF NOT EXISTS crisis_relevance DOUBLE PRECISION`,
        `ALTER TABLE daily_metric_snapshots ADD COLUMN IF NOT EXISTS crisis_confidence DOUBLE PRECISION`,
      ];
      const applied: string[] = [];
      for (const s of stmts) { await client.query(s); applied.push(s); }
      const cols = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'daily_metric_snapshots' ORDER BY column_name`,
      );
      return { statusCode: 200, body: JSON.stringify({ applied, columns: cols.rows.map((r: any) => r.column_name) }, null, 2) };
    }

    if (action === 'add-embeddings-column') {
      // Migración 0004: pgvector + columna embedding + índice ivfflat.
      // Idempotente — IF NOT EXISTS en todo.
      const stmts = [
        `CREATE EXTENSION IF NOT EXISTS vector`,
        `ALTER TABLE mentions ADD COLUMN IF NOT EXISTS embedding vector(1024)`,
        `ALTER TABLE mentions ADD COLUMN IF NOT EXISTS embedded_at timestamp with time zone`,
        `CREATE INDEX IF NOT EXISTS idx_mentions_embedding ON mentions USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`,
      ];
      const applied: string[] = [];
      for (const s of stmts) { await client.query(s); applied.push(s); }
      const cols = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'mentions' AND column_name IN ('embedding','embedded_at')`,
      );
      const counts = await client.query(
        `SELECT COUNT(*)::int AS total, COUNT(embedding)::int AS with_embedding FROM mentions`,
      );
      return {
        statusCode: 200,
        body: JSON.stringify({ applied, columns: cols.rows.map((r: any) => r.column_name), counts: counts.rows[0] }, null, 2),
      };
    }

    if (action === 'create-narratives-schema') {
      // Crea las tablas del feature "narrativas": narratives, narrative_mentions,
      // narrative_edges, narrative_candidates. Requiere pgvector ya activo (lo
      // garantiza add-embeddings-column, pero también lo aseguramos aquí).
      // Idempotente — IF NOT EXISTS en todo.
      const stmts = [
        `CREATE EXTENSION IF NOT EXISTS vector`,

        // Tabla principal de narrativas
        `CREATE TABLE IF NOT EXISTS narratives (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
          name VARCHAR(120) NOT NULL,
          slug VARCHAR(140) NOT NULL,
          summary TEXT,
          keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
          centroid vector(1024),
          centroid_at_naming vector(1024),
          status VARCHAR(16) NOT NULL DEFAULT 'emerging'
            CHECK (status IN ('emerging','active','peaking','declining','dormant','revived')),
          first_mention_id UUID REFERENCES mentions(id) ON DELETE SET NULL,
          initiator_first JSONB,
          initiator_influencer JSONB,
          mention_count INTEGER NOT NULL DEFAULT 0,
          total_engagement BIGINT NOT NULL DEFAULT 0,
          total_reach BIGINT NOT NULL DEFAULT 0,
          velocity_24h DOUBLE PRECISION NOT NULL DEFAULT 0,
          engagement_velocity_24h DOUBLE PRECISION NOT NULL DEFAULT 0,
          drift_score DOUBLE PRECISION NOT NULL DEFAULT 0,
          born_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_mention_at TIMESTAMPTZ,
          peaked_at TIMESTAMPTZ,
          last_renamed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_narratives_agency_slug UNIQUE (agency_id, slug)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_narratives_agency_status
          ON narratives (agency_id, status)`,
        `CREATE INDEX IF NOT EXISTS idx_narratives_last_mention
          ON narratives (agency_id, last_mention_at DESC)`,
        // IVFFlat para centroide (consistente con mentions.embedding). Con
        // ~150 narrativas activas por agencia, lists=10 es suficiente.
        `CREATE INDEX IF NOT EXISTS idx_narratives_centroid
          ON narratives USING ivfflat (centroid vector_cosine_ops) WITH (lists = 10)`,

        // Asignación mention → narrative
        `CREATE TABLE IF NOT EXISTS narrative_mentions (
          narrative_id UUID NOT NULL REFERENCES narratives(id) ON DELETE CASCADE,
          mention_id UUID NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
          similarity DOUBLE PRECISION NOT NULL,
          is_primary BOOLEAN NOT NULL DEFAULT false,
          assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (narrative_id, mention_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_narrative_mentions_mention
          ON narrative_mentions (mention_id)`,
        `CREATE INDEX IF NOT EXISTS idx_narrative_mentions_primary
          ON narrative_mentions (mention_id) WHERE is_primary = true`,

        // Edges entre narrativas (undirected: source < target en orden UUID)
        `CREATE TABLE IF NOT EXISTS narrative_edges (
          agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
          source_narrative_id UUID NOT NULL REFERENCES narratives(id) ON DELETE CASCADE,
          target_narrative_id UUID NOT NULL REFERENCES narratives(id) ON DELETE CASCADE,
          edge_type VARCHAR(24) NOT NULL
            CHECK (edge_type IN ('co_occurrence','author_overlap','semantic')),
          strength DOUBLE PRECISION NOT NULL,
          computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (source_narrative_id, target_narrative_id, edge_type),
          CONSTRAINT chk_narrative_edges_order CHECK (source_narrative_id < target_narrative_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_narrative_edges_agency
          ON narrative_edges (agency_id, edge_type)`,

        // Pool de candidatos
        `CREATE TABLE IF NOT EXISTS narrative_candidates (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
          mention_id UUID NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
          embedding vector(1024) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_narrative_candidates_mention UNIQUE (mention_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_narrative_candidates_agency_created
          ON narrative_candidates (agency_id, created_at)`,
      ];
      const applied: string[] = [];
      for (const s of stmts) {
        await client.query(s);
        applied.push(s.replace(/\s+/g, ' ').slice(0, 80) + '…');
      }
      const tables = await client.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('narratives','narrative_mentions','narrative_edges','narrative_candidates')
          ORDER BY table_name`,
      );
      return {
        statusCode: 200,
        body: JSON.stringify({
          applied: applied.length,
          tables: tables.rows.map((r: any) => r.table_name),
        }, null, 2),
      };
    }

    if (action === 'cleanup-narrative-duplicates') {
      // Limpia duplicados de is_primary=true en narrative_mentions causados por
      // un bug de concurrencia en eco-narrative-cluster (corregido con
      // reservedConcurrentExecutions=1 después del 2026-05-25). Mantiene la
      // asignación cronológicamente más antigua como primary, las demás las
      // demota a is_primary=false. Idempotente — repetir es no-op.
      const dupBefore = await client.query(
        `SELECT COUNT(*)::int AS demote_count FROM narrative_mentions nm
          WHERE nm.is_primary = true
            AND EXISTS (
              SELECT 1 FROM narrative_mentions nm2
               WHERE nm2.mention_id = nm.mention_id
                 AND nm2.is_primary = true
                 AND nm2.assigned_at < nm.assigned_at
            )`,
      );
      const upd = await client.query(
        `UPDATE narrative_mentions nm
            SET is_primary = false
          WHERE nm.is_primary = true
            AND EXISTS (
              SELECT 1 FROM narrative_mentions nm2
               WHERE nm2.mention_id = nm.mention_id
                 AND nm2.is_primary = true
                 AND nm2.assigned_at < nm.assigned_at
            )`,
      );
      const dupAfter = await client.query(
        `SELECT COUNT(*)::int AS remaining FROM (
           SELECT mention_id FROM narrative_mentions WHERE is_primary = true
           GROUP BY mention_id HAVING COUNT(*) > 1
         ) t`,
      );
      return {
        statusCode: 200,
        body: JSON.stringify(
          {
            demoted: upd.rowCount,
            expected: dupBefore.rows[0].demote_count,
            duplicate_mentions_remaining: dupAfter.rows[0].remaining,
          },
          null,
          2,
        ),
      };
    }

    if (action === 'backfill-embeddings') {
      // Recorre menciones con embedding IS NULL (de la agencia indicada o
      // todas) y las puebla en lotes con concurrencia 5 contra Bedrock. Es
      // idempotente y se puede invocar repetidamente — cada corrida procesa
      // hasta `limit` menciones (default 1000) y reporta cuánto queda.
      const wantLimit = Math.max(1, Math.min(5000, Number(event.limit ?? 1000)));
      const agencySlug = event.agencySlug ?? null;
      const params: unknown[] = [];
      let where = 'WHERE embedding IS NULL';
      if (agencySlug) {
        params.push(agencySlug);
        where += ` AND agency_id = (SELECT id FROM agencies WHERE slug = $${params.length})`;
      }
      params.push(wantLimit);
      const sel = await client.query(
        `SELECT id, title, snippet
           FROM mentions
           ${where}
           ORDER BY published_at DESC
           LIMIT $${params.length}`,
        params,
      );
      const rows = sel.rows as Array<{ id: string; title: string | null; snippet: string | null }>;
      console.log(`backfill-embeddings: ${rows.length} pending in this batch`);

      const concurrency = 5;
      let succeeded = 0;
      let skipped = 0;
      let failed = 0;
      for (let i = 0; i < rows.length; i += concurrency) {
        const chunk = rows.slice(i, i + concurrency);
        const results = await Promise.allSettled(chunk.map(async (row) => {
          const input = buildEmbeddingInput(row.title, row.snippet);
          if (!input) { skipped += 1; return; }
          const vec = await embedText(input);
          if (!vec) { failed += 1; return; }
          await client.query(
            'UPDATE mentions SET embedding = $1::vector, embedded_at = NOW() WHERE id = $2',
            [toPgvectorLiteral(vec), row.id],
          );
          succeeded += 1;
        }));
        for (const r of results) {
          if (r.status === 'rejected') {
            failed += 1;
            console.warn('backfill-embeddings row failed:', r.reason);
          }
        }
      }

      const remaining = await client.query(
        agencySlug
          ? `SELECT COUNT(*)::int AS c FROM mentions
              WHERE embedding IS NULL AND agency_id = (SELECT id FROM agencies WHERE slug = $1)`
          : `SELECT COUNT(*)::int AS c FROM mentions WHERE embedding IS NULL`,
        agencySlug ? [agencySlug] : [],
      );
      return {
        statusCode: 200,
        body: JSON.stringify({
          processed: rows.length,
          succeeded,
          skipped,
          failed,
          remaining: remaining.rows[0].c,
          agencySlug,
        }, null, 2),
      };
    }

    if (action === 'seed-subtopics') {
      // Sembrar la tabla `subtopics` desde @eco/shared.TOPICS_BY_AGENCY.
      // Idempotente: ON CONFLICT (topic_id, slug) DO NOTHING.
      // Soporta filtrar a una agencia (agencySlug) o todas.
      const targetAgency = event.agencySlug ?? null;
      const agencyKeys = targetAgency
        ? [targetAgency]
        : Object.keys(TOPICS_BY_AGENCY);

      let inserted = 0;
      let skipped = 0;
      const perAgency: Record<string, { inserted: number; skipped: number }> = {};

      for (const slug of agencyKeys) {
        perAgency[slug] = { inserted: 0, skipped: 0 };
        const topicsForAgency = TOPICS_BY_AGENCY[slug];
        if (!topicsForAgency) continue;

        // Lookup agency id
        const agencyRow = await client.query(
          'SELECT id FROM agencies WHERE slug = $1',
          [slug],
        );
        if (agencyRow.rows.length === 0) {
          console.warn(`seed-subtopics: agency '${slug}' not found in DB`);
          continue;
        }
        const agencyId = agencyRow.rows[0].id;

        for (const topic of topicsForAgency) {
          if (!topic.subtopics.length) continue;
          // Lookup topic id
          const topicRow = await client.query(
            'SELECT id FROM topics WHERE agency_id = $1 AND slug = $2',
            [agencyId, topic.slug],
          );
          if (topicRow.rows.length === 0) {
            console.warn(`seed-subtopics: topic '${topic.slug}' missing for agency '${slug}'`);
            continue;
          }
          const topicId = topicRow.rows[0].id;
          for (const sub of topic.subtopics) {
            const ins = await client.query(
              `INSERT INTO subtopics (topic_id, name, slug, description, display_order, is_active)
               VALUES ($1, $2, $3, $4, $5, true)
               ON CONFLICT (topic_id, slug) DO NOTHING
               RETURNING id`,
              [topicId, sub.name, sub.slug, sub.description, sub.displayOrder],
            );
            if (ins.rows.length > 0) { inserted += 1; perAgency[slug].inserted += 1; }
            else { skipped += 1; perAgency[slug].skipped += 1; }
          }
        }
      }
      return {
        statusCode: 200,
        body: JSON.stringify({ inserted, skipped, perAgency }, null, 2),
      };
    }

    if (action === 'backfill-subtopics-init') {
      // Idempotente: añade `subtopic_attempts` a mention_topics si falta.
      // Sirve para evitar reprocesar filas que Bedrock no pudo clasificar.
      await client.query(`
        ALTER TABLE mention_topics
        ADD COLUMN IF NOT EXISTS subtopic_attempts SMALLINT NOT NULL DEFAULT 0
      `);
      return { statusCode: 200, body: JSON.stringify({ initialized: true }) };
    }

    if (action === 'backfill-subtopics') {
      // Backfill: para cada mention_topic con subtopic_id NULL, llama Bedrock
      // con un menú constrained-enum de subtopics del topic_id ya asignado y
      // actualiza subtopic_id. Procesa en lotes con concurrencia para acelerar.
      const wantLimit = Math.max(1, Math.min(5000, Number(event.limit ?? 1000)));
      const targetAgency = event.agencySlug ?? 'ddecpr';
      // Concurrency tunable via event payload. Bedrock Sonnet 4.6 (cross-region
      // inference) tolera 20-30 concurrent sin throttle en cuentas estándar.
      const concurrency = Math.max(1, Math.min(40, Number((event as { concurrency?: number }).concurrency ?? 8)));

      // Cargar el menú topic→subtopics desde @eco/shared para la agencia.
      const agencyTopics = TOPICS_BY_AGENCY[targetAgency];
      if (!agencyTopics) {
        return { statusCode: 400, body: JSON.stringify({ error: `Unknown agency: ${targetAgency}` }) };
      }
      const subtopicsByTopicSlug = new Map<string, { slug: string; name: string; description: string }[]>();
      for (const t of agencyTopics) subtopicsByTopicSlug.set(t.slug, t.subtopics);

      // Resolver agency_id
      const agencyRow = await client.query(
        'SELECT id FROM agencies WHERE slug = $1',
        [targetAgency],
      );
      if (agencyRow.rows.length === 0) {
        return { statusCode: 404, body: JSON.stringify({ error: `Agency not found: ${targetAgency}` }) };
      }
      const agencyId = agencyRow.rows[0].id;

      // Pull pending rows: mentions of this agency with at least one
      // mention_topic where subtopic_id IS NULL but the topic has subtopics.
      // Excluye filas ya intentadas N veces sin éxito (subtopic_attempts >= 3)
      // y ordena por menos intentos primero, luego random para distribuir carga
      // entre invocaciones paralelas.
      const maxAttempts = Math.max(1, Math.min(5, Number((event as { maxAttempts?: number }).maxAttempts ?? 3)));
      const sel = await client.query(
        `SELECT mt.mention_id, mt.topic_id, t.slug AS topic_slug,
                m.title, m.snippet, m.nlp_summary
           FROM mention_topics mt
           JOIN topics t ON t.id = mt.topic_id
           JOIN mentions m ON m.id = mt.mention_id
          WHERE m.agency_id = $1
            AND mt.subtopic_id IS NULL
            AND mt.subtopic_attempts < $3
            AND EXISTS (SELECT 1 FROM subtopics st WHERE st.topic_id = mt.topic_id)
          ORDER BY mt.subtopic_attempts ASC, random()
          LIMIT $2`,
        [agencyId, wantLimit, maxAttempts],
      );

      const rows = sel.rows as Array<{
        mention_id: string;
        topic_id: number;
        topic_slug: string;
        title: string | null;
        snippet: string | null;
        nlp_summary: string | null;
      }>;
      console.log(`backfill-subtopics: ${rows.length} pending rows`);

      // Cache subtopic_id by (topic_id, slug) — avoids per-row SELECT.
      const subtopicIdCache = new Map<string, number>();
      const stRows = await client.query(
        `SELECT st.id, st.slug, st.topic_id
           FROM subtopics st
           JOIN topics t ON t.id = st.topic_id
          WHERE t.agency_id = $1`,
        [agencyId],
      );
      for (const r of stRows.rows) {
        subtopicIdCache.set(`${r.topic_id}:${r.slug}`, r.id);
      }

      let succeeded = 0;
      let unmatched = 0;
      let failed = 0;

      for (let i = 0; i < rows.length; i += concurrency) {
        const chunk = rows.slice(i, i + concurrency);
        const results = await Promise.allSettled(chunk.map(async (row) => {
          const allowed = subtopicsByTopicSlug.get(row.topic_slug) ?? [];
          if (allowed.length === 0) return; // no subtopics for this topic, skip
          const slug = await classifySubtopicWithBedrock({
            title: row.title,
            snippet: row.snippet,
            summary: row.nlp_summary,
            topicSlug: row.topic_slug,
            allowed,
          });
          if (!slug) {
            // Marcar intento fallido para que el próximo barrido no la repita.
            await client.query(
              `UPDATE mention_topics SET subtopic_attempts = subtopic_attempts + 1
                WHERE mention_id = $1 AND topic_id = $2 AND subtopic_id IS NULL`,
              [row.mention_id, row.topic_id],
            );
            unmatched += 1;
            return;
          }
          const cached = subtopicIdCache.get(`${row.topic_id}:${slug}`);
          if (!cached) {
            await client.query(
              `UPDATE mention_topics SET subtopic_attempts = subtopic_attempts + 1
                WHERE mention_id = $1 AND topic_id = $2 AND subtopic_id IS NULL`,
              [row.mention_id, row.topic_id],
            );
            unmatched += 1;
            return;
          }
          await client.query(
            `UPDATE mention_topics SET subtopic_id = $1, subtopic_attempts = subtopic_attempts + 1
              WHERE mention_id = $2 AND topic_id = $3 AND subtopic_id IS NULL`,
            [cached, row.mention_id, row.topic_id],
          );
          succeeded += 1;
        }));
        for (const r of results) {
          if (r.status === 'rejected') {
            failed += 1;
            console.warn('backfill-subtopics row failed:', r.reason);
          }
        }
      }

      const remaining = await client.query(
        `SELECT COUNT(*)::int AS c
           FROM mention_topics mt
           JOIN mentions m ON m.id = mt.mention_id
          WHERE m.agency_id = $1
            AND mt.subtopic_id IS NULL
            AND mt.subtopic_attempts < $2
            AND EXISTS (SELECT 1 FROM subtopics st WHERE st.topic_id = mt.topic_id)`,
        [agencyId, maxAttempts],
      );
      const totallyExhausted = await client.query(
        `SELECT COUNT(*)::int AS c
           FROM mention_topics mt
           JOIN mentions m ON m.id = mt.mention_id
          WHERE m.agency_id = $1
            AND mt.subtopic_id IS NULL
            AND mt.subtopic_attempts >= $2`,
        [agencyId, maxAttempts],
      );
      return {
        statusCode: 200,
        body: JSON.stringify({
          processed: rows.length,
          succeeded,
          unmatched,
          failed,
          remaining: remaining.rows[0].c,
          exhausted: totallyExhausted.rows[0].c,
          agencySlug: targetAgency,
        }, null, 2),
      };
    }

    if (action === 'create-manual-import-schema') {
      // Aplica las migrations 0006 (mention_imports) y 0007 (mentions manual
      // support) idempotentemente. Drizzle migrations no corren automáticas
      // en este repo — el patrón es action hardcoded como create-reports-schema.

      // --- 0006: mention_imports table ---
      await client.query(`
        CREATE TABLE IF NOT EXISTS mention_imports (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
          uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          source_type VARCHAR(20) NOT NULL,
          s3_key TEXT,
          source_url TEXT,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          total_rows INTEGER,
          rows_new INTEGER DEFAULT 0,
          rows_duplicate INTEGER DEFAULT 0,
          rows_update INTEGER DEFAULT 0,
          rows_error INTEGER DEFAULT 0,
          rows_processed INTEGER DEFAULT 0,
          preview_json JSONB,
          errors_json JSONB,
          error_message TEXT,
          default_timezone VARCHAR(50) DEFAULT 'America/Puerto_Rico',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          committed_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_mention_imports_agency_id ON mention_imports(agency_id);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_mention_imports_status ON mention_imports(status);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_mention_imports_created_at ON mention_imports(created_at DESC);`);

      // --- 0007: mentions manual support ---
      await client.query(`ALTER TABLE mentions ALTER COLUMN bw_resource_id DROP NOT NULL;`);
      await client.query(`ALTER TABLE mentions ALTER COLUMN bw_query_id DROP NOT NULL;`);

      // Drop UNIQUE bw_resource_id (Drizzle named it mentions_bw_resource_id_unique)
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'mentions_bw_resource_id_unique'
              AND table_name = 'mentions'
          ) THEN
            ALTER TABLE mentions DROP CONSTRAINT mentions_bw_resource_id_unique;
          END IF;
        END $$;
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS mentions_bw_resource_id_partial_unique
          ON mentions (bw_resource_id) WHERE bw_resource_id IS NOT NULL;
      `);

      await client.query(`ALTER TABLE mentions ADD COLUMN IF NOT EXISTS url_canonical VARCHAR(1000);`);
      await client.query(`ALTER TABLE mentions ADD COLUMN IF NOT EXISTS ingestion_source VARCHAR(20) NOT NULL DEFAULT 'brandwatch';`);
      await client.query(`ALTER TABLE mentions ADD COLUMN IF NOT EXISTS source_import_id UUID;`);

      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'mentions_source_import_id_fkey'
              AND table_name = 'mentions'
          ) THEN
            ALTER TABLE mentions
              ADD CONSTRAINT mentions_source_import_id_fkey
              FOREIGN KEY (source_import_id) REFERENCES mention_imports(id)
              ON DELETE SET NULL;
          END IF;
        END $$;
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_url_canonical ON mentions(url_canonical);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_source_import_id ON mentions(source_import_id);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_ingestion_source ON mentions(ingestion_source);`);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS mentions_url_canonical_agency_unique
          ON mentions (agency_id, url_canonical) WHERE url_canonical IS NOT NULL;
      `);

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'manual-import schema ready',
          nextStep: 'Run action=backfill-url-canonical en loop hasta remaining=0',
        }),
      };
    }
    if (action === 'backfill-url-canonical') {
      // Backfill `mentions.url_canonical` para registros que aún no la tienen.
      // Necesario para que el dedup (agency_id, url_canonical) cubra menciones
      // de Brandwatch antiguas — sin esto, un Excel que incluye una URL ya
      // ingerida por Brandwatch se marcaría como `new` en vez de `duplicate`.
      //
      // Idempotente: cada invocación procesa hasta `batchSize` filas con
      // url_canonical IS NULL y url IS NOT NULL, retorna `remaining`. Loop
      // manual desde CLI hasta remaining=0.
      const batchSize = Math.max(100, Math.min(20000, Number(event.batchSize ?? 5000)));
      const sel = await client.query(
        `SELECT id, url FROM mentions
           WHERE url_canonical IS NULL AND url IS NOT NULL
           LIMIT $1`,
        [batchSize],
      );
      const rows = sel.rows as Array<{ id: string; url: string }>;
      console.log(`backfill-url-canonical: ${rows.length} rows in this batch`);

      let updated = 0;
      let unparseable = 0;
      // Bulk update con UPDATE … FROM (VALUES …). Más rápido que un UPDATE
      // por fila cuando son miles. Si el canonicalizer devuelve null (URL
      // inválida), persistimos un sentinel único por row (`invalid:<id>`)
      // para que (a) el predicado `WHERE url_canonical IS NULL` no la vuelva
      // a tomar y (b) el unique parcial `WHERE url_canonical IS NOT NULL`
      // no colisione (cada sentinel es único por id).
      if (rows.length > 0) {
        const values: string[] = [];
        const params: unknown[] = [];
        let i = 1;
        for (const row of rows) {
          const c = canonicalizeUrl(row.url);
          if (c) {
            values.push(`($${i}::uuid, $${i + 1}::varchar)`);
            params.push(row.id, c);
            updated += 1;
          } else {
            values.push(`($${i}::uuid, $${i + 1}::varchar)`);
            params.push(row.id, `invalid:${row.id}`);
            unparseable += 1;
          }
          i += 2;
        }
        await client.query(
          `UPDATE mentions m
             SET url_canonical = v.canonical
             FROM (VALUES ${values.join(', ')}) AS v(id, canonical)
             WHERE m.id = v.id`,
          params,
        );
      }

      const rem = await client.query(
        `SELECT COUNT(*)::int AS c FROM mentions
           WHERE url_canonical IS NULL AND url IS NOT NULL`,
      );
      return {
        statusCode: 200,
        body: JSON.stringify({
          processed: rows.length,
          updated,
          unparseable,
          remaining: rem.rows[0].c,
        }, null, 2),
      };
    }

    return { statusCode: 200, body: `Action '${action}' completed successfully` };
  } finally {
    await client.end();
  }
};

async function classifySubtopicWithBedrock(args: {
  title: string | null;
  snippet: string | null;
  summary: string | null;
  topicSlug: string;
  allowed: { slug: string; name: string; description: string }[];
}): Promise<string | null> {
  const { title, snippet, summary, topicSlug, allowed } = args;
  const menu = allowed.map((s) => `- ${s.slug}: ${s.description}`).join('\n');
  const prompt = `Eres un clasificador de subtopics para social listening en Puerto Rico. Te doy UNA mención cuyo topic padre YA está asignado como "${topicSlug}".

MENCIÓN:
Título: ${title ?? '(sin título)'}
Texto: ${(snippet ?? '').slice(0, 400)}
Resumen IA: ${summary ?? '(sin resumen)'}

SUBTOPICS PERMITIDOS bajo "${topicSlug}":
${menu}

INSTRUCCIONES:
- Elige el subtopic que MEJOR describe el contenido específico de la mención.
- Responde SOLO con JSON: {"subtopic_slug": "<slug>", "confidence": 0.0-1.0}
- Si NINGÚN subtopic encaja con confianza ≥0.4, responde: {"subtopic_slug": null, "confidence": 0.0}
- No expliques. No uses markdown. Solo el JSON.`;

  try {
    const response = await bedrock.send(new InvokeModelCommand({
      modelId: SUBTOPIC_BACKFILL_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.0,
      }),
    }));
    const body = JSON.parse(new TextDecoder().decode(response.body));
    const text = body?.content?.[0]?.text ?? '';
    // Strip markdown fences if Haiku adds them despite instructions
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    const slug = parsed?.subtopic_slug;
    if (!slug || typeof slug !== 'string') return null;
    // Verify the slug is in the allowed list (defense against hallucination)
    if (!allowed.some((s) => s.slug === slug)) return null;
    return slug;
  } catch (err) {
    console.warn(`classifySubtopicWithBedrock failed for topic=${topicSlug}: ${(err as Error).message}`);
    return null;
  }
}

async function runMigrations(client: any): Promise<void> {
  console.log('Running schema migrations...');

  // Create enums
  await client.query(`
    DO $$ BEGIN
      CREATE TYPE user_role AS ENUM ('admin', 'analyst', 'viewer');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  // agencies
  await client.query(`
    CREATE TABLE IF NOT EXISTS agencies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) NOT NULL UNIQUE,
      brandwatch_project_id BIGINT,
      brandwatch_query_ids JSONB,
      logo_url VARCHAR(500),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
  `);

  // users
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cognito_sub VARCHAR(255) NOT NULL UNIQUE,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      role user_role NOT NULL,
      agency_id UUID NOT NULL REFERENCES agencies(id),
      is_active BOOLEAN NOT NULL DEFAULT true,
      last_login TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // topics
  await client.query(`
    CREATE TABLE IF NOT EXISTS topics (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true
    );
  `);

  // subtopics
  await client.query(`
    CREATE TABLE IF NOT EXISTS subtopics (
      id SERIAL PRIMARY KEY,
      topic_id INTEGER NOT NULL REFERENCES topics(id),
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(100) NOT NULL,
      description TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      UNIQUE(topic_id, slug)
    );
  `);

  // municipalities
  await client.query(`
    CREATE TABLE IF NOT EXISTS municipalities (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(100) NOT NULL UNIQUE,
      region VARCHAR(50) NOT NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      population INTEGER NOT NULL DEFAULT 0
    );
  `);

  // mentions (core table)
  await client.query(`
    CREATE TABLE IF NOT EXISTS mentions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agency_id UUID NOT NULL REFERENCES agencies(id),
      bw_resource_id VARCHAR(255) NOT NULL UNIQUE,
      bw_guid VARCHAR(255),
      bw_query_id BIGINT NOT NULL,
      bw_query_name VARCHAR(255),
      title TEXT,
      snippet TEXT,
      url TEXT,
      original_url TEXT,
      author VARCHAR(255),
      author_fullname VARCHAR(255),
      author_gender VARCHAR(20),
      author_avatar_url TEXT,
      domain VARCHAR(255),
      page_type VARCHAR(50) NOT NULL,
      content_source VARCHAR(50),
      content_source_name VARCHAR(100),
      pub_type VARCHAR(50),
      subtype VARCHAR(50),
      likes INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      engagement_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      impact DOUBLE PRECISION NOT NULL DEFAULT 0,
      reach_estimate INTEGER NOT NULL DEFAULT 0,
      potential_audience INTEGER NOT NULL DEFAULT 0,
      monthly_visitors BIGINT NOT NULL DEFAULT 0,
      bw_country VARCHAR(100),
      bw_country_code VARCHAR(10),
      bw_region VARCHAR(100),
      bw_city VARCHAR(100),
      bw_city_code VARCHAR(100),
      bw_sentiment VARCHAR(20),
      nlp_sentiment VARCHAR(20),
      nlp_emotions JSONB,
      nlp_pertinence VARCHAR(10),
      nlp_summary TEXT,
      text_hash VARCHAR(64),
      is_duplicate BOOLEAN NOT NULL DEFAULT false,
      duplicate_of_id UUID,
      media_urls JSONB,
      has_image BOOLEAN NOT NULL DEFAULT false,
      has_video BOOLEAN NOT NULL DEFAULT false,
      published_at TIMESTAMPTZ NOT NULL,
      ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      language VARCHAR(10) NOT NULL DEFAULT 'es'
    );
  `);

  // mention indexes
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_agency_id ON mentions(agency_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_published_at ON mentions(published_at DESC);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_nlp_sentiment ON mentions(nlp_sentiment);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_page_type ON mentions(page_type);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_text_hash ON mentions(text_hash);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_domain ON mentions(domain);`);

  // mention_topics junction
  await client.query(`
    CREATE TABLE IF NOT EXISTS mention_topics (
      mention_id UUID NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
      topic_id INTEGER NOT NULL REFERENCES topics(id),
      subtopic_id INTEGER REFERENCES subtopics(id),
      confidence DOUBLE PRECISION NOT NULL,
      PRIMARY KEY (mention_id, topic_id)
    );
  `);

  // mention_municipalities junction
  await client.query(`
    CREATE TABLE IF NOT EXISTS mention_municipalities (
      mention_id UUID NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
      municipality_id INTEGER NOT NULL REFERENCES municipalities(id),
      source VARCHAR(20) NOT NULL,
      PRIMARY KEY (mention_id, municipality_id)
    );
  `);

  // alert_rules
  await client.query(`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agency_id UUID NOT NULL REFERENCES agencies(id),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      config JSONB NOT NULL,
      notify_emails JSONB NOT NULL,
      created_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_alert_rules_agency_id ON alert_rules(agency_id);`);

  // alert_history
  await client.query(`
    CREATE TABLE IF NOT EXISTS alert_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      alert_rule_id UUID NOT NULL REFERENCES alert_rules(id),
      agency_id UUID NOT NULL REFERENCES agencies(id),
      triggered_at TIMESTAMPTZ NOT NULL,
      mention_ids JSONB,
      details JSONB,
      notification_sent BOOLEAN NOT NULL DEFAULT false,
      sent_at TIMESTAMPTZ
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_alert_history_agency_id ON alert_history(agency_id);`);

  // ingestion_cursors
  await client.query(`
    CREATE TABLE IF NOT EXISTS ingestion_cursors (
      query_id BIGINT PRIMARY KEY,
      last_mention_date TIMESTAMPTZ NOT NULL,
      last_run_at TIMESTAMPTZ NOT NULL,
      mentions_fetched INTEGER NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'idle'
    );
  `);

  // daily_metric_snapshots
  await client.query(`
    CREATE TABLE IF NOT EXISTS daily_metric_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agency_id UUID NOT NULL REFERENCES agencies(id),
      date DATE NOT NULL,
      total_mentions INTEGER NOT NULL DEFAULT 0,
      positive_count INTEGER NOT NULL DEFAULT 0,
      neutral_count INTEGER NOT NULL DEFAULT 0,
      negative_count INTEGER NOT NULL DEFAULT 0,
      high_pertinence_count INTEGER NOT NULL DEFAULT 0,
      total_likes INTEGER NOT NULL DEFAULT 0,
      total_comments INTEGER NOT NULL DEFAULT 0,
      total_shares INTEGER NOT NULL DEFAULT 0,
      total_reach BIGINT NOT NULL DEFAULT 0,
      total_impact DOUBLE PRECISION NOT NULL DEFAULT 0,
      total_engagement_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      nss DOUBLE PRECISION,
      brand_health_index DOUBLE PRECISION,
      reputation_momentum DOUBLE PRECISION,
      engagement_rate DOUBLE PRECISION,
      amplification_rate DOUBLE PRECISION,
      engagement_velocity DOUBLE PRECISION,
      crisis_risk_score DOUBLE PRECISION,
      volume_anomaly_zscore DOUBLE PRECISION,
      nss_7d DOUBLE PRECISION,
      nss_30d DOUBLE PRECISION,
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(agency_id, date)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_daily_metrics_agency_crisis ON daily_metric_snapshots(agency_id, crisis_risk_score);`);

  // Multi-tenant: add agency_id to topics
  await client.query(`ALTER TABLE topics ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id);`);

  // Backfill existing topics with AAA agency_id
  await client.query(`UPDATE topics SET agency_id = (SELECT id FROM agencies WHERE slug = 'aaa') WHERE agency_id IS NULL;`);

  // Make agency_id NOT NULL after backfill
  await client.query(`ALTER TABLE topics ALTER COLUMN agency_id SET NOT NULL;`);

  // Drop old unique constraint on slug, replace with (agency_id, slug)
  await client.query(`ALTER TABLE topics DROP CONSTRAINT IF EXISTS topics_slug_key;`);
  await client.query(`DROP INDEX IF EXISTS topics_slug_key;`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_topic_agency_slug ON topics(agency_id, slug);`);

  console.log('Schema migrations completed successfully');
}

async function runSeed(client: any): Promise<void> {
  console.log('Running seed data...');

  // Seed AAA agency
  await client.query(`
    INSERT INTO agencies (name, slug, brandwatch_project_id, brandwatch_query_ids)
    VALUES ('Autoridad de Acueductos y Alcantarillados', 'aaa', 1998403803, '[2003911540]'::jsonb)
    ON CONFLICT (slug) DO NOTHING;
  `);
  console.log('  -> AAA agency seeded');

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
         ON CONFLICT (agency_id, slug) DO NOTHING`,
        [ddecprAgencyId, name, slug, description, order],
      );
    }
    console.log(`  -> ${ddecprTopics.length} DDECPR topics seeded`);
  }

  // Seed municipalities (all 78)
  const municipalities = [
    ['san-juan','San Juan','Metro',18.4655,-66.1057,318441],['bayamon','Bayamón','Metro',18.3985,-66.1553,170110],['carolina','Carolina','Metro',18.3811,-65.9574,146984],['guaynabo','Guaynabo','Metro',18.3566,-66.1108,89780],['trujillo-alto','Trujillo Alto','Metro',18.3547,-66.0074,67740],['catano','Cataño','Metro',18.4414,-66.1181,24888],['toa-baja','Toa Baja','Metro',18.4442,-66.2546,75204],['toa-alta','Toa Alta','Metro',18.3882,-66.2484,68025],['arecibo','Arecibo','Norte',18.4725,-66.7157,87242],['manati','Manatí','Norte',18.4319,-66.4835,38692],['vega-baja','Vega Baja','Norte',18.4443,-66.3907,54414],['vega-alta','Vega Alta','Norte',18.4123,-66.3312,37910],['dorado','Dorado','Norte',18.4589,-66.2678,37688],['barceloneta','Barceloneta','Norte',18.4512,-66.5385,22322],['camuy','Camuy','Norte',18.4839,-66.8449,30466],['hatillo','Hatillo','Norte',18.4866,-66.7883,37945],['quebradillas','Quebradillas','Norte',18.4729,-66.9386,23423],['isabela','Isabela','Norte',18.5000,-67.0244,42420],['loiza','Loíza','Norte',18.4313,-65.8783,24553],['rio-grande','Río Grande','Norte',18.3802,-65.8314,48025],['luquillo','Luquillo','Norte',18.3726,-65.7165,18547],['caguas','Caguas','Este',18.2388,-66.0486,127244],['humacao','Humacao','Este',18.1497,-65.8198,50896],['fajardo','Fajardo','Este',18.3258,-65.6525,32240],['juncos','Juncos','Este',18.2276,-65.9211,37165],['las-piedras','Las Piedras','Este',18.1831,-65.8666,36110],['gurabo','Gurabo','Este',18.2542,-65.9730,45369],['san-lorenzo','San Lorenzo','Este',18.1895,-65.9607,37873],['naguabo','Naguabo','Este',18.2115,-65.7347,25718],['yabucoa','Yabucoa','Este',18.0507,-65.8792,32282],['ceiba','Ceiba','Este',18.2632,-65.6487,11853],['culebra','Culebra','Este',18.3103,-65.3028,1714],['vieques','Vieques','Este',18.1263,-65.4401,8249],['aguas-buenas','Aguas Buenas','Este',18.2570,-66.1021,25314],['cidra','Cidra','Este',18.1759,-66.1612,38307],['cayey','Cayey','Este',18.1119,-66.1660,44015],['maunabo','Maunabo','Este',18.0072,-65.8992,10679],['patillas','Patillas','Este',18.0038,-65.9966,16468],['mayaguez','Mayagüez','Oeste',18.2013,-67.1397,71083],['aguadilla','Aguadilla','Oeste',18.4274,-67.1541,54166],['cabo-rojo','Cabo Rojo','Oeste',18.0866,-67.1457,46024],['san-german','San Germán','Oeste',18.0831,-67.0359,30227],['anasco','Añasco','Oeste',18.2828,-67.1395,26322],['rincon','Rincón','Oeste',18.3402,-67.2499,14293],['aguada','Aguada','Oeste',18.3793,-67.1876,37516],['moca','Moca','Oeste',18.3949,-67.1131,36019],['san-sebastian','San Sebastián','Oeste',18.3367,-66.9904,36249],['las-marias','Las Marías','Oeste',18.2518,-66.9910,8606],['hormigueros','Hormigueros','Oeste',18.1395,-67.1270,15806],['lajas','Lajas','Oeste',18.0498,-67.0591,23315],['sabana-grande','Sabana Grande','Oeste',18.0786,-66.9608,22284],['maricao','Maricao','Oeste',18.1808,-66.9800,5318],['ponce','Ponce','Sur',18.0111,-66.6141,132502],['guayama','Guayama','Sur',17.9843,-66.1117,37685],['juana-diaz','Juana Díaz','Sur',18.0535,-66.5065,44790],['salinas','Salinas','Sur',18.0021,-66.2576,27518],['santa-isabel','Santa Isabel','Sur',17.9661,-66.4049,21384],['coamo','Coamo','Sur',18.0799,-66.3580,38336],['guanica','Guánica','Sur',17.9715,-66.9074,15228],['yauco','Yauco','Sur',18.0352,-66.8499,35025],['guayanilla','Guayanilla','Sur',18.0193,-66.7917,17623],['penuelas','Peñuelas','Sur',18.0563,-66.7260,19267],['arroyo','Arroyo','Sur',17.9665,-66.0613,17111],['villalba','Villalba','Sur',18.1277,-66.4924,22093],['utuado','Utuado','Central',18.2655,-66.7008,28186],['lares','Lares','Central',18.2957,-66.8780,25647],['adjuntas','Adjuntas','Central',18.1627,-66.7224,17024],['jayuya','Jayuya','Central',18.2183,-66.5916,14536],['ciales','Ciales','Central',18.3368,-66.4689,16374],['morovis','Morovis','Central',18.3253,-66.4075,29612],['orocovis','Orocovis','Central',18.2269,-66.3912,20791],['barranquitas','Barranquitas','Central',18.1863,-66.3063,27725],['aibonito','Aibonito','Central',18.1400,-66.2661,23457],['comerio','Comerío','Central',18.2189,-66.2256,18648],['naranjito','Naranjito','Central',18.3009,-66.2450,27914],['corozal','Corozal','Central',18.3417,-66.3168,33478],['florida','Florida','Central',18.3626,-66.5717,11254],
  ];

  for (const [slug, name, region, lat, lon, pop] of municipalities) {
    await client.query(`
      INSERT INTO municipalities (name, slug, region, latitude, longitude, population)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (slug) DO NOTHING
    `, [name, slug, region, lat, lon, pop]);
  }
  console.log(`  -> ${municipalities.length} municipalities seeded`);

  // Seed topics and subtopics
  const topicsData: Array<[string, string, string, number, Array<[string, string, string, number]>]> = [
    ['averias-interrupciones', 'Averías / Interrupciones', 'Fallas técnicas que interrumpen el servicio', 1, [
      ['bombeo-represas', 'Bombeo / Represas', 'Fallas en bombas y represas', 1],
      ['plantas-filtracion', 'Plantas de Filtración', 'Plantas fuera de servicio', 2],
      ['tuberias-fugas', 'Tuberías / Fugas', 'Roturas y fugas en la red', 3],
      ['apagones-infraestructura', 'Apagones en Infraestructura', 'Fallas eléctricas en plantas/bombas', 4],
    ]],
    ['calidad-agua', 'Calidad del Agua', 'Problemas de calidad del agua potable', 2, [
      ['turbidez', 'Turbidez', 'Alta turbidez en fuentes', 1],
      ['contaminacion', 'Contaminación', 'Contaminación química o biológica', 2],
      ['presion-baja', 'Presión Baja', 'Baja presión en sectores', 3],
    ]],
    ['conflictos-inter-agencia', 'Conflictos Inter-Agencia', 'Disputas entre AAA y otras entidades', 3, [
      ['aaa-vs-luma', 'AAA vs LUMA', 'Conflictos con LUMA Energy', 1],
      ['aaa-vs-municipios', 'AAA vs Municipios', 'Disputas con gobiernos municipales', 2],
      ['aaa-vs-legislatura', 'AAA vs Legislatura', 'Cuestionamientos legislativos', 3],
    ]],
    ['infraestructura', 'Infraestructura', 'Inversiones y mejoras a infraestructura', 4, [
      ['obras-nuevas', 'Obras Nuevas', 'Nueva infraestructura', 1],
      ['renovacion', 'Renovación', 'Renovación de equipos y tuberías', 2],
      ['fondos-federales', 'Fondos FEMA / Federales', 'Asignaciones federales', 3],
      ['inversiones', 'Inversiones', 'Inversiones generales', 4],
    ]],
    ['servicio-cliente', 'Servicio al Cliente', 'Experiencia del cliente', 5, [
      ['facturacion-depositos', 'Facturación / Depósitos', 'Tarifas y pagos', 1],
      ['quejas', 'Quejas', 'Quejas generales del público', 2],
      ['comunicacion-deficiente', 'Comunicación Deficiente', 'Falta de información', 3],
    ]],
    ['crisis-emergencias', 'Crisis / Emergencias', 'Situaciones de emergencia', 6, [
      ['sin-agua-prolongado', 'Sin Agua Prolongado', 'Comunidades sin agua >24h', 1],
      ['contingencia', 'Contingencia', 'Planes de contingencia', 2],
      ['camiones-cisterna', 'Camiones Cisterna', 'Distribución de agua vía cisterna', 3],
    ]],
    ['gestion-administracion', 'Gestión / Administración', 'Aspectos gerenciales', 7, [
      ['nombramientos', 'Nombramientos', 'Cambios de personal ejecutivo', 1],
      ['vistas-publicas', 'Vistas Públicas / Cámara', 'Comparecencias legislativas', 2],
      ['auditorias', 'Auditorías', 'Auditorías e investigaciones', 3],
      ['declaraciones-ejecutivas', 'Declaraciones Ejecutivas', 'Declaraciones de ejecutivos AAA', 4],
    ]],
    ['legislacion', 'Legislación', 'Proyectos de ley y regulación', 8, [
      ['proyectos-ley', 'Proyectos de Ley', 'Legislación propuesta', 1],
      ['resoluciones', 'Resoluciones', 'Resoluciones del Senado/Cámara', 2],
      ['transparencia', 'Transparencia', 'Medidas de transparencia', 3],
    ]],
    ['impacto-comunitario', 'Impacto Comunitario', 'Efecto en las comunidades', 9, [
      ['municipios-afectados', 'Municipios Afectados', 'Municipios impactados', 1],
      ['sectores-residenciales', 'Sectores Residenciales', 'Residenciales afectadas', 2],
      ['infraestructura-critica', 'Infraestructura Crítica', 'Aeropuertos, hospitales, escuelas', 3],
    ]],
    ['medio-ambiente', 'Medio Ambiente', 'Temas ambientales hídricos', 10, [
      ['embalses', 'Embalses', 'Niveles y sedimentación', 1],
      ['rios', 'Ríos', 'Condición de ríos y cuencas', 2],
      ['sequia', 'Sequía', 'Periodos de sequía', 3],
    ]],
  ];

  // Get AAA agency ID for topic seeding
  const aaaResult = await client.query("SELECT id FROM agencies WHERE slug = 'aaa'");
  const aaaAgencyId = aaaResult.rows[0]?.id;

  for (const [slug, name, desc, order, subtopics] of topicsData) {
    const res = await client.query(`
      INSERT INTO topics (agency_id, name, slug, description, display_order)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (agency_id, slug) DO UPDATE SET name = $2
      RETURNING id
    `, [aaaAgencyId, name, slug, desc, order]);
    const topicId = res.rows[0].id;

    for (const [sSlug, sName, sDesc, sOrder] of subtopics) {
      await client.query(`
        INSERT INTO subtopics (topic_id, name, slug, description, display_order)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (topic_id, slug) DO NOTHING
      `, [topicId, sName, sSlug, sDesc, sOrder]);
    }
  }

  const totalSubtopics = topicsData.reduce((s, t) => s + t[4].length, 0);
  console.log(`  -> ${topicsData.length} topics, ${totalSubtopics} subtopics seeded`);
  console.log('Seed completed successfully');
}

async function getStatus(client: any): Promise<{ statusCode: number; body: string }> {
  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  const agencies = await client.query('SELECT count(*) FROM agencies');
  const municipalities = await client.query('SELECT count(*) FROM municipalities');
  const topics = await client.query('SELECT count(*) FROM topics');
  const mentions = await client.query('SELECT count(*) FROM mentions');

  const status = {
    tables: tables.rows.map((r: any) => r.table_name),
    counts: {
      agencies: agencies.rows[0].count,
      municipalities: municipalities.rows[0].count,
      topics: topics.rows[0].count,
      mentions: mentions.rows[0].count,
    },
  };

  return { statusCode: 200, body: JSON.stringify(status, null, 2) };
}

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }),
  );
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}
