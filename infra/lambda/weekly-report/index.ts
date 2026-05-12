/**
 * eco-weekly-report Lambda
 *
 * Disparador 1 — EventBridge (cada hora, minuto 0): itera report_configs
 * activos, calcula la hora local de cada agencia según su timezone, y envía
 * si la hora coincide con send_hour_local.
 *
 * Disparador 2 — invocación manual/API (payload con agencySlug): envía
 * inmediatamente para esa agencia, ignorando la hora. Se usa para "Enviar
 * prueba" desde el dashboard admin.
 *
 * Cada envío (o skip/fail) se registra en report_send_log.
 */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  INSIGHTS_SYSTEM_PROMPT,
  buildSentimentInsightsPrompt,
  buildDailySummaryPrompt,
  renderWeeklyReportHtml,
  type MentionSample,
  type WeeklyAggregates,
  type WeeklyReportRenderData,
} from '@eco/shared';

const bedrock = new BedrockRuntimeClient({});
const sm = new SecretsManagerClient({});
const ses = new SESClient({});

const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1';
const BEDROCK_FALLBACK_MODEL_ID = process.env.BEDROCK_FALLBACK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';

/**
 * TZ para todo cálculo de "día calendario" del reporte. Puerto Rico es AST
 * (UTC-4) sin DST. La config por agencia (report_configs.timezone) sigue
 * siendo configurable; esta constante es solo el default usado cuando un
 * cálculo necesita "el día PR" sin pasar por la fila de config.
 */
const REPORT_TIMEZONE = 'America/Puerto_Rico';

let dbUrl: string | null = null;
let schemaEnsured = false;

interface InvokePayload {
  /** Si se especifica, ejecuta solo para esa agencia e ignora la hora (útil para tests manuales). */
  agencySlug?: string;
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
  status?: 'sent' | 'skipped' | 'failed' | 'no_recipients' | 'no_data';
  sent?: number;
  messageId?: string;
  html?: string;
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
      console.log(`[weekly-report] targeted run · agency=${event.agencySlug} · dryRun=${event.dryRun === true}`);
      const result = await runForAgencyBySlug(client, event);
      return result;
    }

    // Modo: scheduled (EventBridge cada hora). Itera configs activas y
    // decide cuáles corresponden a esta hora local.
    const nowUtc = new Date();
    console.log(`[weekly-report] scheduled sweep · now=${nowUtc.toISOString()}`);

    const configs = await client.query(
      `SELECT rc.agency_id, rc.send_hour_local, rc.timezone, rc.template_key,
              rc.recipients, rc.from_email, rc.from_name,
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
      if (localHour !== cfg.send_hour_local) {
        console.log(`[weekly-report] skip ${cfg.slug} · localHour=${localHour} vs sendHour=${cfg.send_hour_local} (${cfg.timezone})`);
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
      const run = await runForAgency(client, {
        agencyId: cfg.agency_id,
        agencySlug: cfg.slug,
        agencyName: cfg.name,
        recipients: cfg.recipients as string[],
        fromEmail: cfg.from_email,
        fromName: cfg.from_name,
        templateKey: cfg.template_key,
        trigger: 'scheduled',
        triggeredBy: null,
      });
      runs.push(run);
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
  const recipients = event.recipients ?? (a.recipients as string[] | null) ?? [];
  const fromEmail = a.from_email ?? 'agutierrez@populicom.com';
  const fromName = a.from_name ?? 'ECO Radar';
  const templateKey = a.template_key ?? 'weekly-sentiment-summary';
  const trigger = event.trigger ?? 'manual';

  if (event.dryRun === true) {
    const { html } = await buildReport(client, { id: a.id, slug: a.slug, name: a.name });
    return { ok: true, agency: a.slug, html, status: 'sent' };
  }

  if (recipients.length === 0) {
    await logSend(client, a.id, {
      recipients: [], fromEmail, templateKey, trigger, status: 'no_recipients',
      triggeredBy: event.triggeredBy,
    });
    return { ok: false, agency: a.slug, status: 'no_recipients', error: 'no recipients configured' };
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
  });
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

async function runForAgency(client: any, i: AgencyRunInputs): Promise<RunResult> {
  try {
    const { html, aggregates } = await buildReport(client, {
      id: i.agencyId, slug: i.agencySlug, name: i.agencyName,
    });

    if (aggregates.totals.total === 0) {
      console.warn(`[weekly-report] ${i.agencySlug} — no mentions in period, skipping send`);
      await logSend(client, i.agencyId, {
        recipients: i.recipients, fromEmail: i.fromEmail, templateKey: i.templateKey,
        trigger: i.trigger, status: 'no_data', stats: aggregates.totals, triggeredBy: i.triggeredBy ?? undefined,
      });
      return { ok: false, agency: i.agencySlug, status: 'no_data' };
    }

    const subject = `${agencyShortName(i.agencySlug)} · Resumen semanal ${formatShortDay(aggregates.periodStart)} – ${formatShortDay(aggregates.periodEnd)}`;

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
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Html: { Data: html, Charset: 'UTF-8' } },
          },
        }));
        sent.push(recipient);
        if (!firstMessageId) firstMessageId = result.MessageId;
        console.log(`[weekly-report] ${i.agencySlug} sent to=${recipient} messageId=${result.MessageId}`);
      } catch (err: any) {
        failed.push({ email: recipient, error: String(err?.message ?? err) });
        console.warn(`[weekly-report] ${i.agencySlug} SKIPPED ${recipient}: ${err?.message ?? err}`);
      }
    }

    const status = sent.length > 0 ? 'sent' : 'failed';
    await logSend(client, i.agencyId, {
      recipients: sent, fromEmail: i.fromEmail, templateKey: i.templateKey,
      trigger: i.trigger, status, messageId: firstMessageId,
      error: failed.length > 0 ? `partial: ${failed.map((f) => f.email).join(',')}` : undefined,
      stats: aggregates.totals, triggeredBy: i.triggeredBy ?? undefined,
    });
    return {
      ok: sent.length > 0,
      agency: i.agencySlug,
      status,
      sent: sent.length,
      messageId: firstMessageId,
      ...(failed.length > 0 && { error: `${failed.length} recipient(s) failed: ${failed.map((f) => f.email).join(', ')}` }),
    };
  } catch (err: any) {
    console.error(`[weekly-report] ${i.agencySlug} FAILED:`, err);
    await logSend(client, i.agencyId, {
      recipients: i.recipients, fromEmail: i.fromEmail, templateKey: i.templateKey,
      trigger: i.trigger, status: 'failed', error: String(err?.message ?? err),
      triggeredBy: i.triggeredBy ?? undefined,
    });
    return { ok: false, agency: i.agencySlug, status: 'failed', error: String(err?.message ?? err) };
  }
}

// ============================================================
// Build report (aggregates + Bedrock + render HTML)
// ============================================================

interface BuiltReport {
  html: string;
  aggregates: WeeklyAggregates;
}

async function buildReport(
  client: any,
  agency: { id: string; slug: string; name: string },
): Promise<BuiltReport> {
  // Periodo: últimos 7 días CERRADOS (terminando AYER) en America/Puerto_Rico.
  // El correo se envía 6 AM PR; ayer ya es un día completo. No incluimos hoy
  // parcial — eso sesgaría el termómetro y el delta vs. semana previa.
  const nowUtc = new Date();
  const todayPR = ymdInTimeZone(nowUtc, REPORT_TIMEZONE);
  const endDate = addDaysYmd(todayPR, -1);                  // ayer cerrado
  const startDate = addDaysYmd(endDate, -6);                // 7 días cerrados
  const prevEndDate = addDaysYmd(startDate, -1);            // semana previa también 7 días
  const prevStartDate = addDaysYmd(prevEndDate, -6);

  const aggregates = await buildAggregates(client, agency, startDate, endDate, prevStartDate, prevEndDate);
  const samples = await loadSamples(client, agency.id, startDate, endDate);
  const todaySamples = await loadTodaySamples(client, agency.id, endDate);

  const insights = await generateInsights(aggregates, samples);
  const dailySummary = await generateDailySummary(aggregates, todaySamples, endDate);
  const topicsTable = await loadTopicsTable(client, agency.id, startDate, endDate);

  const dailySeriesLabeled = aggregates.dailySeries.map((d) => ({
    date: d.date,
    dayLabel: formatDayLabel(d.date),
    negative: d.negative,
    neutral: d.neutral,
    positive: d.positive,
  }));

  const renderData: WeeklyReportRenderData = {
    agencyName: agency.name,
    agencyShortName: agencyShortName(agency.slug),
    agencyKicker: `${agencyShortName(agency.slug)} · ${agency.name}`,
    periodLabel: formatPeriodLabel(startDate, endDate),
    updatedAtLabel: formatUpdatedAtLabel(nowUtc, REPORT_TIMEZONE),
    totals: aggregates.totals,
    deltaVsPrev: aggregates.deltaVsPrevWeek,
    chartImageUrl: buildChartImageUrl(dailySeriesLabeled),
    dailySeries: dailySeriesLabeled,
    topicsTable,
    insights,
    dailySummary: {
      label: `Resumen del día · ${formatShortDay(endDate)}`,
      paragraph: dailySummary,
    },
  };

  return { html: renderWeeklyReportHtml(renderData), aggregates };
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
      template_key VARCHAR(64) NOT NULL DEFAULT 'weekly-sentiment-summary',
      recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
      from_email VARCHAR(255) NOT NULL DEFAULT 'agutierrez@populicom.com',
      from_name VARCHAR(255) NOT NULL DEFAULT 'ECO Radar',
      updated_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_report_configs_active ON report_configs(is_active);`);

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
  // Esto es necesario porque el ON CONFLICT de arriba respeta filas tocadas
  // por la UI, pero el cambio Bogotá→PR es estructural y aplica para todos.
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
  prevStartDate: string,
  prevEndDate: string,
): Promise<WeeklyAggregates> {
  // NOTA: las queries de métricas NO filtran por nlp_pertinence — cuentan todas
  // las menciones para mantener paridad con el dashboard. El filtro de pertinencia
  // se aplica solo en loadSamples()/loadTodaySamples() porque esas muestras van al
  // LLM, y queremos que el LLM solo describa señal de calidad.
  const totalsRow = await client.query(
    `SELECT COALESCE(nlp_sentiment, bw_sentiment) AS s, COUNT(*)::int AS c
       FROM mentions
      WHERE agency_id = $1
        AND published_at >= ($2::date)
        AND published_at <  (($3::date) + INTERVAL '1 day')
      GROUP BY 1`,
    [agency.id, startDate, endDate],
  );
  const totals = foldSentiments(totalsRow.rows);

  const prevTotalsRow = await client.query(
    `SELECT COALESCE(nlp_sentiment, bw_sentiment) AS s, COUNT(*)::int AS c
       FROM mentions
      WHERE agency_id = $1
        AND published_at >= ($2::date)
        AND published_at <  (($3::date) + INTERVAL '1 day')
      GROUP BY 1`,
    [agency.id, prevStartDate, prevEndDate],
  );
  const prevTotals = foldSentiments(prevTotalsRow.rows);

  const deltaVsPrevWeek = {
    negative: deltaPct(totals.negative, prevTotals.negative),
    neutral: deltaPct(totals.neutral, prevTotals.neutral),
    positive: deltaPct(totals.positive, prevTotals.positive),
  };

  const dailyRows = await client.query(
    `SELECT to_char(published_at AT TIME ZONE 'America/Puerto_Rico', 'YYYY-MM-DD') AS d,
            COALESCE(nlp_sentiment, bw_sentiment) AS s,
            COUNT(*)::int AS c
       FROM mentions
      WHERE agency_id = $1
        AND published_at >= ($2::date)
        AND published_at <  (($3::date) + INTERVAL '1 day')
      GROUP BY 1, 2
      ORDER BY 1`,
    [agency.id, startDate, endDate],
  );

  const daily = new Map<string, { negative: number; neutral: number; positive: number }>();
  for (let i = 0; i < 7; i++) {
    const d = addDaysYmd(startDate, i);
    daily.set(d, { negative: 0, neutral: 0, positive: 0 });
  }
  for (const row of dailyRows.rows) {
    const bucket = daily.get(row.d);
    if (!bucket) continue;
    const s = normalizeSentiment(row.s);
    if (s) bucket[s] += row.c;
  }
  const dailySeries = Array.from(daily.entries()).map(([date, v]) => ({ date, ...v }));

  // Cada mención cuenta UNA sola vez bajo su tópico principal (el de mayor
  // confidence en mention_topics). Esto evita inflación por multi-clasificación
  // y hace que la suma de "Total" cuadre con el universo del termómetro.
  // Para menciones con empate de confidence, desempata por topic_id (estable).
  const byTopicRows = await client.query(
    `SELECT t.name AS topic,
            ARRAY_AGG(DISTINCT s.name ORDER BY s.name) FILTER (WHERE s.name IS NOT NULL) AS subtopics,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE pt.sentiment = 'negativo')::int AS negative,
            COUNT(*) FILTER (WHERE pt.sentiment = 'neutral')::int AS neutral,
            COUNT(*) FILTER (WHERE pt.sentiment = 'positivo')::int AS positive
       FROM (
         SELECT m.id AS mention_id,
                COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
                (SELECT topic_id FROM mention_topics
                  WHERE mention_id = m.id
                  ORDER BY confidence DESC NULLS LAST, topic_id ASC LIMIT 1) AS topic_id,
                (SELECT subtopic_id FROM mention_topics
                  WHERE mention_id = m.id
                  ORDER BY confidence DESC NULLS LAST, topic_id ASC LIMIT 1) AS subtopic_id
           FROM mentions m
          WHERE m.agency_id = $1
            AND m.published_at >= ($2::date)
            AND m.published_at <  (($3::date) + INTERVAL '1 day')
       ) pt
       JOIN topics t ON t.id = pt.topic_id
       LEFT JOIN subtopics s ON s.id = pt.subtopic_id
      GROUP BY t.id, t.name
      ORDER BY total DESC
      LIMIT 10`,
    [agency.id, startDate, endDate],
  );
  const byTopic = byTopicRows.rows.map((r: any) => ({
    topic: r.topic, subtopics: (r.subtopics ?? []) as string[],
    total: r.total, negative: r.negative, neutral: r.neutral, positive: r.positive,
  }));

  const byMuniRows = await client.query(
    `SELECT mu.name AS municipality,
            COUNT(DISTINCT m.id)::int AS total,
            COUNT(DISTINCT m.id) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) = 'negativo')::int AS negative
       FROM mentions m
       JOIN mention_municipalities mm ON mm.mention_id = m.id
       JOIN municipalities mu ON mu.id = mm.municipality_id
      WHERE m.agency_id = $1
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
                AND m2.published_at >= ($2::date)
                AND m2.published_at <  (($3::date) + INTERVAL '1 day')
              GROUP BY 1
              ORDER BY COUNT(*) DESC
              LIMIT 1) AS dominant_sentiment
       FROM mentions m
      WHERE agency_id = $1
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
    totals: { ...totals, total: totals.negative + totals.neutral + totals.positive },
    deltaVsPrevWeek,
    dailySeries,
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

async function loadTopicsTable(
  client: any,
  agencyId: string,
  startDate: string,
  endDate: string,
): Promise<WeeklyReportRenderData['topicsTable']> {
  // Estrategia: cada mención cuenta UNA vez bajo su "tópico principal" (el de
  // mayor confidence). Devolvemos top 7 tópicos + fila "Otros" (resto agrupado)
  // + fila "Sin clasificar" (menciones sin tópico aún). La suma de Total
  // cuadra con el universo del termómetro. Hace al correo más simple para una
  // audiencia ejecutiva que no necesita razonar sobre multi-clasificación.
  const r = await client.query(
    `SELECT COALESCE(t.id, -1) AS topic_id_key,
            COALESCE(t.name, 'Sin clasificar') AS topic,
            ARRAY_AGG(DISTINCT s.name ORDER BY s.name) FILTER (WHERE s.name IS NOT NULL) AS subtopics,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE pt.sentiment = 'negativo')::int AS negative,
            COUNT(*) FILTER (WHERE pt.sentiment = 'neutral')::int AS neutral,
            COUNT(*) FILTER (WHERE pt.sentiment = 'positivo')::int AS positive
       FROM (
         SELECT m.id AS mention_id,
                COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
                (SELECT topic_id FROM mention_topics
                  WHERE mention_id = m.id
                  ORDER BY confidence DESC NULLS LAST, topic_id ASC LIMIT 1) AS topic_id,
                (SELECT subtopic_id FROM mention_topics
                  WHERE mention_id = m.id
                  ORDER BY confidence DESC NULLS LAST, topic_id ASC LIMIT 1) AS subtopic_id
           FROM mentions m
          WHERE m.agency_id = $1
            AND m.published_at >= ($2::date)
            AND m.published_at <  (($3::date) + INTERVAL '1 day')
       ) pt
       LEFT JOIN topics t ON t.id = pt.topic_id
       LEFT JOIN subtopics s ON s.id = pt.subtopic_id
      GROUP BY t.id, t.name
      ORDER BY total DESC`,
    [agencyId, startDate, endDate],
  );

  type Row = {
    topic: string;
    subtopics: string;
    total: number;
    negative: number;
    neutral: number;
    positive: number;
    isUnclassified?: boolean;
    isOther?: boolean;
  };

  const allRows: Row[] = r.rows.map((row: any): Row => ({
    topic: row.topic,
    subtopics: (row.subtopics ?? []).slice(0, 3).join(' · '),
    total: row.total,
    negative: row.negative,
    neutral: row.neutral,
    positive: row.positive,
    isUnclassified: row.topic === 'Sin clasificar',
  }));

  const classified = allRows.filter((r) => !r.isUnclassified);
  const unclassified = allRows.find((r) => r.isUnclassified);

  // Top 7 tópicos clasificados; el resto se colapsa en "Otros tópicos".
  const TOP_N = 7;
  const top = classified.slice(0, TOP_N);
  const rest = classified.slice(TOP_N);

  const result: Row[] = [...top];
  if (rest.length > 0) {
    const others: Row = {
      topic: `Otros tópicos (${rest.length})`,
      subtopics: '',
      total: rest.reduce((s, r) => s + r.total, 0),
      negative: rest.reduce((s, r) => s + r.negative, 0),
      neutral: rest.reduce((s, r) => s + r.neutral, 0),
      positive: rest.reduce((s, r) => s + r.positive, 0),
      isOther: true,
    };
    result.push(others);
  }
  if (unclassified && unclassified.total > 0) {
    result.push({
      ...unclassified,
      subtopics: 'En proceso de clasificación',
    });
  }
  return result;
}

// ============================================================
// Bedrock
// ============================================================

async function invokeClaude(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
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
        }),
      }));
      const body = JSON.parse(new TextDecoder().decode(response.body));
      const text: string = body.content[0].text;
      return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
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
    const text = await invokeClaude(INSIGHTS_SYSTEM_PROMPT, prompt, 1500);
    const parsed = JSON.parse(text);
    return {
      negative: (parsed.negative ?? []).filter((s: string) => typeof s === 'string'),
      neutral: (parsed.neutral ?? []).filter((s: string) => typeof s === 'string'),
      positive: (parsed.positive ?? []).filter((s: string) => typeof s === 'string'),
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
    const text = await invokeClaude(INSIGHTS_SYSTEM_PROMPT, prompt, 600);
    const parsed = JSON.parse(text);
    return typeof parsed.summary === 'string' ? parsed.summary : 'Resumen no disponible.';
  } catch (err) {
    console.error('[weekly-report] daily summary generation failed:', err);
    return 'Resumen no disponible.';
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
// Chart image (QuickChart.io)
// ============================================================

function buildChartImageUrl(
  series: Array<{ date: string; dayLabel: string; negative: number; neutral: number; positive: number }>,
): string {
  const labels = series.map((d) => d.dayLabel);
  const neg = series.map((d) => d.negative);
  const neu = series.map((d) => d.neutral);
  const pos = series.map((d) => d.positive);

  // El template HTML del correo ya muestra su propia leyenda; aquí desactivamos
  // la del chart para no duplicar. Paleta alineada con render-weekly-report.
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

function agencyShortName(slug: string): string {
  const map: Record<string, string> = { aaa: 'AAA', ddecpr: 'DDEC' };
  return map[slug] ?? slug.toUpperCase();
}

// ============================================================
// Date / string helpers
// ============================================================

/**
 * Devuelve YYYY-MM-DD del día calendario en la timezone IANA dada.
 * Usa Intl.DateTimeFormat para no depender de offsets manuales (sin DST issues).
 */
function ymdInTimeZone(utc: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(utc).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

const ES_MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const ES_DOW_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function formatPeriodLabel(startYmd: string, endYmd: string): string {
  const [sy, sm, sd] = startYmd.split('-').map(Number);
  const [ey, em, ed] = endYmd.split('-').map(Number);
  const startMonth = ES_MONTH_SHORT[sm - 1];
  const endMonth = ES_MONTH_SHORT[em - 1];
  if (sm === em && sy === ey) return `${sd} – ${ed} ${endMonth} ${ey}`;
  return `${sd} ${startMonth} – ${ed} ${endMonth} ${ey}`;
}

function formatShortDay(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return `${d} ${ES_MONTH_SHORT[m - 1]}`;
}

function formatDayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${ES_DOW_SHORT[dt.getUTCDay()]} ${d}`;
}

function formatUpdatedAtLabel(nowUtc: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(nowUtc).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const day = Number(parts.day);
  const monthIdx = Number(parts.month) - 1;
  const month = ES_MONTH_SHORT[monthIdx] ?? '';
  const hour = Number(parts.hour);
  const minute = parts.minute ?? '00';
  const ampm = (parts.dayPeriod ?? '').toLowerCase().startsWith('p') ? 'p.m.' : 'a.m.';
  const tzLabel = timeZone === 'America/Puerto_Rico' ? 'AST' : timeZone.split('/').pop() ?? timeZone;
  return `${day} ${month}, ${hour}:${minute} ${ampm} ${tzLabel}`;
}

// ============================================================
// Time zone arithmetic
// ============================================================

/** Devuelve la hora local (0–23) en la timezone IANA dada. */
function hourInTimeZone(utc: Date, timeZone: string): number {
  // Intl.DateTimeFormat con hour12: false devuelve "00" – "23"
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hour: '2-digit',
  }).formatToParts(utc);
  const hourPart = parts.find((p) => p.type === 'hour');
  const h = Number(hourPart?.value ?? '-1');
  if (Number.isNaN(h)) return -1;
  // Intl a veces devuelve "24" para media noche — lo normalizamos a 0.
  return h === 24 ? 0 : h;
}

// ============================================================
// Misc
// ============================================================

function foldSentiments(rows: Array<{ s: string | null; c: number }>): { negative: number; neutral: number; positive: number } {
  const out = { negative: 0, neutral: 0, positive: 0 };
  for (const row of rows) {
    const s = normalizeSentiment(row.s);
    if (s) out[s] += row.c;
  }
  return out;
}

function normalizeSentiment(s: string | null): 'negative' | 'neutral' | 'positive' | null {
  if (!s) return null;
  const v = s.toLowerCase();
  if (v.startsWith('neg')) return 'negative';
  if (v.startsWith('pos')) return 'positive';
  if (v.startsWith('neu')) return 'neutral';
  return null;
}

function deltaPct(curr: number, prev: number): number {
  if (prev === 0) {
    if (curr === 0) return 0;
    return 100;
  }
  return ((curr - prev) / prev) * 100;
}

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }));
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}
