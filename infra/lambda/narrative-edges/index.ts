/**
 * eco-narrative-edges — Lambda diaria que recalcula conexiones entre narrativas.
 *
 * Trigger: EventBridge cron `cron(0 6 * * ? *)` (6am UTC = 2am AST diaria).
 *
 * Tres tipos de edges (todos undirected, source < target en orden UUID):
 *   - co_occurrence: pares de narrativas que comparten ≥5 menciones.
 *     strength = jaccard(n1.mentions, n2.mentions). Tope superior depende
 *     de qué tan solapadas estén las temáticas.
 *   - author_overlap: pares con ≥3 autores en común.
 *     strength = |A∩B| / min(|A|, |B|) (índice de solapamiento, no Jaccard).
 *   - semantic: pares con coseno entre centroides > 0.6.
 *     strength = cosine_sim directo.
 *
 * Estrategia: truncate + reinsert por agencia (idempotente y simple — ~150
 * narrativas × O(N²) edges es manejable en SQL). Filtra strength ≥ 0.15 al
 * final para reducir ruido.
 *
 * Invocación manual:
 *   aws lambda invoke --function-name eco-narrative-edges \
 *     --payload '{"agencySlug":"ddecpr"}' /tmp/r.json
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({});
const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;

const MIN_STRENGTH = Number(process.env.NARRATIVE_EDGE_MIN_STRENGTH ?? 0.15);
const SEMANTIC_THRESHOLD = Number(process.env.NARRATIVE_SEMANTIC_THRESHOLD ?? 0.6);
const CO_OCCURRENCE_MIN_SHARED = Number(process.env.NARRATIVE_CO_OCCURRENCE_MIN_SHARED ?? 5);
const AUTHOR_OVERLAP_MIN_SHARED = Number(process.env.NARRATIVE_AUTHOR_OVERLAP_MIN_SHARED ?? 3);

interface EdgesEvent {
  agencySlug?: string;
}

interface EdgesStats {
  agency: string;
  coOccurrence: number;
  authorOverlap: number;
  semantic: number;
  total: number;
}

export const handler = async (
  event: EdgesEvent = {},
): Promise<{ statusCode: number; body: string }> => {
  const start = Date.now();
  console.log(`[narrative-edges] start ${JSON.stringify(event)}`);

  const dbUrl = await getDatabaseUrl();
  const pg = await import('pg');
  const client = new pg.default.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const agencies = await fetchActiveAgencies(client, event.agencySlug);
    const stats: EdgesStats[] = [];
    for (const agency of agencies) {
      const s = await computeEdgesForAgency(client, agency);
      stats.push(s);
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ elapsedMs: Date.now() - start, stats }, null, 2),
    };
  } finally {
    await client.end();
  }
};

async function computeEdgesForAgency(
  client: import('pg').Client,
  agency: { id: string; slug: string },
): Promise<EdgesStats> {
  // Truncate edges existentes de esta agencia
  await client.query('DELETE FROM narrative_edges WHERE agency_id = $1', [agency.id]);

  // Co-occurrence (menciones compartidas)
  const coRes = await client.query(
    `INSERT INTO narrative_edges (agency_id, source_narrative_id, target_narrative_id, edge_type, strength)
     SELECT $1, nm1.narrative_id, nm2.narrative_id, 'co_occurrence',
            (COUNT(*)::float / GREATEST(
              (SELECT COUNT(*) FROM narrative_mentions WHERE narrative_id = nm1.narrative_id AND is_primary = true)
              + (SELECT COUNT(*) FROM narrative_mentions WHERE narrative_id = nm2.narrative_id AND is_primary = true)
              - COUNT(*),
              1
            )) AS strength
       FROM narrative_mentions nm1
       JOIN narrative_mentions nm2 ON nm2.mention_id = nm1.mention_id
       JOIN narratives n1 ON n1.id = nm1.narrative_id AND n1.agency_id = $1
       JOIN narratives n2 ON n2.id = nm2.narrative_id AND n2.agency_id = $1
       WHERE nm1.narrative_id < nm2.narrative_id
       GROUP BY nm1.narrative_id, nm2.narrative_id
       HAVING COUNT(*) >= $2
     ON CONFLICT (source_narrative_id, target_narrative_id, edge_type) DO NOTHING`,
    [agency.id, CO_OCCURRENCE_MIN_SHARED],
  );
  const coCount = coRes.rowCount ?? 0;

  // Author overlap (autores compartidos)
  const aoRes = await client.query(
    `WITH narrative_authors AS (
       SELECT nm.narrative_id, m.author
         FROM narrative_mentions nm
         JOIN mentions m ON m.id = nm.mention_id
         JOIN narratives n ON n.id = nm.narrative_id AND n.agency_id = $1
         WHERE nm.is_primary = true AND m.author IS NOT NULL
         GROUP BY nm.narrative_id, m.author
     ),
     author_counts AS (
       SELECT narrative_id, COUNT(*)::int AS author_count FROM narrative_authors GROUP BY narrative_id
     ),
     pair_shared AS (
       SELECT na1.narrative_id AS source, na2.narrative_id AS target, COUNT(*)::int AS shared
         FROM narrative_authors na1
         JOIN narrative_authors na2 ON na2.author = na1.author AND na2.narrative_id > na1.narrative_id
         GROUP BY na1.narrative_id, na2.narrative_id
         HAVING COUNT(*) >= $2
     )
     INSERT INTO narrative_edges (agency_id, source_narrative_id, target_narrative_id, edge_type, strength)
     SELECT $1, ps.source, ps.target, 'author_overlap',
            (ps.shared::float / LEAST(ac1.author_count, ac2.author_count))
       FROM pair_shared ps
       JOIN author_counts ac1 ON ac1.narrative_id = ps.source
       JOIN author_counts ac2 ON ac2.narrative_id = ps.target
     ON CONFLICT (source_narrative_id, target_narrative_id, edge_type) DO NOTHING`,
    [agency.id, AUTHOR_OVERLAP_MIN_SHARED],
  );
  const aoCount = aoRes.rowCount ?? 0;

  // Semantic (similitud entre centroides)
  const seRes = await client.query(
    `INSERT INTO narrative_edges (agency_id, source_narrative_id, target_narrative_id, edge_type, strength)
     SELECT $1, n1.id, n2.id, 'semantic', (1 - (n1.centroid <=> n2.centroid))
       FROM narratives n1
       JOIN narratives n2 ON n2.id > n1.id AND n2.agency_id = n1.agency_id
       WHERE n1.agency_id = $1
         AND n1.centroid IS NOT NULL AND n2.centroid IS NOT NULL
         AND (1 - (n1.centroid <=> n2.centroid)) >= $2
     ON CONFLICT (source_narrative_id, target_narrative_id, edge_type) DO NOTHING`,
    [agency.id, SEMANTIC_THRESHOLD],
  );
  const seCount = seRes.rowCount ?? 0;

  // Prune edges con strength < MIN_STRENGTH
  await client.query('DELETE FROM narrative_edges WHERE agency_id = $1 AND strength < $2', [
    agency.id,
    MIN_STRENGTH,
  ]);

  const stats: EdgesStats = {
    agency: agency.slug,
    coOccurrence: coCount,
    authorOverlap: aoCount,
    semantic: seCount,
    total: coCount + aoCount + seCount,
  };
  console.log(`[${agency.slug}] edges=${JSON.stringify(stats)}`);
  return stats;
}

async function fetchActiveAgencies(
  client: import('pg').Client,
  agencySlug?: string,
): Promise<{ id: string; slug: string }[]> {
  if (agencySlug) {
    const r = await client.query<{ id: string; slug: string }>(
      'SELECT id, slug FROM agencies WHERE slug = $1 AND is_active = true',
      [agencySlug],
    );
    return r.rows;
  }
  const r = await client.query<{ id: string; slug: string }>(
    'SELECT id, slug FROM agencies WHERE is_active = true ORDER BY slug',
  );
  return r.rows;
}

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }));
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}
