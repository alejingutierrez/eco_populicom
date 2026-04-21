import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createHash } from 'crypto';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import type { BrandwatchMention, NlpAnalysis, Sentiment, Emotion } from '@eco/shared';
import { TOPIC_SLUGS_BY_AGENCY, SUBTOPIC_SLUGS_BY_AGENCY, TOPICS_BY_AGENCY, MUNICIPALITY_SLUGS, extractMunicipalitiesFromText } from '@eco/shared';

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
    // Batch dedup: one SELECT filters out mentions already in DB.
    const resourceIds: string[] = [];
    for (const r of event.Records) {
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

    const newRecords = event.Records.filter((r) => {
      try {
        const body = JSON.parse(r.body) as BrandwatchMention;
        return !existingSet.has(body.resourceId);
      } catch { return false; }
    });

    const skipped = event.Records.length - newRecords.length;
    console.log(`Batch: ${event.Records.length} records — ${skipped} duplicates skipped, ${newRecords.length} new`);

    // Parallelize NLP + inserts. `pg.Client` serializes DB queries internally,
    // but Bedrock calls run concurrently (the real bottleneck).
    if (newRecords.length > 0) {
      const results = await Promise.allSettled(
        newRecords.map((r) => processRecord(r, client)),
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        // Re-throw first error so SQS retries the batch.
        console.error(`${failed.length}/${newRecords.length} records failed in batch`);
        throw (failed[0] as PromiseRejectedResult).reason;
      }
    }
  } finally {
    await client.end();
  }
};

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

  // Call Claude Opus via Bedrock for NLP analysis
  const nlp = await analyzeWithClaude(mention, agency);

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

async function analyzeWithClaude(mention: BrandwatchMention, agency: AgencyInfo): Promise<NlpAnalysis> {
  const agencyTopics = TOPICS_BY_AGENCY[agency.slug] ?? [];
  const topicSlugs = agencyTopics.map((t) => t.slug).join(', ');
  const subtopicSlugs = agencyTopics.flatMap((t) => t.subtopics.map((s) => s.slug)).join(', ');

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

Responde SOLO con JSON válido (sin markdown, sin backticks):
{
  "sentiment": "negativo" | "neutral" | "positivo",
  "emotions": [],
  "pertinence": "alta" | "media" | "baja",
  "topics": [{ "topic_slug": "...", "subtopic_slug": "...", "confidence": 0.0 }],
  "municipalities": [],
  "summary": "Resumen de una línea"
}

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

TOPICS:
- usar SOLO estos slugs: ${topicSlugs}
- subtopic_slug (opcional): ${subtopicSlugs}
- Máximo 3 tópicos por mención.
- confidence: 0.0 a 1.0.

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

  let text: string | null = null;
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
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
          }),
        }),
      );
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      text = responseBody.content[0].text;
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
  if (text === null) {
    throw lastErr ?? new Error('No Bedrock model produced a response');
  }

  try {
    // Strip markdown code fences if present
    const cleanText = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleanText) as NlpAnalysis;
    return validateNlpResult(parsed, agency.slug);
  } catch (err) {
    console.error(`[${agency.slug}] Failed to parse NLP response for ${mention.resourceId}:`, text);
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
    municipalities: (raw.municipalities ?? []).filter((m) => MUNICIPALITY_SLUGS.includes(m)),
    summary: (raw.summary ?? '').slice(0, 500),
  };
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
