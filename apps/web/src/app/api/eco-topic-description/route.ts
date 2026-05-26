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
 * Histórico (period_end_date < ayer AST) inmutable; rolling (period_end_date
 * = ayer AST) refresca si el cache está stale > 1h (regen async best-effort).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, topicDescriptionsCache, topics, agencies } from '@eco/database';
import { and, eq, desc } from 'drizzle-orm';
import {
  rollingWindowYmdInTZ,
  ymdInTimeZone,
  TOPIC_DESCRIPTION_SYSTEM_PROMPT,
  buildTopicDescriptionPrompt,
  type TopicAggregateForDescription,
  type TopicMentionSample,
} from '@eco/shared';
import { invokeClaude } from '@eco/shared/src/bedrock';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { resolveAgencyId } from '@/lib/agency';
import { log } from '@/lib/log';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TZ = 'America/Puerto_Rico';
const PRIMARY_MODEL = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1';
const FALLBACK_MODEL = process.env.BEDROCK_FALLBACK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';

const PERIOD_DAYS: Record<string, number> = {
  '1D': 1, '5D': 5, '7D': 7, '30D': 30, '90D': 90,
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
    const w = rollingWindowYmdInTZ(days, new Date(), TZ);
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
      // Para rolling stale podríamos disparar regen en background; por ahora
      // devolvemos lo que tenemos (suficiente para una descripción que cambia
      // poco entre horas) y dejamos el flag stale para que la UI decida.
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

    // Cache miss: genera ahora (síncrono). Window inclusivo en ambos extremos
    // en AST (UTC-4 sin DST).
    const sinceIso = `${startYmd}T04:00:00.000Z`;
    const untilDate = new Date(`${endYmd}T04:00:00.000Z`);
    untilDate.setUTCDate(untilDate.getUTCDate() + 1);
    const untilIso = untilDate.toISOString();
    const periodDays = Math.max(1, Math.round((untilDate.getTime() - new Date(sinceIso).getTime()) / 86_400_000));

    const aggregate = await loadTopicAggregate(pool, agencyId, agencyRow.name, topicRow.id, topicRow.name, topicRow.slug, sinceIso, untilIso, periodDays);
    if (aggregate.totalMentions === 0) {
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
    const userPrompt = buildTopicDescriptionPrompt(aggregate, samples);
    const text = await invokeClaude({
      client: getBedrock(),
      systemPrompt: TOPIC_DESCRIPTION_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 400,
      primaryModel: PRIMARY_MODEL,
      fallbackModel: FALLBACK_MODEL,
      temperature: 0,
    });
    let parsed: { description?: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      // El modelo a veces envuelve en markdown fences; intentamos extraer.
      const match = text.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }
    const description = (parsed.description ?? '').trim().slice(0, 800);
    if (!description) {
      log.warn('eco-topic-description', 'model returned empty', { topicSlug, startYmd, endYmd });
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
      [agencyId, topicRow.id, startYmd, endYmd, description, PRIMARY_MODEL],
    );

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
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('positivo','positive'))::int AS pos,
            COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative'))::int AS neg
       FROM mention_topics mt
       JOIN mentions m ON m.id = mt.mention_id
      WHERE m.agency_id = $1 AND mt.topic_id = $2
        AND m.published_at >= $3 AND m.published_at <= $4`,
    [agencyId, topicId, sinceIso, untilIso],
  );
  const total = Number(totalsRes.rows[0]?.total ?? 0);
  const positive = Number(totalsRes.rows[0]?.pos ?? 0);
  const negative = Number(totalsRes.rows[0]?.neg ?? 0);

  const subRes = await pool.query<{ name: string; count: number }>(
    `SELECT s.name AS name, COUNT(*)::int AS count
       FROM mention_topics mt
       JOIN mentions m ON m.id = mt.mention_id
       JOIN subtopics s ON s.id = mt.subtopic_id
      WHERE m.agency_id = $1 AND mt.topic_id = $2
        AND m.published_at >= $3 AND m.published_at <= $4
      GROUP BY s.name
      ORDER BY count DESC
      LIMIT 10`,
    [agencyId, topicId, sinceIso, untilIso],
  );

  const muniRes = await pool.query<{ name: string; count: number }>(
    `SELECT mu.name AS name, COUNT(*)::int AS count
       FROM mention_topics mt
       JOIN mentions m ON m.id = mt.mention_id
       JOIN mention_municipalities mm ON mm.mention_id = m.id
       JOIN municipalities mu ON mu.id = mm.municipality_id
      WHERE m.agency_id = $1 AND mt.topic_id = $2
        AND m.published_at >= $3 AND m.published_at <= $4
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

async function loadTopicSamples(
  pool: ReturnType<typeof getPool>,
  agencyId: string,
  topicId: number,
  sinceIso: string,
  untilIso: string,
): Promise<TopicMentionSample[]> {
  const out: TopicMentionSample[] = [];
  for (const s of ['negativo', 'neutral', 'positivo'] as const) {
    const altSentiment = s === 'negativo' ? 'negative' : s === 'positivo' ? 'positive' : 'neutral';
    const res = await pool.query<{ title: string | null; snippet: string | null; sentiment: string | null; subtopic: string | null; source: string | null }>(
      `SELECT m.title, m.snippet,
              COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
              (SELECT sub.name FROM mention_topics mt2 JOIN subtopics sub ON sub.id = mt2.subtopic_id
                WHERE mt2.mention_id = m.id AND mt2.topic_id = $2 LIMIT 1) AS subtopic,
              m.page_type AS source
         FROM mention_topics mt
         JOIN mentions m ON m.id = mt.mention_id
        WHERE m.agency_id = $1 AND mt.topic_id = $2
          AND m.published_at >= $3 AND m.published_at <= $4
          AND COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ($5, $6)
        ORDER BY COALESCE(m.engagement_score, 0) DESC
        LIMIT 2`,
      [agencyId, topicId, sinceIso, untilIso, s, altSentiment],
    );
    for (const r of res.rows) {
      const text = ((r.title ?? '') || (r.snippet ?? '')).toString().trim();
      if (!text) continue;
      out.push({
        text,
        sentiment: normalizeSentiment(r.sentiment),
        subtopic: r.subtopic ?? null,
        source: r.source ?? null,
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
