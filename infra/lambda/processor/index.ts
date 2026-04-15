import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createHash } from 'crypto';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import type { BrandwatchMention, NlpAnalysis, Sentiment, Emotion } from '@eco/shared';
import { TOPICS_BY_AGENCY, TOPIC_SLUGS_BY_AGENCY, SUBTOPIC_SLUGS_BY_AGENCY } from '@eco/shared';

const bedrock = new BedrockRuntimeClient({});
const sqs = new SQSClient({});
const sm = new SecretsManagerClient({});

const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
const ALERTS_QUEUE_URL = process.env.ALERTS_QUEUE_URL!;
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1';

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
    for (const record of event.Records) {
      await processRecord(record, client);
    }
  } finally {
    await client.end();
  }
};

async function processRecord(record: SQSRecord, pgClient: any): Promise<void> {
  const mention: BrandwatchMention = JSON.parse(record.body);
  const resourceId = mention.resourceId;

  const agency = agencyMap!.get(mention.queryId);
  if (!agency) { console.warn(`Unknown queryId ${mention.queryId}, skipping`); return; }

  console.log(`[${agency.slug}] Processing mention ${resourceId} from ${mention.domain}`);

  // Check if already processed (idempotency)
  const existing = await pgClient.query(
    'SELECT id FROM mentions WHERE bw_resource_id = $1',
    [resourceId],
  );
  if (existing.rows.length > 0) {
    console.log(`[${agency.slug}] Mention ${resourceId} already exists, skipping`);
    return;
  }

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
- pertinence: "alta" si la mención TRATA sobre ${agency.name}. "media" si ${agency.name} es secundaria. "baja" si ${agency.name} se menciona de paso.
- topics: usar SOLO estos slugs de tópicos: ${topicSlugs}
- subtopic_slug: ${subtopicSlugs}
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
    municipalities: (raw.municipalities ?? []).filter((m) => typeof m === 'string' && m.length > 0),
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
