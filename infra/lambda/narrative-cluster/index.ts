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
 *   NARRATIVE_MIN_MENTIONS_BIRTH    (7)     DBSCAN minPts para nacer narrativa
 *   NARRATIVE_DBSCAN_EPS            (0.19)  eps de respaldo (ver NARRATIVE_EPS_AUTO)
 *   NARRATIVE_EPS_AUTO              (true)  eps por percentil de la k-distancia
 *   NARRATIVE_EPS_PERCENTILE        (0.25)  percentil usado cuando EPS_AUTO
 *   NARRATIVE_EPS_MIN / _MAX        (0.22 / 0.34)  recorte del eps automático
 *   NARRATIVE_CANDIDATE_WINDOW_DAYS (21)    ventana del pool sobre published_at
 *   NARRATIVE_REVIVE_THRESHOLD      (0.82)  similitud para resucitar una dormant
 *   NARRATIVE_REVIVE_WINDOW_DAYS    (45)    antigüedad máxima para revivir
 *
 * N8 — nota sobre el "drift" de configuración: la auditoría de julio afirmaba
 * que producción corría 0.19/7 contra un git que decía 0.22/10. Es FALSO:
 * `infra/lib/workers-stack.ts` ya declaraba '0.19' y '7'. El desajuste estaba
 * en ESTE comentario y en los defaults de abajo, que seguían diciendo 0.22/10 y
 * hacían creer que la infraestructura estaba desalineada. Los defaults del
 * código ahora coinciden con el env desplegado.
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
  autoEps,
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
// N5: 0.70, no 0.78. Medido en producción, la máx-similitud promedio de una
// mención contra cualquier centroide es 0.44-0.51, así que 0.78 vivía en la cola
// y `assigned` era 0 en todas las corridas.
const THRESHOLD = Number(process.env.NARRATIVE_THRESHOLD ?? 0.70);
// Resucitar exige MÁS evidencia que continuar: una dormant sólo revive con una
// mención claramente suya.
const REVIVE_THRESHOLD = Number(process.env.NARRATIVE_REVIVE_THRESHOLD ?? 0.82);
// Cuán atrás puede estar la última mención de una dormant para seguir siendo
// candidata a revivir. Más allá, la narrativa está cerrada.
const REVIVE_WINDOW_DAYS = Number(process.env.NARRATIVE_REVIVE_WINDOW_DAYS ?? 45);
const EWMA_ALPHA = Number(process.env.NARRATIVE_EWMA_ALPHA ?? 0.05);
const MIN_MENTIONS_BIRTH = Number(process.env.NARRATIVE_MIN_MENTIONS_BIRTH ?? 7);
const DBSCAN_EPS = Number(process.env.NARRATIVE_DBSCAN_EPS ?? 0.19);
const TOP_N_MATCHES = Number(process.env.NARRATIVE_TOP_N_MATCHES ?? 3);
const INFLUENCE_WINDOW_HOURS = Number(process.env.NARRATIVE_INFLUENCE_WINDOW_HOURS ?? 24);
const PER_AGENCY_LIMIT = Number(process.env.NARRATIVE_PER_AGENCY_LIMIT ?? 5000);
// Cap del pool de candidatos por corrida de DBSCAN: el algoritmo es O(n²) en
// distancias coseno de 1024 dims — 10k candidatos corre en ~30s, 50k no cabe
// ni en 15 min. Con el cap, cada corrida digiere los candidatos más viejos;
// los clusters nacidos drenan el pool y la siguiente corrida toma el resto.
const CANDIDATE_POOL_LIMIT = Number(process.env.NARRATIVE_CANDIDATE_POOL_LIMIT ?? 12000);
// N1: ventana temporal del pool y de la admisión, en días sobre published_at.
// 21 días cubre el ciclo de vida de una noticia en este corpus sin arrastrar el
// backlog histórico.
const CANDIDATE_WINDOW_DAYS = Number(process.env.NARRATIVE_CANDIDATE_WINDOW_DAYS ?? 21);
// N2: eps por PERCENTIL de la k-distancia de la ventana, no constante mágica.
// Ver la nota de autoEps() en @eco/shared: el barrido k-NN sobre la ventana de
// la crisis Domenech (685 puntos) mostró que NO hay rodilla, así que cualquier
// eps global es política. El p25 de la 6-NN medía 0.300; el 0.19 de producción
// está en el p12.
const EPS_AUTO = (process.env.NARRATIVE_EPS_AUTO ?? 'true') !== 'false';
const EPS_PERCENTILE = Number(process.env.NARRATIVE_EPS_PERCENTILE ?? 0.25);
const EPS_MIN = Number(process.env.NARRATIVE_EPS_MIN ?? 0.22);
const EPS_MAX = Number(process.env.NARRATIVE_EPS_MAX ?? 0.34);
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
         -- N1: ventana sobre published_at. Sin esto el query re-encolaba
         -- indefinidamente las mismas menciones viejas que la poda acababa de
         -- borrar, y el pool nunca convergía. Va sobre published_at y NO sobre
         -- created_at porque created_at es fecha de ENCOLADO: un backfill la
         -- pone "hoy" para menciones de 2025 (medido: 53,225 candidatos de
         -- gobernadora creados el 29-30 jul con published_at de 2025), así que
         -- no es monótona y no sirve como eje temporal.
         AND m.published_at >= NOW() - ($3 || ' days')::interval
         AND NOT EXISTS (SELECT 1 FROM narrative_mentions nm WHERE nm.mention_id = m.id)
         AND NOT EXISTS (SELECT 1 FROM narrative_candidates nc WHERE nc.mention_id = m.id)
       -- Lo más RECIENTE primero: una narrativa que nace tarde no sirve.
       ORDER BY m.published_at DESC
       LIMIT $2`,
    [agency.id, PER_AGENCY_LIMIT, CANDIDATE_WINDOW_DAYS],
  );
  stats.unassigned = unassignedRes.rows.length;
  console.log(`[${agency.slug}] unassigned mentions: ${stats.unassigned}`);

  // 2. Assign each to nearest narratives or pool of candidates
  for (const mention of unassignedRes.rows) {
    try {
      // N5/N6: dos etapas.
      //
      // La fase de asignación estaba MUERTA — `assigned = 0` en todas las
      // corridas — por dos razones medidas en producción:
      //   (a) el umbral 0.78 vive muy por encima de la similitud real: la
      //       máx-similitud promedio de una mención contra cualquier centroide
      //       es 0.44-0.51, así que 0.78 está en la cola de la distribución;
      //   (b) 1,273 de 1,291 narrativas (98.6%) están `dormant`, y el query las
      //       excluía por completo.
      //
      // Etapa 1: narrativas VIVAS con el umbral normal.
      // Etapa 2: narrativas DORMANT RECIENTES con un umbral más ALTO (0.82) —
      // resucitar exige más evidencia que continuar. Sin esta etapa `revived`
      // es estructuralmente inalcanzable: una dormant es invisible al matching,
      // así que nunca recibe menciones y su velocidad nunca sube. Medido:
      // incluir dormant recientes sube de 1 a 19 los matches de 642 menciones
      // de gobernadora en 7 días. La tabla tenía 0 filas con status='revived'.
      const nearest = await client.query<{ id: string; similarity: string; status: string }>(
        `SELECT id, (1 - (centroid <=> $1::vector)) AS similarity, status
           FROM narratives
           WHERE agency_id = $2
             AND centroid IS NOT NULL
             AND (
               status <> 'dormant'
               OR last_mention_at >= NOW() - ($4 || ' days')::interval
             )
           ORDER BY centroid <=> $1::vector
           LIMIT $3`,
        [mention.embedding, agency.id, TOP_N_MATCHES, REVIVE_WINDOW_DAYS],
      );

      const matches = nearest.rows
        .map((r) => ({ id: r.id, similarity: Number(r.similarity), status: r.status }))
        .filter((r) => r.similarity >= (r.status === 'dormant' ? REVIVE_THRESHOLD : THRESHOLD));

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
            // Math.round: engagement_score es float y las columnas son bigint —
            // pg manda "24194.000032621" y el cast ::bigint revienta (22P02).
            Math.round(mention.engagement_score ?? 0),
            Math.round(mention.reach_estimate ?? 0),
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
  // Poda de candidatos rancios: un candidato lleva ≥7 días en el pool sin
  // clusterizar Y su mención tiene >30 días — ya no va a parir narrativa de
  // actualidad. Sin la poda, el pool crece sin tope y los rancios bloquean la
  // ventana LIMIT del DBSCAN (oldest-first) para los candidatos nuevos.
  // N1: la poda usa EL MISMO predicado que la admisión. Antes exigía las DOS
  // condiciones (created_at >7d Y published_at >30d), así que un candidato de 10
  // días con mención de 20 no se podaba nunca pero tampoco clusterizaba; y el
  // query de no-asignadas, sin filtro de fecha, re-encolaba lo podado con
  // created_at fresco. El invariante ahora es simple: "está en el pool ⟺
  // published_at está en la ventana".
  await client.query(
    `DELETE FROM narrative_candidates nc
      USING mentions m
      WHERE m.id = nc.mention_id
        AND nc.agency_id = $1
        AND m.published_at < NOW() - ($2 || ' days')::interval`,
    [agency.id, CANDIDATE_WINDOW_DAYS],
  );

  const candRes = await client.query<CandidateRow>(
    `SELECT nc.id AS candidate_id,
            nc.mention_id AS id,
            nc.embedding::text AS embedding,
            m.title, m.snippet, m.author, m.published_at, m.url,
            m.engagement_score, m.reach_estimate, m.likes, m.comments, m.shares, m.page_type
       FROM narrative_candidates nc
       JOIN mentions m ON m.id = nc.mention_id
       WHERE nc.agency_id = $1
       AND m.is_duplicate = false
       -- N1: ventana temporal COHERENTE. Esta era la causa DOMINANTE de que la
       -- detección se degradara ~40x: el DBSCAN recibía siempre exactamente
       -- 12,000 candidatos ordenados por created_at ASC, de los cuales el 81.7%
       -- eran publicaciones de 2025 y sólo el 0.57% de los últimos 7 días — las
       -- menciones de hoy NUNCA entraban al muestreo. Medido sobre el pool real:
       -- una ventana de 72h da 29 core points con el eps que ya corre en
       -- producción; el pool oldest-first dio 0 clusters en 96 corridas.
       AND m.published_at >= NOW() - ($3 || ' days')::interval
       ORDER BY m.published_at DESC
       LIMIT $2`,
    [agency.id, CANDIDATE_POOL_LIMIT, CANDIDATE_WINDOW_DAYS],
  );

  if (candRes.rows.length < MIN_MENTIONS_BIRTH) {
    return { created: 0, named: 0 };
  }

  type Point = { row: CandidateRow; vec: number[] };
  const points: Point[] = candRes.rows.map((row) => ({
    row,
    vec: parseVectorLiteral(row.embedding),
  }));

  // N2: eps derivado de la ventana. Con NARRATIVE_EPS_AUTO=false vuelve al valor
  // de env, para poder comparar corridas.
  const dist = (a: Point, b: Point) => cosineDistance(a.vec, b.vec);
  let epsUsed = DBSCAN_EPS;
  let epsSource = 'env';
  if (EPS_AUTO && points.length > MIN_MENTIONS_BIRTH) {
    const auto = autoEps(points, dist, Math.max(1, MIN_MENTIONS_BIRTH - 1), EPS_PERCENTILE, EPS_MIN, EPS_MAX);
    epsUsed = auto.eps;
    epsSource = `auto p${Math.round(EPS_PERCENTILE * 100)} raw=${auto.raw.toFixed(3)}${auto.clamped ? ' clamp' : ''}`;
  }

  const { clusters } = dbscan(points, dist, epsUsed, MIN_MENTIONS_BIRTH);

  // N7: log estructurado. Sin esto, "la detección se congeló" tardó SEIS SEMANAS
  // en notarse. Estos son los campos que hay que alarmar.
  console.log(JSON.stringify({
    evt: 'narrative_dbscan',
    agency: agency.slug,
    candidates: candRes.rows.length,
    clusters: clusters.length,
    eps: Number(epsUsed.toFixed(4)),
    epsSource,
    minPts: MIN_MENTIONS_BIRTH,
    windowDays: CANDIDATE_WINDOW_DAYS,
  }));

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

      // Math.round: los scores son float y narratives.total_engagement/_reach
      // son bigint — un sum no entero tumba el INSERT completo (22P02) y la
      // narrativa se nombra (Bedrock gastado) pero nunca nace.
      const totalEngagement = Math.round(cluster.reduce(
        (sum, p) => sum + (p.row.engagement_score ?? 0),
        0,
      ));
      const totalReach = Math.round(cluster.reduce(
        (sum, p) => sum + (p.row.reach_estimate ?? 0),
        0,
      ));

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
    detected_days_ago: number | string | null;
    days_since_assigned: number | string | null;
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
            ) AS avg_velocity_7d,
            -- N6: born_at es la fecha de la mención MÁS VIEJA del cluster
            -- (index.ts usa first.published_at), así que con el pool
            -- oldest-first las narrativas nacían viejas. created_at es cuándo
            -- LA DETECTAMOS, que es lo que hace falta para 'emerging'.
            EXTRACT(EPOCH FROM (NOW() - n.created_at)) / 86400.0 AS detected_days_ago,
            -- N6: recencia por ASIGNACIÓN, no por publicación. Una narrativa
            -- detectada hoy sobre menciones de hace 5 días tenía velocity24h=0 y
            -- se marcaba 'declining' el mismo run que la creaba.
            (SELECT CASE WHEN MAX(nm.assigned_at) IS NULL THEN NULL
                         ELSE EXTRACT(EPOCH FROM (NOW() - MAX(nm.assigned_at))) / 86400.0 END
               FROM narrative_mentions nm WHERE nm.narrative_id = n.id
            ) AS days_since_assigned
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
      detectedDaysAgo: row.detected_days_ago == null ? undefined : Number(row.detected_days_ago),
      daysSinceAssigned: row.days_since_assigned == null ? undefined : Number(row.days_since_assigned),
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
         ORDER BY MAX(COALESCE(m.reach_estimate, 0)::bigint * (1 + COALESCE(m.likes,0) + COALESCE(m.comments,0) + COALESCE(m.shares,0))) DESC NULLS LAST
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
