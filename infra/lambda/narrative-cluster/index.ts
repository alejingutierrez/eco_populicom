/**
 * eco-narrative-cluster — Lambda principal del feature de narrativas.
 *
 * Trigger: EventBridge cron `cron(15 * * * ? *)` (cada hora, minuto 15).
 *
 * Por cada agencia activa:
 *   1. Toma menciones con `embedding` que aún no están asignadas a ninguna
 *      narrativa ni en el pool de candidatos.
 *   2. Para cada mención, busca las top-3 narrativas más cercanas por coseno.
 *      Si la mejor supera el threshold (default 0.78), asigna 1:N (hasta 3
 *      narrativas, top-1 marcada `is_primary`). Actualiza centroide del top-1
 *      con EWMA. Si no supera threshold, mete la mención al pool de candidatos.
 *   3. Sobre el pool de candidatos corre DBSCAN; cada cluster denso (≥minPts)
 *      spawnea una narrativa nueva, nombrada con Bedrock Claude (tool-use).
 *   4. Recalcula lifecycle states (emerging/active/peaking/declining/dormant/revived)
 *      vía state machine determinística sobre velocity, ageDays, etc.
 *   5. Para narrativas con ≥24h de antigüedad sin `initiator_influencer`,
 *      calcula la voz más influyente en las primeras 24h.
 *
 * Invocación manual (sin cron) — útil para probar o backfillear:
 *   aws lambda invoke --function-name eco-narrative-cluster \
 *     --payload '{"agencySlug":"ddecpr","dryRun":true}' /tmp/out.json
 *
 * Tunables vía env vars (defaults entre paréntesis):
 *   NARRATIVE_THRESHOLD             (0.78)  similitud coseno mínima para asignar
 *   NARRATIVE_EWMA_ALPHA            (0.05)  peso del nuevo punto en update centroide
 *   NARRATIVE_MIN_MENTIONS_BIRTH    (10)    DBSCAN minPts para nacer narrativa
 *   NARRATIVE_DBSCAN_EPS            (0.22)  DBSCAN eps (1 - threshold)
 *   NARRATIVE_TOP_N_MATCHES         (3)     máximo narrativas por mención
 *   NARRATIVE_INFLUENCE_WINDOW_HOURS (24)   ventana para top influencia
 *   NARRATIVE_PER_AGENCY_LIMIT      (5000)  máximo de menciones a procesar/agencia/corrida
 *   NARRATIVE_MAX_NEW_PER_RUN       (20)    máximo narrativas nuevas por corrida (safety cap)
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import {
  cosineSimilarity,
  ewmaUpdate,
  vectorMean,
  dbscan,
  cosineDistance,
  parseVectorLiteral,
  toVectorLiteral,
  computeLifecycleState,
  type NarrativeStatus,
} from '@eco/shared';
import { nameNarrative, pickRepresentativeSamples, type NarrativeSample } from './naming';

const sm = new SecretsManagerClient({});
const bedrock = new BedrockRuntimeClient({});

const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
const THRESHOLD = Number(process.env.NARRATIVE_THRESHOLD ?? 0.78);
const EWMA_ALPHA = Number(process.env.NARRATIVE_EWMA_ALPHA ?? 0.05);
const MIN_MENTIONS_BIRTH = Number(process.env.NARRATIVE_MIN_MENTIONS_BIRTH ?? 10);
const DBSCAN_EPS = Number(process.env.NARRATIVE_DBSCAN_EPS ?? 0.22);
const TOP_N_MATCHES = Number(process.env.NARRATIVE_TOP_N_MATCHES ?? 3);
const INFLUENCE_WINDOW_HOURS = Number(process.env.NARRATIVE_INFLUENCE_WINDOW_HOURS ?? 24);
const PER_AGENCY_LIMIT = Number(process.env.NARRATIVE_PER_AGENCY_LIMIT ?? 5000);
const MAX_NEW_PER_RUN = Number(process.env.NARRATIVE_MAX_NEW_PER_RUN ?? 20);

/**
 * Limpia strings antes de pasarlos a jsonb. pg rechaza JSON con surrogates
 * UTF-16 sueltos (sin pareja), p.ej. autores con un emoji corrupto cuyo low
 * surrogate quedó truncado. Strip silenciosamente: para nuestro caso (mostrar
 * autor/url) perder un emoji roto es preferible a perder la narrativa entera.
 */
function sanitizeUnicode<T extends string | null | undefined>(s: T): T {
  if (s == null) return s;
  // Pattern: high surrogate sin low surrogate, o low surrogate sin high surrogate.
  return (s as string).replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '',
  ) as T;
}

interface ClusterEvent {
  agencySlug?: string;
  dryRun?: boolean;
  /** Skip naming (Bedrock) — útil para probar clustering puro sin coste. */
  skipNaming?: boolean;
  /** Override del cap de narrativas nuevas por corrida. */
  maxNewNarratives?: number;
}

interface ClusterStats {
  agency: string;
  unassigned: number;
  assigned: number;
  queuedAsCandidates: number;
  newNarratives: number;
  namesGenerated: number;
  lifecycleUpdated: number;
  influencersComputed: number;
  errors: number;
}

interface MentionRow {
  id: string;
  embedding: string; // pgvector literal
  title: string | null;
  snippet: string | null;
  author: string | null;
  published_at: Date;
  url: string | null;
  engagement_score: number | null;
  reach_estimate: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  page_type: string | null;
}

interface CandidateRow extends MentionRow {
  candidate_id: string;
}

type Agency = { id: string; slug: string };

export const handler = async (event: ClusterEvent = {}): Promise<{ statusCode: number; body: string }> => {
  const startedAt = Date.now();
  console.log(`[narrative-cluster] start event=${JSON.stringify(event)}`);

  const dbUrl = await getDatabaseUrl();
  const pg = await import('pg');
  const client = new pg.default.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const agencies = await fetchActiveAgencies(client, event.agencySlug);
    console.log(`[narrative-cluster] processing ${agencies.length} agencies`);

    const stats: ClusterStats[] = [];
    for (const agency of agencies) {
      try {
        const s = await clusterForAgency(client, agency, event);
        stats.push(s);
      } catch (err) {
        console.error(`[narrative-cluster] agency ${agency.slug} failed`, err);
        stats.push({
          agency: agency.slug,
          unassigned: 0,
          assigned: 0,
          queuedAsCandidates: 0,
          newNarratives: 0,
          namesGenerated: 0,
          lifecycleUpdated: 0,
          influencersComputed: 0,
          errors: 1,
        });
      }
    }

    const elapsedMs = Date.now() - startedAt;
    return {
      statusCode: 200,
      body: JSON.stringify(
        { dryRun: !!event.dryRun, elapsedMs, stats },
        null,
        2,
      ),
    };
  } finally {
    await client.end();
  }
};

async function clusterForAgency(
  client: import('pg').Client,
  agency: Agency,
  event: ClusterEvent,
): Promise<ClusterStats> {
  const stats: ClusterStats = {
    agency: agency.slug,
    unassigned: 0,
    assigned: 0,
    queuedAsCandidates: 0,
    newNarratives: 0,
    namesGenerated: 0,
    lifecycleUpdated: 0,
    influencersComputed: 0,
    errors: 0,
  };

  // 1. Fetch unassigned mentions with embedding
  const unassignedRes = await client.query<MentionRow>(
    `SELECT m.id, m.embedding::text AS embedding, m.title, m.snippet, m.author,
            m.published_at, m.url, m.engagement_score, m.reach_estimate,
            m.likes, m.comments, m.shares, m.page_type
       FROM mentions m
       WHERE m.agency_id = $1
         AND m.is_duplicate = false
         AND m.embedding IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM narrative_mentions nm WHERE nm.mention_id = m.id)
         AND NOT EXISTS (SELECT 1 FROM narrative_candidates nc WHERE nc.mention_id = m.id)
       ORDER BY m.published_at ASC
       LIMIT $2`,
    [agency.id, PER_AGENCY_LIMIT],
  );
  stats.unassigned = unassignedRes.rows.length;
  console.log(`[${agency.slug}] unassigned mentions: ${stats.unassigned}`);

  // 2. Assign each to nearest narratives or pool of candidates
  for (const mention of unassignedRes.rows) {
    try {
      const nearest = await client.query<{ id: string; similarity: string }>(
        `SELECT id, (1 - (centroid <=> $1::vector)) AS similarity
           FROM narratives
           WHERE agency_id = $2
             AND is_duplicate = false
             AND status != 'dormant'
             AND centroid IS NOT NULL
           ORDER BY centroid <=> $1::vector
           LIMIT $3`,
        [mention.embedding, agency.id, TOP_N_MATCHES],
      );

      const matches = nearest.rows
        .map((r) => ({ id: r.id, similarity: Number(r.similarity) }))
        .filter((r) => r.similarity >= THRESHOLD);

      if (matches.length > 0) {
        if (event.dryRun) {
          stats.assigned += 1;
          continue;
        }

        for (let i = 0; i < matches.length; i += 1) {
          await client.query(
            `INSERT INTO narrative_mentions (narrative_id, mention_id, similarity, is_primary)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [matches[i].id, mention.id, matches[i].similarity, i === 0],
          );
        }

        // EWMA update centroide del top-1
        const primary = matches[0];
        const oldRes = await client.query<{ c: string }>(
          'SELECT centroid::text AS c FROM narratives WHERE id = $1',
          [primary.id],
        );
        if (oldRes.rows.length === 0) {
          stats.errors += 1;
          continue;
        }
        const oldCentroid = parseVectorLiteral(oldRes.rows[0].c);
        const newPoint = parseVectorLiteral(mention.embedding);
        const newCentroid = ewmaUpdate(oldCentroid, newPoint, EWMA_ALPHA);

        await client.query(
          `UPDATE narratives
              SET centroid = $1::vector,
                  mention_count = mention_count + 1,
                  total_engagement = total_engagement + COALESCE($2::bigint, 0),
                  total_reach = total_reach + COALESCE($3::bigint, 0),
                  last_mention_at = GREATEST(COALESCE(last_mention_at, $4::timestamptz), $4::timestamptz),
                  updated_at = NOW()
              WHERE id = $5`,
          [
            toVectorLiteral(newCentroid),
            mention.engagement_score ?? 0,
            mention.reach_estimate ?? 0,
            mention.published_at,
            primary.id,
          ],
        );

        stats.assigned += 1;
      } else {
        if (event.dryRun) {
          stats.queuedAsCandidates += 1;
          continue;
        }
        await client.query(
          `INSERT INTO narrative_candidates (agency_id, mention_id, embedding)
           VALUES ($1, $2, $3::vector)
           ON CONFLICT (mention_id) DO NOTHING`,
          [agency.id, mention.id, mention.embedding],
        );
        stats.queuedAsCandidates += 1;
      }
    } catch (err) {
      console.warn(`[${agency.slug}] mention ${mention.id} failed:`, err);
      stats.errors += 1;
    }
  }

  // 3. Spawn narratives from candidates pool
  if (!event.dryRun) {
    const { created, named } = await spawnNarrativesFromCandidates(
      client,
      agency,
      event.maxNewNarratives ?? MAX_NEW_PER_RUN,
      event.skipNaming ?? false,
    );
    stats.newNarratives = created;
    stats.namesGenerated = named;
  }

  // 4. Recompute lifecycle states
  if (!event.dryRun) {
    stats.lifecycleUpdated = await updateLifecycleStates(client, agency);
  }

  // 5. Compute influencers for narratives that have crossed 24h since born_at
  if (!event.dryRun) {
    stats.influencersComputed = await computeInfluencersForRecentNarratives(client, agency);
  }

  console.log(`[${agency.slug}] stats=${JSON.stringify(stats)}`);
  return stats;
}

async function spawnNarrativesFromCandidates(
  client: import('pg').Client,
  agency: Agency,
  maxNew: number,
  skipNaming: boolean,
): Promise<{ created: number; named: number }> {
  const candRes = await client.query<CandidateRow>(
    `SELECT nc.id AS candidate_id,
            nc.mention_id AS id,
            nc.embedding::text AS embedding,
            m.title, m.snippet, m.author, m.published_at, m.url,
            m.engagement_score, m.reach_estimate, m.likes, m.comments, m.shares, m.page_type
       FROM narrative_candidates nc
       JOIN mentions m ON m.id = nc.mention_id
       WHERE nc.agency_id = $1
       AND nc.is_duplicate = false
       ORDER BY nc.created_at ASC`,
    [agency.id],
  );

  if (candRes.rows.length < MIN_MENTIONS_BIRTH) {
    return { created: 0, named: 0 };
  }

  type Point = { row: CandidateRow; vec: number[] };
  const points: Point[] = candRes.rows.map((row) => ({
    row,
    vec: parseVectorLiteral(row.embedding),
  }));

  const { clusters } = dbscan(
    points,
    (a, b) => cosineDistance(a.vec, b.vec),
    DBSCAN_EPS,
    MIN_MENTIONS_BIRTH,
  );

  console.log(
    `[${agency.slug}] DBSCAN: ${candRes.rows.length} candidates → ${clusters.length} clusters (eps=${DBSCAN_EPS}, minPts=${MIN_MENTIONS_BIRTH})`,
  );

  let created = 0;
  let named = 0;
  for (const cluster of clusters) {
    if (created >= maxNew) break;
    if (cluster.length < MIN_MENTIONS_BIRTH) continue;

    try {
      const samples: NarrativeSample[] = pickRepresentativeSamples(
        cluster.map((p) => ({
          title: p.row.title,
          snippet: p.row.snippet,
          author: p.row.author,
          publishedAt: p.row.published_at?.toISOString?.() ?? null,
          platform: p.row.page_type,
          engagement: p.row.engagement_score ?? 0,
          reach: p.row.reach_estimate ?? 0,
        })),
        10,
      );

      let naming: { name: string; slug: string; summary: string; keywords: string[] };
      if (skipNaming) {
        // Útil para probar pipeline sin Bedrock. Genera placeholder.
        const placeholderSlug = `narrativa-${Date.now().toString(36)}-${created}`;
        naming = {
          name: `Narrativa ${placeholderSlug.slice(-6)}`,
          slug: placeholderSlug,
          summary: '[Naming pendiente — skipNaming=true en esta corrida]',
          keywords: ['pendiente'],
        };
      } else {
        naming = await nameNarrative(bedrock, samples);
        named += 1;
      }

      const centroid = vectorMean(cluster.map((p) => p.vec));
      const centroidLit = toVectorLiteral(centroid);

      const sorted = [...cluster].sort(
        (a, b) => new Date(a.row.published_at).getTime() - new Date(b.row.published_at).getTime(),
      );
      const first = sorted[0].row;
      const last = sorted[sorted.length - 1].row;

      const initiatorFirst = {
        author: sanitizeUnicode(first.author),
        platform: sanitizeUnicode(first.page_type),
        publishedAt: first.published_at?.toISOString?.() ?? null,
        url: sanitizeUnicode(first.url),
        snippet: sanitizeUnicode(first.snippet?.slice(0, 220) ?? null),
      };

      let slug = naming.slug;
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM narratives WHERE agency_id = $1 AND slug = $2',
        [agency.id, slug],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        slug = `${slug}-${Date.now().toString(36).slice(-5)}`;
      }

      const totalEngagement = cluster.reduce(
        (sum, p) => sum + (p.row.engagement_score ?? 0),
        0,
      );
      const totalReach = cluster.reduce(
        (sum, p) => sum + (p.row.reach_estimate ?? 0),
        0,
      );

      const insertRes = await client.query<{ id: string }>(
        `INSERT INTO narratives (
            agency_id, name, slug, summary, keywords,
            centroid, centroid_at_naming, status,
            first_mention_id, initiator_first,
            mention_count, total_engagement, total_reach,
            born_at, last_mention_at
          ) VALUES (
            $1, $2, $3, $4, $5::jsonb,
            $6::vector, $6::vector, 'emerging',
            $7, $8::jsonb,
            $9, $10, $11,
            $12, $13
          )
          RETURNING id`,
        [
          agency.id,
          naming.name,
          slug,
          naming.summary,
          JSON.stringify(naming.keywords),
          centroidLit,
          first.id,
          JSON.stringify(initiatorFirst),
          cluster.length,
          totalEngagement,
          totalReach,
          first.published_at,
          last.published_at,
        ],
      );
      const narrativeId = insertRes.rows[0].id;

      // Inserta narrative_mentions y prepara delete de candidates
      const mentionIds: string[] = [];
      for (const p of cluster) {
        const sim = cosineSimilarity(p.vec, centroid);
        await client.query(
          `INSERT INTO narrative_mentions (narrative_id, mention_id, similarity, is_primary)
           VALUES ($1, $2, $3, true)
           ON CONFLICT (narrative_id, mention_id) DO NOTHING`,
          [narrativeId, p.row.id, sim],
        );
        mentionIds.push(p.row.id);
      }

      // Drop candidates
      await client.query(
        `DELETE FROM narrative_candidates WHERE mention_id = ANY($1::uuid[])`,
        [mentionIds],
      );

      created += 1;
      console.log(`[${agency.slug}] spawned narrative "${naming.name}" (${cluster.length} mentions, slug=${slug})`);
    } catch (err) {
      console.warn(`[${agency.slug}] cluster naming/insert failed (cluster size ${cluster.length})`, err);
      // Leave candidates en pool — próxima corrida reintentará
    }
  }

  return { created, named };
}

async function updateLifecycleStates(
  client: import('pg').Client,
  agency: Agency,
): Promise<number> {
  const narratives = await client.query<{
    id: string;
    status: NarrativeStatus;
    mention_count: string;
    peaked_at: Date | null;
    age_days: string;
    days_since_last: string | null;
    velocity_24h: string;
    avg_velocity_7d: string;
  }>(
    `SELECT n.id,
            n.status,
            n.mention_count,
            n.peaked_at,
            EXTRACT(EPOCH FROM (NOW() - n.born_at)) / 86400.0 AS age_days,
            CASE WHEN n.last_mention_at IS NULL THEN NULL
                 ELSE EXTRACT(EPOCH FROM (NOW() - n.last_mention_at)) / 86400.0 END AS days_since_last,
            (SELECT COUNT(*)::int FROM narrative_mentions nm
               JOIN mentions m ON m.id = nm.mention_id
               WHERE nm.narrative_id = n.id AND nm.is_primary = true
                 AND m.published_at >= NOW() - INTERVAL '24 hours'
            ) AS velocity_24h,
            (SELECT (COUNT(*)::float / 7.0) FROM narrative_mentions nm
               JOIN mentions m ON m.id = nm.mention_id
               WHERE nm.narrative_id = n.id AND nm.is_primary = true
                 AND m.published_at >= NOW() - INTERVAL '7 days'
            ) AS avg_velocity_7d
       FROM narratives n
       WHERE n.agency_id = $1`,
    [agency.id],
  );

  let updated = 0;
  for (const row of narratives.rows) {
    const daysSinceLast = row.days_since_last == null ? 9999 : Number(row.days_since_last);
    const result = computeLifecycleState({
      velocity24h: Number(row.velocity_24h),
      avgVelocity7d: Number(row.avg_velocity_7d),
      daysSinceLast,
      mentionCount: Number(row.mention_count),
      ageDays: Number(row.age_days),
      prevStatus: row.status,
    });

    const setPeakedAt = result.enteredPeaking && !row.peaked_at;
    const sql = setPeakedAt
      ? `UPDATE narratives
            SET status = $1,
                velocity_24h = $2,
                engagement_velocity_24h = $2,
                peaked_at = NOW(),
                updated_at = NOW()
            WHERE id = $3`
      : `UPDATE narratives
            SET status = $1,
                velocity_24h = $2,
                engagement_velocity_24h = $2,
                updated_at = NOW()
            WHERE id = $3`;

    await client.query(sql, [result.status, Number(row.velocity_24h), row.id]);
    if (result.status !== row.status) {
      console.log(`[${agency.slug}] lifecycle: ${row.id} ${row.status} → ${result.status}`);
    }
    updated += 1;
  }
  return updated;
}

async function computeInfluencersForRecentNarratives(
  client: import('pg').Client,
  agency: Agency,
): Promise<number> {
  const recent = await client.query<{ id: string; born_at: Date }>(
    `SELECT id, born_at FROM narratives
       WHERE agency_id = $1
         AND is_duplicate = false
         AND initiator_influencer IS NULL
         AND born_at <= NOW() - INTERVAL '${INFLUENCE_WINDOW_HOURS} hours'`,
    [agency.id],
  );

  let computed = 0;
  for (const n of recent.rows) {
    const top = await client.query<{
      author: string;
      reach: string | null;
      engagement: string | null;
      published_at: Date | null;
      url: string | null;
    }>(
      `SELECT m.author,
              MAX(COALESCE(m.reach_estimate, 0))::bigint AS reach,
              SUM(COALESCE(m.likes,0)+COALESCE(m.comments,0)+COALESCE(m.shares,0))::bigint AS engagement,
              MIN(m.published_at) AS published_at,
              (ARRAY_AGG(m.url ORDER BY COALESCE(m.reach_estimate, 0) DESC))[1] AS url
         FROM mentions m
         JOIN narrative_mentions nm ON nm.mention_id = m.id
         WHERE nm.narrative_id = $1
           AND m.author IS NOT NULL
           AND m.published_at <= $2::timestamptz + INTERVAL '${INFLUENCE_WINDOW_HOURS} hours'
         GROUP BY m.author
         ORDER BY MAX(COALESCE(m.reach_estimate, 0) * (1 + COALESCE(m.likes,0) + COALESCE(m.comments,0) + COALESCE(m.shares,0))) DESC NULLS LAST
         LIMIT 1`,
      [n.id, n.born_at],
    );

    if (top.rows.length > 0) {
      const r = top.rows[0];
      await client.query(
        'UPDATE narratives SET initiator_influencer = $1::jsonb WHERE id = $2',
        [
          JSON.stringify({
            author: sanitizeUnicode(r.author),
            reach: Number(r.reach ?? 0),
            engagement: Number(r.engagement ?? 0),
            publishedAt: r.published_at?.toISOString?.() ?? null,
            url: sanitizeUnicode(r.url),
          }),
          n.id,
        ],
      );
      computed += 1;
    }
  }
  return computed;
}

async function fetchActiveAgencies(
  client: import('pg').Client,
  agencySlug?: string,
): Promise<Agency[]> {
  if (agencySlug) {
    const r = await client.query<Agency>(
      'SELECT id, slug FROM agencies WHERE slug = $1 AND is_active = true',
      [agencySlug],
    );
    return r.rows;
  }
  const r = await client.query<Agency>(
    'SELECT id, slug FROM agencies WHERE is_active = true ORDER BY slug',
  );
  return r.rows;
}

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }));
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}
