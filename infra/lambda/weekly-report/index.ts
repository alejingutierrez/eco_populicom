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
  const fromName = a.from_name ?? 'Populicom Radar';
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
  // Periodo: últimos 7 días naturales en America/Bogota, cerrando HOY.
  const nowLocal = new Date(Date.now() - 5 * 3600 * 1000); // Bogotá = UTC-5 sin DST
  const endDate = toYmd(nowLocal);
  const startDate = toYmd(new Date(nowLocal.getTime() - 6 * 86400 * 1000));
  const prevEndDate = toYmd(new Date(nowLocal.getTime() - 7 * 86400 * 1000));
  const prevStartDate = toYmd(new Date(nowLocal.getTime() - 13 * 86400 * 1000));

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
    agencyKicker: `${agencyShortName(agency.slug)} · ${agency.name}`,
    periodLabel: formatPeriodLabel(startDate, endDate),
    updatedAtLabel: formatUpdatedAtLabel(nowLocal),
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
      send_hour_local INTEGER NOT NULL DEFAULT 16,
      timezone VARCHAR(64) NOT NULL DEFAULT 'America/Bogota',
      template_key VARCHAR(64) NOT NULL DEFAULT 'weekly-sentiment-summary',
      recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
      from_email VARCHAR(255) NOT NULL DEFAULT 'agutierrez@populicom.com',
      from_name VARCHAR(255) NOT NULL DEFAULT 'Populicom Radar',
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

  // Seed default config: DDEC activo con destinatarios Populicom a las 5pm
  // (America/Bogota). Otras agencias inactivas. Solo inserta si la fila no existe.
  const DDEC_RECIPIENTS = [
    'agutierrez@populicom.com',
    'gpaz@populicom.com',
    'csanchez@populicom.com',
    'asoto@populicom.com',
  ];
  await client.query(`
    INSERT INTO report_configs (agency_id, is_active, send_hour_local, timezone, recipients, from_email, from_name)
    SELECT id,
           CASE WHEN slug = 'ddecpr' THEN true ELSE false END,
           17,
           'America/Bogota',
           CASE WHEN slug = 'ddecpr' THEN $1::jsonb ELSE '[]'::jsonb END,
           'agutierrez@populicom.com',
           'Populicom Radar'
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
  const totalsRow = await client.query(
    `SELECT COALESCE(nlp_sentiment, bw_sentiment) AS s, COUNT(*)::int AS c
       FROM mentions
      WHERE agency_id = $1
        AND nlp_pertinence IN ('alta','media')
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
        AND nlp_pertinence IN ('alta','media')
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
    `SELECT to_char(published_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS d,
            COALESCE(nlp_sentiment, bw_sentiment) AS s,
            COUNT(*)::int AS c
       FROM mentions
      WHERE agency_id = $1
        AND nlp_pertinence IN ('alta','media')
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

  const byTopicRows = await client.query(
    `SELECT t.name AS topic,
            ARRAY_AGG(DISTINCT s.name ORDER BY s.name) FILTER (WHERE s.name IS NOT NULL) AS subtopics,
            COUNT(DISTINCT m.id)::int AS total,
            COUNT(DISTINCT m.id) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) = 'negativo')::int AS negative,
            COUNT(DISTINCT m.id) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) = 'neutral')::int AS neutral,
            COUNT(DISTINCT m.id) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) = 'positivo')::int AS positive
       FROM mentions m
       JOIN mention_topics mt ON mt.mention_id = m.id
       JOIN topics t ON t.id = mt.topic_id
       LEFT JOIN subtopics s ON s.id = mt.subtopic_id
      WHERE m.agency_id = $1
        AND m.nlp_pertinence IN ('alta','media')
        AND m.published_at >= ($2::date)
        AND m.published_at <  (($3::date) + INTERVAL '1 day')
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
        AND m.nlp_pertinence IN ('alta','media')
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
                AND m2.nlp_pertinence IN ('alta','media')
                AND m2.published_at >= ($2::date)
                AND m2.published_at <  (($3::date) + INTERVAL '1 day')
              GROUP BY 1
              ORDER BY COUNT(*) DESC
              LIMIT 1) AS dominant_sentiment
       FROM mentions m
      WHERE agency_id = $1
        AND nlp_pertinence IN ('alta','media')
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
        AND nlp_pertinence IN ('alta','media')
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
        AND m.nlp_pertinence IN ('alta','media')
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
  const r = await client.query(
    `SELECT t.name AS topic,
            ARRAY_AGG(DISTINCT s.name ORDER BY s.name) FILTER (WHERE s.name IS NOT NULL) AS subtopics,
            COUNT(DISTINCT m.id)::int AS total,
            COUNT(DISTINCT m.id) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) = 'negativo')::int AS negative,
            COUNT(DISTINCT m.id) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) = 'neutral')::int AS neutral,
            COUNT(DISTINCT m.id) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) = 'positivo')::int AS positive
       FROM mentions m
       JOIN mention_topics mt ON mt.mention_id = m.id
       JOIN topics t ON t.id = mt.topic_id
       LEFT JOIN subtopics s ON s.id = mt.subtopic_id
      WHERE m.agency_id = $1
        AND m.nlp_pertinence IN ('alta','media')
        AND m.published_at >= ($2::date)
        AND m.published_at <  (($3::date) + INTERVAL '1 day')
      GROUP BY t.id, t.name
      ORDER BY total DESC
      LIMIT 8`,
    [agencyId, startDate, endDate],
  );
  return r.rows.map((row: any) => ({
    topic: row.topic,
    subtopics: (row.subtopics ?? []).slice(0, 3).join(' · '),
    total: row.total,
    negative: row.negative,
    neutral: row.neutral,
    positive: row.positive,
  }));
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

  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Negativo', data: neg, borderColor: '#E86452', backgroundColor: 'rgba(232,100,82,0.15)',
          borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#FFFFFF', pointBorderColor: '#E86452',
          pointBorderWidth: 2, tension: 0.35, fill: true },
        { label: 'Neutral', data: neu, borderColor: '#94A3B8', backgroundColor: 'rgba(148,163,184,0.10)',
          borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#FFFFFF', pointBorderColor: '#94A3B8',
          pointBorderWidth: 1.5, tension: 0.35, fill: true },
        { label: 'Positivo', data: pos, borderColor: '#52C47A', backgroundColor: 'rgba(82,196,122,0)',
          borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#FFFFFF', pointBorderColor: '#52C47A',
          pointBorderWidth: 1.5, tension: 0.35, fill: false },
      ],
    },
    options: {
      layout: { padding: { top: 12, right: 12, bottom: 4, left: 4 } },
      plugins: {
        legend: { position: 'top', align: 'start',
          labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true,
            font: { size: 12, family: "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif", weight: '600' },
            color: '#475569' } },
        title: { display: false },
      },
      scales: {
        y: { beginAtZero: true, grid: { color: '#F1F5F9', drawBorder: false },
          ticks: { font: { size: 11, family: "-apple-system, Arial, sans-serif" }, color: '#94A3B8', padding: 6, maxTicksLimit: 5 } },
        x: { grid: { display: false, drawBorder: false },
          ticks: { font: { size: 11, family: "-apple-system, Arial, sans-serif", weight: '500' }, color: '#64748B', padding: 6 } },
      },
    },
  };
  return `https://quickchart.io/chart?w=580&h=260&bkg=white&devicePixelRatio=2&c=${encodeURIComponent(JSON.stringify(config))}`;
}

function agencyShortName(slug: string): string {
  const map: Record<string, string> = { aaa: 'AAA', ddecpr: 'DDEC' };
  return map[slug] ?? slug.toUpperCase();
}

// ============================================================
// Date / string helpers
// ============================================================

function toYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return toYmd(date);
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

function formatUpdatedAtLabel(nowLocal: Date): string {
  const day = nowLocal.getUTCDate();
  const month = ES_MONTH_SHORT[nowLocal.getUTCMonth()];
  let h = nowLocal.getUTCHours();
  const m = String(nowLocal.getUTCMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'p.m.' : 'a.m.';
  h = h % 12 || 12;
  return `${day} ${month}, ${h}:${m} ${ampm} (Bogotá)`;
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
