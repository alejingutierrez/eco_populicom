/**
 * eco-ai-tasks Lambda
 *
 * Lambda multi-acción que orquesta las invocaciones de Claude vía Bedrock que
 * alimentan el dashboard:
 *
 *   - `briefing`   (default, scheduled): para cada agencia activa, genera un
 *                   resumen ejecutivo de las últimas 24h y lo persiste en
 *                   `agency_briefings`. /api/eco-data lo lee.
 *
 *   - `topic-descriptions` (manual): para una agencia (o todas), genera una
 *                   descripción 2-3 oraciones para cada uno de sus tópicos
 *                   activos y la persiste en `topics.description`.
 *
 * Trigger 1 — EventBridge cron 4×/día (00, 06, 12, 18 hora AST) sin payload.
 * Trigger 2 — invocación manual con payload:
 *   {action:'briefing', agencySlug?:string, dryRun?:bool}
 *   {action:'topic-descriptions', agencySlug?:string, dryRun?:bool}
 *
 * En `dryRun:true`, calcula y devuelve el output del LLM en el response pero
 * NO escribe a la DB.
 */
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import {
  EXECUTIVE_BRIEFING_SYSTEM_PROMPT,
  buildExecutiveBriefingPrompt,
  EMERGING_BRIEFING_SYSTEM_PROMPT,
  buildEmergingBriefingPrompt,
  CRISIS_BRIEFING_SYSTEM_PROMPT,
  buildCrisisBriefingPrompt,
  TOPIC_DESCRIPTION_SYSTEM_PROMPT,
  buildTopicDescriptionPrompt,
  INSIGHTS_SYSTEM_PROMPT,
  buildSentimentInsightsPrompt,
  buildPeriodSummaryPrompt,
  CACHED_METRIC_INSIGHT_SYSTEM_PROMPT,
  buildCachedMetricInsightPrompt,
  type BriefingAggregates,
  type BriefingOutput,
  type EmergingBriefingAggregates,
  type CrisisBriefingAggregates,
  type EmergingTopic,
  type TopicAggregateForDescription,
  type TopicMentionSample,
  type WeeklyAggregates,
  type MetricKey,
  type CachedMetricInsightInput,
} from '@eco/shared';
import { agencyShortName, buildPeriodAggregates, loadSamples, loadMetricInsightContext } from './aggregates';
// `invokeClaudeWithTool` se importa por deep-path para no traer el SDK Bedrock
// al grafo de apps/web. El index de `@eco/shared` no re-exporta `bedrock.ts`
// — solo este lambda (y otros consumers que tengan @aws-sdk/client-bedrock-
// runtime instalado) lo importan directamente. Tool-use con input_schema es
// preferido vs JSON crudo (feedback_bedrock_tool_use).
import { invokeClaudeWithTool } from '@eco/shared/src/bedrock';

// JSON Schemas para tool-use. Bedrock garantiza el shape del input — el modelo
// no puede devolver comillas/saltos sin escapar que rompan JSON.parse, problema
// histórico documentado en feedback_bedrock_tool_use.
const BRIEFING_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    narrative_html: {
      type: 'string',
      description: 'Narrativa de 1-2 oraciones con <strong> permitido solo para resaltar nombres propios/cifras.',
    },
    dominant_signal: { type: 'string', description: 'Ej: "Infraestructura · Negativa"' },
    action_label: { type: 'string', description: 'Acción recomendada en gerundio/imperativo (max 80 chars)' },
    action_tone: { type: 'string', enum: ['pos', 'neg', 'warn', 'neu'] },
    reach_label: { type: 'string', description: 'Ej: "2.34M impresiones"' },
  },
  required: ['narrative_html', 'dominant_signal', 'action_label', 'action_tone', 'reach_label'],
};

const TOPIC_DESCRIPTION_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    description: {
      type: 'string',
      description: '2-3 oraciones describiendo el tópico, cada afirmación con número concreto + nombre propio.',
    },
  },
  required: ['description'],
};

const bedrock = new BedrockRuntimeClient({});
const sm = new SecretsManagerClient({});

const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
const PRIMARY_MODEL = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1';
const FALLBACK_MODEL = process.env.BEDROCK_FALLBACK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';

const TZ = 'America/Puerto_Rico';

let dbUrl: string | null = null;

type Action = 'briefing' | 'topic-descriptions' | 'period-insights' | 'metric-insight';

interface InvokeEvent {
  action?: Action;
  agencySlug?: string;
  /** YYYY-MM-DD (inclusive) — para period-insights y metric-insight. */
  periodStart?: string;
  /** YYYY-MM-DD (inclusive) — para period-insights y metric-insight. */
  periodEnd?: string;
  /** Solo para action='metric-insight'. */
  metric?: MetricKey;
  dryRun?: boolean;
}

interface PerAgencyResult {
  agencySlug: string;
  status: 'ok' | 'fallback' | 'error';
  message?: string;
  output?: unknown;
}

interface HandlerResult {
  statusCode: number;
  body: string;
}

export const handler = async (event?: InvokeEvent): Promise<HandlerResult> => {
  const action: Action = event?.action ?? 'briefing';
  const dryRun = !!event?.dryRun;
  console.log(`[ai-tasks] invoked action=${action} agency=${event?.agencySlug ?? 'all'} dryRun=${dryRun}`);

  if (!dbUrl) dbUrl = await getDatabaseUrl();

  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // Self-heal schema for briefings (idempotent CREATE IF NOT EXISTS pattern,
    // mismo enfoque que weekly-report con ensureReportsSchema). Eso permite
    // que el deploy de la Lambda no dependa de correr la migration Lambda.
    await ensureBriefingsSchema(client);

    const agencies = await loadAgencies(client, event?.agencySlug ?? null);
    if (agencies.length === 0) {
      return ok({ action, result: 'no-agencies' });
    }

    const results: PerAgencyResult[] = [];

    if (action === 'briefing') {
      for (const a of agencies) {
        results.push(await generateBriefingFor(client, a, dryRun));
      }
    } else if (action === 'topic-descriptions') {
      for (const a of agencies) {
        results.push(await generateTopicDescriptionsFor(client, a, dryRun));
      }
    } else if (action === 'period-insights') {
      if (!event?.periodStart || !event?.periodEnd) {
        return { statusCode: 400, body: JSON.stringify({ error: 'period-insights requires periodStart + periodEnd (YYYY-MM-DD)' }) };
      }
      await ensureOverviewPeriodInsightsSchema(client);
      for (const a of agencies) {
        results.push(await generatePeriodInsightsFor(client, a, event.periodStart, event.periodEnd, dryRun));
      }
    } else if (action === 'metric-insight') {
      if (!event?.periodStart || !event?.periodEnd || !event?.metric) {
        return { statusCode: 400, body: JSON.stringify({ error: 'metric-insight requires metric + periodStart + periodEnd' }) };
      }
      await ensureMetricInsightsSchema(client);
      for (const a of agencies) {
        results.push(await generateMetricInsightFor(client, a, event.metric, event.periodStart, event.periodEnd, dryRun));
      }
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: `unknown action: ${action}` }) };
    }

    return ok({ action, dryRun, results });
  } finally {
    await client.end();
  }
};

// ============================================================
// Briefing generator
// ============================================================

type BriefingMode = 'signal' | 'emerging' | 'crisis';

async function generateBriefingFor(
  client: any,
  agency: AgencyRow,
  dryRun: boolean,
): Promise<PerAgencyResult> {
  const periodHours = 24;
  const aggregates = await loadBriefingAggregates(client, agency, periodHours);

  // Si la ventana tiene < 10 menciones, no vale la pena invocar al LLM —
  // emitimos un briefing rule-based para cada modo (fallback=true) para que
  // la UI quede poblada sin riesgo de alucinación.
  if (aggregates.totals.total < 10) {
    const ruleBased = buildRuleBasedBriefing(aggregates);
    if (!dryRun) {
      for (const mode of ['signal', 'emerging', 'crisis'] as BriefingMode[]) {
        await persistBriefing(client, agency.id, periodHours, mode, ruleBased, aggregates.totals.total, PRIMARY_MODEL, true);
      }
    }
    return { agencySlug: agency.slug, status: 'fallback', message: 'baja señal (<10 menciones)', output: { signal: ruleBased, emerging: ruleBased, crisis: ruleBased } };
  }

  // Cargar aggregates específicos para "emerging" y "crisis" (queries
  // adicionales sobre la misma ventana). Se hace en paralelo para no
  // duplicar latencia.
  const [emergingAgg, crisisAgg] = await Promise.all([
    loadEmergingAggregates(client, agency, periodHours, aggregates),
    loadCrisisAggregates(client, agency, periodHours, aggregates),
  ]);

  // Tres invocaciones en paralelo, una por modo. Cada una falla
  // independientemente al fallback rule-based.
  const [signalRes, emergingRes, crisisRes] = await Promise.all([
    runBriefingMode('signal', () => buildExecutiveBriefingPrompt(aggregates), EXECUTIVE_BRIEFING_SYSTEM_PROMPT, aggregates),
    runBriefingMode('emerging', () => buildEmergingBriefingPrompt(emergingAgg), EMERGING_BRIEFING_SYSTEM_PROMPT, aggregates),
    runBriefingMode('crisis', () => buildCrisisBriefingPrompt(crisisAgg), CRISIS_BRIEFING_SYSTEM_PROMPT, aggregates),
  ]);

  if (!dryRun) {
    await Promise.all([
      persistBriefing(client, agency.id, periodHours, 'signal', signalRes.output, aggregates.totals.total, PRIMARY_MODEL, signalRes.fallback),
      persistBriefing(client, agency.id, periodHours, 'emerging', emergingRes.output, aggregates.totals.total, PRIMARY_MODEL, emergingRes.fallback),
      persistBriefing(client, agency.id, periodHours, 'crisis', crisisRes.output, aggregates.totals.total, PRIMARY_MODEL, crisisRes.fallback),
    ]);
  }

  const status = signalRes.fallback || emergingRes.fallback || crisisRes.fallback ? 'fallback' : 'ok';
  return {
    agencySlug: agency.slug,
    status,
    output: { signal: signalRes.output, emerging: emergingRes.output, crisis: crisisRes.output },
  };
}

interface BriefingModeResult {
  output: BriefingOutput;
  fallback: boolean;
  errorMessage?: string;
}

async function runBriefingMode(
  mode: BriefingMode,
  buildPrompt: () => string,
  systemPrompt: string,
  fallbackAgg: BriefingAggregates,
): Promise<BriefingModeResult> {
  try {
    // Tool-use con input_schema (vs el invokeClaude + JSON.parse de main) —
    // Bedrock garantiza el shape del input. Sin comillas/saltos rompiendo el
    // parser (feedback_bedrock_tool_use). Mantenemos la abstracción
    // runBriefingMode de main para los 3 modos (signal / emerging / crisis).
    const parsed = await invokeClaudeWithTool<BriefingOutput>({
      client: bedrock,
      systemPrompt,
      userPrompt: buildPrompt(),
      maxTokens: 800,
      primaryModel: PRIMARY_MODEL,
      fallbackModel: FALLBACK_MODEL,
      temperature: 0,
      tool: {
        name: 'emit_briefing',
        description: 'Emit the structured executive briefing.',
        input_schema: BRIEFING_TOOL_SCHEMA,
      },
    });
    return { output: validateBriefingOutput(parsed), fallback: false };
  } catch (err) {
    console.error(`[ai-tasks] briefing mode=${mode} failed:`, (err as Error).message);
    return { output: buildRuleBasedBriefing(fallbackAgg), fallback: true, errorMessage: (err as Error).message };
  }
}

function validateBriefingOutput(raw: BriefingOutput): BriefingOutput {
  const allowedTones = new Set(['pos', 'neg', 'warn', 'neu']);
  const tone = allowedTones.has(raw.action_tone) ? raw.action_tone : 'neu';
  // Sanitize narrative: solo <strong> permitido. Cualquier otra etiqueta se elimina.
  const narrative = sanitizeStrongOnly(String(raw.narrative_html ?? ''));
  return {
    narrative_html: narrative.slice(0, 1200),
    dominant_signal: String(raw.dominant_signal ?? 'Sin señal dominante · Neutral').slice(0, 120),
    action_label: String(raw.action_label ?? 'Explorar tópicos activos →').slice(0, 80),
    action_tone: tone,
    reach_label: String(raw.reach_label ?? '—').slice(0, 60),
  };
}

function sanitizeStrongOnly(html: string): string {
  // Reemplaza cualquier tag que no sea <strong>/</strong> por su contenido.
  // Estrategia conservadora: tira todas las etiquetas excepto strong/closing strong.
  return html.replace(/<(?!\/?strong\b)[^>]*>/gi, '');
}

function buildRuleBasedBriefing(agg: BriefingAggregates): BriefingOutput {
  // Mismo determinismo que el bloque actual de /api/eco-data:670-691, replicado
  // aquí para que la fila tenga el mismo shape que un briefing IA y la UI no
  // diferencie cómo render.
  const totalNeg = agg.totals.negative;
  const totalPos = agg.totals.positive;
  const tone: 'pos' | 'neg' | 'warn' | 'neu' = agg.nss != null && agg.nss > 5
    ? 'pos'
    : agg.nss != null && agg.nss < -5
    ? 'neg'
    : 'warn';
  const verb = tone === 'pos' ? 'mejora' : tone === 'neg' ? 'deteriora' : 'se mantiene estable';
  const dominant = agg.byTopic[0];
  const dominantTone = !dominant
    ? 'Neutral'
    : dominant.positive > dominant.negative + dominant.total * 0.08
    ? 'Positiva'
    : dominant.negative > dominant.positive + dominant.total * 0.08
    ? 'Negativa'
    : 'Mixta';
  const negPct = dominant && dominant.total > 0 ? Math.round((dominant.negative / dominant.total) * 100) : 0;

  const narrative = dominant
    ? `La percepción pública se <strong>${verb}</strong> en torno a <strong>${escapeHtml(dominant.topic)}</strong> (${dominant.total} menciones, ${negPct}% negativo). En las últimas ${agg.periodHours}h se registraron ${agg.totals.total} menciones (${totalNeg} negativas, ${totalPos} positivas).`
    : `En las últimas ${agg.periodHours}h se registraron <strong>${agg.totals.total}</strong> menciones sin un tópico dominante claro (${totalNeg} negativas, ${totalPos} positivas).`;

  return {
    narrative_html: narrative,
    dominant_signal: dominant ? `${dominant.topic} · ${dominantTone}` : 'Sin señal dominante · Neutral',
    action_label: dominant ? `Seguir ${dominant.topic} →` : 'Explorar tópicos activos →',
    action_tone: tone,
    reach_label: formatReach(agg.totalReach),
  };
}

function formatReach(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M impresiones`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K impresiones`;
  return `${n} impresiones`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

async function persistBriefing(
  client: any,
  agencyId: string,
  periodHours: number,
  mode: BriefingMode,
  output: BriefingOutput,
  sourceMentions: number,
  model: string,
  fallback: boolean,
): Promise<void> {
  await client.query(
    `INSERT INTO agency_briefings
       (agency_id, period_hours, mode, narrative_html, dominant_signal,
        action_label, action_tone, reach_label, model_used,
        source_mentions, fallback)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      agencyId,
      periodHours,
      mode,
      output.narrative_html,
      output.dominant_signal,
      output.action_label,
      output.action_tone,
      output.reach_label,
      fallback ? `${model} (fallback rule-based)` : model,
      sourceMentions,
      fallback,
    ],
  );
}

async function loadBriefingAggregates(
  client: any,
  agency: AgencyRow,
  periodHours: number,
): Promise<BriefingAggregates> {
  // Usa COALESCE(nlp_sentiment, bw_sentiment) para que las cifras cuadren con
  // /api/eco-data (paridad bit a bit con el dashboard — patrón documentado en
  // la memoria del proyecto: feedback_data_parity.md).
  const since = new Date(Date.now() - periodHours * 3600 * 1000);
  const prevSince = new Date(Date.now() - 2 * periodHours * 3600 * 1000);

  const totalsCur = await client.query(
    `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE COALESCE(nlp_sentiment, bw_sentiment) IN ('positivo', 'positive'))::int AS pos,
        COUNT(*) FILTER (WHERE COALESCE(nlp_sentiment, bw_sentiment) IN ('negativo', 'negative'))::int AS neg,
        COALESCE(SUM(reach_estimate), 0)::bigint AS reach
       FROM mentions
      WHERE agency_id = $1 AND is_duplicate = false AND published_at >= $2`,
    [agency.id, since.toISOString()],
  );
  const cur = totalsCur.rows[0];
  const totalCur = Number(cur.total);
  const positiveCur = Number(cur.pos);
  const negativeCur = Number(cur.neg);
  const neutralCur = Math.max(0, totalCur - positiveCur - negativeCur);
  const reach = Number(cur.reach);

  const totalsPrev = await client.query(
    `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE COALESCE(nlp_sentiment, bw_sentiment) IN ('positivo', 'positive'))::int AS pos,
        COUNT(*) FILTER (WHERE COALESCE(nlp_sentiment, bw_sentiment) IN ('negativo', 'negative'))::int AS neg
       FROM mentions
      WHERE agency_id = $1 AND is_duplicate = false AND published_at >= $2 AND published_at < $3`,
    [agency.id, prevSince.toISOString(), since.toISOString()],
  );
  const prev = totalsPrev.rows[0];
  const totalPrev = Number(prev.total);
  const positivePrev = Number(prev.pos);
  const negativePrev = Number(prev.neg);

  const nss = totalCur > 0
    ? Math.round(((positiveCur - negativeCur) / totalCur) * 100 * 10) / 10
    : null;
  const nssPrev = totalPrev > 0
    ? ((positivePrev - negativePrev) / totalPrev) * 100
    : null;
  const nssDelta = nss != null && nssPrev != null
    ? Math.round((nss - nssPrev) * 10) / 10
    : null;

  const byTopicRes = await client.query(
    `SELECT t.name AS topic,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('positivo','positive'))::int AS pos,
            COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative'))::int AS neg
       FROM mentions m
       JOIN mention_topics mt ON mt.mention_id = m.id
       JOIN topics t ON t.id = mt.topic_id
      WHERE m.agency_id = $1 AND m.published_at >= $2
      AND m.is_duplicate = false
      GROUP BY t.name
      ORDER BY total DESC
      LIMIT 5`,
    [agency.id, since.toISOString()],
  );
  const byTopic = byTopicRes.rows.map((r: any) => {
    const total = Number(r.total);
    const pos = Number(r.pos);
    const neg = Number(r.neg);
    const neu = Math.max(0, total - pos - neg);
    return { topic: r.topic, total, positive: pos, neutral: neu, negative: neg };
  });

  const byMuniRes = await client.query(
    `SELECT mu.name AS municipality,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative'))::int AS neg
       FROM mentions m
       JOIN mention_municipalities mm ON mm.mention_id = m.id
       JOIN municipalities mu ON mu.id = mm.municipality_id
      WHERE m.agency_id = $1 AND m.published_at >= $2
      AND m.is_duplicate = false
      GROUP BY mu.name
      ORDER BY total DESC
      LIMIT 5`,
    [agency.id, since.toISOString()],
  );
  const byMunicipality = byMuniRes.rows.map((r: any) => ({
    municipality: r.municipality,
    total: Number(r.total),
    negative: Number(r.neg),
  }));

  const topMentionsRes = await client.query(
    `SELECT m.title, m.snippet,
            COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
            COALESCE(m.engagement_score, 0)::int AS engagement,
            (SELECT t.name FROM mention_topics mt JOIN topics t ON t.id=mt.topic_id
              WHERE mt.mention_id = m.id ORDER BY mt.confidence DESC NULLS LAST LIMIT 1) AS topic,
            (SELECT mu.name FROM mention_municipalities mm JOIN municipalities mu ON mu.id=mm.municipality_id
              WHERE mm.mention_id = m.id LIMIT 1) AS municipality,
            m.page_type AS source
       FROM mentions m
      WHERE m.agency_id = $1 AND m.published_at >= $2
      AND m.is_duplicate = false
      ORDER BY engagement DESC
      LIMIT 3`,
    [agency.id, since.toISOString()],
  );
  const topMentions = topMentionsRes.rows.map((r: any) => ({
    text: (r.title || r.snippet || '').trim().slice(0, 280),
    sentiment: normalizeSentiment(r.sentiment),
    topic: r.topic ?? null,
    municipality: r.municipality ?? null,
    source: r.source ?? null,
    engagement: Number(r.engagement),
  })).filter((m: { text: string }) => m.text.length > 0);

  const generatedAtLabel = new Date().toLocaleString('es-PR', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

  // Nivel TÍPICO de la agencia (volumen diario promedio + NSS promedio) para
  // contexto coyuntural: permite que el briefing diga "por encima/por debajo de
  // su nivel habitual de 7 días" sin perder el ancla de base. Se computa desde
  // mentions (misma fuente que los totales) sobre las ventanas de 7 y 30 días
  // CERRADAS previas a la ventana actual, para que "típico" no incluya el pico
  // que estamos describiendo.
  const loadBaseline = async (baselineDays: number): Promise<{ windowDays: number; avgDailyVolume: number | null; avgNss: number | null }> => {
    const baseSince = new Date(Date.now() - (baselineDays * 24 + periodHours) * 3600 * 1000);
    const baseUntil = since; // hasta el arranque de la ventana actual
    const res = await client.query(
      `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE COALESCE(nlp_sentiment, bw_sentiment) IN ('positivo','positive'))::int AS pos,
          COUNT(*) FILTER (WHERE COALESCE(nlp_sentiment, bw_sentiment) IN ('negativo','negative'))::int AS neg
         FROM mentions
        WHERE agency_id = $1 AND is_duplicate = false
          AND published_at >= $2 AND published_at < $3`,
      [agency.id, baseSince.toISOString(), baseUntil.toISOString()],
    );
    const row = res.rows[0] ?? {};
    const total = Number(row.total ?? 0);
    const pos = Number(row.pos ?? 0);
    const neg = Number(row.neg ?? 0);
    const avgDailyVolume = total > 0 ? Math.round((total / baselineDays) * 10) / 10 : null;
    const avgNss = total > 0 ? Math.round(((pos - neg) / total) * 100 * 10) / 10 : null;
    return { windowDays: baselineDays, avgDailyVolume, avgNss };
  };
  const [baseline7d, baseline30d] = await Promise.all([loadBaseline(7), loadBaseline(30)]);

  return {
    agencyName: agency.name,
    agencyShortName: agency.slug.toUpperCase().slice(0, 6),
    periodHours,
    generatedAtLabel,
    baseline7d,
    baseline30d,
    totals: { total: totalCur, positive: positiveCur, neutral: neutralCur, negative: negativeCur },
    prevTotals: { total: totalPrev, positive: positivePrev, neutral: Math.max(0, totalPrev - positivePrev - negativePrev), negative: negativePrev },
    nss,
    nssDelta,
    totalReach: reach,
    byTopic,
    byMunicipality,
    topMentions,
  };
}

function normalizeSentiment(s: string | null): 'positivo' | 'neutral' | 'negativo' {
  if (s === 'positivo' || s === 'positive') return 'positivo';
  if (s === 'negativo' || s === 'negative') return 'negativo';
  return 'neutral';
}

// ============================================================
// Emerging aggregates loader
// ============================================================

async function loadEmergingAggregates(
  client: any,
  agency: AgencyRow,
  periodHours: number,
  base: BriefingAggregates,
): Promise<EmergingBriefingAggregates> {
  // Comparamos las últimas N/2 horas vs. las N/2 horas anteriores del periodo.
  // El delta es ((recent − previous) / previous) × 100, sin tope superior.
  const since = new Date(Date.now() - periodHours * 3600 * 1000);
  const midPoint = new Date(Date.now() - (periodHours / 2) * 3600 * 1000);

  const halvesRes = await client.query(
    `SELECT t.name AS topic,
            COUNT(*) FILTER (WHERE m.published_at >= $3)::int AS recent_total,
            COUNT(*) FILTER (WHERE m.published_at >= $2 AND m.published_at < $3)::int AS previous_total,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('positivo','positive'))::int AS pos,
            COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative'))::int AS neg
       FROM mentions m
       JOIN mention_topics mt ON mt.mention_id = m.id
       JOIN topics t ON t.id = mt.topic_id
      WHERE m.agency_id = $1 AND m.published_at >= $2
      AND m.is_duplicate = false
      GROUP BY t.name
      ORDER BY recent_total DESC`,
    [agency.id, since.toISOString(), midPoint.toISOString()],
  );

  const emerging: EmergingTopic[] = halvesRes.rows.map((r: any) => {
    const recent = Number(r.recent_total);
    const previous = Number(r.previous_total);
    const deltaPct = previous > 0
      ? Math.round(((recent - previous) / previous) * 100)
      : (recent > 0 ? 100 : 0);
    const total = Number(r.total);
    const pos = Number(r.pos);
    const neg = Number(r.neg);
    return {
      topic: r.topic,
      total,
      positive: pos,
      neutral: Math.max(0, total - pos - neg),
      negative: neg,
      deltaPct,
    };
  }).sort((a: EmergingTopic, b: EmergingTopic) => b.deltaPct - a.deltaPct).slice(0, 5);

  return {
    agencyName: agency.name,
    agencyShortName: agency.slug.toUpperCase().slice(0, 6),
    periodHours,
    generatedAtLabel: base.generatedAtLabel,
    emergingTopics: emerging,
    totals: base.totals,
    totalReach: base.totalReach,
    baseline7d: base.baseline7d,
  };
}

// ============================================================
// Crisis aggregates loader
// ============================================================

async function loadCrisisAggregates(
  client: any,
  agency: AgencyRow,
  periodHours: number,
  base: BriefingAggregates,
): Promise<CrisisBriefingAggregates> {
  // Lee el snapshot diario más reciente para crisis_risk_score y subcomponentes
  // (la fórmula se calcula 24/7 por eco-metrics-calculator). Si no hay snapshot,
  // todos los valores quedan en null y el prompt cae en banda NORMAL.
  const snapRes = await client.query(
    `SELECT crisis_risk_score, crisis_severity, crisis_velocity, crisis_relevance,
            volume_anomaly_zscore
       FROM daily_metric_snapshots
      WHERE agency_id = $1
      ORDER BY date DESC
      LIMIT 1`,
    [agency.id],
  );
  const snap = snapRes.rows[0] ?? {};

  const since = new Date(Date.now() - periodHours * 3600 * 1000);
  const negTopicsRes = await client.query(
    `SELECT t.name AS topic,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative'))::int AS neg
       FROM mentions m
       JOIN mention_topics mt ON mt.mention_id = m.id
       JOIN topics t ON t.id = mt.topic_id
      WHERE m.agency_id = $1 AND m.published_at >= $2
      AND m.is_duplicate = false
      GROUP BY t.name
      HAVING COUNT(*) >= 5
      ORDER BY (COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative')))::float / NULLIF(COUNT(*), 0) DESC
      LIMIT 5`,
    [agency.id, since.toISOString()],
  );
  const topNegativeTopics = negTopicsRes.rows.map((r: any) => {
    const total = Number(r.total);
    const negative = Number(r.neg);
    return {
      topic: r.topic,
      total,
      negative,
      negativeShare: total > 0 ? negative / total : 0,
    };
  });

  const negMuniRes = await client.query(
    `SELECT mu.name AS municipality,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative'))::int AS neg
       FROM mentions m
       JOIN mention_municipalities mm ON mm.mention_id = m.id
       JOIN municipalities mu ON mu.id = mm.municipality_id
      WHERE m.agency_id = $1 AND m.published_at >= $2
      AND m.is_duplicate = false
      GROUP BY mu.name
      HAVING COUNT(*) >= 5
      ORDER BY (COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative')))::float / NULLIF(COUNT(*), 0) DESC
      LIMIT 3`,
    [agency.id, since.toISOString()],
  );
  const topNegativeMunicipalities = negMuniRes.rows.map((r: any) => ({
    municipality: r.municipality,
    total: Number(r.total),
    negative: Number(r.neg),
  }));

  const negShare = base.totals.total > 0
    ? base.totals.negative / base.totals.total
    : 0;

  return {
    agencyName: agency.name,
    agencyShortName: agency.slug.toUpperCase().slice(0, 6),
    periodHours,
    generatedAtLabel: base.generatedAtLabel,
    crisisRiskScore: snap.crisis_risk_score != null ? Number(snap.crisis_risk_score) : null,
    crisisSeverity: snap.crisis_severity != null ? Number(snap.crisis_severity) : null,
    crisisVelocity: snap.crisis_velocity != null ? Number(snap.crisis_velocity) : null,
    crisisRelevance: snap.crisis_relevance != null ? Number(snap.crisis_relevance) : null,
    volumeAnomalyZscore: snap.volume_anomaly_zscore != null ? Number(snap.volume_anomaly_zscore) : null,
    totals: base.totals,
    negativeShare: negShare,
    topNegativeTopics,
    topNegativeMunicipalities,
    totalReach: base.totalReach,
  };
}

// ============================================================
// Topic description generator
// ============================================================

async function generateTopicDescriptionsFor(
  client: any,
  agency: AgencyRow,
  dryRun: boolean,
): Promise<PerAgencyResult> {
  const topicsRes = await client.query(
    `SELECT id, slug, name FROM topics WHERE agency_id = $1 AND is_active = true ORDER BY display_order`,
    [agency.id],
  );

  const updates: Array<{ topic: string; description?: string; status: string; message?: string }> = [];
  const periodDays = 30;
  const since = new Date(Date.now() - periodDays * 24 * 3600 * 1000);

  for (const t of topicsRes.rows) {
    try {
      const agg = await loadTopicAggregate(client, agency, t.id, t.name, t.slug, since, periodDays);
      if (agg.totalMentions === 0) {
        updates.push({ topic: t.slug, status: 'skip', message: 'sin menciones en 30d' });
        continue;
      }
      const samples = await loadTopicSamples(client, agency, t.id, since);
      const prompt = buildTopicDescriptionPrompt(agg, samples);
      const parsed = await invokeClaudeWithTool<{ description?: string }>({
        client: bedrock,
        systemPrompt: TOPIC_DESCRIPTION_SYSTEM_PROMPT,
        userPrompt: prompt,
        maxTokens: 400,
        primaryModel: PRIMARY_MODEL,
        fallbackModel: FALLBACK_MODEL,
        temperature: 0,
        tool: {
          name: 'emit_topic_description',
          description: 'Emit the structured topic description.',
          input_schema: TOPIC_DESCRIPTION_TOOL_SCHEMA,
        },
      });
      const description = (parsed.description ?? '').trim().slice(0, 800);
      if (!description) {
        updates.push({ topic: t.slug, status: 'skip', message: 'modelo devolvió vacío' });
        continue;
      }
      if (!dryRun) {
        await client.query(`UPDATE topics SET description = $1 WHERE id = $2`, [description, t.id]);
      }
      updates.push({ topic: t.slug, description, status: 'ok' });
    } catch (err) {
      updates.push({ topic: t.slug, status: 'error', message: (err as Error).message });
    }
  }

  return { agencySlug: agency.slug, status: 'ok', output: updates };
}

// ============================================================
// Period Insights generator (action='period-insights')
// ============================================================
//
// Genera los 3 bloques de insights (negative/neutral/positive) y un párrafo
// daily_summary para un periodo arbitrario (agency, periodStart, periodEnd).
// Persiste en `overview_period_insights` con UPSERT. Sirve a /api/eco-insights.

interface PeriodInsightsOutput {
  negative: string[];
  neutral: string[];
  positive: string[];
}

const PERIOD_INSIGHTS_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    negative: {
      type: 'array',
      maxItems: 3,
      items: { type: 'string', minLength: 20, maxLength: 400 },
      description: 'Hasta 3 insights de tono negativo, una oración cada uno (20–45 palabras).',
    },
    neutral: {
      type: 'array',
      maxItems: 3,
      items: { type: 'string', minLength: 20, maxLength: 400 },
    },
    positive: {
      type: 'array',
      maxItems: 3,
      items: { type: 'string', minLength: 20, maxLength: 400 },
    },
  },
  required: ['negative', 'neutral', 'positive'],
};

const DAILY_SUMMARY_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      minLength: 80, maxLength: 1400,
      description: 'Párrafo de 3–5 oraciones describiendo el PERIODO ENTERO (no solo el último día). Para 1D coincide con un daily summary; para 5D/7D/30D/custom describe la ventana completa.',
    },
  },
  required: ['summary'],
};

async function generatePeriodInsightsFor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  agency: AgencyRow,
  periodStart: string,
  periodEnd: string,
  dryRun: boolean,
): Promise<PerAgencyResult> {
  // Ventana previa de igual duración para deltaVsPrevWeek.
  const fromDate = new Date(`${periodStart}T00:00:00Z`);
  const toDate = new Date(`${periodEnd}T00:00:00Z`);
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
  const prevEnd = new Date(fromDate.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const prevStartYmd = fmt(prevStart);
  const prevEndYmd = fmt(prevEnd);

  let aggregates: WeeklyAggregates;
  try {
    aggregates = await buildPeriodAggregates(client, agency, periodStart, periodEnd, prevStartYmd, prevEndYmd);
  } catch (err) {
    return { agencySlug: agency.slug, status: 'error', message: `aggregates failed: ${(err as Error).message}` };
  }

  if (aggregates.totals.total < 10) {
    // No vale la pena gastar LLM para señal anémica. Persistimos fila vacía
    // para que el endpoint la sirva sin reintentar.
    const empty: PeriodInsightsOutput = { negative: [], neutral: [], positive: [] };
    if (!dryRun) {
      await persistPeriodInsights(client, agency.id, periodStart, periodEnd, empty, null, PRIMARY_MODEL);
    }
    return { agencySlug: agency.slug, status: 'fallback', message: 'baja señal (<10 menciones)', output: { ...empty, daily_summary: null } };
  }

  try {
    const samples = await loadSamples(client, agency.id, periodStart, periodEnd);
    const insightsPrompt = buildSentimentInsightsPrompt(aggregates, samples);
    const insights = await invokeClaudeWithTool<PeriodInsightsOutput>({
      client: bedrock,
      systemPrompt: INSIGHTS_SYSTEM_PROMPT,
      userPrompt: insightsPrompt,
      maxTokens: 1500,
      primaryModel: PRIMARY_MODEL,
      fallbackModel: FALLBACK_MODEL,
      temperature: 0,
      tool: {
        name: 'emit_period_insights',
        description: 'Emit 3 sentiment-bucketed lists of insights.',
        input_schema: PERIOD_INSIGHTS_TOOL_SCHEMA,
      },
    });

    // Period summary: párrafo sobre el RANGO ENTERO (no solo el último día).
    // Para 1D coincide semánticamente con un daily summary; para 5D/7D/30D
    // describe la VENTANA COMPLETA. Petición explícita del usuario:
    // "independiente que yo filtre 1D, 5D, 7D y 30D parece que los insights
    // y resúmenes se siguen haciendo solo con el día anterior y eso está mal".
    //
    // maxTokens 1500 (igual que insights) — antes era 600 y truncaba el tool_use
    // en periodos ≥7D devolviendo input vacío silenciosamente. Si el primer
    // intento devuelve summary corto, reintentamos con 3000 tokens. Si tras eso
    // sigue vacío, log VISIBLE para que se note en CloudWatch.
    const summaryPrompt = buildPeriodSummaryPrompt(aggregates, samples);
    const trySummary = async (maxTokens: number): Promise<string | null> => {
      const sum = await invokeClaudeWithTool<{ summary: string }>({
        client: bedrock,
        systemPrompt: INSIGHTS_SYSTEM_PROMPT,
        userPrompt: summaryPrompt,
        maxTokens,
        primaryModel: PRIMARY_MODEL,
        fallbackModel: FALLBACK_MODEL,
        temperature: 0,
        tool: {
          name: 'emit_period_summary',
          description: 'Emit a single paragraph summarizing the WHOLE period (not just the last day).',
          input_schema: DAILY_SUMMARY_TOOL_SCHEMA,
        },
      });
      const trimmed = (sum.summary ?? '').trim().slice(0, 1400);
      return trimmed.length >= 80 ? trimmed : null;
    };

    let dailySummary: string | null = null;
    try {
      dailySummary = await trySummary(1500);
      if (!dailySummary) {
        console.warn(`[ai-tasks] period_summary returned empty/short for ${agency.slug} ${periodStart}→${periodEnd} at maxTokens=1500; retrying with 3000`);
        dailySummary = await trySummary(3000);
      }
    } catch (err) {
      console.warn(`[ai-tasks] period_summary error for ${agency.slug} ${periodStart}→${periodEnd}: ${(err as Error).message}`);
      try {
        dailySummary = await trySummary(3000);
      } catch (err2) {
        console.warn(`[ai-tasks] period_summary retry also failed: ${(err2 as Error).message}`);
      }
    }
    if (!dailySummary) {
      // El usuario reportó que para 2026-04-12→2026-05-11 no se generó resumen
      // — antes esto era silencioso (null persistido). Ahora ERROR explícito.
      console.error(`[ai-tasks] period_summary FINAL NULL for ${agency.slug} ${periodStart}→${periodEnd}`);
    }

    const validated: PeriodInsightsOutput = {
      negative: Array.isArray(insights.negative) ? insights.negative.slice(0, 3) : [],
      neutral: Array.isArray(insights.neutral) ? insights.neutral.slice(0, 3) : [],
      positive: Array.isArray(insights.positive) ? insights.positive.slice(0, 3) : [],
    };

    if (!dryRun) {
      await persistPeriodInsights(client, agency.id, periodStart, periodEnd, validated, dailySummary, PRIMARY_MODEL);
    }
    return {
      agencySlug: agency.slug,
      status: 'ok',
      output: { ...validated, daily_summary: dailySummary },
    };
  } catch (err) {
    return { agencySlug: agency.slug, status: 'error', message: (err as Error).message };
  }
}

// ============================================================
// Metric Insight generator (action='metric-insight')
// ============================================================

const METRIC_INSIGHT_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    insight: {
      type: 'string',
      minLength: 80, maxLength: 1400,
      description: 'Párrafo de 3-5 oraciones describiendo POR QUÉ el valor de la métrica es lo que es para esta agencia en este periodo. Inline <strong> permitido.',
    },
  },
  required: ['insight'],
};

function subcomponentsFor(metric: MetricKey, snapshot: Record<string, number | null>): Record<string, number | null> {
  // Mapea las columnas crudas de daily_metric_snapshots a labels humanos por
  // métrica. El prompt los usa como contexto SIN explicar la fórmula.
  if (metric === 'crisis') {
    return {
      'severity (share negativo)': snapshot.crisis_severity ?? null,
      'velocity (z-score volumen)': snapshot.crisis_velocity ?? null,
      'relevance (ratio pertinencia)': snapshot.crisis_relevance ?? null,
      'confidence (log10 menciones)': snapshot.crisis_confidence ?? null,
    };
  }
  if (metric === 'bhi') {
    return {
      'nss normalizado (0-1)': snapshot.nss != null ? (Number(snapshot.nss) + 100) / 200 : null,
      'engagement rate': snapshot.engagement_rate ?? null,
      'amplification rate': snapshot.amplification_rate ?? null,
      'volume (menciones del día)': snapshot.total_mentions ?? null,
    };
  }
  if (metric === 'nss') {
    return {
      'positivas (día)': snapshot.positive_count ?? null,
      'neutras (día)': snapshot.neutral_count ?? null,
      'negativas (día)': snapshot.negative_count ?? null,
      'nss rolling 7d': snapshot.nss_7d ?? null,
      'nss rolling 30d': snapshot.nss_30d ?? null,
    };
  }
  if (metric === 'polarization') {
    return {
      'polarization index': snapshot.polarization_index ?? null,
      'positivas (día)': snapshot.positive_count ?? null,
      'negativas (día)': snapshot.negative_count ?? null,
      'neutras (día)': snapshot.neutral_count ?? null,
    };
  }
  if (metric === 'volume') {
    return {
      'total menciones del periodo': null, // se inyecta vía totalMentions
      'volume anomaly z-score': snapshot.volume_anomaly_zscore ?? null,
      'reputation momentum': snapshot.reputation_momentum ?? null,
    };
  }
  return {};
}

function snapshotValueFor(metric: MetricKey, snapshot: Record<string, number | null>, totalMentions: number): number | null {
  if (metric === 'crisis') return snapshot.crisis_risk_score ?? null;
  if (metric === 'bhi') return snapshot.brand_health_index ?? null;
  if (metric === 'nss') return snapshot.nss ?? null;
  if (metric === 'polarization') return snapshot.polarization_index ?? null;
  if (metric === 'volume') return totalMentions;
  return null;
}

async function generateMetricInsightFor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  agency: AgencyRow,
  metric: MetricKey,
  periodStart: string,
  periodEnd: string,
  dryRun: boolean,
): Promise<PerAgencyResult> {
  try {
    const ctx = await loadMetricInsightContext(client, agency, periodStart, periodEnd);
    const value = snapshotValueFor(metric, ctx.snapshot, ctx.totalMentions);
    const promptInput: CachedMetricInsightInput = {
      metric,
      agencyName: agency.name,
      agencyShortName: agencyShortName(agency.slug),
      periodStart,
      periodEnd,
      value,
      subcomponents: subcomponentsFor(metric, ctx.snapshot),
      topTopics: ctx.topTopics,
      topAuthors: ctx.topAuthors,
      topMunicipalities: ctx.topMunicipalities,
      totalMentions: ctx.totalMentions,
      totalMentionsDelta: ctx.totalMentionsDelta,
    };
    if (ctx.totalMentions < 5) {
      const fallback = `No hay señal suficiente (<strong>${ctx.totalMentions}</strong> menciones) en el periodo seleccionado para describir el valor de la métrica.`;
      if (!dryRun) {
        await persistMetricInsight(client, agency.id, metric, periodStart, periodEnd, fallback, PRIMARY_MODEL);
      }
      return { agencySlug: agency.slug, status: 'fallback', message: 'baja señal', output: { metric, insight: fallback } };
    }
    const prompt = buildCachedMetricInsightPrompt(promptInput);
    const parsed = await invokeClaudeWithTool<{ insight: string }>({
      client: bedrock,
      systemPrompt: CACHED_METRIC_INSIGHT_SYSTEM_PROMPT,
      userPrompt: prompt,
      maxTokens: 800,
      primaryModel: PRIMARY_MODEL,
      fallbackModel: FALLBACK_MODEL,
      temperature: 0,
      tool: {
        name: 'emit_metric_insight',
        description: 'Emit the structured one-paragraph metric insight.',
        input_schema: METRIC_INSIGHT_TOOL_SCHEMA,
      },
    });
    const insight = sanitizeStrongOnly(String(parsed.insight ?? '').trim()).slice(0, 1400);
    if (!insight) {
      return { agencySlug: agency.slug, status: 'error', message: 'modelo devolvió vacío' };
    }
    if (!dryRun) {
      await persistMetricInsight(client, agency.id, metric, periodStart, periodEnd, insight, PRIMARY_MODEL);
    }
    return { agencySlug: agency.slug, status: 'ok', output: { metric, insight } };
  } catch (err) {
    return { agencySlug: agency.slug, status: 'error', message: (err as Error).message };
  }
}

async function persistMetricInsight(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  agencyId: string,
  metric: MetricKey,
  periodStart: string,
  periodEnd: string,
  insight: string,
  modelUsed: string,
): Promise<void> {
  await client.query(
    `INSERT INTO metric_insights_cache
       (agency_id, metric, period_start_date, period_end_date,
        insight_text, model_used, generated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT ON CONSTRAINT uq_metric_insights_agency_metric_range
     DO UPDATE SET
       insight_text = EXCLUDED.insight_text,
       model_used   = EXCLUDED.model_used,
       generated_at = NOW()`,
    [agencyId, metric, periodStart, periodEnd, insight, modelUsed],
  );
}

async function persistPeriodInsights(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  agencyId: string,
  periodStart: string,
  periodEnd: string,
  insights: PeriodInsightsOutput,
  dailySummary: string | null,
  modelUsed: string,
): Promise<void> {
  await client.query(
    `INSERT INTO overview_period_insights
       (agency_id, period_start_date, period_end_date,
        negative_insights, neutral_insights, positive_insights,
        daily_summary, model_used, generated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, NOW())
     ON CONFLICT ON CONSTRAINT uq_overview_period_insights_agency_range
     DO UPDATE SET
       negative_insights = EXCLUDED.negative_insights,
       neutral_insights  = EXCLUDED.neutral_insights,
       positive_insights = EXCLUDED.positive_insights,
       daily_summary     = EXCLUDED.daily_summary,
       model_used        = EXCLUDED.model_used,
       generated_at      = NOW()`,
    [
      agencyId, periodStart, periodEnd,
      JSON.stringify(insights.negative),
      JSON.stringify(insights.neutral),
      JSON.stringify(insights.positive),
      dailySummary, modelUsed,
    ],
  );
}

async function loadTopicAggregate(
  client: any,
  agency: AgencyRow,
  topicId: number,
  topicName: string,
  topicSlug: string,
  since: Date,
  periodDays: number,
): Promise<TopicAggregateForDescription> {
  const totalsRes = await client.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('positivo','positive'))::int AS pos,
            COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative'))::int AS neg
       FROM mention_topics mt
       JOIN mentions m ON m.id = mt.mention_id
      WHERE m.agency_id = $1 AND m.is_duplicate = false AND mt.topic_id = $2 AND m.published_at >= $3`,
    [agency.id, topicId, since.toISOString()],
  );
  const total = Number(totalsRes.rows[0]?.total ?? 0);
  const positive = Number(totalsRes.rows[0]?.pos ?? 0);
  const negative = Number(totalsRes.rows[0]?.neg ?? 0);

  const subRes = await client.query(
    `SELECT s.name AS name, COUNT(*)::int AS count
       FROM mention_topics mt
       JOIN mentions m ON m.id = mt.mention_id
       JOIN subtopics s ON s.id = mt.subtopic_id
      WHERE m.agency_id = $1 AND mt.topic_id = $2 AND m.published_at >= $3
      AND m.is_duplicate = false
      GROUP BY s.name
      ORDER BY count DESC
      LIMIT 10`,
    [agency.id, topicId, since.toISOString()],
  );

  const muniRes = await client.query(
    `SELECT mu.name AS name, COUNT(*)::int AS count
       FROM mention_topics mt
       JOIN mentions m ON m.id = mt.mention_id
       JOIN mention_municipalities mm ON mm.mention_id = m.id
       JOIN municipalities mu ON mu.id = mm.municipality_id
      WHERE m.agency_id = $1 AND mt.topic_id = $2 AND m.published_at >= $3
      AND m.is_duplicate = false
      GROUP BY mu.name
      ORDER BY count DESC
      LIMIT 5`,
    [agency.id, topicId, since.toISOString()],
  );

  return {
    agencyName: agency.name,
    topicName,
    topicSlug,
    periodDays,
    totalMentions: total,
    positive,
    neutral: Math.max(0, total - positive - negative),
    negative,
    topSubtopics: subRes.rows.map((r: any) => ({ name: r.name, count: Number(r.count) })),
    topMunicipalities: muniRes.rows.map((r: any) => ({ name: r.name, count: Number(r.count) })),
  };
}

async function loadTopicSamples(
  client: any,
  agency: AgencyRow,
  topicId: number,
  since: Date,
): Promise<TopicMentionSample[]> {
  // 2 muestras por sentimiento priorizando engagement alto + pertinencia alta.
  const out: TopicMentionSample[] = [];
  for (const s of ['negativo', 'neutral', 'positivo'] as const) {
    const res = await client.query(
      `SELECT m.title, m.snippet,
              COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
              (SELECT sub.name FROM mention_topics mt2 JOIN subtopics sub ON sub.id = mt2.subtopic_id
                WHERE mt2.mention_id = m.id AND mt2.topic_id = $2 LIMIT 1) AS subtopic,
              m.page_type AS source
         FROM mention_topics mt
         JOIN mentions m ON m.id = mt.mention_id
        WHERE m.agency_id = $1 AND mt.topic_id = $2
          AND m.is_duplicate = false
          AND m.published_at >= $3
          AND COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ($4, $5)
        ORDER BY COALESCE(m.engagement_score, 0) DESC
        LIMIT 2`,
      [agency.id, topicId, since.toISOString(), s, s === 'negativo' ? 'negative' : s === 'positivo' ? 'positive' : 'neutral'],
    );
    for (const r of res.rows) {
      const text = (r.title || r.snippet || '').toString().trim();
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

// ============================================================
// Schema + agencies helpers
// ============================================================

interface AgencyRow {
  id: string;
  slug: string;
  name: string;
}

async function loadAgencies(client: any, slugFilter: string | null): Promise<AgencyRow[]> {
  if (slugFilter) {
    const res = await client.query(
      `SELECT id, slug, name FROM agencies WHERE is_active = true AND slug = $1`,
      [slugFilter],
    );
    return res.rows;
  }
  const res = await client.query(
    `SELECT id, slug, name FROM agencies WHERE is_active = true ORDER BY slug`,
  );
  return res.rows;
}

async function ensureMetricInsightsSchema(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "metric_insights_cache" (
      "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "agency_id"           UUID NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
      "metric"              VARCHAR(24) NOT NULL,
      "period_start_date"   DATE NOT NULL,
      "period_end_date"     DATE NOT NULL,
      "insight_text"        TEXT NOT NULL,
      "model_used"          TEXT NOT NULL,
      "generated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "uq_metric_insights_agency_metric_range"
        UNIQUE ("agency_id", "metric", "period_start_date", "period_end_date")
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS "idx_metric_insights_recent"
      ON "metric_insights_cache"("agency_id", "metric", "period_end_date" DESC)
  `);
}

async function ensureOverviewPeriodInsightsSchema(client: any): Promise<void> {
  // Self-heal idempotente — espejo de la migración 0003. Permite que el lambda
  // funcione aunque el endpoint o el infra-team aún no haya corrido la
  // migración formal.
  await client.query(`
    CREATE TABLE IF NOT EXISTS "overview_period_insights" (
      "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "agency_id"           UUID NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
      "period_start_date"   DATE NOT NULL,
      "period_end_date"     DATE NOT NULL,
      "negative_insights"   JSONB NOT NULL DEFAULT '[]'::jsonb,
      "neutral_insights"    JSONB NOT NULL DEFAULT '[]'::jsonb,
      "positive_insights"   JSONB NOT NULL DEFAULT '[]'::jsonb,
      "daily_summary"       TEXT,
      "model_used"          TEXT NOT NULL,
      "generated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "uq_overview_period_insights_agency_range"
        UNIQUE ("agency_id", "period_start_date", "period_end_date")
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS "idx_overview_period_insights_recent"
      ON "overview_period_insights"("agency_id", "period_end_date" DESC)
  `);
}

async function ensureBriefingsSchema(client: any): Promise<void> {
  // Idempotente — sin efecto si las migraciones 0002/0003 ya corrieron.
  await client.query(`
    CREATE TABLE IF NOT EXISTS "agency_briefings" (
      "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "agency_id"       UUID NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
      "generated_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "period_hours"    INTEGER NOT NULL DEFAULT 24,
      "narrative_html"  TEXT NOT NULL,
      "dominant_signal" TEXT NOT NULL,
      "action_label"    TEXT NOT NULL,
      "action_tone"     VARCHAR(10) NOT NULL,
      "reach_label"     TEXT,
      "model_used"      TEXT NOT NULL,
      "source_mentions" INTEGER NOT NULL,
      "fallback"        BOOLEAN NOT NULL DEFAULT false
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS "idx_agency_briefings_recent"
      ON "agency_briefings"("agency_id", "generated_at" DESC)
  `);
  // Self-heal de la migración 0003 (briefing modes) — la corrida del lambda
  // no depende de invocar manualmente eco-migration.
  await client.query(`
    ALTER TABLE "agency_briefings"
      ADD COLUMN IF NOT EXISTS "mode" VARCHAR(10) NOT NULL DEFAULT 'signal'
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS "idx_agency_briefings_mode"
      ON "agency_briefings"("agency_id", "mode", "generated_at" DESC)
  `);
}

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }));
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}

function ok(payload: unknown): HandlerResult {
  return { statusCode: 200, body: JSON.stringify(payload) };
}
