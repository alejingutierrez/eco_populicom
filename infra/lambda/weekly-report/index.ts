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
  buildSentimentReport,
  closedWindowYmdInTZ,
  ymdInTimeZone,
  hourInTimeZone,
  formatPeriodLabel,
  formatShortDay,
  formatUpdatedAtLabel,
  type MentionSample,
  type WeeklyAggregates,
  type WeeklyReportRenderData,
  type PgClientLike,
  type SentimentReport,
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
  const window = closedWindowYmdInTZ(7, nowUtc, REPORT_TIMEZONE);
  const { startYmd: startDate, endYmd: endDate, prevStartYmd: prevStartDate, prevEndYmd: prevEndDate } = window;

  // 1) Agregados base (totales, daily series, tabla de tópicos) — fuente de
  //    verdad compartida con /api/overview a través de @eco/shared.
  const sentimentReport = await buildSentimentReport(
    client as PgClientLike, agency.id, startDate, endDate, prevStartDate, prevEndDate,
  );

  // 2) Contexto extra para el LLM (top tópicos, municipios, autores, fuentes,
  //    emociones). Estas queries son específicas del prompt — no las usa el
  //    dashboard.
  const aggregates = await buildAggregates(client, agency, startDate, endDate, sentimentReport);
  const samples = await loadSamples(client, agency.id, startDate, endDate);
  const todaySamples = await loadTodaySamples(client, agency.id, endDate);

  const insights = await generateInsights(aggregates, samples);
  const dailySummary = await generateDailySummary(aggregates, todaySamples, endDate);

  const renderData: WeeklyReportRenderData = {
    agencyName: agency.name,
    agencyShortName: agencyShortName(agency.slug),
    agencyKicker: `${agencyShortName(agency.slug)} · ${agency.name}`,
    periodLabel: formatPeriodLabel(startDate, endDate),
    updatedAtLabel: formatUpdatedAtLabel(nowUtc, REPORT_TIMEZONE),
    totals: sentimentReport.totals,
    deltaVsPrev: sentimentReport.deltaVsPrev,
    chartImageUrl: buildChartImageUrl(sentimentReport.dailySeries),
    dailySeries: sentimentReport.dailySeries,
    topicsTable: sentimentReport.topicsTable,
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
            negative: { type: 'array', items: { type: 'string' }, description: '0–3 insights del bloque negativo.' },
            neutral:  { type: 'array', items: { type: 'string' }, description: '0–3 insights del bloque neutral.' },
            positive: { type: 'array', items: { type: 'string' }, description: '0–3 insights del bloque positivo.' },
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
      600,
      {
        name: 'submit_daily_summary',
        description: 'Entrega el párrafo resumen del último día del periodo.',
        input_schema: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Párrafo único de 3–5 oraciones.' },
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
