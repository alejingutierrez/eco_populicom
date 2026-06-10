/**
 * eco-narrative-drift — Lambda semanal que detecta drift de centroides y
 * re-namea narrativas cuyo eje conversacional ha cambiado significativamente.
 *
 * Trigger: EventBridge cron `cron(0 8 ? * MON *)` (lunes 8am UTC = 4am AST).
 *
 * Lógica por narrativa activa (status != 'dormant'):
 *   drift = 1 - cosine(centroid_actual, centroid_at_naming)
 *   if drift > DRIFT_THRESHOLD (default 0.25):
 *     - Toma 10 menciones más recientes
 *     - Llama nameNarrative() con Bedrock tool-use
 *     - UPDATE narratives SET name, summary, keywords, centroid_at_naming = centroid_actual,
 *                              last_renamed_at = NOW(), drift_score = drift
 *
 * El cap MAX_RENAMES_PER_RUN evita un blast de Bedrock si muchas narrativas
 * derivan al mismo tiempo (raro, pero posible tras una migración o cambio
 * masivo de threshold).
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import {
  cosineSimilarity,
  parseVectorLiteral,
  toVectorLiteral,
} from '@eco/shared';
import {
  nameNarrative,
  pickRepresentativeSamples,
  type NarrativeSample,
} from '../narrative-cluster/naming';

const sm = new SecretsManagerClient({});
const bedrock = new BedrockRuntimeClient({});

const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
const DRIFT_THRESHOLD = Number(process.env.NARRATIVE_DRIFT_THRESHOLD ?? 0.25);
const MAX_RENAMES_PER_RUN = Number(process.env.NARRATIVE_MAX_RENAMES_PER_RUN ?? 15);

interface DriftEvent {
  agencySlug?: string;
  dryRun?: boolean;
  /** Override threshold para esta corrida (útil para audit/diagnóstico). */
  threshold?: number;
}

interface DriftStats {
  agency: string;
  evaluated: number;
  drifted: number;
  renamed: number;
  errors: number;
}

export const handler = async (
  event: DriftEvent = {},
): Promise<{ statusCode: number; body: string }> => {
  const start = Date.now();
  const threshold = event.threshold ?? DRIFT_THRESHOLD;
  console.log(`[narrative-drift] start threshold=${threshold} ${JSON.stringify(event)}`);

  const dbUrl = await getDatabaseUrl();
  const pg = await import('pg');
  const client = new pg.default.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const agencies = await fetchActiveAgencies(client, event.agencySlug);
    const stats: DriftStats[] = [];
    for (const agency of agencies) {
      const s = await driftForAgency(client, agency, threshold, !!event.dryRun);
      stats.push(s);
    }
    return {
      statusCode: 200,
      body: JSON.stringify(
        { elapsedMs: Date.now() - start, threshold, dryRun: !!event.dryRun, stats },
        null,
        2,
      ),
    };
  } finally {
    await client.end();
  }
};

async function driftForAgency(
  client: import('pg').Client,
  agency: { id: string; slug: string },
  threshold: number,
  dryRun: boolean,
): Promise<DriftStats> {
  const stats: DriftStats = {
    agency: agency.slug,
    evaluated: 0,
    drifted: 0,
    renamed: 0,
    errors: 0,
  };

  const rows = await client.query<{
    id: string;
    name: string;
    centroid: string;
    centroid_at_naming: string;
  }>(
    `SELECT id, name, centroid::text AS centroid, centroid_at_naming::text AS centroid_at_naming
       FROM narratives
       WHERE agency_id = $1
         AND status != 'dormant'
         AND centroid IS NOT NULL
         AND centroid_at_naming IS NOT NULL`,
    [agency.id],
  );
  stats.evaluated = rows.rows.length;

  for (const n of rows.rows) {
    if (stats.renamed >= MAX_RENAMES_PER_RUN) break;
    try {
      const current = parseVectorLiteral(n.centroid);
      const nominal = parseVectorLiteral(n.centroid_at_naming);
      const drift = 1 - cosineSimilarity(current, nominal);

      // Actualiza drift_score siempre (audit) — esto es barato y útil para UI.
      await client.query('UPDATE narratives SET drift_score = $1 WHERE id = $2', [
        drift,
        n.id,
      ]);

      if (drift < threshold) continue;
      stats.drifted += 1;

      if (dryRun) continue;

      // Re-nombrar: trae las 10 menciones primarias más recientes
      const recent = await client.query<{
        title: string | null;
        snippet: string | null;
        author: string | null;
        published_at: Date;
        page_type: string | null;
        engagement_score: number | null;
        reach_estimate: number | null;
      }>(
        `SELECT m.title, m.snippet, m.author, m.published_at, m.page_type,
                m.engagement_score, m.reach_estimate
           FROM mentions m
           JOIN narrative_mentions nm ON nm.mention_id = m.id
           WHERE nm.narrative_id = $1 AND nm.is_primary = true
           ORDER BY m.published_at DESC
           LIMIT 25`,
        [n.id],
      );

      if (recent.rows.length === 0) continue;

      const samples: NarrativeSample[] = pickRepresentativeSamples(
        recent.rows.map((r) => ({
          title: r.title,
          snippet: r.snippet,
          author: r.author,
          publishedAt: r.published_at?.toISOString?.() ?? null,
          platform: r.page_type,
          engagement: r.engagement_score ?? 0,
          reach: r.reach_estimate ?? 0,
        })),
        10,
      );

      const naming = await nameNarrative(bedrock, samples);

      // Slug uniqueness check
      let slug = naming.slug;
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM narratives WHERE agency_id = $1 AND slug = $2 AND id != $3',
        [agency.id, slug, n.id],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        slug = `${slug}-${Date.now().toString(36).slice(-5)}`;
      }

      await client.query(
        `UPDATE narratives
            SET name = $1,
                slug = $2,
                summary = $3,
                keywords = $4::jsonb,
                centroid_at_naming = $5::vector,
                last_renamed_at = NOW(),
                drift_score = $6,
                updated_at = NOW()
            WHERE id = $7`,
        [
          naming.name,
          slug,
          naming.summary,
          JSON.stringify(naming.keywords),
          toVectorLiteral(current),
          drift,
          n.id,
        ],
      );

      console.log(
        `[${agency.slug}] renamed "${n.name}" → "${naming.name}" (drift=${drift.toFixed(3)})`,
      );
      stats.renamed += 1;
    } catch (err) {
      console.warn(`[${agency.slug}] drift narrative ${n.id} failed:`, err);
      stats.errors += 1;
    }
  }

  console.log(`[${agency.slug}] drift stats=${JSON.stringify(stats)}`);
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
