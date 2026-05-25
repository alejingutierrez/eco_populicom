import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createHash } from 'crypto';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import type { BrandwatchMention, NlpAnalysis, Sentiment, Emotion, ManualMentionInput, ManualMentionSqsMessage } from '@eco/shared';
import { TOPIC_SLUGS_BY_AGENCY, SUBTOPIC_SLUGS_BY_AGENCY, TOPICS_BY_AGENCY, MUNICIPALITY_SLUGS, extractMunicipalitiesFromText, canonicalizeUrl, isManualMessage } from '@eco/shared';
import { buildEmbeddingInput, embedText, toPgvectorLiteral } from '../lib/embeddings';

const bedrock = new BedrockRuntimeClient({});
const sqs = new SQSClient({});
const sm = new SecretsManagerClient({});

const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
const ALERTS_QUEUE_URL = process.env.ALERTS_QUEUE_URL!;
// Primary model: best quality. Fallback: used when primary is throttled/quota-agotado.
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1';
const BEDROCK_FALLBACK_MODEL_ID = process.env.BEDROCK_FALLBACK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';

// Soft circuit-breaker: once the primary model throttles, skip it for this many
// milliseconds to avoid hammering a quota that's been consumed for the day.
const PRIMARY_COOLDOWN_MS = 5 * 60 * 1000;
let primaryCooldownUntil = 0;

function isThrottlingError(err: unknown): boolean {
  const e = err as { name?: string; message?: string };
  if (!e) return false;
  if (e.name === 'ThrottlingException') return true;
  const msg = String(e.message ?? '').toLowerCase();
  return msg.includes('too many tokens') || msg.includes('too many requests') || msg.includes('throttl');
}

let dbUrl: string | null = null;

interface AgencyInfo { id: string; slug: string; name: string; }
let agencyMap: Map<number, AgencyInfo> | null = null;

async function loadAgencyMap(dbUrl: string): Promise<Map<number, AgencyInfo>> {
  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query(
      'SELECT id, slug, name, brandwatch_query_ids FROM agencies WHERE is_active = true AND brandwatch_query_ids IS NOT NULL'
    );
    const map = new Map<number, AgencyInfo>();
    for (const row of result.rows) {
      for (const qid of row.brandwatch_query_ids as number[]) {
        map.set(qid, { id: row.id, slug: row.slug, name: row.name });
      }
    }
    return map;
  } finally { await client.end(); }
}

type ReprocessEvent = { action: 'reprocess-nlp-errors' };
type ProcessorEvent = SQSEvent | ReprocessEvent;

function isReprocessEvent(e: ProcessorEvent): e is ReprocessEvent {
  return typeof (e as ReprocessEvent).action === 'string' && (e as ReprocessEvent).action === 'reprocess-nlp-errors';
}

export const handler = async (event: ProcessorEvent): Promise<unknown> => {
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

  if (isReprocessEvent(event)) {
    try {
      return await reprocessNlpErrors(client);
    } finally {
      await client.end();
    }
  }

  console.log(`Processing ${event.Records.length} records`);

  try {
    // Particionar el batch en {brandwatch, manual}. Los mensajes manuales
    // (Excel / URL import) llevan `__source: 'manual_*'` y `agencyId` en el
    // body — no se resuelven por queryId y deduplican por url_canonical.
    const bwRecords: SQSRecord[] = [];
    const manualRecords: { record: SQSRecord; message: ManualMentionSqsMessage }[] = [];
    for (const r of event.Records) {
      let parsed: unknown;
      try { parsed = JSON.parse(r.body); } catch { continue; }
      if (isManualMessage(parsed)) {
        manualRecords.push({ record: r, message: parsed });
      } else {
        bwRecords.push(r);
      }
    }

    // --- Brandwatch path (existente) ---
    let bwFailed: unknown = null;
    if (bwRecords.length > 0) {
      // Batch dedup: one SELECT filters out mentions already in DB.
      const resourceIds: string[] = [];
      for (const r of bwRecords) {
        try {
          const body = JSON.parse(r.body) as BrandwatchMention;
          if (body.resourceId) resourceIds.push(body.resourceId);
        } catch { /* skip malformed */ }
      }

      let existingSet = new Set<string>();
      if (resourceIds.length > 0) {
        const existing = await client.query(
          'SELECT bw_resource_id FROM mentions WHERE bw_resource_id = ANY($1::text[])',
          [resourceIds],
        );
        existingSet = new Set(existing.rows.map((r: any) => r.bw_resource_id));
      }

      const newRecords = bwRecords.filter((r) => {
        try {
          const body = JSON.parse(r.body) as BrandwatchMention;
          return !existingSet.has(body.resourceId);
        } catch { return false; }
      });

      const skipped = bwRecords.length - newRecords.length;
      console.log(`Brandwatch batch: ${bwRecords.length} records — ${skipped} duplicates skipped, ${newRecords.length} new`);

      if (newRecords.length > 0) {
        const results = await Promise.allSettled(
          newRecords.map((r) => processRecord(r, client)),
        );
        const failed = results.filter((r) => r.status === 'rejected');
        if (failed.length > 0) {
          console.error(`${failed.length}/${newRecords.length} Brandwatch records failed in batch`);
          bwFailed = (failed[0] as PromiseRejectedResult).reason;
        }
      }
    }

    // --- Manual path (Excel/URL import) ---
    //
    // Diferencias vs Brandwatch:
    //   • Dedup por url_canonical (no bw_resource_id)
    //   • INSERT con ON CONFLICT ... DO UPDATE (upsert seguro contra race)
    //   • Errores per-row NO tiran el batch — quedan en mention_imports.errors_json
    //   • Después de cada record, UPDATE mention_imports.rows_processed
    if (manualRecords.length > 0) {
      console.log(`Manual import batch: ${manualRecords.length} records`);
      const results = await Promise.allSettled(
        manualRecords.map(({ message }) => processManualRecord(message, client)),
      );
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'rejected') {
          const { message } = manualRecords[i];
          console.warn(`Manual record failed: ${(r.reason as Error)?.message}`);
          // Append error a mention_imports.errors_json sin tirar el batch
          try {
            await client.query(
              `UPDATE mention_imports
                  SET errors_json = COALESCE(errors_json, '[]'::jsonb) || $1::jsonb,
                      rows_error  = COALESCE(rows_error, 0) + 1
                WHERE id = $2`,
              [
                JSON.stringify([{
                  url: message.mention.url,
                  errorMessage: (r.reason as Error)?.message ?? String(r.reason),
                }]),
                message.sourceImportId,
              ],
            );
          } catch (logErr) {
            console.error('Failed to log manual error:', logErr);
          }
        }
      }
      // Marcar 'completed' si ya no quedan rows pendientes en este import.
      // Hacemos esto por cada sourceImportId único en el batch.
      const importIds = Array.from(new Set(manualRecords.map((m) => m.message.sourceImportId)));
      for (const importId of importIds) {
        await maybeMarkImportCompleted(client, importId);
      }
    }

    if (bwFailed) {
      // Re-throw después de procesar manual para que SQS retry-ee el batch
      // (los mensajes manuales que sí completaron quedan asentados — el
      // UPSERT garantiza idempotencia).
      throw bwFailed;
    }
  } finally {
    await client.end();
  }
  return;
};

/**
 * Marca el import como 'completed' si rows_processed cubre todo lo
 * despachado (rows_new + rows_update). Idempotente: si ya está completed
 * no hace nada.
 */
async function maybeMarkImportCompleted(pgClient: any, importId: string): Promise<void> {
  await pgClient.query(
    `UPDATE mention_imports
        SET status = 'completed',
            completed_at = NOW()
      WHERE id = $1
        AND status = 'committing'
        AND rows_processed >= COALESCE(rows_new, 0) + COALESCE(rows_update, 0)`,
    [importId],
  );
}

async function processRecord(record: SQSRecord, pgClient: any): Promise<void> {
  const mention: BrandwatchMention = JSON.parse(record.body);
  const resourceId = mention.resourceId;

  let agency = agencyMap!.get(mention.queryId);
  if (!agency) {
    // Stale warm-container cache — refresh from DB before giving up
    console.log(`queryId ${mention.queryId} not in cached map (size=${agencyMap!.size}); refreshing`);
    agencyMap = await loadAgencyMap(dbUrl!);
    agency = agencyMap.get(mention.queryId);
  }
  if (!agency) {
    // Truly unknown even after refresh — throw so SQS retries/DLQ handles it
    throw new Error(`Unknown queryId ${mention.queryId} after refresh — check agency seed`);
  }

  // NOTE: bw_resource_id existence check is done in the handler via batch SELECT,
  // so this record is guaranteed new here. The INSERT still has a UNIQUE guard.

  // Compute text hash for deduplication
  const textForHash = normalizeText((mention.title ?? '') + ' ' + (mention.snippet ?? ''));
  const textHash = createHash('sha256').update(textForHash).digest('hex');

  // Check for duplicate text
  const duplicate = await pgClient.query(
    'SELECT id FROM mentions WHERE text_hash = $1 AND agency_id = $2 LIMIT 1',
    [textHash, agency.id],
  );
  const isDuplicate = duplicate.rows.length > 0;
  const duplicateOfId = isDuplicate ? duplicate.rows[0].id : null;

  // Skip-empty: Brandwatch ocasionalmente entrega menciones sin título ni
  // snippet. Sin texto el LLM no puede asignar tópico (queda 'Sin clasificar'
  // en el reporte) — bypass Bedrock, persiste con pertinencia=baja.
  const isEmpty = !mention.title?.trim() && !mention.snippet?.trim();

  let nlp: NlpAnalysis;
  if (isEmpty) {
    console.log(`[${agency.slug}] Skip-empty: mention ${resourceId} has no title or snippet — bypassing Bedrock`);
    nlp = {
      sentiment: 'neutral',
      emotions: [],
      pertinence: 'baja',
      topics: [],
      municipalities: [],
      summary: 'Mención sin contenido textual',
    };
  } else {
    nlp = await analyzeWithClaude(mention, agency);
  }

  // Reinforce municipality coverage with a deterministic regex pass over the
  // text Claude saw. Merges with Claude's output and dedupes. This alone took
  // coverage from 31% to >70% on a sample in local tests.
  const regexMunis = extractMunicipalitiesFromText(mention.title, mention.snippet, nlp.summary);
  const mergedMunis = Array.from(new Set([...(nlp.municipalities ?? []), ...regexMunis]));
  nlp.municipalities = mergedMunis.filter((m) => MUNICIPALITY_SLUGS.includes(m));

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
      parsePublishedAt(mention), mention.language ?? 'es',
    ],
  );

  const mentionId = mentionResult.rows[0].id;

  // Best-effort: generar embedding del contenido para "menciones similares".
  // No bloquea el resto del procesamiento — si Bedrock falla, la mención
  // queda sin embedding y el backfill la recogerá después.
  const embedInput = buildEmbeddingInput(mention.title, mention.snippet);
  if (embedInput) {
    const vec = await embedText(embedInput);
    if (vec) {
      await pgClient.query(
        'UPDATE mentions SET embedding = $1::vector, embedded_at = NOW() WHERE id = $2',
        [toPgvectorLiteral(vec), mentionId],
      );
    }
  }

  // Insert topic associations
  for (const topic of nlp.topics) {
    // Look up topic ID scoped to agency
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

/**
 * Procesa un mensaje SQS de import manual (Excel o URL).
 *
 * Diferencias vs processRecord:
 *   • agencyId viene del payload (no via queryId lookup)
 *   • dedup por url_canonical (no bw_resource_id)
 *   • INSERT … ON CONFLICT (agency_id, url_canonical) … DO UPDATE — upsert
 *     que completa solo campos NULL (no sobreescribe data de Brandwatch)
 *   • Setea ingestion_source + source_import_id
 *   • Al final, UPDATE mention_imports.rows_processed +1
 *
 * Reutiliza: analyzeWithClaude (via adapter), embedding, mention_topics,
 * mention_municipalities, slugify, parsePublishedAt.
 */
async function processManualRecord(msg: ManualMentionSqsMessage, pgClient: any): Promise<void> {
  const { mention, agencyId, sourceImportId, __source } = msg;

  // Cargar info de la agencia para el prompt NLP (necesita name + slug)
  const agencyRow = await pgClient.query(
    'SELECT id, slug, name FROM agencies WHERE id = $1',
    [agencyId],
  );
  if (agencyRow.rows.length === 0) {
    throw new Error(`Manual record: unknown agency_id ${agencyId} for import ${sourceImportId}`);
  }
  const agency: AgencyInfo = agencyRow.rows[0];

  // Compute text hash for dedup secundario (mismo patrón que Brandwatch)
  const textForHash = normalizeText((mention.title ?? '') + ' ' + (mention.snippet ?? ''));
  const textHash = createHash('sha256').update(textForHash).digest('hex');

  // NLP — adapter sobre BrandwatchMention shape para reutilizar analyzeWithClaude.
  // Si título y snippet vacíos, skip Bedrock (mismo bypass que el path Brandwatch).
  const isEmpty = !mention.title?.trim() && !mention.snippet?.trim();
  let nlp: NlpAnalysis;
  if (isEmpty) {
    nlp = {
      sentiment: 'neutral',
      emotions: [],
      pertinence: 'baja',
      topics: [],
      municipalities: [],
      summary: 'Mención sin contenido textual',
    };
  } else {
    const adapter = manualToBrandwatchAdapter(mention);
    nlp = await analyzeWithClaude(adapter, agency);
  }

  // Refuerzo determinístico por regex (idéntico al path Brandwatch).
  const regexMunis = extractMunicipalitiesFromText(mention.title, mention.snippet, nlp.summary);
  const mergedMunis = Array.from(new Set([...(nlp.municipalities ?? []), ...regexMunis]));
  nlp.municipalities = mergedMunis.filter((m) => MUNICIPALITY_SLUGS.includes(m));

  // pageType: requerido por schema (notNull). Si el preview lambda no lo
  // setteó, derivar del dominio.
  const pageType = mention.pageType || 'web';

  // INSERT con upsert. ON CONFLICT (agency_id, url_canonical) hace match
  // contra el unique partial index. DO UPDATE solo rellena campos NULL
  // (COALESCE: si la row existente ya tiene valor, lo respeta).
  //
  // NOTA: published_at en upsert se mantiene si la existente ya tiene uno
  // — Brandwatch normalmente lo trae bien y no queremos pisarlo.
  const mentionResult = await pgClient.query(
    `INSERT INTO mentions (
      agency_id, bw_resource_id, bw_guid, bw_query_id, bw_query_name,
      title, snippet, url, url_canonical, original_url,
      author, author_fullname, author_gender, author_avatar_url,
      domain, page_type, content_source, content_source_name, pub_type, subtype,
      likes, comments, shares, engagement_score, impact, reach_estimate, potential_audience, monthly_visitors,
      bw_country, bw_country_code, bw_region, bw_city,
      bw_sentiment,
      nlp_sentiment, nlp_emotions, nlp_pertinence, nlp_summary,
      text_hash, is_duplicate, duplicate_of_id,
      media_urls, has_image, has_video,
      published_at, processed_at, language,
      ingestion_source, source_import_id
    ) VALUES (
      $1, NULL, NULL, NULL, NULL,
      $2, $3, $4, $5, $4,
      $6, $7, NULL, $8,
      $9, $10, NULL, NULL, NULL, NULL,
      $11, $12, $13, $14, $15, $16, $17, $18,
      $19, $20, $21, $22,
      $23,
      $24, $25, $26, $27,
      $28, FALSE, NULL,
      $29, $30, $31,
      $32, NOW(), $33,
      $34, $35
    )
    ON CONFLICT (agency_id, url_canonical) WHERE url_canonical IS NOT NULL
    DO UPDATE SET
      title              = COALESCE(mentions.title,              EXCLUDED.title),
      snippet            = COALESCE(mentions.snippet,            EXCLUDED.snippet),
      author             = COALESCE(mentions.author,             EXCLUDED.author),
      author_fullname    = COALESCE(mentions.author_fullname,    EXCLUDED.author_fullname),
      author_avatar_url  = COALESCE(mentions.author_avatar_url,  EXCLUDED.author_avatar_url),
      media_urls         = COALESCE(mentions.media_urls,         EXCLUDED.media_urls),
      likes              = CASE WHEN mentions.likes = 0     THEN EXCLUDED.likes     ELSE mentions.likes     END,
      comments           = CASE WHEN mentions.comments = 0  THEN EXCLUDED.comments  ELSE mentions.comments  END,
      shares             = CASE WHEN mentions.shares = 0    THEN EXCLUDED.shares    ELSE mentions.shares    END,
      reach_estimate     = CASE WHEN mentions.reach_estimate = 0 THEN EXCLUDED.reach_estimate ELSE mentions.reach_estimate END,
      potential_audience = CASE WHEN mentions.potential_audience = 0 THEN EXCLUDED.potential_audience ELSE mentions.potential_audience END,
      engagement_score   = CASE WHEN mentions.engagement_score = 0 THEN EXCLUDED.engagement_score ELSE mentions.engagement_score END,
      impact             = CASE WHEN mentions.impact = 0 THEN EXCLUDED.impact ELSE mentions.impact END,
      nlp_sentiment      = COALESCE(mentions.nlp_sentiment,      EXCLUDED.nlp_sentiment),
      nlp_emotions       = COALESCE(mentions.nlp_emotions,       EXCLUDED.nlp_emotions),
      nlp_pertinence     = COALESCE(mentions.nlp_pertinence,     EXCLUDED.nlp_pertinence),
      nlp_summary        = COALESCE(mentions.nlp_summary,        EXCLUDED.nlp_summary),
      processed_at       = NOW(),
      source_import_id   = COALESCE(mentions.source_import_id,   EXCLUDED.source_import_id),
      ingestion_source   = CASE WHEN mentions.ingestion_source = 'brandwatch' THEN mentions.ingestion_source ELSE EXCLUDED.ingestion_source END
    RETURNING id`,
    [
      agency.id,
      mention.title ?? null, mention.snippet ?? null, mention.url, mention.urlCanonical,
      mention.author ?? null, mention.authorFullname ?? null, mention.authorAvatarUrl ?? null,
      mention.domain, pageType,
      mention.likes ?? 0, mention.comments ?? 0, mention.shares ?? 0,
      mention.engagementScore ?? 0, mention.impact ?? 0, mention.reachEstimate ?? 0,
      mention.potentialAudience ?? 0, mention.monthlyVisitors ?? 0,
      mention.bwCountry ?? null, mention.bwCountryCode ?? null, mention.bwRegion ?? null, mention.bwCity ?? null,
      mention.bwSentiment ?? null,
      nlp.sentiment, JSON.stringify(nlp.emotions), nlp.pertinence, nlp.summary,
      textHash,
      JSON.stringify(mention.mediaUrls ?? []),
      (mention.mediaUrls?.length ?? 0) > 0,
      mention.subtype === 'video',
      new Date(mention.publishedAt), mention.language ?? 'es',
      __source, sourceImportId,
    ],
  );

  const mentionId = mentionResult.rows[0].id;

  // Embedding best-effort (mismo patrón que Brandwatch)
  const embedInput = buildEmbeddingInput(mention.title, mention.snippet);
  if (embedInput) {
    const vec = await embedText(embedInput);
    if (vec) {
      await pgClient.query(
        'UPDATE mentions SET embedding = $1::vector, embedded_at = NOW() WHERE id = $2 AND embedding IS NULL',
        [toPgvectorLiteral(vec), mentionId],
      );
    }
  }

  // Topics
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

  // Municipalities (NLP)
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

  // Brandwatch geo (si vino en el Excel)
  if (mention.bwCity) {
    const citySlug = slugify(mention.bwCity);
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

  // Alertas (mismo trigger que Brandwatch)
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
          publishedAt: mention.publishedAt,
        }),
      }),
    );
  }

  // Tracking de progreso del import
  await pgClient.query(
    `UPDATE mention_imports
        SET rows_processed = COALESCE(rows_processed, 0) + 1
      WHERE id = $1`,
    [sourceImportId],
  );

  console.log(`[${agency.slug}] Manual mention ${mention.url} processed (${__source}): sentiment=${nlp.sentiment}, pertinence=${nlp.pertinence}`);
}

/**
 * Adapta un ManualMentionInput a la forma BrandwatchMention para reutilizar
 * `analyzeWithClaude` sin cambios. Solo poblamos los campos que el prompt
 * realmente lee (title, snippet, contentSourceName, domain, author, date,
 * sentiment).
 */
function manualToBrandwatchAdapter(m: ManualMentionInput): BrandwatchMention {
  return {
    resourceId: m.urlCanonical, // placeholder — analyzeWithClaude no lo usa
    guid: m.urlCanonical,
    queryId: 0,
    queryName: '',
    title: m.title,
    snippet: m.snippet,
    url: m.url,
    originalUrl: m.url,
    author: m.author,
    fullname: m.authorFullname,
    avatarUrl: m.authorAvatarUrl,
    domain: m.domain,
    pageType: m.pageType,
    contentSource: m.contentSource,
    contentSourceName: m.contentSourceName,
    subtype: m.subtype,
    likes: m.likes,
    comments: m.comments,
    shares: m.shares,
    engagementScore: m.engagementScore,
    impact: m.impact,
    reachEstimate: m.reachEstimate,
    potentialAudience: m.potentialAudience,
    monthlyVisitors: m.monthlyVisitors,
    country: m.bwCountry,
    countryCode: m.bwCountryCode,
    region: m.bwRegion,
    city: m.bwCity,
    sentiment: m.bwSentiment,
    mediaUrls: m.mediaUrls,
    language: m.language,
    date: m.publishedAt,
  } as BrandwatchMention;
}

async function analyzeWithClaude(mention: BrandwatchMention, agency: AgencyInfo): Promise<NlpAnalysis> {
  const agencyTopics = TOPICS_BY_AGENCY[agency.slug] ?? [];
  const topicSlugs = agencyTopics.map((t) => t.slug).join(', ');
  const subtopicSlugs = agencyTopics.flatMap((t) => t.subtopics.map((s) => s.slug)).join(', ');

  // Construye el menú de subtopics anidado bajo cada topic padre, con sus
  // descripciones cortas. Esto evita que Claude empareje un subtopic con un
  // topic incorrecto (problema con la lista plana anterior).
  const topicSubtopicMenu = agencyTopics
    .map((t) => {
      if (!t.subtopics.length) return `  • ${t.slug} — ${t.name}: (sin subtopics)`;
      const subs = t.subtopics.map((s) => `      - ${s.slug} — ${s.description}`).join('\n');
      return `  • ${t.slug} — ${t.name}:\n${subs}`;
    })
    .join('\n');

  // Pass Brandwatch's own sentiment (positive/neutral/negative) as a hint so
  // Claude has an anchor. Historically Claude was too positive — it rated
  // 5,600 "bw=neutral" news items as "positivo". The rules below bias
  // toward neutral for factual reporting and require overt language for a
  // positivo call.
  const bwSentimentHint = mention.sentiment
    ? `\nSentimiento Brandwatch (referencia): ${mention.sentiment}`
    : '';

  const prompt = `Eres un analista de social listening especializado en Puerto Rico.
Analiza esta mención sobre ${agency.name}.

MENCIÓN:
Título: ${mention.title ?? '(sin título)'}
Texto: ${mention.snippet ?? '(sin texto)'}
Fuente: ${mention.contentSourceName ?? mention.domain} (${mention.domain})
Autor: ${mention.author ?? 'Desconocido'}
Fecha: ${mention.date}${bwSentimentHint}

Llama a la herramienta classify_mention con los campos correctos.

REGLAS DE SENTIMIENTO (muy importantes — los datos actuales tienen sesgo positivo):
- "positivo" EXCLUSIVAMENTE cuando el autor/medio expresa evaluación explícitamente favorable hacia ${agency.name}: elogios, logros celebrados por la ciudadanía, resolución de problemas agradecida, decisiones aplaudidas. Señales: "felicita", "excelente", "gracias a", "aplauden", "reconocimiento".
- "negativo" cuando la mención expresa queja, crítica, denuncia, fallo operativo, escándalo, protesta, reclamo ciudadano, o el autor/medio usa lenguaje desfavorable. Señales: "denuncia", "protesta", "falla", "critica", "cuestiona", "sigue sin", "años sin", "exigen".
- "neutral" por defecto para: reportajes informativos sin valoración, comunicados oficiales, anuncios institucionales sin reacción pública visible, datos, números de contacto, inauguraciones descritas sin entusiasmo evaluativo. Si el texto solo DESCRIBE sin evaluar, es neutral.
- NO marques positivo solo porque se resuelva un problema o se inaugure algo. Solo cuando haya elogio explícito.
- Si el Sentimiento Brandwatch dice "neutral", usa "neutral" salvo que el texto tenga señales inequívocas de positivo/negativo.

PERTINENCIA:
- "alta" si la mención TRATA sobre ${agency.name}. "media" si ${agency.name} es secundaria. "baja" si ${agency.name} se menciona de paso.

EMOTIONS:
- del set [frustración, enojo, alivio, gratitud, preocupación, sarcasmo, indiferencia]. Máximo 3. Omite el campo si el texto es meramente factual.

TOPICS Y SUBTOPICS (menú jerárquico — el subtopic_slug DEBE pertenecer al topic_slug elegido):
${topicSubtopicMenu}

REGLAS DE TOPICS/SUBTOPICS:
- topic_slug obligatorio. Usa SOLO uno de: ${topicSlugs}.
- subtopic_slug opcional pero MUY recomendado. Debe ser uno de los listados bajo el topic_slug elegido. NUNCA mezcles un subtopic de un topic con otro topic.
- Máximo 3 tópicos por mención. confidence: 0.0 a 1.0.

REGLAS DE ROUTING CROSS-TOPIC (cuando la mención toca varios temas, elige UNO primario):
- Si el post anuncia el NÚMERO DE EMPLEOS como hecho central → topic = empleo-fuerza-laboral. Si habla de la DECISIÓN/SECTOR corporativo → topic = inversion-extranjera.
- Misión comercial España: si centra en "empresas PR exportando" → comercio-exterior; si centra en "atraer capital ES a PR" → inversion-extranjera.
- Hotel boutique con créditos Ley 60: si la conversación es "caso de éxito turístico" → turismo-economia; si es "controversia Ley 60" → incentivos-economicos.
- Compañía Turismo separación: legislacion-economica (NO turismo-economia).
- OGPe / PC 1183 / inspecciones bomberos: si discute "permisos como sistema" → permisos-reforma; si discute "DDEC como agencia receptora/cedente de funciones" → legislacion-economica.
- Críticas dirigidas a la PERSONA del Secretario (credibilidad, gestión, viajes): topic = gestion-secretario con sentiment=negativo; reserva criticas-controversias para críticas al PROYECTO o al MODELO económico, no a la persona.
- FITUR: turismo-economia.fitur-y-promocion-internacional (NO comercio-exterior).

MUNICIPALITIES:
- Slugs de los 78 municipios de PR (ej: san-juan, ponce, bayamon, mayaguez).
- Incluye TODO municipio mencionado por nombre, barrio (Santurce→san-juan, Río Piedras→san-juan, Levittown→toa-baja, Condado→san-juan) o contexto geográfico claro.
- Si el texto menciona sólo "Puerto Rico" sin municipio, deja el array vacío.`;

  const modelsToTry: string[] = [];
  const now = Date.now();
  if (now >= primaryCooldownUntil) {
    modelsToTry.push(BEDROCK_MODEL_ID);
  }
  if (BEDROCK_FALLBACK_MODEL_ID && BEDROCK_FALLBACK_MODEL_ID !== BEDROCK_MODEL_ID) {
    modelsToTry.push(BEDROCK_FALLBACK_MODEL_ID);
  }

  // Bedrock tool-use con input_schema: garantiza un objeto estructurado y
  // elimina parse-errors de JSON crudo (rompe con `"`/`\n` mal escapados).
  const classifyTool = {
    name: 'classify_mention',
    description: 'Registra la clasificación NLP de una mención de social listening sobre la agencia.',
    input_schema: {
      type: 'object',
      properties: {
        sentiment: { type: 'string', enum: ['negativo', 'neutral', 'positivo'] },
        emotions: {
          type: 'array',
          maxItems: 3,
          items: { type: 'string', enum: ['frustración', 'enojo', 'alivio', 'gratitud', 'preocupación', 'sarcasmo', 'indiferencia'] },
        },
        pertinence: { type: 'string', enum: ['alta', 'media', 'baja'] },
        topics: {
          type: 'array',
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              topic_slug: { type: 'string' },
              subtopic_slug: { type: 'string' },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['topic_slug', 'confidence'],
          },
        },
        municipalities: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
      required: ['sentiment', 'pertinence', 'summary'],
    },
  };

  let parsed: NlpAnalysis | null = null;
  let lastErr: unknown = null;
  for (const modelId of modelsToTry) {
    try {
      const response = await bedrock.send(
        new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 1024,
            temperature: 0.1,
            messages: [{ role: 'user', content: prompt }],
            tools: [classifyTool],
            tool_choice: { type: 'tool', name: 'classify_mention' },
          }),
        }),
      );
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const blocks = (responseBody.content ?? []) as Array<{ type: string; input?: unknown }>;
      const toolUse = blocks.find((b) => b.type === 'tool_use');
      if (!toolUse?.input) {
        lastErr = new Error(`Bedrock returned no tool_use block (stop_reason=${responseBody.stop_reason})`);
        continue;
      }
      parsed = toolUse.input as NlpAnalysis;
      break;
    } catch (err) {
      lastErr = err;
      if (isThrottlingError(err) && modelId === BEDROCK_MODEL_ID) {
        primaryCooldownUntil = Date.now() + PRIMARY_COOLDOWN_MS;
        console.warn(`[${agency.slug}] Primary model ${modelId} throttled; cooling down ${PRIMARY_COOLDOWN_MS / 1000}s, falling back`);
        continue;
      }
      throw err;
    }
  }

  if (parsed === null) {
    console.error(`[${agency.slug}] Bedrock failed for ${mention.resourceId}:`, lastErr);
    return {
      sentiment: 'neutral',
      emotions: [],
      pertinence: 'media',
      topics: [],
      municipalities: [],
      summary: 'Error en análisis NLP',
    };
  }

  return validateNlpResult(parsed, agency.slug);
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
    municipalities: (raw.municipalities ?? []).filter((m) => MUNICIPALITY_SLUGS.includes(m)),
    summary: (raw.summary ?? '').slice(0, 500),
  };
}

async function reprocessNlpErrors(pgClient: any): Promise<{ reprocessed: number; failed: number; details: any[] }> {
  const errors = await pgClient.query(`
    SELECT m.id, m.bw_resource_id, m.bw_guid, m.bw_query_id, m.bw_query_name,
           m.title, m.snippet, m.url, m.domain, m.content_source, m.content_source_name,
           m.author, m.published_at, m.bw_sentiment, m.language,
           m.agency_id, a.slug AS agency_slug, a.name AS agency_name
      FROM mentions m JOIN agencies a ON a.id = m.agency_id
     WHERE m.nlp_summary = 'Error en análisis NLP'
     ORDER BY m.published_at DESC`);

  console.log(`[reprocess-nlp-errors] Found ${errors.rows.length} mentions to retry`);

  const details: any[] = [];
  let reprocessed = 0;
  let failed = 0;

  for (const row of errors.rows) {
    const agency: AgencyInfo = { id: row.agency_id, slug: row.agency_slug, name: row.agency_name };
    const mention: BrandwatchMention = {
      resourceId: row.bw_resource_id,
      guid: row.bw_guid,
      queryId: row.bw_query_id,
      queryName: row.bw_query_name,
      title: row.title,
      snippet: row.snippet,
      url: row.url,
      domain: row.domain,
      contentSource: row.content_source,
      contentSourceName: row.content_source_name,
      author: row.author,
      date: (row.published_at instanceof Date ? row.published_at.toISOString() : row.published_at),
      sentiment: row.bw_sentiment,
      language: row.language,
    } as BrandwatchMention;

    try {
      const nlp = await analyzeWithClaude(mention, agency);
      if (nlp.summary === 'Error en análisis NLP') {
        throw new Error('Bedrock still returns error (tool-use fallback)');
      }

      await pgClient.query(
        `UPDATE mentions
            SET nlp_sentiment = $1,
                nlp_emotions = $2,
                nlp_pertinence = $3,
                nlp_summary = $4
          WHERE id = $5`,
        [nlp.sentiment, JSON.stringify(nlp.emotions ?? []), nlp.pertinence, (nlp.summary ?? '').slice(0, 500), row.id],
      );

      await pgClient.query('DELETE FROM mention_topics WHERE mention_id = $1', [row.id]);
      for (const t of nlp.topics ?? []) {
        const topicRow = await pgClient.query(
          'SELECT id FROM topics WHERE slug = $1 AND agency_id = $2',
          [t.topic_slug, row.agency_id],
        );
        if (topicRow.rows.length === 0) continue;
        let subtopicId: number | null = null;
        if (t.subtopic_slug) {
          const subRow = await pgClient.query(
            'SELECT id FROM subtopics WHERE slug = $1 AND topic_id = $2',
            [t.subtopic_slug, topicRow.rows[0].id],
          );
          subtopicId = subRow.rows[0]?.id ?? null;
        }
        await pgClient.query(
          `INSERT INTO mention_topics (mention_id, topic_id, subtopic_id, confidence)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [row.id, topicRow.rows[0].id, subtopicId, t.confidence],
        );
      }

      await pgClient.query(`DELETE FROM mention_municipalities WHERE mention_id = $1 AND source = 'nlp'`, [row.id]);
      for (const muniSlug of nlp.municipalities ?? []) {
        const muniRow = await pgClient.query('SELECT id FROM municipalities WHERE slug = $1', [muniSlug]);
        if (muniRow.rows.length > 0) {
          await pgClient.query(
            `INSERT INTO mention_municipalities (mention_id, municipality_id, source)
             VALUES ($1, $2, 'nlp') ON CONFLICT DO NOTHING`,
            [row.id, muniRow.rows[0].id],
          );
        }
      }

      reprocessed++;
      details.push({ id: row.id, status: 'ok', sentiment: nlp.sentiment, pertinence: nlp.pertinence, topics: (nlp.topics ?? []).length });
    } catch (err: any) {
      failed++;
      details.push({ id: row.id, status: 'failed', error: String(err?.message ?? err) });
      console.error(`[reprocess-nlp-errors] mention ${row.id} failed:`, err);
    }
  }

  return { reprocessed, failed, details };
}

function parsePublishedAt(m: BrandwatchMention): Date {
  // Brandwatch sometimes omits `date`; fall back to `added` (when BW received it).
  // We DO NOT fall back to `new Date()` anymore: a NOW() fallback silently
  // collapses undated historical mentions onto the ingest day and inflates
  // whichever AST day the cron happened to run on. Instead we throw so SQS
  // retries and eventually routes the record to DLQ for manual inspection.
  const raw = m.date || (m as any).added;
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    console.warn(`Mention ${m.resourceId}: invalid date value ${JSON.stringify(raw)} — rejecting`);
  } else {
    console.warn(`Mention ${m.resourceId}: no date/added field — rejecting`);
  }
  throw new Error(`Mention ${m.resourceId} missing usable published_at`);
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
