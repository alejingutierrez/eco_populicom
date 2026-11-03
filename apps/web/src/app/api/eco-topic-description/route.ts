/**
 * GET /api/eco-topic-description — sirve la descripción IA de un tópico para
 * una agencia + periodo específico, cacheada por (topic_id, period_start,
 * period_end).
 *
 * Comportamiento:
 *   - Cache hit  → devuelve la descripción guardada (rápido).
 *   - Cache miss → invoca Bedrock (Claude Opus, fallback Sonnet) SINCRÓNICAMENTE,
 *                  persiste y devuelve. Cliente espera ~3–10s, sin polling.
 *
 * El ECS task role del web service ya tiene `bedrock:InvokeModel` (commit
 * "chore(infra): grant Bedrock InvokeModel to ECS task role"), así que el
 * endpoint puede llamar Bedrock directamente sin pasar por el lambda
 * eco-ai-tasks. Esto evita el patrón 202/polling que sí usa
 * /api/eco-metric-insight, manteniendo el código del endpoint más simple.
 *
 * Frescura: un hit se regenera (síncrono, como un miss) si llegaron menciones
 * PRIMARIAS del tópico a la ventana después de generarlo (lib/ai-cache-
 * freshness). Antes la histórica era inmutable y la rolling solo marcaba
 * stale: DF asistencia-social 14→20 oct se generó sin 40 de sus 95 menciones
 * (QA 23-oct-2026). Si la regeneración falla se sirve la vieja con stale.
 *
 * Universo del prompt: menciones cuyo tópico PRIMARIO (top-confidence) es éste,
 * el mismo criterio que TOPICS de /api/eco-data. Antes contaba cualquier fila
 * de mention_topics (incluye secundarios) y el texto citaba cifras que la
 * página no muestra (DF gestion-secretaria: 612 en el prompt vs 183 en la UI).
 *
 * Motor de redacción (WP-8): con la agencia en `COMPOSER_WEB_AGENCIES` la
 * descripción sale del perfil ligero del motor (./composer.ts), con cifras
 * por marcador. La versión del motor va en `model_used`; una fila de otra
 * versión (o legacy con la bandera encendida, y al revés) se regenera. El
 * motor compone SIEMPRE en segundo plano: con fila se sirve la que haya; sin
 * fila se responde con el texto legacy (misma latencia que hoy) y la del
 * motor aparece en la siguiente vista. Un fallo del redactor no guarda nada.
 * Con la bandera vacía la ruta hace exactamente lo de antes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, topicDescriptionsCache, topics, agencies } from '@eco/database';
import { and, eq, desc } from 'drizzle-orm';
import {
  dashboardPresetWindowYmdInTZ,
  ymdInTimeZone,
  TOPIC_DESCRIPTION_SYSTEM_PROMPT,
  type PgClientLike,
  buildTopicDescriptionPrompt,
  type TopicAggregateForDescription,
  type TopicMentionSample,
} from '@eco/shared';
import { invokeClaudeWithTool } from '@eco/shared/src/bedrock';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { resolveAgencyId } from '@/lib/agency';
import { log } from '@/lib/log';
import {
  loadWindowFreshness, isAiCacheOutdated, claimAiTrigger, releaseAiTrigger,
  expectedComposerVersion, isComposerVersionStale,
} from '@/lib/ai-cache-freshness';
import { composerVersionFromModelUsed } from './composer';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TZ = 'America/Puerto_Rico';
const PRIMARY_MODEL = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1';
const FALLBACK_MODEL = process.env.BEDROCK_FALLBACK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';

/**
 * Marca en model_used de las filas generadas con el universo de tópico
 * PRIMARIO. Las anteriores (multi-tópico, citaban cifras que la UI no muestra)
 * se tratan como viejas y se regeneran una vez, sin cambio de esquema.
 */
const PRIMARY_UNIVERSE_TAG = '+primary';

const PERIOD_DAYS: Record<string, number> = {
  'HOY': 1, '1D': 1, '5D': 5, '7D': 7, '30D': 30, '90D': 90,
  '1M': 30, '3M': 90, '6M': 180, '1A': 365, 'Max': 730,
};

let bedrock: BedrockRuntimeClient | null = null;
function getBedrock(): BedrockRuntimeClient {
  if (!bedrock) bedrock = new BedrockRuntimeClient({});
  return bedrock;
}

function parseCustomRange(
  fromParam: string | null,
  toParam: string | null,
): null | { startYmd: string; endYmd: string } {
  if (!fromParam || !toParam) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromParam) || !/^\d{4}-\d{2}-\d{2}$/.test(toParam)) return null;
  if (fromParam > toParam) return null;
  return { startYmd: fromParam, endYmd: toParam };
}

function normalizeSentiment(s: string | null): 'positivo' | 'neutral' | 'negativo' {
  if (s === 'positivo' || s === 'positive') return 'positivo';
  if (s === 'negativo' || s === 'negative') return 'negativo';
  return 'neutral';
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rl = consume('eco-topic-description:' + clientKey(request), { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } },
    );
  }

  const start = Date.now();
  const { searchParams } = new URL(request.url);
  const topicSlug = searchParams.get('topic');
  if (!topicSlug) {
    return NextResponse.json({ error: 'Missing topic param' }, { status: 400 });
  }

  const periodKey = searchParams.get('period') ?? '1M';
  const customRange = parseCustomRange(searchParams.get('from'), searchParams.get('to'));

  let startYmd: string;
  let endYmd: string;
  if (customRange) {
    startYmd = customRange.startYmd;
    endYmd = customRange.endYmd;
  } else {
    const days = PERIOD_DAYS[periodKey];
    if (!days) {
      return NextResponse.json({ error: `Unsupported period: ${periodKey}` }, { status: 400 });
    }
    const w = dashboardPresetWindowYmdInTZ(periodKey, days, new Date(), TZ);
    startYmd = w.startYmd;
    endYmd = w.endYmd;
  }

  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ error: 'No agency resolved' }, { status: 404 });
  }

  const pool = getPool();
  const db = getDb();

  const [agencyRow] = await db
    .select({ id: agencies.id, name: agencies.name, slug: agencies.slug })
    .from(agencies)
    .where(eq(agencies.id, agencyId))
    .limit(1);
  if (!agencyRow) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
  }

  const [topicRow] = await db
    .select({ id: topics.id, name: topics.name, slug: topics.slug })
    .from(topics)
    .where(and(eq(topics.slug, topicSlug), eq(topics.agencyId, agencyId)))
    .limit(1);
  if (!topicRow) {
    return NextResponse.json({ error: 'Topic not found for this agency' }, { status: 404 });
  }

  // Fila vieja que se está regenerando: respaldo si la regeneración falla.
  let staleRow: { description: string; generatedAt: Date | string } | null = null;
  // Versión del motor que debe tener la fila (null = legacy, bandera vacía).
  const composerExpected = expectedComposerVersion(agencyRow.slug, { startYmd, endYmd });
  const serveStale = (): NextResponse | null => {
    if (!staleRow) return null;
    const res = NextResponse.json({
      status: 'ready' as const,
      topicSlug,
      periodStart: startYmd,
      periodEnd: endYmd,
      description: staleRow.description,
      generatedAt: staleRow.generatedAt,
      stale: true,
    });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  };

  try {
    await ensureTopicDescriptionsCacheSchema(pool);

    const [cached] = await db
      .select()
      .from(topicDescriptionsCache)
      .where(and(
        eq(topicDescriptionsCache.topicId, topicRow.id),
        eq(topicDescriptionsCache.periodStartDate, startYmd),
        eq(topicDescriptionsCache.periodEndDate, endYmd),
      ))
      .orderBy(desc(topicDescriptionsCache.generatedAt))
      .limit(1);

    const yesterdayYmd = ymdInTimeZone(new Date(Date.now() - 86400000), TZ);
    const isHistorical = endYmd < yesterdayYmd;

    if (cached) {
      const generatedAt = new Date(cached.generatedAt as unknown as string);
      const ageMs = Date.now() - generatedAt.getTime();
      const STALE_MS = 60 * 60 * 1000;
      const stale = !isHistorical && ageMs > STALE_MS;
      const outdated = !String(cached.modelUsed ?? '').endsWith(PRIMARY_UNIVERSE_TAG)
        || isComposerVersionStale(composerVersionFromModelUsed(cached.modelUsed), composerExpected)
        || isAiCacheOutdated(
          await loadWindowFreshness(pool as unknown as PgClientLike, {
            agencyId, startYmd, endYmd, generatedAt, topicId: topicRow.id,
          }),
        );
      if (!outdated) {
        const res = NextResponse.json({
          status: 'ready' as const,
          topicSlug,
          periodStart: startYmd,
          periodEnd: endYmd,
          description: cached.description,
          generatedAt: cached.generatedAt,
          stale,
        });
        res.headers.set('Cache-Control', 'no-store');
        return res;
      }
      // Vieja: se regenera abajo como un miss; si otra petición ya la está
      // regenerando (< 3 min), se sirve la vieja.
      staleRow = cached;
      if (!claimAiTrigger(`topic-description:${topicRow.id}:${startYmd}:${endYmd}`)) return serveStale()!;
    }

    // Cache miss: genera ahora (síncrono). Window inclusivo en ambos extremos
    // en AST (UTC-4 sin DST).
    const sinceIso = `${startYmd}T04:00:00.000Z`;
    const untilDate = new Date(`${endYmd}T04:00:00.000Z`);
    untilDate.setUTCDate(untilDate.getUTCDate() + 1);
    const untilIso = untilDate.toISOString();
    const periodDays = Math.max(1, Math.round((untilDate.getTime() - new Date(sinceIso).getTime()) / 86_400_000));

    const aggregate = await loadTopicAggregate(pool, agencyId, agencyRow.name, topicRow.id, topicRow.name, topicRow.slug, sinceIso, untilIso, periodDays);
    if (aggregate.totalMentions === 0) {
      const fallback = serveStale();
      if (fallback) return fallback;
      const res = NextResponse.json({
        status: 'empty' as const,
        topicSlug,
        periodStart: startYmd,
        periodEnd: endYmd,
        description: null,
        message: 'No hay menciones de este tópico en el periodo seleccionado.',
      });
      res.headers.set('Cache-Control', 'no-store');
      return res;
    }

    const samples = await loadTopicSamples(pool, agencyId, topicRow.id, sinceIso, untilIso);
    const regenKey = `topic-description:${topicRow.id}:${startYmd}:${endYmd}`;
    const composerArgs = {
      pool, agencyId, agency: agencyRow, topicId: topicRow.id, startYmd, endYmd, sinceIso, untilIso, aggregate, samples, regenKey,
    };
    if (composerExpected && staleRow) {
      // Hay texto que mostrar: se sirve YA y el motor compone en segundo plano
      // (el hit ya reclamó la clave). El motor no entra al camino crítico.
      composeDescriptionInBackground(composerArgs);
      return serveStale()!;
    }
    const userPrompt = buildTopicDescriptionPrompt(aggregate, samples);
    // tool-use en vez de pedir JSON en texto crudo: la descripción ahora es
    // más larga y cita contenido real de las menciones, así que trae comillas
    // y saltos de línea que rompían `JSON.parse` (el fallback por regex era
    // un parche). Con input_schema el parseo lo garantiza Bedrock.
    const parsed = await invokeClaudeWithTool<{ description?: string }>({
      client: getBedrock(),
      systemPrompt: TOPIC_DESCRIPTION_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 1200,
      primaryModel: PRIMARY_MODEL,
      fallbackModel: FALLBACK_MODEL,
      temperature: 0,
      tool: {
        name: 'emit_topic_description',
        description: 'Emit the topic description for the period.',
        input_schema: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              minLength: 80,
              maxLength: 1200,
              description: 'Descripción de 3 a 5 oraciones sobre de qué se está hablando en este tópico durante el periodo.',
            },
          },
          required: ['description'],
        },
      },
    });
    const description = (parsed.description ?? '').trim().slice(0, 1200);
    if (!description) {
      log.warn('eco-topic-description', 'model returned empty', { topicSlug, startYmd, endYmd });
      const fallback = serveStale();
      if (fallback) return fallback;
      return NextResponse.json(
        { error: 'Model returned empty description', topicSlug, periodStart: startYmd, periodEnd: endYmd },
        { status: 502 },
      );
    }

    // Persistir en cache con ON CONFLICT (race seguro con otra invocación
    // concurrente que pueda haber generado la misma fila milisegundos antes).
    await pool.query(
      `INSERT INTO topic_descriptions_cache
         (agency_id, topic_id, period_start_date, period_end_date, description, model_used)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ON CONSTRAINT uq_topic_descriptions_topic_range
       DO UPDATE SET description = EXCLUDED.description,
                     model_used  = EXCLUDED.model_used,
                     generated_at = NOW()`,
      [agencyId, topicRow.id, startYmd, endYmd, description, PRIMARY_MODEL + PRIMARY_UNIVERSE_TAG],
    );
    // Con motor y sin fila: la primera vista recibe el texto legacy (misma
    // latencia que hoy) y el motor compone en segundo plano para la siguiente.
    if (composerExpected && claimAiTrigger(regenKey)) composeDescriptionInBackground(composerArgs);

    const res = NextResponse.json({
      status: 'ready' as const,
      topicSlug,
      periodStart: startYmd,
      periodEnd: endYmd,
      description,
      generatedAt: new Date().toISOString(),
      stale: false,
    });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (err) {
    log.error('eco-topic-description', 'handler failed', { msg: (err as Error).message, topicSlug, startYmd, endYmd });
    const fallback = serveStale();
    if (fallback) return fallback;
    return NextResponse.json(
      { error: 'eco-topic-description error', message: (err as Error).message },
      { status: 500 },
    );
  } finally {
    log.info('eco-topic-description', 'request complete', {
      latencyMs: Date.now() - start, topicSlug, startYmd, endYmd,
    });
  }
}

/**
 * Descripción con el motor (perfil ligero). Null si el redactor no produjo
 * borrador. La serie diaria del tópico fija la ventana del paquete de hechos.
 */
async function composeDescription(a: {
  pool: ReturnType<typeof getPool>;
  agencyId: string;
  agency: { id: string; name: string; slug: string };
  topicId: number;
  startYmd: string; endYmd: string; sinceIso: string; untilIso: string;
  aggregate: TopicAggregateForDescription;
  samples: TopicSampleRow[];
}): Promise<{ description: string; modelUsed: string } | null> {
  const [{ getComposerLlm, createComposerDataAccess, toRawComposerSample }, c, { prepareSamples }] = await Promise.all([
    import('@/lib/bedrock-client'),
    import('./composer'),
    import('@eco/shared'),
  ]);
  const group = (k: 'negativo' | 'neutral' | 'positivo') => a.samples.filter((x) => x.sentiment === k).map((x) => toRawComposerSample({
    id: x.id, createdAt: x.createdAt, text: x.text, sentiment: x.sentiment, author: x.author ?? null, source: x.source ?? null,
  }));
  const [prepared, series] = await Promise.all([
    prepareSamples(createComposerDataAccess(a.pool, a.agencyId), {
      negative: group('negativo'), neutral: group('neutral'), positive: group('positivo'),
    }, { agencyAuthors: [a.agency.name] }),
    loadTopicDailySeries(a.pool, a.agencyId, a.topicId, a.sinceIso, a.untilIso, a.startYmd, a.endYmd),
  ]);
  const input = c.topicComposerInput({
    agencyId: a.agencyId, agencyName: a.agency.name, shortName: a.agency.slug.toUpperCase().slice(0, 6),
    startYmd: a.startYmd, endYmd: a.endYmd, aggregate: a.aggregate, dailySeries: series, samples: prepared.samples,
  });
  const r = await c.composeTopic(input, getComposerLlm(), (m) => log.warn('eco-topic-description', m));
  log.info('eco-topic-description', 'composer', {
    topic: a.aggregate.topicSlug, version: r.composition.composerVersion, degraded: r.degraded,
    seconds: r.composition.stageSeconds.total, corrector: r.composition.correctorRan,
    safetyNet: r.composition.safetyNetLog.length, errors: r.composition.errors.slice(0, 3),
  });
  const description = c.topicDescription(r);
  return description ? { description, modelUsed: c.composerModelUsed(r, PRIMARY_UNIVERSE_TAG) } : null;
}

/**
 * El motor en segundo plano: compone y, solo si el texto salió del redactor,
 * guarda la fila con su versión en `model_used`. La ruta nunca lo espera
 * (sin fila responde con el texto legacy, con fila con la que haya), así la
 * vista tarda lo mismo que hoy. El llamador ya reclamó `regenKey`.
 */
function composeDescriptionInBackground(a: Parameters<typeof composeDescription>[0] & { regenKey: string }): void {
  (async () => {
    try {
      const composed = await composeDescription(a);
      if (!composed) return; // sin borrador del redactor: queda la fila que había
      await a.pool.query(
        `INSERT INTO topic_descriptions_cache
           (agency_id, topic_id, period_start_date, period_end_date, description, model_used)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ON CONSTRAINT uq_topic_descriptions_topic_range
         DO UPDATE SET description = EXCLUDED.description,
                       model_used  = EXCLUDED.model_used,
                       generated_at = NOW()`,
        [a.agencyId, a.topicId, a.startYmd, a.endYmd, composed.description, composed.modelUsed],
      );
    } catch (err) {
      log.error('eco-topic-description', 'composer (background) failed', { msg: (err as Error).message });
    } finally {
      releaseAiTrigger(a.regenKey);
    }
  })();
}

/**
 * Serie diaria (día PR) del tópico, mismo universo y tópico primario que el
 * resto de la ruta. Rellena los días sin menciones.
 */
async function loadTopicDailySeries(
  pool: ReturnType<typeof getPool>,
  agencyId: string,
  topicId: number,
  sinceIso: string,
  untilIso: string,
  startYmd: string,
  endYmd: string,
): Promise<Array<{ date: string; negative: number; neutral: number; positive: number }>> {
  const res = await pool.query<{ d: string; neg: number; pos: number; total: number }>(
    `WITH ${PRIMARY_TOPIC_MENTIONS_CTE}
     SELECT to_char(m.published_at AT TIME ZONE 'America/Puerto_Rico', 'YYYY-MM-DD') AS d,
            COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative'))::int AS neg,
            COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('positivo','positive'))::int AS pos,
            COUNT(*)::int AS total
       FROM tm m
      GROUP BY 1`,
    [agencyId, topicId, sinceIso, untilIso],
  );
  const byDay = new Map(res.rows.map((r) => [r.d, r]));
  const out: Array<{ date: string; negative: number; neutral: number; positive: number }> = [];
  for (let t = Date.parse(`${startYmd}T00:00:00Z`); t <= Date.parse(`${endYmd}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const r = byDay.get(d);
    const neg = Number(r?.neg ?? 0), pos = Number(r?.pos ?? 0), tot = Number(r?.total ?? 0);
    out.push({ date: d, negative: neg, positive: pos, neutral: Math.max(0, tot - neg - pos) });
  }
  return out;
}

/**
 * Menciones de la ventana cuyo tópico PRIMARIO (fila de mention_topics de
 * mayor confianza; mismo ORDER BY que TOPICS de /api/eco-data) es $2, con el
 * subtópico de esa misma fila. Universo pertinente. Params: $1 agencia,
 * $2 topic_id, $3/$4 bordes ISO.
 */
const PRIMARY_TOPIC_MENTIONS_CTE = `
  tm AS (
    SELECT m.id, m.title, m.snippet, m.author, m.page_type,
           m.nlp_sentiment, m.bw_sentiment, m.engagement_score, m.published_at,
           p.subtopic_id
      FROM mentions m
      CROSS JOIN LATERAL (
        SELECT mt.topic_id, mt.subtopic_id
          FROM mention_topics mt
         WHERE mt.mention_id = m.id
         ORDER BY mt.confidence DESC NULLS LAST, mt.topic_id ASC
         LIMIT 1
      ) p
     WHERE m.agency_id = $1 AND p.topic_id = $2
       AND m.is_duplicate = false
       AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
       AND m.published_at >= $3 AND m.published_at <= $4
  )`;

async function loadTopicAggregate(
  pool: ReturnType<typeof getPool>,
  agencyId: string,
  agencyName: string,
  topicId: number,
  topicName: string,
  topicSlug: string,
  sinceIso: string,
  untilIso: string,
  periodDays: number,
): Promise<TopicAggregateForDescription> {
  const totalsRes = await pool.query<{ total: number; pos: number; neg: number }>(
    `WITH ${PRIMARY_TOPIC_MENTIONS_CTE}
     SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('positivo','positive'))::int AS pos,
            COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative'))::int AS neg
       FROM tm m`,
    [agencyId, topicId, sinceIso, untilIso],
  );
  const total = Number(totalsRes.rows[0]?.total ?? 0);
  const positive = Number(totalsRes.rows[0]?.pos ?? 0);
  const negative = Number(totalsRes.rows[0]?.neg ?? 0);

  // Subtópico de la fila primaria (como SUBTOPICS de eco-data): la suma
  // nunca excede el total del tópico.
  const subRes = await pool.query<{ name: string; count: number }>(
    `WITH ${PRIMARY_TOPIC_MENTIONS_CTE}
     SELECT s.name AS name, COUNT(*)::int AS count
       FROM tm m
       JOIN subtopics s ON s.id = m.subtopic_id
      GROUP BY s.name
      ORDER BY count DESC
      LIMIT 10`,
    [agencyId, topicId, sinceIso, untilIso],
  );

  const muniRes = await pool.query<{ name: string; count: number }>(
    `WITH ${PRIMARY_TOPIC_MENTIONS_CTE}
     SELECT mu.name AS name, COUNT(*)::int AS count
       FROM tm m
       JOIN mention_municipalities mm ON mm.mention_id = m.id
       JOIN municipalities mu ON mu.id = mm.municipality_id
      GROUP BY mu.name
      ORDER BY count DESC
      LIMIT 5`,
    [agencyId, topicId, sinceIso, untilIso],
  );

  return {
    agencyName,
    topicName,
    topicSlug,
    periodDays,
    totalMentions: total,
    positive,
    neutral: Math.max(0, total - positive - negative),
    negative,
    topSubtopics: subRes.rows.map((r) => ({ name: r.name, count: Number(r.count) })),
    topMunicipalities: muniRes.rows.map((r) => ({ name: r.name, count: Number(r.count) })),
  };
}

/**
 * Muestras de menciones que alimentan la descripción.
 *
 * Antes traía 2 por sentimiento (6 en total) y solo el título. El usuario pidió
 * descripciones "más contextuales… pasarle las menciones del periodo a la IA
 * para que tenga más contexto y pueda hacer descripciones más acertadas", así
 * que ahora:
 *   - 10 por sentimiento (hasta 30) en vez de 2,
 *   - mezcla las más ENGAGED con las más RECIENTES, para no describir solo el
 *     pico viral e ignorar la conversación de fondo,
 *   - concatena título + snippet (antes el snippet se descartaba si había
 *     título), que es donde vive el contenido real de la queja o el reclamo.
 */
const SAMPLES_PER_SENTIMENT = 10;

/** Muestra del prompt + id y fecha (el motor las anota con tipo, padre y día). */
type TopicSampleRow = TopicMentionSample & { id: string; createdAt: string };

async function loadTopicSamples(
  pool: ReturnType<typeof getPool>,
  agencyId: string,
  topicId: number,
  sinceIso: string,
  untilIso: string,
): Promise<TopicSampleRow[]> {
  const out: TopicSampleRow[] = [];
  const seen = new Set<string>();
  const half = Math.ceil(SAMPLES_PER_SENTIMENT / 2);
  for (const s of ['negativo', 'neutral', 'positivo'] as const) {
    const altSentiment = s === 'negativo' ? 'negative' : s === 'positivo' ? 'positive' : 'neutral';
    // Dos pasadas por sentimiento: top engagement + más recientes. UNION ALL
    // en una sola query para no multiplicar round-trips.
    const res = await pool.query<{ id: string; title: string | null; snippet: string | null; sentiment: string | null; subtopic: string | null; source: string | null; author: string | null; published_at: Date | string }>(
      `WITH ${PRIMARY_TOPIC_MENTIONS_CTE},
       pool AS (
         SELECT m.id, m.title, m.snippet, m.author, m.page_type, m.subtopic_id,
                COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
                COALESCE(m.engagement_score, 0) AS eng,
                m.published_at
           FROM tm m
          WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ($5, $6)
       ),
       picked AS (
         (SELECT * FROM pool ORDER BY eng DESC LIMIT $7)
         UNION
         (SELECT * FROM pool ORDER BY published_at DESC LIMIT $8)
       )
       SELECT p.id, p.title, p.snippet, p.sentiment, p.author, p.published_at,
              p.page_type AS source,
              (SELECT sub.name FROM subtopics sub WHERE sub.id = p.subtopic_id) AS subtopic
         FROM picked p
        ORDER BY p.eng DESC`,
      [agencyId, topicId, sinceIso, untilIso, s, altSentiment, half, SAMPLES_PER_SENTIMENT - half],
    );
    for (const r of res.rows) {
      if (seen.has(r.id)) continue;
      // Título + snippet: el contenido real de la queja suele estar en el
      // snippet, que antes se descartaba cuando existía título.
      const title = (r.title ?? '').toString().replace(/\s+/g, ' ').trim();
      const snippet = (r.snippet ?? '').toString().replace(/\s+/g, ' ').trim();
      const text = (snippet && title && !snippet.startsWith(title))
        ? `${title} — ${snippet}`
        : (snippet || title);
      if (!text) continue;
      seen.add(r.id);
      out.push({
        id: r.id,
        createdAt: new Date(r.published_at as unknown as string).toISOString(),
        text,
        sentiment: normalizeSentiment(r.sentiment),
        subtopic: r.subtopic ?? null,
        source: r.source ?? null,
        author: r.author ?? null,
      });
    }
  }
  return out;
}

async function ensureTopicDescriptionsCacheSchema(pool: ReturnType<typeof getPool>): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "topic_descriptions_cache" (
      "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "agency_id"           UUID NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
      "topic_id"            INTEGER NOT NULL REFERENCES "topics"("id") ON DELETE CASCADE,
      "period_start_date"   DATE NOT NULL,
      "period_end_date"     DATE NOT NULL,
      "description"         TEXT NOT NULL,
      "model_used"          TEXT NOT NULL,
      "generated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "uq_topic_descriptions_topic_range"
        UNIQUE ("topic_id", "period_start_date", "period_end_date")
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idx_topic_descriptions_topic_recent"
      ON "topic_descriptions_cache"("topic_id", "period_end_date")
  `);
}
