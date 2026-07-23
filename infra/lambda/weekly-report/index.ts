/**
 * eco-weekly-report Lambda — envía los REPORTES por correo (diario y semanal).
 *
 * (El nombre del lambda es histórico; desde jul 2026 maneja DOS tipos de
 * correo. No se renombra el recurso para no recrear la función en CDK.)
 *
 * Tipos de correo:
 *  - DIARIO ("[Diario] …"): todos los días a la hora local configurada
 *    (report_configs.send_hour_local, default 6 AM). Ventana rolante de 7
 *    días cerrados terminando ayer.
 *  - SEMANAL ("[Semanal] …"): solo el día configurado
 *    (report_configs.weekly_send_dow, default 5 = viernes) a SU propia hora
 *    (weekly_send_hour_local, default 15 = 3:00 PM). Compara la semana
 *    cerrada (7 días terminando ayer) contra la anterior.
 *
 * Disparador 1 — EventBridge (cada hora, minuto 0): itera report_configs
 * activos, calcula la hora local de cada agencia según su timezone, y envía
 * si la hora coincide con send_hour_local (+ gate de día para el semanal).
 *
 * Disparador 2 — invocación manual/API (payload con agencySlug): envía
 * inmediatamente para esa agencia, ignorando hora y día. `reportType`
 * ('daily' | 'weekly', default 'daily') elige el correo. Se usa para
 * "Enviar prueba" desde el dashboard admin y para dryRun.
 *
 * Cada envío (o skip/fail) se registra en report_send_log; el semanal se
 * distingue por template_key = 'weekly-comparison-v1'.
 */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  INSIGHTS_SYSTEM_PROMPT,
  buildSentimentInsightsPrompt,
  buildDailySummaryPrompt,
  buildWeeklySummaryPrompt,
  renderDailyReportHtml,
  renderWeeklySummaryHtml,
  buildSentimentReport,
  buildSubject,
  closedWindowYmdInTZ,
  ymdInTimeZone,
  hourInTimeZone,
  dowInTimeZone,
  addDaysYmd,
  formatPeriodLabel,
  formatShortDay,
  formatDayLabel,
  formatUpdatedAtLabel,
  loadMetricsForWindow,
  formatMetric,
  formatDelta,
  formatVelocity,
  type EmailMetric,
  type MentionSample,
  type WeeklyAggregates,
  type DailyReportRenderData,
  type WeeklySummaryRenderData,
  type PgClientLike,
  type SentimentReport,
  type WindowMetrics,
} from '@eco/shared';

const bedrock = new BedrockRuntimeClient({});
const sm = new SecretsManagerClient({});
const ses = new SESClient({});

const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1';
const BEDROCK_FALLBACK_MODEL_ID = process.env.BEDROCK_FALLBACK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';
const DASHBOARD_BASE_URL = process.env.DASHBOARD_BASE_URL ?? 'http://eco-alb-1881782703.us-east-1.elb.amazonaws.com';

/** template_key con el que el SEMANAL se registra en report_send_log. El
 *  diario usa el template_key de la config ('daily-sentiment-summary'). */
const WEEKLY_TEMPLATE_KEY = 'weekly-comparison-v1';

/**
 * TZ para todo cálculo de "día calendario" del reporte. Puerto Rico es AST
 * (UTC-4) sin DST. La config por agencia (report_configs.timezone) sigue
 * siendo configurable; esta constante es solo el default usado cuando un
 * cálculo necesita "el día PR" sin pasar por la fila de config.
 */
const REPORT_TIMEZONE = 'America/Puerto_Rico';

let dbUrl: string | null = null;
let schemaEnsured = false;

type ReportType = 'daily' | 'weekly';

interface InvokePayload {
  /** Si se especifica, ejecuta solo para esa agencia e ignora hora/día (tests manuales). */
  agencySlug?: string;
  /** Tipo de correo a generar en invocación dirigida. Default: 'daily'. */
  reportType?: ReportType;
  /** Override de destinatarios (solo si viene agencySlug). Si no, usa los de report_configs. */
  recipients?: string[];
  /** True = renderiza y devuelve HTML sin enviar y sin logear. */
  dryRun?: boolean;
  /** "scheduled" (default), "manual", "test" — se guarda en report_send_log.trigger. */
  trigger?: 'scheduled' | 'manual' | 'test';
  /** uuid del usuario que disparó (solo manual/test). */
  triggeredBy?: string;
}

interface RunResult {
  ok: boolean;
  agency?: string;
  reportType?: ReportType;
  status?: 'sent' | 'skipped' | 'failed' | 'no_recipients' | 'no_data';
  sent?: number;
  messageId?: string;
  html?: string;
  subject?: string;
  error?: string;
}

export const handler = async (event: InvokePayload = {}): Promise<{ ok: boolean; runs?: RunResult[]; results?: RunResult[] } | RunResult> => {
  if (!dbUrl) dbUrl = await getDatabaseUrl();

  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    if (!schemaEnsured) {
      await ensureReportsSchema(client);
      schemaEnsured = true;
    }

    // Modo: invocación dirigida (manual/send-test desde UI)
    if (event.agencySlug) {
      console.log(`[weekly-report] targeted run · agency=${event.agencySlug} · type=${event.reportType ?? 'daily'} · dryRun=${event.dryRun === true}`);
      const result = await runForAgencyBySlug(client, event);
      return result;
    }

    // Modo: scheduled (EventBridge cada hora). Itera configs activas y
    // decide cuáles corresponden a esta hora local (y, para el semanal,
    // a este día local).
    const nowUtc = new Date();
    console.log(`[weekly-report] scheduled sweep · now=${nowUtc.toISOString()}`);

    const configs = await client.query(
      `SELECT rc.agency_id, rc.send_hour_local, rc.timezone, rc.template_key,
              rc.recipients, rc.from_email, rc.from_name,
              rc.weekly_enabled, rc.weekly_send_dow, rc.weekly_send_hour_local,
              a.slug, a.name
         FROM report_configs rc
         JOIN agencies a ON a.id = rc.agency_id
        WHERE rc.is_active = true
          AND a.is_active = true`,
    );
    console.log(`[weekly-report] ${configs.rows.length} active configs`);

    const runs: RunResult[] = [];
    for (const cfg of configs.rows) {
      const localHour = hourInTimeZone(nowUtc, cfg.timezone);
      const localDow = dowInTimeZone(nowUtc, cfg.timezone);

      // Diario: todos los días a send_hour_local. Semanal: SOLO el día
      // configurado (default viernes) a SU propia hora (default 15 = 3 PM),
      // independiente de la hora del diario.
      const dailyDue = localHour === cfg.send_hour_local;
      const weeklyDue = cfg.weekly_enabled === true
        && localDow === (cfg.weekly_send_dow ?? 5)
        && localHour === (cfg.weekly_send_hour_local ?? 15);

      if (!dailyDue && !weeklyDue) {
        console.log(`[weekly-report] skip ${cfg.slug} · localHour=${localHour}/dow=${localDow} vs daily=${cfg.send_hour_local} weekly=${cfg.weekly_send_hour_local ?? 15}@dow${cfg.weekly_send_dow ?? 5} (${cfg.timezone})`);
        continue;
      }
      if (!Array.isArray(cfg.recipients) || cfg.recipients.length === 0) {
        console.warn(`[weekly-report] ${cfg.slug} — no recipients configured`);
        await logSend(client, cfg.agency_id, {
          recipients: [], fromEmail: cfg.from_email, templateKey: cfg.template_key,
          trigger: 'scheduled', status: 'no_recipients',
        });
        runs.push({ ok: false, agency: cfg.slug, status: 'no_recipients' });
        continue;
      }
      const inputs: AgencyRunInputs = {
        agencyId: cfg.agency_id,
        agencySlug: cfg.slug,
        agencyName: cfg.name,
        recipients: cfg.recipients as string[],
        fromEmail: cfg.from_email,
        fromName: cfg.from_name,
        templateKey: cfg.template_key,
        trigger: 'scheduled',
        triggeredBy: null,
      };

      if (dailyDue) runs.push(await runForAgency(client, inputs, 'daily'));
      if (weeklyDue) runs.push(await runForAgency(client, inputs, 'weekly'));
    }
    return { ok: true, runs };
  } finally {
    await client.end();
  }
};

// ============================================================
// Targeted run (manual from UI)
// ============================================================

async function runForAgencyBySlug(client: any, event: InvokePayload): Promise<RunResult> {
  const agencyRow = await client.query(
    `SELECT a.id, a.slug, a.name,
            rc.recipients, rc.from_email, rc.from_name, rc.template_key
       FROM agencies a
       LEFT JOIN report_configs rc ON rc.agency_id = a.id
      WHERE a.slug = $1 AND a.is_active = true
      LIMIT 1`,
    [event.agencySlug],
  );
  if (!agencyRow.rows.length) {
    return { ok: false, error: `agency '${event.agencySlug}' not found` };
  }
  const a = agencyRow.rows[0];
  const reportType: ReportType = event.reportType === 'weekly' ? 'weekly' : 'daily';
  const recipients = event.recipients ?? (a.recipients as string[] | null) ?? [];
  const fromEmail = a.from_email ?? 'agutierrez@populicom.com';
  const fromName = a.from_name ?? 'ECO Radar';
  const templateKey = a.template_key ?? 'daily-sentiment-summary';
  const trigger = event.trigger ?? 'manual';

  if (event.dryRun === true) {
    const built = await buildEmail(client, { id: a.id, slug: a.slug, name: a.name }, reportType);
    return { ok: true, agency: a.slug, reportType, html: built.html, subject: built.subject, status: 'sent' };
  }

  if (recipients.length === 0) {
    await logSend(client, a.id, {
      recipients: [], fromEmail, templateKey, trigger, status: 'no_recipients',
      triggeredBy: event.triggeredBy,
    });
    return { ok: false, agency: a.slug, reportType, status: 'no_recipients', error: 'no recipients configured' };
  }

  return runForAgency(client, {
    agencyId: a.id,
    agencySlug: a.slug,
    agencyName: a.name,
    recipients,
    fromEmail,
    fromName,
    templateKey,
    trigger,
    triggeredBy: event.triggeredBy ?? null,
  }, reportType);
}

// ============================================================
// Full per-agency run (DB → Bedrock → render → SES → log)
// ============================================================

interface AgencyRunInputs {
  agencyId: string;
  agencySlug: string;
  agencyName: string;
  recipients: string[];
  fromEmail: string;
  fromName: string;
  templateKey: string;
  trigger: 'scheduled' | 'manual' | 'test';
  triggeredBy: string | null;
}

async function runForAgency(client: any, i: AgencyRunInputs, reportType: ReportType): Promise<RunResult> {
  const logTemplateKey = reportType === 'weekly' ? WEEKLY_TEMPLATE_KEY : i.templateKey;
  try {
    const built = await buildEmail(client, {
      id: i.agencyId, slug: i.agencySlug, name: i.agencyName,
    }, reportType);

    if (!built.hasData) {
      console.warn(`[weekly-report] ${i.agencySlug} (${reportType}) — no mentions in period, skipping send`);
      await logSend(client, i.agencyId, {
        recipients: i.recipients, fromEmail: i.fromEmail, templateKey: logTemplateKey,
        trigger: i.trigger, status: 'no_data', stats: built.stats, triggeredBy: i.triggeredBy ?? undefined,
      });
      return { ok: false, agency: i.agencySlug, reportType, status: 'no_data' };
    }

    // Enviar por destinatario individual: en SES sandbox, una dirección no
    // verificada tumba el mensaje entero si va en TO compartido. Individual
    // permite que los verificados reciban aunque otros fallen.
    const sent: string[] = [];
    const failed: { email: string; error: string }[] = [];
    let firstMessageId: string | undefined;
    for (const recipient of i.recipients) {
      try {
        const result = await ses.send(new SendEmailCommand({
          Source: `${i.fromName} <${i.fromEmail}>`,
          Destination: { ToAddresses: [recipient] },
          Message: {
            Subject: { Data: built.subject, Charset: 'UTF-8' },
            Body: { Html: { Data: built.html, Charset: 'UTF-8' } },
          },
        }));
        sent.push(recipient);
        if (!firstMessageId) firstMessageId = result.MessageId;
        console.log(`[weekly-report] ${i.agencySlug} (${reportType}) sent to=${recipient} messageId=${result.MessageId}`);
      } catch (err: any) {
        failed.push({ email: recipient, error: String(err?.message ?? err) });
        console.warn(`[weekly-report] ${i.agencySlug} (${reportType}) SKIPPED ${recipient}: ${err?.message ?? err}`);
      }
    }

    const status = sent.length > 0 ? 'sent' : 'failed';
    await logSend(client, i.agencyId, {
      recipients: sent, fromEmail: i.fromEmail, templateKey: logTemplateKey,
      trigger: i.trigger, status, messageId: firstMessageId,
      error: failed.length > 0 ? `partial: ${failed.map((f) => f.email).join(',')}` : undefined,
      stats: built.stats, triggeredBy: i.triggeredBy ?? undefined,
    });
    return {
      ok: sent.length > 0,
      agency: i.agencySlug,
      reportType,
      status,
      sent: sent.length,
      messageId: firstMessageId,
      ...(failed.length > 0 && { error: `${failed.length} recipient(s) failed: ${failed.map((f) => f.email).join(', ')}` }),
    };
  } catch (err: any) {
    console.error(`[weekly-report] ${i.agencySlug} (${reportType}) FAILED:`, err);
    await logSend(client, i.agencyId, {
      recipients: i.recipients, fromEmail: i.fromEmail, templateKey: logTemplateKey,
      trigger: i.trigger, status: 'failed', error: String(err?.message ?? err),
      triggeredBy: i.triggeredBy ?? undefined,
    });
    return { ok: false, agency: i.agencySlug, reportType, status: 'failed', error: String(err?.message ?? err) };
  }
}

// ============================================================
// Build email (dispatch por tipo)
// ============================================================

interface BuiltEmail {
  html: string;
  subject: string;
  stats: { negative: number; neutral: number; positive: number; total: number };
  /** false → no se envía (status no_data). */
  hasData: boolean;
}

async function buildEmail(
  client: any,
  agency: { id: string; slug: string; name: string },
  reportType: ReportType,
): Promise<BuiltEmail> {
  return reportType === 'weekly'
    ? buildWeeklySummaryEmail(client, agency)
    : buildDailyReportEmail(client, agency);
}

/** "lun 7 jul" — día de envío para el asunto del diario. */
function fullDayEs(ymd: string): string {
  const monthPart = formatShortDay(ymd).split(' ')[1] ?? '';
  return `${formatDayLabel(ymd)} ${monthPart}`.trim();
}

function fmtIntEs(n: number): string {
  return n.toLocaleString('es-PR');
}

// ============================================================
// REPORTE DIARIO — ventana rolante de 7 días cerrados
// ============================================================

async function buildDailyReportEmail(
  client: any,
  agency: { id: string; slug: string; name: string },
): Promise<BuiltEmail> {
  // Periodo: últimos 7 días CERRADOS (terminando AYER) en America/Puerto_Rico.
  // El correo se envía 6 AM PR; ayer ya es un día completo. No incluimos hoy
  // parcial — eso sesgaría el termómetro y el delta vs. los 7 días previos.
  const nowUtc = new Date();
  const window = closedWindowYmdInTZ(7, nowUtc, REPORT_TIMEZONE);
  const { startYmd: startDate, endYmd: endDate, prevStartYmd: prevStartDate, prevEndYmd: prevEndDate } = window;

  // 1) Agregados base (totales, daily series, tabla de tópicos) — fuente de
  //    verdad compartida con /api/overview a través de @eco/shared.
  const sentimentReport = await buildSentimentReport(
    client as PgClientLike, agency.id, startDate, endDate, prevStartDate, prevEndDate,
  );

  // 1b) Métricas compuestas recalculadas sobre la ventana actual y la previa.
  //     Misma fuente y mismos formatos de delta que /api/eco-data (el dash).
  const [winCur, winPrev] = await Promise.all([
    loadMetricsForWindow(client as PgClientLike, agency.id, startDate, endDate),
    loadMetricsForWindow(client as PgClientLike, agency.id, prevStartDate, prevEndDate),
  ]);

  // 2) Contexto extra para el LLM (top tópicos, municipios, autores, fuentes,
  //    emociones). Estas queries son específicas del prompt — no las usa el
  //    dashboard.
  const aggregates = await buildAggregates(client, agency, startDate, endDate, sentimentReport);
  const samples = await loadSamples(client, agency.id, startDate, endDate);
  const todaySamples = await loadTodaySamples(client, agency.id, endDate);

  const insights = await generateInsights(aggregates, samples);
  const dailySummary = await generateDailySummary(aggregates, todaySamples, endDate);

  const renderData: DailyReportRenderData = {
    agencyName: agency.name,
    agencyShortName: agencyShortName(agency.slug),
    agencyKicker: `${agencyShortName(agency.slug)} · ${agency.name}`,
    periodLabel: formatPeriodLabel(startDate, endDate),
    updatedAtLabel: formatUpdatedAtLabel(nowUtc, REPORT_TIMEZONE),
    totals: sentimentReport.totals,
    deltaVsPrev: sentimentReport.deltaVsPrev,
    // Deltas de sentimiento formateados con formatDelta (% vs período previo)
    // — el KPI del termómetro los consume para hablar el mismo vocabulario
    // que el dashboard (sube/baja/estable + magnitud con signo tipográfico).
    deltaDisplay: {
      negative: formatDelta(winCur.totals.negative, winPrev.totals.negative, { kind: 'percent', decimals: 0 }),
      neutral: formatDelta(winCur.totals.neutral, winPrev.totals.neutral, { kind: 'percent', decimals: 0 }),
      positive: formatDelta(winCur.totals.positive, winPrev.totals.positive, { kind: 'percent', decimals: 0 }),
    },
    chartImageUrl: buildChartImageUrl(sentimentReport.dailySeries),
    dailySeries: sentimentReport.dailySeries,
    topicsTable: sentimentReport.topicsTable,
    insights,
    dailySummary: {
      label: `Resumen del día · ${formatShortDay(endDate)}`,
      paragraph: dailySummary,
    },
    // Indicadores compuestos NUMÉRICOS — mismos valores y mismos deltas que
    // el dashboard (paridad con /api/eco-data deltaDisplay).
    metrics: buildEmailMetrics(winCur, winPrev),
    // CTA del Bloque 2: enlaza a la landing de Overview del dashboard.
    overviewUrl: `${DASHBOARD_BASE_URL}/overview?agency=${agency.slug}`,
  };

  const todayYmd = ymdInTimeZone(nowUtc, REPORT_TIMEZONE);
  const subject = buildSubject(
    'Diario',
    agencyShortName(agency.slug),
    `${fullDayEs(todayYmd)} · ${fmtIntEs(sentimentReport.totals.total)} menciones`,
  );

  return {
    html: renderDailyReportHtml(renderData),
    subject,
    stats: sentimentReport.totals,
    hasData: sentimentReport.totals.total > 0,
  };
}

/**
 * Indicadores compuestos como EmailMetric (display numérico + delta), con
 * EXACTAMENTE la misma semántica de escala/suffix/invert que el deltaDisplay
 * de /api/eco-data — la fuente del dashboard.
 */
function buildEmailMetrics(cur: WindowMetrics, prev: WindowMetrics): NonNullable<DailyReportRenderData['metrics']> {
  return {
    crisis: {
      display: formatMetric('crisis', cur.crisisRiskScore),
      delta: formatDelta(
        cur.crisisRiskScore != null ? cur.crisisRiskScore * 100 : null,
        prev.crisisRiskScore != null ? prev.crisisRiskScore * 100 : null,
        { kind: 'absolute', decimals: 0, suffix: ' pts', invert: true },
      ),
    },
    bhi: {
      display: formatMetric('bhi', cur.brandHealthIndex),
      delta: formatDelta(
        cur.brandHealthIndex != null ? 1 + cur.brandHealthIndex * 9 : null,
        prev.brandHealthIndex != null ? 1 + prev.brandHealthIndex * 9 : null,
        { kind: 'absolute', decimals: 1, suffix: '' },
      ),
    },
    nss: {
      display: formatMetric('nss', cur.nss),
      delta: formatDelta(cur.nss, prev.nss, { kind: 'absolute', decimals: 1 }),
    },
    polarization: {
      display: formatMetric('polarization', cur.polarizationIndex),
      delta: formatDelta(cur.polarizationIndex, prev.polarizationIndex, { kind: 'absolute', decimals: 0, suffix: ' pts' }),
    },
    velocity: {
      // Velocidad = ritmo de la conversación: cambio % del VOLUMEN de menciones
      // vs período previo (no engagement social) para que no colapse a 0 en
      // periodos noticiosos. Ya es un "cambio %" — no lleva delta adicional.
      display: formatVelocity(cur.totals.total, prev.totals.total),
      hint: 'volumen de menciones vs período previo',
    },
    engagementRate: {
      display: formatMetric('engagementRate', cur.engagementRate),
      delta: formatDelta(cur.engagementRate, prev.engagementRate, { kind: 'absolute', decimals: 1, suffix: ' pts' }),
    },
  };
}

// ============================================================
// RESUMEN SEMANAL — semana cerrada vs semana anterior (viernes)
// ============================================================

interface TopicWindowCount {
  topic: string;
  total: number;
  negative: number;
}

/**
 * Conteo COMPLETO de menciones por tópico principal en una ventana (sin el
 * truncado top-7 del topicsTable — necesario para que la comparación semanal
 * no marque como "nuevo" un tópico que la semana pasada quedó fuera del top).
 * Misma semántica que loadTopicsTable: top-confidence por mención, día
 * calendario en TZ PR, sin duplicados. Excluye "Sin clasificar".
 */
async function loadTopicCounts(
  client: any,
  agencyId: string,
  startYmd: string,
  endYmd: string,
): Promise<TopicWindowCount[]> {
  const r = await client.query(
    `SELECT t.name AS topic,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE pt.sentiment = 'negativo')::int AS negative
       FROM (
         SELECT m.id,
                COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
                (SELECT topic_id FROM mention_topics
                  WHERE mention_id = m.id
                  ORDER BY confidence DESC NULLS LAST, topic_id ASC LIMIT 1) AS topic_id
           FROM mentions m
          WHERE m.agency_id = $1
            AND m.is_duplicate = false
            AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date >= $2::date
            AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date <= $3::date
       ) pt
       JOIN topics t ON t.id = pt.topic_id
      GROUP BY t.name
      ORDER BY total DESC`,
    [agencyId, startYmd, endYmd],
  );
  return r.rows.map((row: any) => ({
    topic: row.topic,
    total: Number(row.total),
    negative: Number(row.negative),
  }));
}

async function buildWeeklySummaryEmail(
  client: any,
  agency: { id: string; slug: string; name: string },
): Promise<BuiltEmail> {
  // Semana cerrada: 7 días terminando AYER. Enviado el viernes ⇒ vie–jue.
  const nowUtc = new Date();
  const window = closedWindowYmdInTZ(7, nowUtc, REPORT_TIMEZONE);
  const { startYmd, endYmd, prevStartYmd, prevEndYmd } = window;
  // Ventana previa-previa: solo para satisfacer la firma de buildSentimentReport
  // al calcular la semana anterior (su deltaVsPrev no se usa aquí).
  const prevPrevEnd = addDaysYmd(prevStartYmd, -1);
  const prevPrevStart = addDaysYmd(prevPrevEnd, -6);

  const [curReport, prevReport, winCur, winPrev, curTopics, prevTopics] = await Promise.all([
    buildSentimentReport(client as PgClientLike, agency.id, startYmd, endYmd, prevStartYmd, prevEndYmd),
    buildSentimentReport(client as PgClientLike, agency.id, prevStartYmd, prevEndYmd, prevPrevStart, prevPrevEnd),
    loadMetricsForWindow(client as PgClientLike, agency.id, startYmd, endYmd),
    loadMetricsForWindow(client as PgClientLike, agency.id, prevStartYmd, prevEndYmd),
    loadTopicCounts(client, agency.id, startYmd, endYmd),
    loadTopicCounts(client, agency.id, prevStartYmd, prevEndYmd),
  ]);

  const totals = curReport.totals;
  const prevTotals = prevReport.totals;

  // Comparación de tópicos: unión de ambas semanas, orden por volumen actual.
  const prevTopicMap = new Map(prevTopics.map((t) => [t.topic, t]));
  const curTopicNames = new Set(curTopics.map((t) => t.topic));
  const compare = [
    ...curTopics.map((t) => ({ topic: t.topic, cur: t.total, prev: prevTopicMap.get(t.topic)?.total ?? 0 })),
    ...prevTopics.filter((t) => !curTopicNames.has(t.topic)).map((t) => ({ topic: t.topic, cur: 0, prev: t.total })),
  ].sort((a, b) => b.cur - a.cur || b.prev - a.prev);
  const topicsCompare = compare.slice(0, 8).map((t) => ({
    ...t,
    delta: formatDelta(t.cur, t.prev, { kind: 'percent', decimals: 0 }),
  }));

  // Contexto LLM de la semana actual (mismas queries que el diario).
  const aggregates = await buildAggregates(client, agency, startYmd, endYmd, curReport);
  const samples = await loadSamples(client, agency.id, startYmd, endYmd);

  const metrics = buildEmailMetrics(winCur, winPrev);
  const indicatorLines = [
    { label: 'Riesgo de crisis', cur: metrics.crisis.display.value ?? '—', prev: formatMetric('crisis', winPrev.crisisRiskScore).value ?? '—' },
    { label: 'Salud de marca', cur: metrics.bhi.display.value ?? '—', prev: formatMetric('bhi', winPrev.brandHealthIndex).value ?? '—' },
    { label: 'Sentimiento neto', cur: metrics.nss.display.value ?? '—', prev: formatMetric('nss', winPrev.nss).value ?? '—' },
    { label: 'Polarización', cur: metrics.polarization?.display.value ?? '—', prev: formatMetric('polarization', winPrev.polarizationIndex).value ?? '—' },
    { label: 'Tasa de interacción', cur: metrics.engagementRate?.display.value ?? '—', prev: formatMetric('engagementRate', winPrev.engagementRate).value ?? '—' },
  ];

  const weekLabel = formatPeriodLabel(startYmd, endYmd);
  const prevWeekLabel = formatPeriodLabel(prevStartYmd, prevEndYmd);

  // Menciones con mayor engagement de la semana — aterrizan el reporte en
  // contenido concreto. Se toman de las mismas muestras que van al LLM
  // (pertinencia alta/media, ya ordenadas por engagement por sentimiento).
  const topMentions = [...samples.negative, ...samples.neutral, ...samples.positive]
    .filter((m) => typeof m.engagement === 'number' && m.engagement > 0)
    .sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0))
    .slice(0, 5)
    .map((m) => ({
      sourceLabel: m.source ?? m.pageType ?? 'Fuente desconocida',
      title: null,
      snippet: m.text.length > 220 ? `${m.text.slice(0, 220)}…` : m.text,
      url: m.url ?? null,
      engagementLabel: `${(m.engagement ?? 0).toLocaleString('es-PR')} interacciones`,
      publishedAtLabel: formatShortDay(m.createdAt.slice(0, 10)),
      tone: m.sentiment,
    }));

  const ai = await generateWeeklyComparison({
    current: aggregates,
    prevTotals,
    prevByTopic: prevTopics.map((t) => ({ topic: t.topic, total: t.total, negative: t.negative })),
    indicatorLines,
    samples,
    weekLabel,
    prevWeekLabel,
  });

  const renderData: WeeklySummaryRenderData = {
    agencyName: agency.name,
    agencyShortName: agencyShortName(agency.slug),
    agencyKicker: `${agencyShortName(agency.slug)} · ${agency.name}`,
    weekLabel,
    prevWeekLabel,
    updatedAtLabel: formatUpdatedAtLabel(nowUtc, REPORT_TIMEZONE),
    totals,
    prevTotals,
    totalDelta: formatDelta(totals.total, prevTotals.total, { kind: 'percent', decimals: 0 }),
    sentimentDelta: {
      negative: formatDelta(totals.negative, prevTotals.negative, { kind: 'percent', decimals: 0, invert: true }),
      neutral: formatDelta(totals.neutral, prevTotals.neutral, { kind: 'percent', decimals: 0 }),
      positive: formatDelta(totals.positive, prevTotals.positive, { kind: 'percent', decimals: 0 }),
    },
    metrics,
    chartImageUrl: buildWeeklyOverlayChartUrl(curReport, prevReport),
    weeklySummary: ai.summary,
    highlights: ai.highlights,
    topicsCompare,
    topMentions,
    dashboardUrl: `${DASHBOARD_BASE_URL}/dashboard?agency=${agency.slug}`,
  };

  const subject = buildSubject('Semanal', agencyShortName(agency.slug), `semana ${weekLabel}`);

  return {
    html: renderWeeklySummaryHtml(renderData),
    subject,
    stats: totals,
    // Enviamos también cuando la semana actual quedó en cero pero la anterior
    // tuvo volumen — "la conversación se apagó" ES señal semanal.
    hasData: totals.total > 0 || prevTotals.total > 0,
  };
}

// ============================================================
// Schema bootstrap (idempotent)
// ============================================================

async function ensureReportsSchema(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS report_configs (
      agency_id UUID PRIMARY KEY REFERENCES agencies(id) ON DELETE CASCADE,
      is_active BOOLEAN NOT NULL DEFAULT true,
      send_hour_local INTEGER NOT NULL DEFAULT 6,
      timezone VARCHAR(64) NOT NULL DEFAULT 'America/Puerto_Rico',
      template_key VARCHAR(64) NOT NULL DEFAULT 'daily-sentiment-summary',
      recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
      from_email VARCHAR(255) NOT NULL DEFAULT 'agutierrez@populicom.com',
      from_name VARCHAR(255) NOT NULL DEFAULT 'ECO Radar',
      weekly_enabled BOOLEAN NOT NULL DEFAULT true,
      weekly_send_dow INTEGER NOT NULL DEFAULT 5,
      weekly_send_hour_local INTEGER NOT NULL DEFAULT 15,
      updated_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_report_configs_active ON report_configs(is_active);`);

  // Migración jul 2026 — correo semanal de los viernes:
  //  - weekly_enabled: on/off del semanal por agencia (default ON).
  //  - weekly_send_dow: día local de envío, convención JS getDay
  //    (0=domingo … 6=sábado). Default 5 = viernes.
  //  - weekly_send_hour_local: hora local (0–23) del semanal, independiente
  //    del diario. Default 15 = 3:00 PM (pedido del cliente jul 2026).
  await client.query(`ALTER TABLE report_configs ADD COLUMN IF NOT EXISTS weekly_enabled BOOLEAN NOT NULL DEFAULT true;`);
  await client.query(`ALTER TABLE report_configs ADD COLUMN IF NOT EXISTS weekly_send_dow INTEGER NOT NULL DEFAULT 5;`);
  await client.query(`ALTER TABLE report_configs ADD COLUMN IF NOT EXISTS weekly_send_hour_local INTEGER NOT NULL DEFAULT 15;`);

  // Self-heal jul 2026: el template_key histórico 'weekly-sentiment-summary'
  // describía un correo que en realidad es DIARIO. Se renombra una sola vez;
  // no-op cuando ya migró. (La API de settings acepta ambos valores.)
  await client.query(`
    UPDATE report_configs
       SET template_key = 'daily-sentiment-summary', updated_at = NOW()
     WHERE template_key = 'weekly-sentiment-summary';
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS report_send_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      recipients JSONB NOT NULL,
      from_email VARCHAR(255) NOT NULL,
      template_key VARCHAR(64) NOT NULL,
      trigger VARCHAR(32) NOT NULL,
      status VARCHAR(32) NOT NULL,
      message_id VARCHAR(255),
      error TEXT,
      stats JSONB,
      triggered_by UUID REFERENCES users(id)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_report_send_log_agency_id ON report_send_log(agency_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_report_send_log_sent_at ON report_send_log(sent_at);`);

  // Seed default config: DDEC activo con destinatarios Populicom a las 6 AM
  // (America/Puerto_Rico). Otras agencias inactivas. El ON CONFLICT solo
  // sobreescribe si nadie ha editado la fila desde la UI (updated_by IS NULL).
  const DDEC_RECIPIENTS = [
    'agutierrez@populicom.com',
    'gpaz@populicom.com',
    'csanchez@populicom.com',
    'asoto@populicom.com',
    'lquinones@populicom.com',
    'grosado@populicom.com',
  ];
  await client.query(`
    INSERT INTO report_configs (agency_id, is_active, send_hour_local, timezone, recipients, from_email, from_name)
    SELECT id,
           CASE WHEN slug = 'ddecpr' THEN true ELSE false END,
           6,
           'America/Puerto_Rico',
           CASE WHEN slug = 'ddecpr' THEN $1::jsonb ELSE '[]'::jsonb END,
           'agutierrez@populicom.com',
           'ECO Radar'
    FROM agencies
    WHERE is_active = true
    ON CONFLICT (agency_id) DO UPDATE SET
      is_active = EXCLUDED.is_active,
      send_hour_local = EXCLUDED.send_hour_local,
      timezone = EXCLUDED.timezone,
      recipients = EXCLUDED.recipients,
      updated_at = NOW()
    WHERE report_configs.updated_by IS NULL;
  `, [JSON.stringify(DDEC_RECIPIENTS)]);

  // Self-heal: una sola vez, migra la config DDEC de Bogotá a Puerto Rico aun
  // si la UI ya tocó la fila (updated_by NOT NULL). Detectamos el estado
  // antiguo por la timezone — si ya es 'America/Puerto_Rico', no hace nada.
  await client.query(`
    UPDATE report_configs rc
       SET timezone = 'America/Puerto_Rico',
           send_hour_local = CASE
             WHEN rc.send_hour_local IN (16, 17) THEN 6
             ELSE rc.send_hour_local
           END,
           updated_at = NOW()
      FROM agencies a
     WHERE rc.agency_id = a.id
       AND a.slug = 'ddecpr'
       AND rc.timezone = 'America/Bogota';
  `);

  // Self-heal from_name: migra filas con el branding viejo "Populicom Radar"
  // a "ECO Radar" sin tocar valores custom que la UI haya guardado.
  await client.query(`
    UPDATE report_configs
       SET from_name = 'ECO Radar', updated_at = NOW()
     WHERE from_name = 'Populicom Radar';
  `);

  // Self-heal recipients de DDEC: añade lquinones y grosado si faltan, sin
  // duplicar y sin tocar otros emails que el usuario haya configurado.
  await client.query(`
    UPDATE report_configs rc
       SET recipients = (
             SELECT COALESCE(jsonb_agg(DISTINCT email), '[]'::jsonb)
               FROM jsonb_array_elements_text(
                 COALESCE(rc.recipients, '[]'::jsonb)
                 || '["lquinones@populicom.com","grosado@populicom.com"]'::jsonb
               ) AS email
           ),
           updated_at = NOW()
      FROM agencies a
     WHERE rc.agency_id = a.id
       AND a.slug = 'ddecpr'
       AND NOT (
         rc.recipients @> '["lquinones@populicom.com"]'::jsonb
         AND rc.recipients @> '["grosado@populicom.com"]'::jsonb
       );
  `);

  console.log('[weekly-report] reports schema ensured');
}

// ============================================================
// DB queries for aggregates
// ============================================================

async function buildAggregates(
  client: any,
  agency: { id: string; slug: string; name: string },
  startDate: string,
  endDate: string,
  sentimentReport: SentimentReport,
): Promise<WeeklyAggregates> {
  // NOTA: las queries de métricas NO filtran por nlp_pertinence — cuentan todas
  // las menciones para mantener paridad con el dashboard. El filtro de pertinencia
  // se aplica solo en loadSamples()/loadTodaySamples() porque esas muestras van al
  // LLM, y queremos que el LLM solo describa señal de calidad.
  //
  // Totales, deltas, daily series y la tabla de tópicos vienen de
  // sentimentReport (ya computado por @eco/shared/buildSentimentReport — la
  // misma función que consume /api/overview). Aquí solo agregamos el contexto
  // que el LLM necesita y que NO se renderiza en el correo: top 10 tópicos
  // como array de subtopics, municipios, autores, fuentes, emociones.
  const byTopic = sentimentReport.topicsTable
    .filter((t) => !t.isOther && !t.isUnclassified)
    .slice(0, 10)
    .map((t) => ({
      topic: t.topic,
      subtopics: t.subtopics ? t.subtopics.split(' · ') : [],
      total: t.total,
      negative: t.negative,
      neutral: t.neutral,
      positive: t.positive,
    }));

  const byMuniRows = await client.query(
    `SELECT mu.name AS municipality,
            COUNT(DISTINCT m.id)::int AS total,
            COUNT(DISTINCT m.id) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) = 'negativo')::int AS negative
       FROM mentions m
       JOIN mention_municipalities mm ON mm.mention_id = m.id
       JOIN municipalities mu ON mu.id = mm.municipality_id
      WHERE m.agency_id = $1
        AND m.is_duplicate = false
        AND m.published_at >= ($2::date)
        AND m.published_at <  (($3::date) + INTERVAL '1 day')
      GROUP BY mu.id, mu.name
      ORDER BY negative DESC, total DESC
      LIMIT 10`,
    [agency.id, startDate, endDate],
  );
  const byMunicipality = byMuniRows.rows.map((r: any) => ({
    municipality: r.municipality, total: r.total, negative: r.negative,
  }));

  const topAuthorsRows = await client.query(
    `SELECT author, COUNT(*)::int AS mentions,
            (SELECT COALESCE(m2.nlp_sentiment, m2.bw_sentiment)
               FROM mentions m2
              WHERE m2.agency_id = $1 AND m2.author = m.author
                AND m2.is_duplicate = false
                AND m2.published_at >= ($2::date)
                AND m2.published_at <  (($3::date) + INTERVAL '1 day')
              GROUP BY 1
              ORDER BY COUNT(*) DESC
              LIMIT 1) AS dominant_sentiment
       FROM mentions m
      WHERE agency_id = $1
        AND is_duplicate = false
        AND author IS NOT NULL AND author <> ''
        AND published_at >= ($2::date)
        AND published_at <  (($3::date) + INTERVAL '1 day')
      GROUP BY author
      ORDER BY mentions DESC
      LIMIT 8`,
    [agency.id, startDate, endDate],
  );
  const topAuthors = topAuthorsRows.rows.map((r: any) => ({
    author: r.author,
    mentions: r.mentions,
    sentiment: (normalizeSentiment(r.dominant_sentiment) ?? 'neutral') as 'negative' | 'neutral' | 'positive',
  }));

  const topSourcesRows = await client.query(
    `SELECT COALESCE(content_source_name, domain) AS source, COUNT(*)::int AS mentions
       FROM mentions
      WHERE agency_id = $1
        AND is_duplicate = false
        AND published_at >= ($2::date)
        AND published_at <  (($3::date) + INTERVAL '1 day')
        AND COALESCE(content_source_name, domain) IS NOT NULL
      GROUP BY source
      ORDER BY mentions DESC
      LIMIT 8`,
    [agency.id, startDate, endDate],
  );
  const topSources = topSourcesRows.rows.map((r: any) => ({ source: r.source, mentions: r.mentions }));

  const emotionsRows = await client.query(
    `SELECT emo::text AS emotion, COUNT(*)::int AS cnt
       FROM mentions m, jsonb_array_elements_text(COALESCE(m.nlp_emotions, '[]'::jsonb)) AS emo
      WHERE m.agency_id = $1
        AND m.is_duplicate = false
        AND m.published_at >= ($2::date)
        AND m.published_at <  (($3::date) + INTERVAL '1 day')
      GROUP BY emo
      ORDER BY cnt DESC
      LIMIT 6`,
    [agency.id, startDate, endDate],
  );
  const topEmotions = emotionsRows.rows.map((r: any) => ({
    emotion: String(r.emotion).replace(/^"|"$/g, ''),
    count: r.cnt,
  }));

  return {
    periodStart: startDate,
    periodEnd: endDate,
    agencyName: agency.name,
    agencyShortName: agencyShortName(agency.slug),
    totals: sentimentReport.totals,
    deltaVsPrevWeek: sentimentReport.deltaVsPrev,
    dailySeries: sentimentReport.dailySeries.map((d) => ({
      date: d.date,
      negative: d.negative,
      neutral: d.neutral,
      positive: d.positive,
    })),
    byTopic,
    byMunicipality,
    topAuthors,
    topSources,
    topEmotions,
  };
}

async function loadSamples(
  client: any,
  agencyId: string,
  startDate: string,
  endDate: string,
): Promise<{ negative: MentionSample[]; neutral: MentionSample[]; positive: MentionSample[] }> {
  const result: Record<string, MentionSample[]> = { negative: [], neutral: [], positive: [] };
  const map: Record<string, 'negativo' | 'neutral' | 'positivo'> = {
    negative: 'negativo', neutral: 'neutral', positive: 'positivo',
  };
  for (const key of Object.keys(result) as Array<keyof typeof result>) {
    const r = await client.query(
      `SELECT m.id, m.published_at, m.title, m.snippet, m.author, m.content_source_name, m.url,
              m.page_type, m.engagement_score, m.nlp_pertinence, m.nlp_emotions,
              COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
              t.name AS topic, s.name AS subtopic, mu.name AS municipality
         FROM mentions m
         LEFT JOIN LATERAL (
           SELECT topic_id, subtopic_id FROM mention_topics WHERE mention_id = m.id ORDER BY confidence DESC NULLS LAST LIMIT 1
         ) mt ON true
         LEFT JOIN topics t ON t.id = mt.topic_id
         LEFT JOIN subtopics s ON s.id = mt.subtopic_id
         LEFT JOIN LATERAL (
           SELECT municipality_id FROM mention_municipalities WHERE mention_id = m.id LIMIT 1
         ) mm ON true
         LEFT JOIN municipalities mu ON mu.id = mm.municipality_id
        WHERE m.agency_id = $1
          AND m.is_duplicate = false
          AND m.published_at >= ($2::date)
          AND m.published_at <  (($3::date) + INTERVAL '1 day')
          AND COALESCE(m.nlp_sentiment, m.bw_sentiment) = $4
          AND m.nlp_pertinence IN ('alta','media')
        ORDER BY COALESCE(m.engagement_score, 0) DESC, m.published_at DESC
        LIMIT 20`,
      [agencyId, startDate, endDate, map[key]],
    );
    result[key] = r.rows.map((row: any) => ({
      id: row.id,
      createdAt: (row.published_at as Date).toISOString(),
      text: `${row.title ? row.title + ' — ' : ''}${row.snippet ?? ''}`.trim(),
      sentiment: key as 'negative' | 'neutral' | 'positive',
      topic: row.topic,
      subtopic: row.subtopic,
      municipality: row.municipality,
      author: row.author,
      source: row.content_source_name,
      url: row.url,
      pageType: row.page_type,
      engagement: row.engagement_score != null ? Number(row.engagement_score) : null,
      pertinence: (row.nlp_pertinence as 'alta' | 'media' | 'baja' | null) ?? null,
      emotions: Array.isArray(row.nlp_emotions) ? row.nlp_emotions : [],
    }));
  }
  return result as { negative: MentionSample[]; neutral: MentionSample[]; positive: MentionSample[] };
}

async function loadTodaySamples(client: any, agencyId: string, todayYmd: string): Promise<MentionSample[]> {
  const r = await client.query(
    `SELECT m.id, m.published_at, m.title, m.snippet, m.author, m.content_source_name,
            COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
            t.name AS topic, mu.name AS municipality
       FROM mentions m
       LEFT JOIN LATERAL (
         SELECT topic_id FROM mention_topics WHERE mention_id = m.id ORDER BY confidence DESC NULLS LAST LIMIT 1
       ) mt ON true
       LEFT JOIN topics t ON t.id = mt.topic_id
       LEFT JOIN LATERAL (
         SELECT municipality_id FROM mention_municipalities WHERE mention_id = m.id LIMIT 1
       ) mm ON true
       LEFT JOIN municipalities mu ON mu.id = mm.municipality_id
      WHERE m.agency_id = $1
        AND m.is_duplicate = false
        AND m.nlp_pertinence IN ('alta','media')
        AND m.published_at >= ($2::date)
        AND m.published_at <  (($2::date) + INTERVAL '1 day')
      ORDER BY COALESCE(m.engagement_score, 0) DESC, m.published_at DESC
      LIMIT 20`,
    [agencyId, todayYmd],
  );
  return r.rows.map((row: any) => ({
    id: row.id,
    createdAt: (row.published_at as Date).toISOString(),
    text: `${row.title ? row.title + ' — ' : ''}${row.snippet ?? ''}`.trim(),
    sentiment: (row.sentiment === 'negativo' ? 'negative' : row.sentiment === 'positivo' ? 'positive' : 'neutral') as 'negative' | 'neutral' | 'positive',
    topic: row.topic,
    municipality: row.municipality,
    source: row.content_source_name,
  }));
}

// ============================================================
// Bedrock
// ============================================================

/**
 * Invoca Claude vía tool-use con `input_schema`. Devuelve el `input`
 * estructurado del bloque `tool_use` — no JSON crudo. Esto evita los fallos
 * por comillas o saltos de línea no escapados que rompen `JSON.parse` cuando
 * pedimos JSON en texto plano. Bedrock garantiza la forma del `tool_use`.
 */
async function invokeClaudeWithTool<T>(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  tool: { name: string; description: string; input_schema: Record<string, unknown> },
): Promise<T> {
  const models = [BEDROCK_MODEL_ID, BEDROCK_FALLBACK_MODEL_ID].filter((m, i, arr) => m && arr.indexOf(m) === i);
  let lastErr: unknown = null;
  for (const modelId of models) {
    try {
      const response = await bedrock.send(new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
          temperature: 0,
          tools: [tool],
          tool_choice: { type: 'tool', name: tool.name },
        }),
      }));
      const body = JSON.parse(new TextDecoder().decode(response.body));
      const content: Array<{ type: string; name?: string; input?: unknown }> = body.content ?? [];
      const toolUse = content.find((b) => b.type === 'tool_use' && b.name === tool.name);
      if (body.stop_reason && body.stop_reason !== 'end_turn' && body.stop_reason !== 'tool_use') {
        throw new Error(`Bedrock stopped with reason '${body.stop_reason}' (likely max_tokens/filter)`);
      }
      if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) {
        throw new Error(`No tool_use block for '${tool.name}' in model ${modelId} response`);
      }
      return toolUse.input as T;
    } catch (err) {
      lastErr = err;
      console.warn(`[weekly-report] model ${modelId} failed:`, (err as Error).message);
    }
  }
  throw lastErr ?? new Error('No Bedrock model produced a response');
}

async function generateInsights(
  aggregates: WeeklyAggregates,
  samples: { negative: MentionSample[]; neutral: MentionSample[]; positive: MentionSample[] },
): Promise<{ negative: string[]; neutral: string[]; positive: string[] }> {
  if (aggregates.totals.total === 0) {
    return { negative: [], neutral: [], positive: [] };
  }
  const prompt = buildSentimentInsightsPrompt(aggregates, samples);
  try {
    const parsed = await invokeClaudeWithTool<{ negative?: unknown; neutral?: unknown; positive?: unknown }>(
      INSIGHTS_SYSTEM_PROMPT,
      prompt,
      1500,
      {
        name: 'submit_weekly_insights',
        description: 'Entrega los insights por sentimiento como tres arrays de cadenas.',
        input_schema: {
          type: 'object',
          properties: {
            negative: { type: 'array', items: { type: 'string' }, description: '0–2 insights del bloque negativo.' },
            neutral:  { type: 'array', items: { type: 'string' }, description: '0–2 insights del bloque neutral.' },
            positive: { type: 'array', items: { type: 'string' }, description: '0–2 insights del bloque positivo.' },
          },
          required: ['negative', 'neutral', 'positive'],
          additionalProperties: false,
        },
      },
    );
    const onlyStrings = (arr: unknown): string[] =>
      Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : [];
    return {
      negative: onlyStrings(parsed.negative),
      neutral:  onlyStrings(parsed.neutral),
      positive: onlyStrings(parsed.positive),
    };
  } catch (err) {
    console.error('[weekly-report] insights generation failed:', err);
    return { negative: [], neutral: [], positive: [] };
  }
}

async function generateDailySummary(
  aggregates: WeeklyAggregates,
  todaySamples: MentionSample[],
  todayYmd: string,
): Promise<string> {
  if (aggregates.totals.total === 0) {
    return 'Sin menciones registradas hoy en los canales monitoreados.';
  }
  const prompt = buildDailySummaryPrompt(aggregates, todaySamples, todayYmd);
  try {
    const parsed = await invokeClaudeWithTool<{ summary?: unknown }>(
      INSIGHTS_SYSTEM_PROMPT,
      prompt,
      1200,
      {
        name: 'submit_daily_summary',
        description: 'Entrega el párrafo resumen del último día del periodo.',
        input_schema: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Párrafo completo de 4 a 6 oraciones (~120–160 palabras) con contexto de la agencia: qué pasó, por qué importa, tópicos/actores clave y números.' },
          },
          required: ['summary'],
          additionalProperties: false,
        },
      },
    );
    return typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
      ? parsed.summary
      : 'Resumen no disponible.';
  } catch (err) {
    console.error('[weekly-report] daily summary generation failed:', err);
    return 'Resumen no disponible.';
  }
}

async function generateWeeklyComparison(
  inputs: Parameters<typeof buildWeeklySummaryPrompt>[0],
): Promise<{ summary: string; highlights: string[] }> {
  const fallback = {
    summary: 'Resumen no disponible.',
    highlights: [] as string[],
  };
  if (inputs.current.totals.total === 0 && inputs.prevTotals.total === 0) {
    return { summary: 'Sin menciones registradas en las últimas dos semanas en los canales monitoreados.', highlights: [] };
  }
  const prompt = buildWeeklySummaryPrompt(inputs);
  try {
    const parsed = await invokeClaudeWithTool<{ summary?: unknown; highlights?: unknown }>(
      INSIGHTS_SYSTEM_PROMPT,
      prompt,
      1200,
      {
        name: 'submit_weekly_comparison',
        description: 'Entrega el resumen ejecutivo semanal y los highlights de qué cambió vs la semana anterior.',
        input_schema: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Párrafo único de 3–5 oraciones, comparativo semana vs semana.' },
            highlights: {
              type: 'array',
              items: { type: 'string' },
              description: '2–4 oraciones independientes, cada una sobre un cambio distinto vs la semana anterior.',
            },
          },
          required: ['summary', 'highlights'],
          additionalProperties: false,
        },
      },
    );
    const summary = typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
      ? parsed.summary
      : fallback.summary;
    const highlights = Array.isArray(parsed.highlights)
      ? parsed.highlights.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 4)
      : [];
    return { summary, highlights };
  } catch (err) {
    console.error('[weekly-report] weekly comparison generation failed:', err);
    return fallback;
  }
}

// ============================================================
// Send log
// ============================================================

interface LogEntry {
  recipients: string[];
  fromEmail: string;
  templateKey: string;
  trigger: 'scheduled' | 'manual' | 'test';
  status: 'sent' | 'skipped' | 'failed' | 'no_recipients' | 'no_data';
  messageId?: string;
  error?: string;
  stats?: { negative: number; neutral: number; positive: number; total: number };
  triggeredBy?: string;
}

async function logSend(client: any, agencyId: string, entry: LogEntry): Promise<void> {
  try {
    await client.query(
      `INSERT INTO report_send_log
         (agency_id, recipients, from_email, template_key, trigger, status, message_id, error, stats, triggered_by)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
      [
        agencyId,
        JSON.stringify(entry.recipients),
        entry.fromEmail,
        entry.templateKey,
        entry.trigger,
        entry.status,
        entry.messageId ?? null,
        entry.error ?? null,
        entry.stats ? JSON.stringify(entry.stats) : null,
        entry.triggeredBy ?? null,
      ],
    );
  } catch (err) {
    console.error('[weekly-report] failed to write send log:', err);
  }
}

// ============================================================
// Chart images (QuickChart.io)
// ============================================================

function buildChartImageUrl(
  series: Array<{ date: string; dayLabel: string; negative: number; neutral: number; positive: number }>,
): string {
  const labels = series.map((d) => d.dayLabel);
  const neg = series.map((d) => d.negative);
  const neu = series.map((d) => d.neutral);
  const pos = series.map((d) => d.positive);

  // El template HTML del correo ya muestra su propia leyenda; aquí desactivamos
  // la del chart para no duplicar. Paleta alineada con el chrome de email.
  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Negativo', data: neg, borderColor: '#C8462F', backgroundColor: 'rgba(200,70,47,0.10)',
          borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#FFFFFF', pointBorderColor: '#C8462F',
          pointBorderWidth: 1.5, tension: 0.3, fill: true },
        { label: 'Neutral', data: neu, borderColor: '#6B7280', backgroundColor: 'rgba(107,114,128,0.06)',
          borderWidth: 2, pointRadius: 2.5, pointBackgroundColor: '#FFFFFF', pointBorderColor: '#6B7280',
          pointBorderWidth: 1.5, tension: 0.3, fill: false },
        { label: 'Positivo', data: pos, borderColor: '#1F8A47', backgroundColor: 'rgba(31,138,71,0)',
          borderWidth: 2, pointRadius: 2.5, pointBackgroundColor: '#FFFFFF', pointBorderColor: '#1F8A47',
          pointBorderWidth: 1.5, tension: 0.3, fill: false },
      ],
    },
    options: {
      layout: { padding: { top: 8, right: 12, bottom: 4, left: 4 } },
      plugins: {
        legend: { display: false },
        title: { display: false },
      },
      scales: {
        y: { beginAtZero: true, grid: { color: '#EEF0F4', drawBorder: false },
          ticks: { font: { size: 10, family: 'Helvetica' }, color: '#8A93A0', padding: 6, maxTicksLimit: 5 } },
        x: { grid: { display: false, drawBorder: false },
          ticks: { font: { size: 11, family: 'Helvetica', weight: '500' }, color: '#4A5563', padding: 6 } },
      },
    },
  };
  // version=4 fuerza Chart.js v4 en QuickChart; en v2 (default) los toggles
  // de plugins.legend no se respetan y la leyenda se renderiza igual.
  return `https://quickchart.io/chart?v=4&w=540&h=240&bkg=white&devicePixelRatio=2&c=${encodeURIComponent(JSON.stringify(config))}`;
}

/**
 * Chart del semanal: volumen TOTAL diario de esta semana (línea sólida azul)
 * superpuesto al de la semana anterior (línea punteada gris), alineados por
 * posición (día 1 de cada semana = mismo día de la semana).
 */
function buildWeeklyOverlayChartUrl(cur: SentimentReport, prev: SentimentReport): string {
  if (!cur.dailySeries.length) return '';
  const labels = cur.dailySeries.map((d) => d.dayLabel);
  const total = (d: { negative: number; neutral: number; positive: number }) => d.negative + d.neutral + d.positive;
  const curData = cur.dailySeries.map(total);
  const prevData = prev.dailySeries.map(total);

  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Esta semana', data: curData, borderColor: '#0A7EA4', backgroundColor: 'rgba(10,126,164,0.10)',
          borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#FFFFFF', pointBorderColor: '#0A7EA4',
          pointBorderWidth: 1.5, tension: 0.3, fill: true },
        { label: 'Semana anterior', data: prevData, borderColor: '#8A93A0', backgroundColor: 'rgba(138,147,160,0)',
          borderWidth: 2, borderDash: [6, 4], pointRadius: 2.5, pointBackgroundColor: '#FFFFFF', pointBorderColor: '#8A93A0',
          pointBorderWidth: 1.5, tension: 0.3, fill: false },
      ],
    },
    options: {
      layout: { padding: { top: 8, right: 12, bottom: 4, left: 4 } },
      plugins: {
        legend: { display: false },
        title: { display: false },
      },
      scales: {
        y: { beginAtZero: true, grid: { color: '#EEF0F4', drawBorder: false },
          ticks: { font: { size: 10, family: 'Helvetica' }, color: '#8A93A0', padding: 6, maxTicksLimit: 5 } },
        x: { grid: { display: false, drawBorder: false },
          ticks: { font: { size: 11, family: 'Helvetica', weight: '500' }, color: '#4A5563', padding: 6 } },
      },
    },
  };
  return `https://quickchart.io/chart?v=4&w=540&h=240&bkg=white&devicePixelRatio=2&c=${encodeURIComponent(JSON.stringify(config))}`;
}

function agencyShortName(slug: string): string {
  const map: Record<string, string> = { aaa: 'AAA', ddecpr: 'DDEC' };
  return map[slug] ?? slug.toUpperCase();
}

// ============================================================
// Misc
// ============================================================

function normalizeSentiment(s: string | null): 'negative' | 'neutral' | 'positive' | null {
  if (!s) return null;
  const v = s.toLowerCase();
  if (v.startsWith('neg')) return 'negative';
  if (v.startsWith('pos')) return 'positive';
  if (v.startsWith('neu')) return 'neutral';
  return null;
}

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }));
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}
