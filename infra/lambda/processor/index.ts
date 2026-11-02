import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import type { Context, SQSEvent, SQSRecord } from 'aws-lambda';
import type { BrandwatchMention, NlpAnalysis } from '@eco/shared';
import { TOPIC_SLUGS_BY_AGENCY, TOPICS_BY_AGENCY, AGENCY_NLP_CONTEXT, TOPIC_ROUTING_RULES, MUNICIPALITY_SLUGS, extractMunicipalitiesFromText, scrapeImageForMention, fetchArticleText, isExpiringImageUrl, mirrorImage, mentionPlatformKey, type ArticleTextResult } from '@eco/shared';
import { buildEmbeddingInput, embedText, toPgvectorLiteral } from '../lib/embeddings';
import { EXISTING_MENTIONS_SQL, MENTION_CONFLICT_TARGET, mentionKey, selectNewRecords, type BatchEntry } from '../lib/mention-keys';
import {
  RUBRIC_V2_VERSION, buildClassificationPrompt, buildClassifyTool, nlpEnumProblem, normalizeNlpResult,
  parseAgencyList, promptVersionFor, rubricModeFor, type NlpAnalysisV2, type RubricId, type RubricMode,
} from '../lib/classification-rubric';
import { deriveMentionKind, type MentionKind } from '../lib/mention-kind';
import { resolveParent, type ParentResolution } from '../lib/parent-resolver';

const bedrock = new BedrockRuntimeClient({});
const sqs = new SQSClient({});
const sm = new SecretsManagerClient({});
const s3 = new S3Client({});

/**
 * Copia propia de imágenes que caducan (CDN de Facebook/Instagram, ~5 días):
 * se guardan en `media/` del bucket crudo y la app las sirve en
 * `${MEDIA_PUBLIC_BASE_URL}/<clave>`. Sin bucket configurado no se copia nada
 * y la mención conserva la URL original, como antes.
 */
const MEDIA_BUCKET = process.env.MEDIA_BUCKET ?? process.env.RAW_BUCKET ?? '';
const MEDIA_PUBLIC_BASE_URL = process.env.MEDIA_PUBLIC_BASE_URL ?? 'https://citizenecho.com/media';

async function mirrorIfExpiring(url: string | null): Promise<string | null> {
  if (!url || !MEDIA_BUCKET || !isExpiringImageUrl(url)) return url;
  const mirrored = await mirrorImage(url, {
    publicBaseUrl: MEDIA_PUBLIC_BASE_URL,
    put: async (key, body, contentType) => {
      await s3.send(new PutObjectCommand({
        Bucket: MEDIA_BUCKET,
        Key: `media/${key}`,
        Body: body,
        ContentType: contentType,
        // La clave es el hash de la URL de origen: el contenido no cambia.
        CacheControl: 'public, max-age=31536000, immutable',
      }));
    },
  });
  if (!mirrored) console.warn(`[media] no se pudo copiar ${url.slice(0, 80)}…`);
  return mirrored ?? url;
}

const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
const ALERTS_QUEUE_URL = process.env.ALERTS_QUEUE_URL!;
// Primary model: best quality. Fallback: used when primary is throttled/quota-agotado.
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1';
const BEDROCK_FALLBACK_MODEL_ID = process.env.BEDROCK_FALLBACK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';

// Soft circuit-breaker: once the primary model throttles, skip it for this many
// milliseconds to avoid hammering a quota that's been consumed for the day.
const PRIMARY_COOLDOWN_MS = 5 * 60 * 1000;
let primaryCooldownUntil = 0;

/**
 * Tope de texto de artículo que se le pasa a Claude. Se GUARDA el cuerpo
 * completo (lo hace eco-article-fetch / la UPDATE de abajo), pero el prompt
 * solo recibe los primeros N caracteres: el lead y el desarrollo llevan toda
 * la señal de sentimiento, pertinencia y tópicos, mientras que un mensaje de
 * presupuesto de 60,000 caracteres multiplicaría el coste de Bedrock por 25
 * sin mejorar la clasificación.
 */
const NLP_TEXT_LIMIT = Number(process.env.NLP_TEXT_LIMIT ?? 8000);

/** page_types donde vale la pena intentar el fetch del cuerpo. */
const FULLTEXT_PAGE_TYPES = new Set(['news', 'blog', 'forum']);

/**
 * Banderas de la interpretación v1 (spec, secciones 6 y 13.4). Todas apagadas
 * por defecto: sin variables, el processor clasifica y escribe igual que antes.
 *
 *   RUBRIC_V2_AGENCIES          slugs separados por coma: clasifican con la
 *                               rúbrica v2 y escriben sus columnas de siempre
 *                               (`nlp_sentiment` = postura hacia la agencia).
 *   RUBRIC_V2_SHADOW_AGENCIES   slugs: además de la clasificación legacy, una
 *                               segunda llamada con la v2 se guarda en
 *                               `mention_nlp_shadow`; no toca `mentions`.
 *   MENTION_ENRICHMENT_ENABLED  1/true: guarda mention_kind, el post padre,
 *                               nlp_adverse_fact, nlp_prompt_version y
 *                               nlp_model (siempre activo para las agencias v2).
 *   NLP_STRICT_ENUMS            1/true: un sentiment/pertinence fuera de enum
 *                               invalida la respuesta en legacy (en v2 y
 *                               sombra siempre se exige).
 *   RUBRIC_V2_SHADOW_MODEL_ID   modelo de la llamada de sombra (por defecto el
 *                               primario; sin fallback ni enfriamiento, para no
 *                               alterar la clasificación de producción).
 *
 * Requiere la migración 0013 (WP-1) antes de encender cualquiera de ellas.
 */
const truthy = (v: string | undefined) => /^(1|true|yes|on)$/i.test((v ?? '').trim());
const RUBRIC_V2_AGENCIES = parseAgencyList(process.env.RUBRIC_V2_AGENCIES);
const RUBRIC_V2_SHADOW_AGENCIES = parseAgencyList(process.env.RUBRIC_V2_SHADOW_AGENCIES);
const MENTION_ENRICHMENT_ENABLED = truthy(process.env.MENTION_ENRICHMENT_ENABLED);
const NLP_STRICT_ENUMS = truthy(process.env.NLP_STRICT_ENUMS);
const RUBRIC_V2_SHADOW_MODEL_ID = process.env.RUBRIC_V2_SHADOW_MODEL_ID || BEDROCK_MODEL_ID;

function rubricModeOf(slug: string): RubricMode {
  return rubricModeFor(slug, RUBRIC_V2_AGENCIES, RUBRIC_V2_SHADOW_AGENCIES);
}

function isThrottlingError(err: unknown): boolean {
  const e = err as { name?: string; message?: string };
  if (!e) return false;
  if (e.name === 'ThrottlingException') return true;
  const msg = String(e.message ?? '').toLowerCase();
  return msg.includes('too many tokens') || msg.includes('too many requests') || msg.includes('throttl');
}

let dbUrl: string | null = null;

interface AgencyInfo {
  id: string;
  slug: string;
  name: string;
  /**
   * La agencia recibe menciones por Brandwatch Y por exportes importados
   * (queryId negativo): la misma publicación puede llegar por las dos vías
   * con resourceIds distintos. Ver findSamePublication.
   */
  mixedSources: boolean;
}
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
      const qids = (row.brandwatch_query_ids as number[]).map(Number);
      const mixedSources = qids.some((q) => q < 0) && qids.some((q) => q > 0);
      for (const qid of qids) {
        map.set(qid, { id: row.id, slug: row.slug, name: row.name, mixedSources });
      }
    }
    return map;
  } finally { await client.end(); }
}

type ReprocessEvent = { action: 'reprocess-nlp-errors' | 'reprocess-unclassified'; limit?: number };
/** Backfill de copias propias: menciones recientes cuya imagen aún no venció. */
type MirrorMediaEvent = { action: 'mirror-media'; sinceHours?: number; limit?: number };
/**
 * Reclasificación por agencia y rango de fechas (backfill de la rúbrica v2,
 * WP-13). `dryRun` es true salvo que se pase `dryRun: false` explícito.
 *   mode 'v2'      reescribe las columnas NLP de `mentions` (+ tópicos y
 *                  municipios NLP) y estampa versión, modelo, tipo y padre.
 *   mode 'shadow'  escribe solo `mention_nlp_shadow`.
 *   countOnly      cuenta candidatas sin llamar a Bedrock.
 */
type ReclassifyEvent = {
  action: 'reclassify';
  agencySlug: string;
  from: string;
  to: string;
  mode?: 'v2' | 'shadow';
  dryRun?: boolean;
  countOnly?: boolean;
  concurrency?: number;
  retries?: number;
  limit?: number;
  /** Salta las ya clasificadas con esta versión (default true). */
  onlyPending?: boolean;
  includeDuplicates?: boolean;
  /** Fuerza un modelo (sin fallback); por defecto primario → fallback. */
  modelId?: string;
};
type ProcessorEvent = SQSEvent | ReprocessEvent | MirrorMediaEvent | ReclassifyEvent;

function isMirrorMediaEvent(e: ProcessorEvent): e is MirrorMediaEvent {
  return (e as MirrorMediaEvent).action === 'mirror-media';
}

function isReclassifyEvent(e: ProcessorEvent): e is ReclassifyEvent {
  return (e as ReclassifyEvent).action === 'reclassify';
}

function isReprocessEvent(e: ProcessorEvent): e is ReprocessEvent {
  return typeof (e as ReprocessEvent).action === 'string'
    && ['reprocess-nlp-errors', 'reprocess-unclassified'].includes((e as ReprocessEvent).action);
}

export const handler = async (event: ProcessorEvent, context?: Pick<Context, 'getRemainingTimeInMillis'>): Promise<unknown> => {
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

  if (isMirrorMediaEvent(event)) {
    try {
      return await mirrorRecentMedia(client, event.sinceHours ?? 120, event.limit ?? 400);
    } finally {
      await client.end();
    }
  }

  if (isReprocessEvent(event)) {
    try {
      return await reprocessNlpErrors(client, event.action, event.limit);
    } finally {
      await client.end();
    }
  }

  if (isReclassifyEvent(event)) {
    try {
      return await reclassify(client, event, context);
    } finally {
      await client.end();
    }
  }

  console.log(`Processing ${event.Records.length} records`);

  try {
    // Batch dedup: un SELECT filtra las menciones que ya existen PARA SU AGENCIA.
    // La llave es (agencia, resourceId), no resourceId solo: la misma nota puede
    // coincidir con las queries de dos agencias y cada una tiene que guardarla
    // (ver lib/mention-keys.ts). Las que no se pueden llavear (queryId fuera del
    // mapa cacheado, sin resourceId) pasan: processRecord las refresca o rechaza.
    const entries: BatchEntry<SQSRecord>[] = event.Records.map((record) => {
      try {
        const body = JSON.parse(record.body) as BrandwatchMention;
        return { record, valid: true, resourceId: body.resourceId, agencyId: agencyMap!.get(body.queryId)?.id };
      } catch {
        return { record, valid: false, resourceId: undefined, agencyId: undefined };
      }
    });

    const keyed = entries.filter((e) => e.valid && e.agencyId && e.resourceId);
    let existingSet = new Set<string>();
    if (keyed.length > 0) {
      const existing = await client.query(EXISTING_MENTIONS_SQL, [
        keyed.map((e) => e.agencyId),
        keyed.map((e) => e.resourceId),
      ]);
      existingSet = new Set(existing.rows.map((r: any) => mentionKey(r.agency_id, r.bw_resource_id)));
    }

    const newRecords = selectNewRecords(entries, existingSet);

    const skipped = event.Records.length - newRecords.length;
    console.log(`Batch: ${event.Records.length} records — ${skipped} duplicates skipped, ${newRecords.length} new`);

    // Parallelize NLP + inserts. `pg.Client` serializes DB queries internally,
    // but Bedrock calls run concurrently (the real bottleneck).
    //
    // Partial-batch failure (reportBatchItemFailures): en vez de re-lanzar y
    // reencolar los 10 mensajes, devolvemos SOLO los messageId que fallaron.
    // Los registros sanos se eliminan de la cola en el primer intento; el
    // dedup SELECT + ON CONFLICT hace idempotente cualquier reentrega.
    const batchItemFailures: { itemIdentifier: string }[] = [];
    if (newRecords.length > 0) {
      const results = await Promise.allSettled(
        newRecords.map((r) => processRecord(r, client)),
      );
      results.forEach((res, i) => {
        if (res.status === 'rejected') {
          const rec = newRecords[i];
          console.error(`record ${rec.messageId} failed:`, (res as PromiseRejectedResult).reason);
          batchItemFailures.push({ itemIdentifier: rec.messageId });
        }
      });
      if (batchItemFailures.length > 0) {
        console.error(`${batchItemFailures.length}/${newRecords.length} records failed in batch (partial retry)`);
      }
    }
    return { batchItemFailures };
  } finally {
    await client.end();
  }
};

/**
 * Id de una mención de la agencia que ya es ESTA publicación (misma clave de
 * `mentionPlatformKey`: id del post en X/FB/IG/YT/TikTok, o URL sin protocolo
 * ni query en web), publicada ±3 días alrededor. Es el mismo cruce que hace el
 * plan de importación de exportes contra la base, en la dirección contraria.
 */
async function findSamePublication(pgClient: any, agencyId: string, mention: BrandwatchMention): Promise<string | null> {
  const key = mentionPlatformKey(mention.url ?? '');
  // En web la clave puede llevar query normalizada (orden, sin rastreo): el
  // filtro SQL busca host+ruta y la comparación exacta la hace la clave.
  const needle = key.slice(key.indexOf(':') + 1).split('?')[0].toLowerCase();
  if (needle.length < 5) return null;
  const at = new Date(mention.date ?? '');
  const when = Number.isNaN(at.getTime()) ? new Date() : at;
  const { rows } = await pgClient.query(
    `SELECT id, url FROM mentions
      WHERE agency_id = $1 AND url IS NOT NULL
        AND published_at BETWEEN $2::timestamptz - interval '3 days' AND $2::timestamptz + interval '3 days'
        AND strpos(lower(url), $3) > 0
      LIMIT 20`,
    [agencyId, when.toISOString(), needle],
  );
  const hit = rows.find((r: { url: string }) => mentionPlatformKey(r.url) === key);
  if (hit) return hit.id;

  // Reels de Facebook: Bunker los entrega como /reel/<id> y Brandwatch como
  // /<página>/posts/<otro id>. Misma publicación, claves distintas (188 en el
  // cruce de DF jul–oct 2026). Segunda red: misma página, mismo segundo (±2 s),
  // y SOLO contra la otra fuente — dentro de Brandwatch hay cientos de pares
  // legítimos de la misma página al mismo segundo.
  if (/facebook/i.test(mention.pageType ?? '') && mention.author && !Number.isNaN(at.getTime())) {
    const otherSource = Number(mention.queryId) < 0 ? 'bw_query_id > 0' : 'bw_query_id < 0';
    const { rows: same } = await pgClient.query(
      `SELECT id FROM mentions
        WHERE agency_id = $1 AND page_type ILIKE 'facebook%' AND ${otherSource}
          AND lower(author) = lower($2)
          AND published_at BETWEEN $3::timestamptz - interval '2 seconds' AND $3::timestamptz + interval '2 seconds'
        LIMIT 1`,
      [agencyId, mention.author, at.toISOString()],
    );
    if (same.length) return same[0].id;
  }
  return null;
}

/** Trunca a los límites varchar(N) del schema; null/undefined pasan intactos. */
function vc(s: string | null | undefined, max = 255): string | null | undefined {
  if (s == null) return s;
  const str = String(s);
  return str.length > max ? str.slice(0, max) : str;
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

  // NOTE: la existencia (agencia, resourceId) se chequea en el handler con un
  // SELECT por lote, así que este registro es nuevo para su agencia. El INSERT
  // conserva el índice único (agency_id, bw_resource_id) como guarda.

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

  // Skip-empty: Brandwatch entrega shells vacíos (sin title, snippet ni URL),
  // especialmente para X/Twitter desde el cambio de API de mayo 2026. No tienen
  // ningún valor analítico — no se pueden clasificar, ni linkar, ni mostrar.
  // Persistir estos shells inflaba el `total_mentions` del día y diluía las
  // métricas de severidad y relevancia del Crisis Score (los aggregates no
  // filtran por nada que distinga shells de menciones reales). Descartamos en
  // origen: si Brandwatch corrige el feed más adelante, las menciones llegarán
  // con contenido y se procesarán normalmente.
  const isEmpty = !mention.title?.trim() && !mention.snippet?.trim() && !mention.url?.trim();
  if (isEmpty) {
    console.log(`[${agency.slug}] Drop-empty-shell: ${resourceId} (page_type=${mention.pageType ?? '?'}, no title/snippet/url)`);
    return;
  }

  // Misma publicación por la otra fuente (antes del NLP, que es lo caro): en
  // una agencia con Brandwatch + exportes, un post de Facebook o una nota que
  // ya entró por el exporte de Bunker llega otra vez por Brandwatch con otro
  // resourceId. No es una republicación (eso lo marca is_duplicate): es el
  // mismo registro, así que no se inserta.
  if (agency.mixedSources && mention.url) {
    const sameId = await findSamePublication(pgClient, agency.id, mention);
    if (sameId) {
      console.log(`[${agency.slug}] Drop-same-publication: ${resourceId} = ${sameId} (${mentionPlatformKey(mention.url)})`);
      return;
    }
  }

  // Cuerpo completo del artículo ANTES del NLP. Brandwatch entrega `snippet`
  // truncado a ~255 caracteres (promedio medido sobre 59k menciones news) y el
  // artículo real tiene 2,000–9,000: hasta ahora todo el análisis corría sobre
  // el 3–10% del texto. Se hace aquí, y no solo en el barrido de
  // eco-article-fetch, porque si el texto llegara después el NLP ya estaría
  // calculado sobre el snippet y nadie lo recalcularía.
  //
  // Los 10 registros del lote corren en Promise.allSettled, así que este fetch
  // suma latencia MÁXIMA (~12s de timeout), no acumulada. Nunca lanza.
  let article: ArticleTextResult | null = null;
  if (mention.url && FULLTEXT_PAGE_TYPES.has((mention.pageType ?? '').toLowerCase())) {
    try {
      article = await fetchArticleText(mention.url, {
        // Verifica que lo extraído sea ESTE artículo: hay sitios que sirven
        // otro contenido en la misma URL sin devolver 404, y ese texto
        // entraría al prompt del NLP como si fuera la mención.
        expect: { snippet: mention.snippet, title: mention.title },
      });
    } catch {
      article = null;
    }
  }
  const fullText = article?.ok ? article.text : null;

  // Interpretación v1 (banderas apagadas por defecto: modo 'legacy', sin
  // enriquecimiento → la clasificación y las escrituras son las de siempre).
  // El tipo de mención es puro (sin red); el padre es una consulta acotada por
  // agencia y fecha (~20–35 ms) que corre en paralelo con Bedrock, así que no
  // suma latencia al registro.
  const mode = rubricModeOf(agency.slug);
  const kind = deriveMentionKind(mention, agency);
  const enrich = MENTION_ENRICHMENT_ENABLED || mode === 'v2';
  const parentPromise: Promise<ParentResolution | null> = enrich && kind === 'comment'
    ? resolveParent(pgClient, agency.id, mention)
    : Promise.resolve(null);

  const classified = Promise.all([
    classifyMention(mention, agency, fullText, { rubric: mode === 'v2' ? 'v2' : 'legacy', kind }),
    mode === 'shadow'
      ? classifyMention(mention, agency, fullText, { rubric: 'v2', kind, models: [RUBRIC_V2_SHADOW_MODEL_ID], affectCooldown: false })
          .catch((err) => { console.warn(`[${agency.slug}] shadow v2 falló para ${resourceId}: ${(err as Error)?.message ?? err}`); return null; })
      : Promise.resolve(null),
  ]);
  // El padre se espera también si Bedrock lanza: su consulta va por el mismo
  // pg.Client y no debe quedar en cola cuando el handler cierre la conexión.
  const [primary, shadow] = await classified.catch(async (err) => { await parentPromise; throw err; });
  const parent = await parentPromise;
  const nlp: NlpAnalysisV2 = primary.nlp;

  // Reinforce municipality coverage with a deterministic regex pass over the
  // text Claude saw. Merges with Claude's output and dedupes. This alone took
  // coverage from 31% to >70% on a sample in local tests.
  const regexMunis = extractMunicipalitiesFromText(mention.title, mention.snippet, nlp.summary);
  const mergedMunis = Array.from(new Set([...(nlp.municipalities ?? []), ...regexMunis]));
  nlp.municipalities = mergedMunis.filter((m) => MUNICIPALITY_SLUGS.includes(m));

  // Best-effort: resuelve una imagen representativa (media directa → thumbnail
  // de YouTube → og:image de news/blog/forum → avatar → null). Nunca lanza; si
  // el scrape falla o tarda, la mención queda sin imagen y el backfill de
  // eco-migration la recogerá después.
  let resolvedImageUrl: string | null = null;
  try {
    resolvedImageUrl = await scrapeImageForMention({
      mediaUrl: mention.mediaUrls?.[0] ?? null,
      pageType: mention.pageType,
      url: mention.url,
      avatarUrl: mention.avatarUrl,
    });
  } catch {
    resolvedImageUrl = null;
  }
  // Las imágenes del CDN de Meta vencen a los ~5 días: se copian ahora, que
  // todavía son válidas. Si la copia falla, queda la original (como antes).
  resolvedImageUrl = await mirrorIfExpiring(resolvedImageUrl);

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
      published_at, processed_at, language,
      resolved_image_url
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
      $44, NOW(), $45,
      $46
    ) ON CONFLICT ${MENTION_CONFLICT_TARGET} DO NOTHING
    RETURNING id`,
    [
      // vc(): Brandwatch entrega autores/nombres/queries que exceden los
      // varchar(N) del schema — sin truncar, la mención entera muere con 22001
      // y termina en la DLQ tras agotar reintentos.
      agency.id, vc(mention.resourceId), vc(mention.guid), mention.queryId, vc(mention.queryName),
      mention.title, mention.snippet, mention.url, mention.originalUrl,
      vc(mention.author), vc(mention.fullname), vc(mention.gender, 20), mention.avatarUrl,
      vc(mention.domain), vc(mention.pageType, 50), vc(mention.contentSource, 50), vc(mention.contentSourceName, 100), vc(mention.pubType, 50), vc(mention.subtype, 50),
      mention.likes ?? 0, mention.comments ?? 0, mention.shares ?? 0,
      mention.engagementScore ?? 0, mention.impact ?? 0, mention.reachEstimate ?? 0,
      mention.potentialAudience ?? 0, mention.monthlyVisitors ?? 0,
      vc(mention.country, 100), vc(mention.countryCode, 10), vc(mention.region, 100), vc(mention.city, 100), vc(mention.cityCode, 100),
      vc(mention.sentiment, 20),
      nlp.sentiment, JSON.stringify(nlp.emotions), nlp.pertinence, nlp.summary,
      textHash, isDuplicate, duplicateOfId,
      JSON.stringify(mention.mediaUrls ?? []),
      (mention.mediaUrls?.length ?? 0) > 0 && mention.subtype === 'photo',
      mention.subtype === 'video',
      parsePublishedAt(mention), mention.language ?? 'es',
      resolvedImageUrl,
    ],
  );

  // ON CONFLICT DO NOTHING: si otra invocación concurrente insertó la misma
  // mención entre el dedup batch y este INSERT, RETURNING no trae filas — la
  // otra invocación ya completó (o completará) el procesamiento.
  if (mentionResult.rows.length === 0) {
    console.log(`[${agency.slug}] Skip-concurrent-insert: ${mention.resourceId}`);
    return;
  }
  const mentionId = mentionResult.rows[0].id;

  // Trazabilidad v1 en una UPDATE aparte (mismo motivo que el cuerpo de
  // abajo: no renumerar los 46 parámetros del INSERT) y tolerante a que la
  // migración 0013 aún no exista. Solo con la bandera o en agencias v2.
  if (enrich) {
    await stampNlpTrace(pgClient, agency.slug, mentionId, {
      kind, parent, adverseFact: nlp.adverse_fact, promptVersion: primary.promptVersion, model: primary.model,
    });
  }
  if (shadow) {
    await writeShadow(pgClient, agency.slug, mentionId, shadow);
  }

  // Persistencia del cuerpo en una UPDATE aparte, no en el INSERT: el INSERT
  // ya lleva 46 parámetros posicionales y renumerarlos por ocho columnas más
  // es la clase de cambio que rompe una mención entera por un off-by-one. El
  // mismo patrón que usa el embedding unas líneas más abajo.
  if (article) {
    const label = article.ok
      ? 'ok'
      : article.reason === 'http-error'
        ? (article.status === 429 ? 'http-error-429' : article.status >= 500 ? 'http-error-5xx' : `http-error-${article.status}`)
        : (article.reason ?? 'unknown');
    try {
      await pgClient.query(
        `UPDATE mentions
            SET full_text = $2, full_text_chars = $3, full_text_words = $4,
                full_text_method = $5, full_text_status = $6,
                full_text_http_status = $7, full_text_fetched_at = NOW(),
                full_text_attempts = 1
          WHERE id = $1`,
        [mentionId, fullText, fullText?.length ?? null, article.ok ? article.words : null,
         article.ok ? article.method : null, label, article.status || null],
      );
    } catch (err) {
      // Si las columnas aún no existen (processor desplegado antes del primer
      // arranque de eco-article-fetch, que es quien las crea), la mención se
      // guarda igual y el barrido la recogerá después.
      console.warn(`[${agency.slug}] full_text UPDATE falló para ${mentionId}: ${(err as Error).message}`);
    }
  }

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

/** Reglas de routing históricas del prompt (escritas para DDEC); las usan las
 *  agencias sin entrada en TOPIC_ROUTING_RULES. */
const LEGACY_ROUTING_RULES = `- Si el post anuncia el NÚMERO DE EMPLEOS como hecho central → topic = empleo-fuerza-laboral. Si habla de la DECISIÓN/SECTOR corporativo → topic = inversion-extranjera.
- Misión comercial España: si centra en "empresas PR exportando" → comercio-exterior; si centra en "atraer capital ES a PR" → inversion-extranjera.
- Hotel boutique con créditos Ley 60: si la conversación es "caso de éxito turístico" → turismo-economia; si es "controversia Ley 60" → incentivos-economicos.
- Compañía Turismo separación: legislacion-economica (NO turismo-economia).
- OGPe / PC 1183 / inspecciones bomberos: si discute "permisos como sistema" → permisos-reforma; si discute "DDEC como agencia receptora/cedente de funciones" → legislacion-economica.
- Críticas dirigidas a la PERSONA del Secretario (credibilidad, gestión, viajes): topic = gestion-secretario con sentiment=negativo; reserva criticas-controversias para críticas al PROYECTO o al MODELO económico, no a la persona.
- FITUR: turismo-economia.fitur-y-promocion-internacional (NO comercio-exterior).`;

/** Resultado de una clasificación, con lo necesario para la trazabilidad. */
interface ClassifyOutcome {
  nlp: NlpAnalysisV2;
  /** Modelo que respondió; nulo si todos fallaron (resultado de error). */
  model: string | null;
  /** `legacy` o `rubric-v2.0`. */
  promptVersion: string;
  rubric: RubricId;
  ok: boolean;
}

interface ClassifyOptions {
  rubric?: RubricId;
  kind?: MentionKind | null;
  /** Rechaza sentiment/pertinence fuera de enum (default: v2 o NLP_STRICT_ENUMS). */
  strict?: boolean;
  /** Cadena de modelos explícita (sombra, reclasificación); default primario → fallback. */
  models?: string[];
  /** Si un throttle del primario activa el enfriamiento global (default true). */
  affectCooldown?: boolean;
}

/** Resultado de error (mismo objeto de siempre): reprocess-nlp-errors lo recoge. */
const NLP_ERROR_SUMMARY = 'Error en análisis NLP';
function nlpErrorResult(): NlpAnalysisV2 {
  return {
    sentiment: 'neutral',
    emotions: [],
    pertinence: 'media',
    topics: [],
    municipalities: [],
    summary: NLP_ERROR_SUMMARY,
    adverse_fact: null,
  };
}

/**
 * Clasifica una mención con `classify_mention`. Con las opciones por defecto
 * (rúbrica legacy, sin modo estricto) el prompt, la herramienta, la cadena de
 * modelos y el resultado son los de siempre.
 */
async function classifyMention(
  mention: BrandwatchMention,
  agency: AgencyInfo,
  fullText: string | null = null,
  opts: ClassifyOptions = {},
): Promise<ClassifyOutcome> {
  const rubric: RubricId = opts.rubric ?? 'legacy';
  const strict = opts.strict ?? (rubric === 'v2' || NLP_STRICT_ENUMS);
  const affectCooldown = opts.affectCooldown ?? true;
  const promptVersion = promptVersionFor(rubric);

  // Contexto y reglas de routing propios de la agencia (topics.ts). Sin
  // entrada, el prompt es el de siempre: el bloque de routing histórico
  // (escrito para DDEC) se conserva tal cual para no mover la clasificación
  // de las agencias que ya lo usan.
  const prompt = buildClassificationPrompt({
    mention,
    agency,
    fullText,
    textLimit: NLP_TEXT_LIMIT,
    catalog: {
      agencyTopics: TOPICS_BY_AGENCY[agency.slug] ?? [],
      agencyContext: AGENCY_NLP_CONTEXT[agency.slug],
      routingRules: TOPIC_ROUTING_RULES[agency.slug] ?? LEGACY_ROUTING_RULES,
    },
    rubric,
    kind: opts.kind ?? null,
  });

  let modelsToTry: string[];
  if (opts.models?.length) {
    modelsToTry = opts.models;
  } else {
    modelsToTry = [];
    const now = Date.now();
    if (now >= primaryCooldownUntil) {
      modelsToTry.push(BEDROCK_MODEL_ID);
    }
    if (BEDROCK_FALLBACK_MODEL_ID && BEDROCK_FALLBACK_MODEL_ID !== BEDROCK_MODEL_ID) {
      modelsToTry.push(BEDROCK_FALLBACK_MODEL_ID);
    }
  }

  // Bedrock tool-use con input_schema: garantiza un objeto estructurado y
  // elimina parse-errors de JSON crudo (rompe con `"`/`\n` mal escapados).
  const classifyTool = buildClassifyTool(rubric);

  let parsed: (NlpAnalysis & { adverse_fact?: unknown }) | null = null;
  let usedModel: string | null = null;
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
      // Modo estricto: un enum fuera de lugar (p. ej. «negative» en inglés)
      // invalida la respuesta y se prueba el siguiente modelo, en vez de
      // contarlo en silencio como neutral.
      const problem = strict ? nlpEnumProblem(toolUse.input) : null;
      if (problem) {
        lastErr = new Error(`${modelId}: ${problem}`);
        console.warn(`[${agency.slug}] respuesta inválida de ${modelId} para ${mention.resourceId}: ${problem}`);
        continue;
      }
      parsed = toolUse.input as NlpAnalysis & { adverse_fact?: unknown };
      usedModel = modelId;
      break;
    } catch (err) {
      lastErr = err;
      if (isThrottlingError(err) && modelId === BEDROCK_MODEL_ID && affectCooldown) {
        primaryCooldownUntil = Date.now() + PRIMARY_COOLDOWN_MS;
        console.warn(`[${agency.slug}] Primary model ${modelId} throttled; cooling down ${PRIMARY_COOLDOWN_MS / 1000}s, falling back`);
        continue;
      }
      if (isThrottlingError(err) && !affectCooldown) {
        continue;
      }
      throw err;
    }
  }

  if (parsed === null) {
    console.error(`[${agency.slug}] Bedrock failed for ${mention.resourceId}:`, lastErr);
    return { nlp: nlpErrorResult(), model: null, promptVersion, rubric, ok: false };
  }

  return { nlp: validateNlpResult(parsed, agency.slug, rubric), model: usedModel, promptVersion, rubric, ok: true };
}

function validateNlpResult(raw: NlpAnalysis & { adverse_fact?: unknown }, agencySlug: string, rubric: RubricId = 'legacy'): NlpAnalysisV2 {
  return normalizeNlpResult(raw, {
    validTopics: TOPIC_SLUGS_BY_AGENCY[agencySlug] ?? [],
    validMunicipalities: MUNICIPALITY_SLUGS,
    rubric,
  });
}

// ---------------------------------------------------------------------------
// Trazabilidad v1: tipo, padre, hecho adverso, versión y modelo
// ---------------------------------------------------------------------------

interface NlpTrace {
  kind: MentionKind;
  parent: ParentResolution | null;
  adverseFact: boolean | null;
  promptVersion: string;
  model: string | null;
}

/**
 * Si la migración 0013 aún no corrió, el UPDATE falla con 42703/42P01: se
 * registra una vez y se deja de intentar por unos minutos en este contenedor
 * (la mención ya quedó guardada con sus columnas de siempre).
 */
const SCHEMA_RETRY_MS = 10 * 60 * 1000;
let traceColumnsMissingUntil = 0;
let shadowTableMissingUntil = 0;

function isMissingSchemaError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === '42703' || code === '42P01';
}

async function stampNlpTrace(pgClient: any, agencySlug: string, mentionId: string, t: NlpTrace): Promise<void> {
  if (Date.now() < traceColumnsMissingUntil) return;
  try {
    await pgClient.query(
      `UPDATE mentions
          SET mention_kind = $2, parent_mention_id = $3, parent_published_at = $4,
              nlp_adverse_fact = $5, nlp_prompt_version = $6, nlp_model = $7
        WHERE id = $1`,
      [mentionId, t.kind, t.parent?.parentMentionId ?? null, t.parent?.parentPublishedAt ?? null,
       t.adverseFact, t.promptVersion, t.model],
    );
  } catch (err) {
    if (isMissingSchemaError(err)) {
      traceColumnsMissingUntil = Date.now() + SCHEMA_RETRY_MS;
      console.error(`[${agencySlug}] columnas de trazabilidad v1 ausentes (¿migración 0013?): ${(err as Error).message}`);
      return;
    }
    console.error(`[${agencySlug}] trazabilidad v1 falló para ${mentionId}: ${(err as Error).message}`);
  }
}

/** Resultado de la v2 en sombra: no toca `mentions`. */
async function writeShadow(pgClient: any, agencySlug: string, mentionId: string, out: ClassifyOutcome, replace = false): Promise<boolean> {
  if (!out.ok) return false;
  if (Date.now() < shadowTableMissingUntil) return false;
  try {
    if (replace) {
      await pgClient.query('DELETE FROM mention_nlp_shadow WHERE mention_id = $1 AND prompt_version = $2', [mentionId, out.promptVersion]);
    }
    await pgClient.query(
      `INSERT INTO mention_nlp_shadow (mention_id, prompt_version, model, sentiment, pertinence, adverse_fact, topics, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [mentionId, out.promptVersion, out.model, out.nlp.sentiment, out.nlp.pertinence, out.nlp.adverse_fact,
       JSON.stringify(out.nlp.topics ?? [])],
    );
    return true;
  } catch (err) {
    if (isMissingSchemaError(err)) {
      shadowTableMissingUntil = Date.now() + SCHEMA_RETRY_MS;
      console.error(`[${agencySlug}] tabla mention_nlp_shadow ausente (¿migración 0013?): ${(err as Error).message}`);
      return false;
    }
    console.error(`[${agencySlug}] escritura de sombra falló para ${mentionId}: ${(err as Error).message}`);
    return false;
  }
}

async function reprocessNlpErrors(
  pgClient: any,
  action: 'reprocess-nlp-errors' | 'reprocess-unclassified' = 'reprocess-nlp-errors',
  limit?: number,
): Promise<{ reprocessed: number; failed: number; remaining: number; details: any[] }> {
  // 'reprocess-unclassified': menciones procesadas sin fila en mention_topics.
  // Pasa cuando Claude devuelve un topic_slug fuera del catálogo de la agencia
  // (el INSERT hace `continue` silencioso) o cuando topics llegó vacío. Sin
  // esta acción quedan huérfanas para siempre — ningún cron las reintenta.
  // Cooldown vía processed_at: el reproceso "toca" processed_at al terminar,
  // así una mención reanalizada que legítimamente queda sin tópico (spam,
  // posts solo-foto) no se vuelve a analizar hasta dentro de 3 días en vez de
  // re-quemarse Bedrock con el mismo ruido cada corrida. Prioridad: alta >
  // media > baja, porque las alta huérfanas son casi siempre misses reales.
  const where = action === 'reprocess-unclassified'
    ? `m.is_duplicate = false
       AND m.processed_at IS NOT NULL
       AND m.processed_at < NOW() - INTERVAL '3 days'
       AND NOT EXISTS (SELECT 1 FROM mention_topics mt WHERE mt.mention_id = m.id)`
    : `m.nlp_summary = 'Error en análisis NLP'`;
  const orderBy = action === 'reprocess-unclassified'
    ? `CASE m.nlp_pertinence WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, m.published_at DESC`
    : `m.published_at DESC`;
  const cap = Math.max(1, Math.min(limit ?? 200, 500));
  const errors = await pgClient.query(`
    SELECT m.id, m.bw_resource_id, m.bw_guid, m.bw_query_id, m.bw_query_name,
           m.title, m.snippet, m.url, m.domain, m.content_source, m.content_source_name,
           m.author, m.published_at, m.bw_sentiment, m.language,
           m.page_type, m.pub_type,
           m.agency_id, a.slug AS agency_slug, a.name AS agency_name
      FROM mentions m JOIN agencies a ON a.id = m.agency_id
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT ${cap}`);

  console.log(`[${action}] Found ${errors.rows.length} mentions to retry (cap ${cap})`);

  const details: any[] = [];
  let reprocessed = 0;
  let failed = 0;

  const processRow = async (row: any): Promise<void> => {
    const agency: AgencyInfo = { id: row.agency_id, slug: row.agency_slug, name: row.agency_name, mixedSources: false };
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
      pageType: row.page_type,
      pubType: row.pub_type,
    } as BrandwatchMention;

    // Agencias v2: se reclasifica con la rúbrica v2 (sus filas nuevas ya
    // son v2). El resto, legacy como siempre. La sombra no aplica aquí.
    const mode = rubricModeOf(agency.slug);
    const kind = deriveMentionKind(mention, agency);
    const enrich = MENTION_ENRICHMENT_ENABLED || mode === 'v2';

    try {
      const outcome = await classifyMention(mention, agency, null, { rubric: mode === 'v2' ? 'v2' : 'legacy', kind });
      const nlp = outcome.nlp;
      if (nlp.summary === 'Error en análisis NLP') {
        throw new Error('Bedrock still returns error (tool-use fallback)');
      }

      await pgClient.query(
        `UPDATE mentions
            SET nlp_sentiment = $1,
                nlp_emotions = $2,
                nlp_pertinence = $3,
                nlp_summary = $4,
                processed_at = NOW()
          WHERE id = $5`,
        [nlp.sentiment, JSON.stringify(nlp.emotions ?? []), nlp.pertinence, (nlp.summary ?? '').slice(0, 500), row.id],
      );

      await rewriteNlpAssociations(pgClient, row.id, row.agency_id, nlp);

      if (enrich) {
        const parent = kind === 'comment' ? await resolveParent(pgClient, agency.id, mention) : null;
        await stampNlpTrace(pgClient, agency.slug, row.id, {
          kind, parent, adverseFact: nlp.adverse_fact, promptVersion: outcome.promptVersion, model: outcome.model,
        });
      }

      reprocessed++;
      details.push({ id: row.id, status: 'ok', sentiment: nlp.sentiment, pertinence: nlp.pertinence, topics: (nlp.topics ?? []).length });
    } catch (err: any) {
      failed++;
      details.push({ id: row.id, status: 'failed', error: String(err?.message ?? err) });
      console.error(`[${action}] mention ${row.id} failed:`, err);
    }
  };

  // Chunks de 4: Bedrock corre concurrente (el cuello real); pg.Client
  // serializa las queries internamente, así que no hay carrera en DB.
  const CHUNK = 4;
  for (let i = 0; i < errors.rows.length; i += CHUNK) {
    await Promise.allSettled(errors.rows.slice(i, i + CHUNK).map(processRow));
  }

  const remainingRes = await pgClient.query(
    `SELECT count(*)::int AS n FROM mentions m WHERE ${where}`,
  );
  const remaining = remainingRes.rows[0]?.n ?? 0;
  console.log(`[${action}] done: ok=${reprocessed} failed=${failed} remaining=${remaining}`);
  return { reprocessed, failed, remaining, details };
}

/**
 * Reemplaza tópicos y municipios NLP de una mención ya guardada (las filas de
 * Brandwatch en mention_municipalities no se tocan).
 */
async function rewriteNlpAssociations(pgClient: any, mentionId: string, agencyId: string, nlp: NlpAnalysis): Promise<void> {
  await pgClient.query('DELETE FROM mention_topics WHERE mention_id = $1', [mentionId]);
  for (const t of nlp.topics ?? []) {
    const topicRow = await pgClient.query(
      'SELECT id FROM topics WHERE slug = $1 AND agency_id = $2',
      [t.topic_slug, agencyId],
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
      [mentionId, topicRow.rows[0].id, subtopicId, t.confidence],
    );
  }

  await pgClient.query(`DELETE FROM mention_municipalities WHERE mention_id = $1 AND source = 'nlp'`, [mentionId]);
  for (const muniSlug of nlp.municipalities ?? []) {
    const muniRow = await pgClient.query('SELECT id FROM municipalities WHERE slug = $1', [muniSlug]);
    if (muniRow.rows.length > 0) {
      await pgClient.query(
        `INSERT INTO mention_municipalities (mention_id, municipality_id, source)
         VALUES ($1, $2, 'nlp') ON CONFLICT DO NOTHING`,
        [mentionId, muniRow.rows[0].id],
      );
    }
  }
}

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bump = (o: Record<string, number>, k: string | null | undefined) => { const key = k ?? 'null'; o[key] = (o[key] ?? 0) + 1; };

/** Margen para cerrar antes del timeout del lambda (5 min). */
const RECLASSIFY_TIME_MARGIN_MS = 60_000;
const RECLASSIFY_MAX_RANGE_DAYS = 120;

/**
 * Reclasificación con la rúbrica v2 por agencia y rango de fechas (spec 12.2;
 * WP-13 la ejecuta en tandas). Cada invocación procesa hasta `limit`
 * menciones, de la más reciente a la más vieja, con `concurrency` llamadas a
 * Bedrock en paralelo y `retries` reintentos con espera exponencial; se
 * detiene antes del timeout y devuelve `remaining` para la siguiente tanda.
 * `dryRun` (por defecto) clasifica y reporta sin escribir nada.
 */
async function reclassify(
  pgClient: any,
  ev: ReclassifyEvent,
  context?: Pick<Context, 'getRemainingTimeInMillis'>,
): Promise<unknown> {
  const mode = ev.mode;
  if (mode !== 'v2' && mode !== 'shadow') throw new Error("reclassify: mode debe ser 'v2' o 'shadow'");
  const from = new Date(ev.from);
  const to = new Date(ev.to);
  if (!ev.agencySlug || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    throw new Error('reclassify: agencySlug, from y to (ISO, from < to) son obligatorios');
  }
  if ((to.getTime() - from.getTime()) / 86_400_000 > RECLASSIFY_MAX_RANGE_DAYS) {
    throw new Error(`reclassify: rango mayor a ${RECLASSIFY_MAX_RANGE_DAYS} días`);
  }
  const dryRun = ev.dryRun !== false;
  const concurrency = clampInt(ev.concurrency, 1, 8, 4);
  const retries = clampInt(ev.retries, 0, 5, 2);
  const cap = clampInt(ev.limit, 1, 1000, 200);
  const onlyPending = ev.onlyPending !== false;

  const agencyRes = await pgClient.query('SELECT id, slug, name FROM agencies WHERE slug = $1', [ev.agencySlug]);
  const a = agencyRes.rows[0];
  if (!a) throw new Error(`reclassify: agencia ${ev.agencySlug} no existe`);
  const agency: AgencyInfo = { id: a.id, slug: a.slug, name: a.name, mixedSources: false };

  const warnings: string[] = [];
  if (mode === 'v2' && rubricModeOf(agency.slug) !== 'v2') {
    warnings.push(`${agency.slug} no está en RUBRIC_V2_AGENCIES: las menciones que entren por SQS seguirán con legacy (usa nlp_prompt_version para no mezclar).`);
  }

  const params: unknown[] = [agency.id, from.toISOString(), to.toISOString()];
  let where = 'm.agency_id = $1 AND m.published_at >= $2 AND m.published_at < $3';
  if (!ev.includeDuplicates) where += ' AND m.is_duplicate = false';
  if (onlyPending) {
    params.push(RUBRIC_V2_VERSION);
    where += mode === 'v2'
      ? ` AND m.nlp_prompt_version IS DISTINCT FROM $${params.length}`
      : ` AND NOT EXISTS (SELECT 1 FROM mention_nlp_shadow s WHERE s.mention_id = m.id AND s.prompt_version = $${params.length})`;
  }

  const countRes = await pgClient.query(`SELECT count(*)::int AS n FROM mentions m WHERE ${where}`, params);
  const candidates: number = countRes.rows[0]?.n ?? 0;
  const base = { agency: agency.slug, mode, dryRun, from: from.toISOString(), to: to.toISOString(), onlyPending, candidates, warnings };
  if (ev.countOnly) return base;

  const rows = (await pgClient.query(
    `SELECT m.id, m.bw_resource_id, m.bw_guid, m.bw_query_id, m.bw_query_name,
            m.title, m.snippet, m.url, m.domain, m.content_source, m.content_source_name,
            m.author, m.published_at, m.bw_sentiment, m.language, m.page_type, m.pub_type,
            m.nlp_sentiment, m.nlp_pertinence,
            left(m.full_text, ${NLP_TEXT_LIMIT + 1}) AS full_text
       FROM mentions m
      WHERE ${where}
      ORDER BY m.published_at DESC
      LIMIT ${cap}`,
    params,
  )).rows as any[];

  const stats = {
    processed: 0, ok: 0, failed: 0, written: 0,
    sentimentBefore: {} as Record<string, number>,
    sentimentAfter: {} as Record<string, number>,
    pertinenceBefore: {} as Record<string, number>,
    pertinenceAfter: {} as Record<string, number>,
    sentimentChanged: 0,
    adverseTrue: 0,
    kinds: {} as Record<string, number>,
    parents: {} as Record<string, number>,
    models: {} as Record<string, number>,
  };
  const details: any[] = [];
  let stoppedEarly = false;

  const processRow = async (row: any): Promise<void> => {
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
      pageType: row.page_type,
      pubType: row.pub_type,
    } as BrandwatchMention;
    const kind = deriveMentionKind(mention, agency);
    const parentPromise = kind === 'comment' ? resolveParent(pgClient, agency.id, mention) : Promise.resolve(null);

    let outcome: ClassifyOutcome | null = null;
    let lastError = '';
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        outcome = await classifyMention(mention, agency, row.full_text ?? null, {
          rubric: 'v2', kind, models: ev.modelId ? [ev.modelId] : undefined, affectCooldown: false,
        });
        if (outcome.ok) break;
        lastError = 'sin respuesta válida de Bedrock';
      } catch (err) {
        lastError = String((err as Error)?.message ?? err);
      }
      outcome = null;
      if (attempt < retries) await sleep(2000 * 2 ** attempt);
    }
    const parent = await parentPromise;

    stats.processed++;
    bump(stats.kinds, kind);
    if (parent) bump(stats.parents, `${parent.platform ?? 'desconocida'}:${parent.status}`);
    bump(stats.sentimentBefore, row.nlp_sentiment);
    bump(stats.pertinenceBefore, row.nlp_pertinence);
    if (!outcome) {
      stats.failed++;
      if (details.length < 100) details.push({ id: row.id, kind, status: 'failed', error: lastError });
      return;
    }
    const nlp = outcome.nlp;
    // Igual que en la ingesta: refuerzo determinista de municipios.
    const regexMunis = extractMunicipalitiesFromText(row.title, row.snippet, nlp.summary);
    nlp.municipalities = Array.from(new Set([...(nlp.municipalities ?? []), ...regexMunis]))
      .filter((m) => MUNICIPALITY_SLUGS.includes(m));

    stats.ok++;
    bump(stats.sentimentAfter, nlp.sentiment);
    bump(stats.pertinenceAfter, nlp.pertinence);
    bump(stats.models, outcome.model);
    if (nlp.sentiment !== row.nlp_sentiment) stats.sentimentChanged++;
    if (nlp.adverse_fact) stats.adverseTrue++;
    if (details.length < 100) {
      details.push({
        id: row.id, kind, parent: parent?.status ?? null,
        before: { sentiment: row.nlp_sentiment, pertinence: row.nlp_pertinence },
        after: { sentiment: nlp.sentiment, pertinence: nlp.pertinence, adverse_fact: nlp.adverse_fact },
      });
    }
    if (dryRun) return;

    if (mode === 'shadow') {
      if (await writeShadow(pgClient, agency.slug, row.id, outcome, true)) stats.written++;
      return;
    }
    await pgClient.query(
      `UPDATE mentions
          SET nlp_sentiment = $2, nlp_emotions = $3, nlp_pertinence = $4, nlp_summary = $5,
              nlp_adverse_fact = $6, nlp_prompt_version = $7, nlp_model = $8,
              mention_kind = $9, parent_mention_id = $10, parent_published_at = $11
        WHERE id = $1`,
      [row.id, nlp.sentiment, JSON.stringify(nlp.emotions ?? []), nlp.pertinence, (nlp.summary ?? '').slice(0, 500),
       nlp.adverse_fact, outcome.promptVersion, outcome.model,
       kind, parent?.parentMentionId ?? null, parent?.parentPublishedAt ?? null],
    );
    await rewriteNlpAssociations(pgClient, row.id, agency.id, nlp);
    stats.written++;
  };

  // Pool de `concurrency` trabajadores sobre la lista; pg.Client serializa las
  // queries, Bedrock corre en paralelo.
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      if (context && context.getRemainingTimeInMillis() < RECLASSIFY_TIME_MARGIN_MS) { stoppedEarly = true; return; }
      const row = rows[next++];
      try {
        await processRow(row);
      } catch (err) {
        stats.failed++;
        if (details.length < 100) details.push({ id: row.id, status: 'failed', error: String((err as Error)?.message ?? err) });
        console.error(`[reclassify] ${row.id} falló:`, err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));

  let remaining: number | null = null;
  if (!dryRun && onlyPending) {
    remaining = (await pgClient.query(`SELECT count(*)::int AS n FROM mentions m WHERE ${where}`, params)).rows[0]?.n ?? 0;
  }
  console.log(`[reclassify] ${agency.slug} ${mode} dryRun=${dryRun}: ok=${stats.ok} failed=${stats.failed} written=${stats.written} remaining=${remaining}`);
  return { ...base, ...stats, remaining, stoppedEarly, details };
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

/**
 * Backfill de copias propias: menciones publicadas en las últimas
 * `sinceHours` horas cuya imagen es de un CDN que caduca y todavía no se
 * copió. Pasadas ~120 h la URL ya venció (403) y no hay nada que salvar.
 * Idempotente: una mención ya copiada apunta a MEDIA_PUBLIC_BASE_URL y el
 * filtro la excluye.
 */
async function mirrorRecentMedia(client: any, sinceHours: number, limit: number): Promise<unknown> {
  const hours = Math.max(1, Math.min(24 * 14, Math.floor(sinceHours)));
  const cap = Math.max(1, Math.min(2000, Math.floor(limit)));
  const rows = (await client.query(
    `SELECT id, resolved_image_url
       FROM mentions
      WHERE resolved_image_url IS NOT NULL
        AND published_at >= now() - ($1::int * INTERVAL '1 hour')
        AND (resolved_image_url ~* '^https?://[^/]*(fbcdn\\.net|cdninstagram\\.com)/'
             OR resolved_image_url ~* '[?&](oe|x-amz-expires|expires)=')
      ORDER BY published_at DESC
      LIMIT $2`,
    [hours, cap],
  )).rows as Array<{ id: string; resolved_image_url: string }>;

  let mirrored = 0;
  let failed = 0;
  // De 5 en 5: el CDN de Meta corta con ráfagas grandes.
  for (let i = 0; i < rows.length; i += 5) {
    await Promise.all(rows.slice(i, i + 5).map(async (r) => {
      const url = await mirrorIfExpiring(r.resolved_image_url);
      if (url && url !== r.resolved_image_url) {
        await client.query('UPDATE mentions SET resolved_image_url = $1 WHERE id = $2 AND resolved_image_url = $3', [url, r.id, r.resolved_image_url]);
        mirrored++;
      } else {
        failed++;
      }
    }));
  }
  console.log(`[mirror-media] ${hours}h: candidatas=${rows.length} copiadas=${mirrored} fallidas=${failed}`);
  return { candidates: rows.length, mirrored, failed };
}
