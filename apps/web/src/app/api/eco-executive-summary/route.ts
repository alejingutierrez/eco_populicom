/**
 * GET /api/eco-executive-summary — "Resumen ejecutivo" del Scorecard, ahora
 * generado POR PERIODO y cacheado por (agency, period_start, period_end).
 *
 * POR QUÉ EXISTE. El bloque del Scorecard leía `agency_briefings`, una tabla
 * que un cron llena con `period_hours = 24` fijo. El resultado: el resumen
 * mostraba lo mismo con el filtro en 1D, 7D, 30D o un rango custom. El usuario
 * lo reportó explícitamente ("debe reaccionar a los filtros, ese componente
 * también cambia de acuerdo al filtro seleccionado"), y además pidió un texto
 * un poco más largo y más narrativo — "de qué realmente está sucediendo y de
 * qué se está hablando", con menos recitación de métricas.
 *
 * DISEÑO. Mismo patrón que /api/eco-topic-description: cache-hit inmediato,
 * cache-miss genera síncronamente con Bedrock (el ECS task role ya tiene
 * bedrock:InvokeModel) y persiste. Los TRES modos (signal / emerging / crisis)
 * salen de UNA sola llamada al modelo — generarlos por separado triplicaba la
 * latencia sin necesidad, porque comparten exactamente el mismo contexto.
 *
 * El SPA sigue teniendo el briefing rule-based de /api/eco-data como fallback
 * (ése sí es period-scoped, porque se deriva de TOPICS/winCur de la ventana),
 * así que el bloque nunca queda vacío mientras esto genera o si Bedrock falla.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, agencies } from '@eco/database';
import { eq } from 'drizzle-orm';
import {
  resolveWindow,
  PERIOD_DAYS,
  formatPeriodLabel,
  buildSentimentReport,
  loadMetricsForWindow,
  EXECUTIVE_SUMMARY_SYSTEM_PROMPT,
  EXECUTIVE_SUMMARY_TOOL_SCHEMA,
  buildExecutiveSummaryPrompt,
  type PgClientLike,
  type ExecutiveSummaryAggregates,
  type ExecutiveSummaryMentionSample,
  type ExecutiveSummaryOutput,
} from '@eco/shared';
import { invokeClaudeWithTool } from '@eco/shared/src/bedrock';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { resolveAgencyId } from '@/lib/agency';
import { requireAuth } from '@/lib/auth/require-admin';
import { log } from '@/lib/log';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TZ = 'America/Puerto_Rico';
const PRIMARY_MODEL = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1';
const FALLBACK_MODEL = process.env.BEDROCK_FALLBACK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';

let bedrockClient: BedrockRuntimeClient | null = null;
function getBedrock(): BedrockRuntimeClient {
  if (!bedrockClient) bedrockClient = new BedrockRuntimeClient({});
  return bedrockClient;
}

/** Muestras por sentimiento: mitad por engagement, mitad por recencia. */
const SAMPLES_PER_SENTIMENT = 10;

function normalizeSentiment(s: string | null): 'positivo' | 'neutral' | 'negativo' {
  if (s === 'positivo' || s === 'positive') return 'positivo';
  if (s === 'negativo' || s === 'negative') return 'negativo';
  return 'neutral';
}

interface ModeShape {
  narrativeHtml: string;
  /** Dos viñetas que explican, debajo del párrafo (ago 2026). */
  points: string[];
  dominantSignal: string;
  action: string;
  actionTone: 'pos' | 'neg' | 'warn' | 'neu';
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rl = consume('eco-exec-summary:' + clientKey(request), { limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } },
    );
  }

  // Sesión OBLIGATORIA, verificada en la ruta y no sólo en el middleware.
  // El matcher del middleware es un allowlist explícito de rutas; olvidar
  // añadir un endpoint nuevo lo deja abierto, y `resolveAgencyId` sin sesión
  // cae a la rama "public/seed" que acepta `?agency=<slug>` — es decir, un
  // anónimo podía pedir el resumen de cualquier agencia (pasó con este mismo
  // endpoint al desplegarlo). Este chequeo hace que el olvido no sea
  // explotable.
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const start = Date.now();
  const { searchParams } = new URL(request.url);
  const periodKey = searchParams.get('period') ?? '7D';
  const window = resolveWindow({
    period: periodKey,
    from: searchParams.get('from'),
    to: searchParams.get('to'),
    timeZone: TZ,
  });
  if (!window) {
    return NextResponse.json(
      { error: `Unsupported period: ${periodKey}. Valid: ${Object.keys(PERIOD_DAYS).join(', ')}, or pass from/to.` },
      { status: 400 },
    );
  }

  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ error: 'No agency resolved' }, { status: 404 });
  }

  const { startYmd, endYmd, prevStartYmd, prevEndYmd } = window;
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

  try {
    await ensureExecutiveSummaryCacheSchema(pool);

    // ---- Cache hit ----------------------------------------------------
    const cached = await pool.query<{
      payload: ExecutiveSummaryOutput;
      generated_at: Date | string;
    }>(
      `SELECT payload, generated_at
         FROM executive_summaries_cache
        WHERE agency_id = $1 AND period_start_date = $2::date AND period_end_date = $3::date
        ORDER BY generated_at DESC
        LIMIT 1`,
      [agencyId, startYmd, endYmd],
    );
    if (cached.rows[0]) {
      const generatedAt = new Date(cached.rows[0].generated_at as unknown as string);
      const res = NextResponse.json({
        status: 'ready' as const,
        periodStart: startYmd,
        periodEnd: endYmd,
        modes: toModes(cached.rows[0].payload),
        generatedAt: generatedAt.toISOString(),
      });
      res.headers.set('Cache-Control', 'no-store');
      return res;
    }

    // ---- Cache miss: construir contexto y generar ----------------------
    const client = pool as unknown as PgClientLike;
    const [report, winCur] = await Promise.all([
      buildSentimentReport(client, agencyId, startYmd, endYmd, prevStartYmd, prevEndYmd),
      loadMetricsForWindow(client, agencyId, startYmd, endYmd),
    ]);

    // Sin señal suficiente no vale gastar LLM: el SPA se queda con el
    // briefing rule-based de /api/eco-data.
    if (report.totals.total < 10) {
      const res = NextResponse.json({
        status: 'empty' as const,
        periodStart: startYmd,
        periodEnd: endYmd,
        modes: null,
        message: 'Señal insuficiente en el periodo para generar un resumen.',
      });
      res.headers.set('Cache-Control', 'no-store');
      return res;
    }

    // Ventana en ISO para las queries de contexto (AST = UTC-4, sin DST).
    const sinceIso = `${startYmd}T04:00:00.000Z`;
    const untilDate = new Date(`${endYmd}T04:00:00.000Z`);
    untilDate.setUTCDate(untilDate.getUTCDate() + 1);
    const untilIso = untilDate.toISOString();
    const periodDays = Math.max(
      1,
      Math.round((untilDate.getTime() - new Date(sinceIso).getTime()) / 86_400_000),
    );

    const [samples, municipalities, authors, halves] = await Promise.all([
      loadSamples(pool, agencyId, sinceIso, untilIso),
      loadTopMunicipalities(pool, agencyId, sinceIso, untilIso),
      loadTopAuthors(pool, agencyId, sinceIso, untilIso),
      loadTopicHalves(pool, agencyId, sinceIso, untilIso),
    ]);

    const aggregates: ExecutiveSummaryAggregates = {
      agencyName: agencyRow.name,
      agencyShortName: agencyRow.slug.toUpperCase().slice(0, 6),
      periodLabel: formatPeriodLabel(startYmd, endYmd),
      periodStart: startYmd,
      periodEnd: endYmd,
      periodDays,
      totals: report.totals,
      prevTotals: report.prevTotals,
      nss: winCur.nss,
      crisisRiskScore: winCur.crisisRiskScore,
      totalReach: winCur.totalReach,
      // La tabla de tópicos del report ya trae primary/secondary + sentimiento
      // sobre ESTA ventana; filtramos las filas agregadas ("Otros", "Sin
      // clasificar") porque no son un asunto del que se pueda hablar.
      topics: report.topicsTable
        .filter((t) => !t.isOther && !t.isUnclassified)
        .slice(0, 7)
        .map((t) => ({
          name: t.topic,
          total: t.total,
          negative: t.negative,
          neutral: t.neutral,
          positive: t.positive,
          // Crecimiento REAL segunda mitad vs primera mitad de la ventana. Es
          // lo único con lo que el modo "emergentes" puede afirmar que algo
          // sube sin inventarlo; si el tópico no aparece en el mapa (o la
          // primera mitad venía en cero) va null y el prompt dice "sin base".
          deltaPct: halves.get(t.topic) ?? null,
          subtopics: t.subtopics,
        })),
      topMunicipalities: municipalities,
      topAuthors: authors,
      samples,
    };

    const output = await invokeClaudeWithTool<ExecutiveSummaryOutput>({
      client: getBedrock(),
      systemPrompt: EXECUTIVE_SUMMARY_SYSTEM_PROMPT,
      userPrompt: buildExecutiveSummaryPrompt(aggregates),
      maxTokens: 3000,
      primaryModel: PRIMARY_MODEL,
      fallbackModel: FALLBACK_MODEL,
      temperature: 0,
      tool: {
        name: 'emit_executive_summary',
        description: 'Emit the three executive-summary modes for the period.',
        input_schema: EXECUTIVE_SUMMARY_TOOL_SCHEMA,
      },
    });

    if (!output?.signal_narrative?.trim()) {
      log.warn('eco-executive-summary', 'model returned empty signal narrative', { startYmd, endYmd });
      return NextResponse.json(
        { error: 'Model returned empty summary', periodStart: startYmd, periodEnd: endYmd },
        { status: 502 },
      );
    }

    await pool.query(
      `INSERT INTO executive_summaries_cache
         (agency_id, period_start_date, period_end_date, payload, model_used)
       VALUES ($1, $2::date, $3::date, $4::jsonb, $5)
       ON CONFLICT (agency_id, period_start_date, period_end_date)
       DO UPDATE SET payload = EXCLUDED.payload,
                     model_used = EXCLUDED.model_used,
                     generated_at = NOW()`,
      [agencyId, startYmd, endYmd, JSON.stringify(output), PRIMARY_MODEL],
    );

    const res = NextResponse.json({
      status: 'ready' as const,
      periodStart: startYmd,
      periodEnd: endYmd,
      modes: toModes(output),
      generatedAt: new Date().toISOString(),
    });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (err) {
    log.error('eco-executive-summary', 'handler failed', { msg: (err as Error).message, startYmd, endYmd });
    return NextResponse.json(
      { error: 'eco-executive-summary error', message: (err as Error).message },
      { status: 500 },
    );
  } finally {
    log.info('eco-executive-summary', 'request complete', {
      latencyMs: Date.now() - start,
      period: window.custom ? 'custom' : periodKey,
      startYmd, endYmd,
    });
  }
}

/**
 * Deriva el tono de la acción del contenido del modo. El modelo no lo emite
 * (pedirle un enum lo hace fallar más seguido que derivarlo aquí); lo
 * inferimos de palabras señal del propio texto que ya generó. 'neu' es el
 * default y el SPA lo pinta con --accent.
 */
/** Descarta viñetas vacías y recorta a dos; el modelo a veces manda una sola. */
function cleanPoints(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 2);
}

function toneFor(narrative: string, mode: 'signal' | 'emerging' | 'crisis'): ModeShape['actionTone'] {
  if (mode === 'crisis') {
    return /sin señal|sin indicios|no hay señal|estable|normal/i.test(narrative) ? 'neu' : 'neg';
  }
  if (mode === 'emerging') {
    return /ningún|no hay|sin narrativas emergentes|sin crecimiento/i.test(narrative) ? 'neu' : 'warn';
  }
  return 'neu';
}

function toModes(p: ExecutiveSummaryOutput): Record<'signal' | 'emerging' | 'crisis', ModeShape> {
  return {
    signal: {
      narrativeHtml: p.signal_narrative,
      points: cleanPoints(p.signal_points),
      dominantSignal: p.signal_dominant,
      action: p.signal_action,
      actionTone: toneFor(p.signal_narrative, 'signal'),
    },
    emerging: {
      narrativeHtml: p.emerging_narrative,
      points: cleanPoints(p.emerging_points),
      dominantSignal: p.emerging_dominant,
      action: p.emerging_action,
      actionTone: toneFor(p.emerging_narrative, 'emerging'),
    },
    crisis: {
      narrativeHtml: p.crisis_narrative,
      points: cleanPoints(p.crisis_points),
      dominantSignal: p.crisis_dominant,
      action: p.crisis_action,
      actionTone: toneFor(p.crisis_narrative, 'crisis'),
    },
  };
}

/**
 * Muestras del periodo: por cada sentimiento, mitad por engagement (el pico
 * que la gente comentó) y mitad por recencia (la conversación de fondo). Sin
 * esa mezcla el resumen describía solo el post viral del periodo.
 */
async function loadSamples(
  pool: ReturnType<typeof getPool>,
  agencyId: string,
  sinceIso: string,
  untilIso: string,
): Promise<ExecutiveSummaryMentionSample[]> {
  const out: ExecutiveSummaryMentionSample[] = [];
  const seen = new Set<string>();
  const half = Math.ceil(SAMPLES_PER_SENTIMENT / 2);
  for (const s of ['negativo', 'neutral', 'positivo'] as const) {
    const alt = s === 'negativo' ? 'negative' : s === 'positivo' ? 'positive' : 'neutral';
    const res = await pool.query<{
      id: string; title: string | null; snippet: string | null; sentiment: string | null;
      author: string | null; source: string | null; eng: number | string | null; topic: string | null;
    }>(
      `WITH pool AS (
         SELECT m.id, m.title, m.snippet, m.author, m.page_type,
                COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
                COALESCE(m.engagement_score, 0) AS eng,
                m.published_at
           FROM mentions m
          WHERE m.agency_id = $1
            AND m.is_duplicate = false
            AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
            AND m.published_at >= $2 AND m.published_at <= $3
            AND COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ($4, $5)
       ),
       picked AS (
         (SELECT * FROM pool ORDER BY eng DESC LIMIT $6)
         UNION
         (SELECT * FROM pool ORDER BY published_at DESC LIMIT $7)
       )
       SELECT p.id, p.title, p.snippet, p.sentiment, p.author, p.eng,
              p.page_type AS source,
              (SELECT t.name FROM mention_topics mt JOIN topics t ON t.id = mt.topic_id
                WHERE mt.mention_id = p.id
                ORDER BY mt.confidence DESC NULLS LAST LIMIT 1) AS topic
         FROM picked p
        ORDER BY p.eng DESC`,
      [agencyId, sinceIso, untilIso, s, alt, half, SAMPLES_PER_SENTIMENT - half],
    );
    for (const r of res.rows) {
      if (seen.has(r.id)) continue;
      const title = (r.title ?? '').toString().replace(/\s+/g, ' ').trim();
      const snippet = (r.snippet ?? '').toString().replace(/\s+/g, ' ').trim();
      const text = snippet && title && !snippet.startsWith(title) ? `${title} — ${snippet}` : snippet || title;
      if (!text) continue;
      seen.add(r.id);
      out.push({
        text,
        sentiment: normalizeSentiment(r.sentiment),
        topic: r.topic ?? null,
        author: r.author ?? null,
        source: r.source ?? null,
        engagement: r.eng == null ? null : Number(r.eng),
      });
    }
  }
  return out;
}

/**
 * Crecimiento por tópico dentro de la ventana: segunda mitad vs primera mitad.
 * Devuelve un mapa nombre-de-tópico → % de cambio (redondeado). Solo incluye
 * tópicos con al menos una mención en la primera mitad — sin base no hay
 * porcentaje que reportar, y el prompt lo trata como "sin base".
 *
 * Mismo universo pertinente y mismo criterio top-confidence que el resto de los
 * conteos del producto, para que el modelo no vea cifras de otro universo.
 */
async function loadTopicHalves(
  pool: ReturnType<typeof getPool>,
  agencyId: string,
  sinceIso: string,
  untilIso: string,
): Promise<Map<string, number>> {
  const midIso = new Date(
    (new Date(sinceIso).getTime() + new Date(untilIso).getTime()) / 2,
  ).toISOString();
  const res = await pool.query<{ name: string; first_half: number | string; second_half: number | string }>(
    `WITH primary_pick AS (
       SELECT m.id,
              m.published_at,
              (SELECT mt.topic_id FROM mention_topics mt
                WHERE mt.mention_id = m.id
                ORDER BY mt.confidence DESC NULLS LAST, mt.topic_id ASC
                LIMIT 1) AS topic_id
         FROM mentions m
        WHERE m.agency_id = $1
          AND m.is_duplicate = false
          AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
          AND m.published_at >= $2 AND m.published_at <= $3
     )
     SELECT t.name AS name,
            COUNT(*) FILTER (WHERE pp.published_at < $4)::int  AS first_half,
            COUNT(*) FILTER (WHERE pp.published_at >= $4)::int AS second_half
       FROM primary_pick pp
       JOIN topics t ON t.id = pp.topic_id
      GROUP BY t.name`,
    [agencyId, sinceIso, untilIso, midIso],
  );
  const out = new Map<string, number>();
  for (const r of res.rows) {
    const first = Number(r.first_half);
    const second = Number(r.second_half);
    if (first <= 0) continue;
    out.set(r.name, Math.round(((second - first) / first) * 100));
  }
  return out;
}

async function loadTopMunicipalities(
  pool: ReturnType<typeof getPool>,
  agencyId: string,
  sinceIso: string,
  untilIso: string,
): Promise<Array<{ name: string; count: number }>> {
  const res = await pool.query<{ name: string; count: number | string }>(
    `SELECT mu.name AS name, COUNT(*)::int AS count
       FROM mentions m
       JOIN mention_municipalities mm ON mm.mention_id = m.id
       JOIN municipalities mu ON mu.id = mm.municipality_id
      WHERE m.agency_id = $1
        AND m.is_duplicate = false
        AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
        AND m.published_at >= $2 AND m.published_at <= $3
      GROUP BY mu.name
      ORDER BY count DESC
      LIMIT 5`,
    [agencyId, sinceIso, untilIso],
  );
  return res.rows.map((r) => ({ name: r.name, count: Number(r.count) }));
}

async function loadTopAuthors(
  pool: ReturnType<typeof getPool>,
  agencyId: string,
  sinceIso: string,
  untilIso: string,
): Promise<Array<{ name: string; mentions: number; reach: number }>> {
  const res = await pool.query<{ name: string; mentions: number | string; reach: number | string }>(
    `SELECT m.author AS name,
            COUNT(*)::int AS mentions,
            COALESCE(SUM(m.reach_estimate), 0)::bigint AS reach
       FROM mentions m
      WHERE m.agency_id = $1
        AND m.is_duplicate = false
        AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
        AND m.published_at >= $2 AND m.published_at <= $3
        AND m.author IS NOT NULL AND m.author <> ''
      GROUP BY m.author
      ORDER BY mentions DESC
      LIMIT 5`,
    [agencyId, sinceIso, untilIso],
  );
  return res.rows.map((r) => ({ name: r.name, mentions: Number(r.mentions), reach: Number(r.reach) }));
}

/**
 * DDL idempotente (mismo patrón que ensureTopicDescriptionsCacheSchema): las
 * migraciones Drizzle no corren en deploy en este repo, así que las tablas de
 * cache se auto-crean desde el endpoint que las usa.
 */
async function ensureExecutiveSummaryCacheSchema(pool: ReturnType<typeof getPool>): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "executive_summaries_cache" (
      "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "agency_id"         UUID NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
      "period_start_date" DATE NOT NULL,
      "period_end_date"   DATE NOT NULL,
      "payload"           JSONB NOT NULL,
      "model_used"        TEXT NOT NULL,
      "generated_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "uq_executive_summaries_agency_range"
        UNIQUE ("agency_id", "period_start_date", "period_end_date")
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idx_executive_summaries_recent"
      ON "executive_summaries_cache"("agency_id", "period_end_date")
  `);
}
