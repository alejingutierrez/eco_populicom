/**
 * Metrics Calculator Lambda
 *
 * 1. Calcula las 8 métricas compuestas a partir de la tabla `mentions` y las
 *    upsertea en `daily_metric_snapshots`.
 * 2. Evalúa reglas de tipo `crisis_threshold` configuradas en `alert_rules`.
 *    Si el `crisis_risk_score` de hoy supera el umbral y se respeta el
 *    cooldown, dispara un correo editorial vía SES con el render de
 *    `@eco/shared/render-crisis-alert`.
 *
 * Trigger: EventBridge cada 10 min (offset del cron de ingesta).
 *
 * Las fórmulas viven en `@eco/shared/metrics` — single source of truth para
 * `/api/eco-data`, `/api/ai/metric-insight` y este lambda.
 */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  CRISIS_EDITORIAL_SYSTEM_PROMPT,
  buildCrisisEditorialPrompt,
  buildSubject,
  calculateMetrics,
  formatMetric,
  renderCrisisAlertHtml,
  renderSimpleAlertHtml,
  type CrisisAlertRenderData,
  type CrisisEditorialInputs,
  type CrisisEditorialOutput,
  type DailyAggregates,
  type HistoricalSnapshot,
  type MentionSample,
} from '@eco/shared';

const sm = new SecretsManagerClient({});
const bedrock = new BedrockRuntimeClient({});
const ses = new SESClient({});

const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1';
const BEDROCK_FALLBACK_MODEL_ID = process.env.BEDROCK_FALLBACK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'agutierrez@populicom.com';
const SES_FROM_NAME = process.env.SES_FROM_NAME ?? 'ECO Radar';
const DASHBOARD_BASE_URL = process.env.DASHBOARD_BASE_URL ?? 'http://eco-alb-1881782703.us-east-1.elb.amazonaws.com';

const REPORT_TIMEZONE = 'America/Puerto_Rico';

let dbUrl: string | null = null;
let schemaEnsured = false;

interface InvokePayload {
  /** Backfill mode (recalcula snapshots históricos). */
  backfill?: boolean;
  /**
   * Fuerza la evaluación de crisis: brinca tanto el threshold como el
   * cooldown. Útil para tests manuales y para regenerar editoriales.
   */
  forceCrisis?: boolean;
  /** Si se especifica, solo evalúa crisis para esa agencia. */
  agencySlug?: string;
  /**
   * Override de destinatarios solo para esta invocación. Si se pasa, NO se
   * tocan los `notify_emails` de la regla — solo se envía a estos correos.
   * Útil con `forceCrisis` para mandar un test a un único correo sin avisar
   * a toda la lista de la regla.
   */
  recipientsOverride?: string[];
}

export const handler = async (event: InvokePayload = {}): Promise<{ statusCode: number; body: string }> => {
  const isBackfill = event.backfill === true;
  console.log(`[metrics-calculator] invoked${isBackfill ? ' (backfill)' : ''}`);

  if (!dbUrl) dbUrl = await getDatabaseUrl();

  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    if (!schemaEnsured) {
      await ensureCrisisSchema(client);
      schemaEnsured = true;
    }

    const agenciesResult = await client.query(
      "SELECT id, slug, name FROM agencies WHERE is_active = true",
    );
    const agencies = agenciesResult.rows as Array<{ id: string; slug: string; name: string }>;

    if (isBackfill) {
      const datesResult = await client.query(
        `SELECT DISTINCT (published_at AT TIME ZONE 'America/Puerto_Rico')::date AS d
         FROM mentions
         ORDER BY d ASC`,
      );
      const dates = datesResult.rows.map((r: any) =>
        typeof r.d === 'string' ? r.d : r.d.toISOString().split('T')[0],
      );
      let computed = 0;
      for (const agency of agencies) {
        for (const date of dates) {
          await computeForAgency(client, agency.id, date);
          computed++;
        }
      }
      console.log(`[metrics-calculator] backfilled ${computed} snapshots across ${dates.length} days`);
      return { statusCode: 200, body: `Backfilled ${computed} snapshots` };
    }

    // Modo normal: compute hoy y evalúa crisis.
    const today = ymdInTimeZone(new Date(), REPORT_TIMEZONE);
    let computed = 0;
    let alertsFired = 0;

    for (const agency of agencies) {
      if (event.agencySlug && agency.slug !== event.agencySlug) continue;
      await computeForAgency(client, agency.id, today);
      computed++;

      try {
        const fired = await evaluateCrisisAlerts(
          client,
          agency,
          today,
          event.forceCrisis === true,
          event.recipientsOverride,
        );
        alertsFired += fired;
      } catch (err) {
        console.error(`[crisis] ${agency.slug} evaluation failed:`, err);
      }

      // Reglas de métrica genéricas (BHI/Polarización/EngVel/Volumen/Crisis).
      try {
        alertsFired += await evaluateMetricThresholdAlerts(
          client,
          agency,
          today,
          event.forceCrisis === true,
          event.recipientsOverride,
        );
      } catch (err) {
        console.error(`[metric-alert] ${agency.slug} evaluation failed:`, err);
      }
    }

    console.log(`[metrics-calculator] computed=${computed} crisisFired=${alertsFired}`);
    return { statusCode: 200, body: `Computed ${computed} agencies, ${alertsFired} crisis alerts` };
  } finally {
    await client.end();
  }
};

// ============================================================
// Daily metric snapshot
// ============================================================

async function computeForAgency(client: any, agencyId: string, today: string): Promise<void> {
  const agg = await getDailyAggregates(client, agencyId, today);
  const history = await getHistoricalSnapshots(client, agencyId, today);
  const metrics = calculateMetrics(agg, history);

  await client.query(
    `INSERT INTO daily_metric_snapshots (
      agency_id, date,
      total_mentions, positive_count, neutral_count, negative_count,
      high_pertinence_count, total_likes, total_comments, total_shares,
      total_reach, total_impact, total_engagement_score,
      nss, brand_health_index, reputation_momentum,
      engagement_rate, amplification_rate, engagement_velocity,
      crisis_risk_score, volume_anomaly_zscore,
      nss_7d, nss_30d,
      polarization_index,
      crisis_severity, crisis_velocity, crisis_relevance, crisis_confidence,
      computed_at
    ) VALUES (
      $1, $2,
      $3, $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12, $13,
      $14, $15, $16,
      $17, $18, $19,
      $20, $21,
      $22, $23,
      $24,
      $25, $26, $27, $28,
      NOW()
    )
    ON CONFLICT (agency_id, date) DO UPDATE SET
      total_mentions = $3, positive_count = $4, neutral_count = $5, negative_count = $6,
      high_pertinence_count = $7, total_likes = $8, total_comments = $9, total_shares = $10,
      total_reach = $11, total_impact = $12, total_engagement_score = $13,
      nss = $14, brand_health_index = $15, reputation_momentum = $16,
      engagement_rate = $17, amplification_rate = $18, engagement_velocity = $19,
      crisis_risk_score = $20, volume_anomaly_zscore = $21,
      nss_7d = $22, nss_30d = $23,
      polarization_index = $24,
      crisis_severity = $25, crisis_velocity = $26,
      crisis_relevance = $27, crisis_confidence = $28,
      computed_at = NOW()`,
    [
      agencyId, today,
      agg.totalMentions, agg.positiveCount, agg.neutralCount, agg.negativeCount,
      agg.highPertinenceCount, agg.totalLikes, agg.totalComments, agg.totalShares,
      agg.totalReach, agg.totalImpact, agg.totalEngagementScore,
      metrics.nss, metrics.brandHealthIndex, metrics.reputationMomentum,
      metrics.engagementRate, metrics.amplificationRate, metrics.engagementVelocity,
      metrics.crisisRiskScore, metrics.volumeAnomalyZscore,
      metrics.nss7d, metrics.nss30d,
      metrics.polarizationIndex,
      metrics.crisisSeverity, metrics.crisisVelocity,
      metrics.crisisRelevance, metrics.crisisConfidence,
    ],
  );
}

async function getDailyAggregates(client: any, agencyId: string, date: string): Promise<DailyAggregates> {
  // is_duplicate = false: las menciones marcadas como duplicadas por text_hash
  // (incluidos los shells vacíos de Twitter pre-Tier-2 que comparten hash)
  // no deben contar en agregados. Ver render-crisis-alert / metric formulas.
  const result = await client.query(
    `SELECT
      COUNT(*)::int AS total_mentions,
      -- Sentimiento efectivo COALESCE(nlp, bw): idéntico al loader windowed
      -- (metrics.ts loadAggregatesForWindow) y a la query de samples de crisis
      -- de este mismo lambda. Antes usaba nlp_sentiment puro, así que el snapshot
      -- diario y el recálculo windowed del dashboard contaban negativos distinto
      -- (las menciones clasificadas por BW pero aún no por NLP no contaban en el
      -- snapshot) → severity/score divergían entre el gate de alerta y el dashboard.
      COUNT(*) FILTER (WHERE COALESCE(nlp_sentiment, bw_sentiment) IN ('positivo','positive'))::int AS positive_count,
      COUNT(*) FILTER (WHERE COALESCE(nlp_sentiment, bw_sentiment) IN ('neutral'))::int AS neutral_count,
      COUNT(*) FILTER (WHERE COALESCE(nlp_sentiment, bw_sentiment) IN ('negativo','negative'))::int AS negative_count,
      COUNT(*) FILTER (WHERE nlp_pertinence = 'alta')::int AS high_pertinence_count,
      COUNT(*) FILTER (WHERE nlp_pertinence IN ('alta','media'))::int AS relevant_mentions_count,
      COUNT(*) FILTER (WHERE nlp_pertinence IN ('alta','media') AND COALESCE(nlp_sentiment, bw_sentiment) IN ('negativo','negative'))::int AS relevant_negative_count,
      COALESCE(SUM(likes), 0)::int AS total_likes,
      COALESCE(SUM(comments), 0)::int AS total_comments,
      COALESCE(SUM(shares), 0)::int AS total_shares,
      COALESCE(SUM(reach_estimate), 0)::bigint AS total_reach,
      COALESCE(SUM(impact), 0)::float AS total_impact,
      COALESCE(SUM(engagement_score), 0)::float AS total_engagement_score
    FROM mentions
    WHERE agency_id = $1
      AND is_duplicate = false
      AND (published_at AT TIME ZONE 'America/Puerto_Rico')::date = $2::date`,
    [agencyId, date],
  );
  const row = result.rows[0];
  return {
    totalMentions: row.total_mentions,
    positiveCount: row.positive_count,
    neutralCount: row.neutral_count,
    negativeCount: row.negative_count,
    highPertinenceCount: row.high_pertinence_count,
    relevantMentionsCount: row.relevant_mentions_count,
    relevantNegativeCount: row.relevant_negative_count,
    totalLikes: row.total_likes,
    totalComments: row.total_comments,
    totalShares: row.total_shares,
    totalReach: Number(row.total_reach),
    totalImpact: row.total_impact,
    totalEngagementScore: row.total_engagement_score,
  };
}

async function getHistoricalSnapshots(client: any, agencyId: string, today: string): Promise<HistoricalSnapshot[]> {
  const result = await client.query(
    `SELECT date, total_mentions, negative_count, nss, total_reach,
            total_engagement_score, engagement_rate
     FROM daily_metric_snapshots
     WHERE agency_id = $1 AND date < $2
     ORDER BY date DESC
     LIMIT 30`,
    [agencyId, today],
  );
  return result.rows.map((r: any) => ({
    date: r.date,
    totalMentions: r.total_mentions,
    negativeCount: r.negative_count,
    nss: r.nss != null ? Number(r.nss) : null,
    totalReach: Number(r.total_reach),
    totalEngagementScore: Number(r.total_engagement_score),
    engagementRate: r.engagement_rate != null ? Number(r.engagement_rate) : null,
  }));
}

// ============================================================
// Crisis schema bootstrap (idempotent)
// ============================================================

/**
 * Asegura que las tablas de alertas existan y que haya al menos una regla
 * `crisis_threshold` seedada para cada agencia activa cuyo `report_configs`
 * tenga recipients (para no enviar a vacío). Las reglas no se sobreescriben
 * si la UI ya las tocó.
 */
async function ensureCrisisSchema(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      config JSONB NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      notify_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS alert_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      alert_rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
      agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      mention_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      details JSONB,
      notification_sent BOOLEAN NOT NULL DEFAULT false,
      sent_at TIMESTAMPTZ
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_alert_rules_agency_active ON alert_rules(agency_id, is_active);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_alert_history_rule_triggered ON alert_history(alert_rule_id, triggered_at DESC);`);

  // Seed: una regla crisis_threshold por agencia activa que tenga recipients
  // en report_configs. Solo inserta si no existe ya alguna regla del mismo
  // type para esa agencia.
  await client.query(`
    INSERT INTO alert_rules (agency_id, name, config, is_active, notify_emails)
    SELECT a.id,
           'Crisis Score · umbral',
           jsonb_build_object(
             'type', 'crisis_threshold',
             'crisis_min', 0.40,
             'severity_min', 0.50,
             'cooldown_hours', 12
           ),
           true,
           COALESCE(rc.recipients, '[]'::jsonb)
      FROM agencies a
      LEFT JOIN report_configs rc ON rc.agency_id = a.id
     WHERE a.is_active = true
       AND COALESCE(jsonb_array_length(rc.recipients), 0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM alert_rules ar
          WHERE ar.agency_id = a.id
            AND ar.config->>'type' = 'crisis_threshold'
       );
  `);

  console.log('[metrics-calculator] crisis schema ensured');
}

// ============================================================
// Crisis alert evaluation
// ============================================================

interface CrisisRuleConfig {
  type: 'crisis_threshold';
  /** Score mínimo para disparar (default 0.40). */
  crisis_min?: number;
  /** Severidad mínima opcional (default 0). */
  severity_min?: number;
  /** Cooldown en horas (default 12). */
  cooldown_hours?: number;
}

interface CrisisRuleRow {
  id: string;
  name: string;
  config: CrisisRuleConfig;
  notify_emails: string[];
}

interface AgencyRow {
  id: string;
  slug: string;
  name: string;
}

async function evaluateCrisisAlerts(
  client: any,
  agency: AgencyRow,
  today: string,
  force: boolean,
  recipientsOverride?: string[],
): Promise<number> {
  const rulesResult = await client.query(
    `SELECT id, name, config, notify_emails
       FROM alert_rules
      WHERE agency_id = $1
        AND is_active = true
        AND config->>'type' = 'crisis_threshold'`,
    [agency.id],
  );
  const rules: CrisisRuleRow[] = rulesResult.rows;
  if (rules.length === 0) return 0;

  const snap = await getTodaySnapshot(client, agency.id, today);
  if (!snap) {
    console.log(`[crisis] ${agency.slug} no snapshot for ${today}`);
    return 0;
  }

  let fired = 0;
  for (const rule of rules) {
    const cfg = rule.config;
    const threshold = cfg.crisis_min ?? 0.4;
    const severityMin = cfg.severity_min ?? 0;
    const cooldownH = cfg.cooldown_hours ?? 12;

    const crisis = snap.crisis_risk_score ?? 0;
    const severity = snap.crisis_severity ?? 0;
    if (!force && (crisis < threshold || severity < severityMin)) {
      console.log(`[crisis] ${agency.slug} below threshold (crisis=${crisis} sev=${severity} min=${threshold}/${severityMin})`);
      continue;
    }

    if (!force) {
      const recent = await client.query(
        `SELECT triggered_at FROM alert_history
          WHERE alert_rule_id = $1 AND notification_sent = true
          ORDER BY triggered_at DESC LIMIT 1`,
        [rule.id],
      );
      const recentRows = recent.rows as Array<{ triggered_at: string }>;
      if (recentRows.length > 0) {
        const lastTs = new Date(recentRows[0].triggered_at).getTime();
        const hoursAgo = (Date.now() - lastTs) / (1000 * 60 * 60);
        if (hoursAgo < cooldownH) {
          console.log(`[crisis] ${agency.slug} cooldown active (${hoursAgo.toFixed(1)}h < ${cooldownH}h)`);
          continue;
        }
      }
    }

    const baseRecipients = Array.isArray(rule.notify_emails) ? rule.notify_emails.filter(Boolean) : [];
    const recipients = recipientsOverride && recipientsOverride.length > 0
      ? recipientsOverride
      : baseRecipients;
    if (recipients.length === 0) {
      console.warn(`[crisis] ${agency.slug} rule ${rule.id} has no recipients`);
      continue;
    }

    try {
      await fireCrisisAlert(client, agency, rule, snap, recipients, today, { previewOnly: false });
      fired++;
    } catch (err) {
      console.error(`[crisis] ${agency.slug} fire failed:`, err);
    }
  }
  return fired;
}

interface SnapshotRow {
  crisis_risk_score: number | null;
  crisis_severity: number | null;
  crisis_velocity: number | null;
  crisis_relevance: number | null;
  volume_anomaly_zscore: number | null;
  brand_health_index: number | null;
  polarization_index: number | null;
  engagement_velocity: number | null;
  total_mentions: number;
  negative_count: number;
}

async function getTodaySnapshot(client: any, agencyId: string, today: string): Promise<SnapshotRow | null> {
  const r = await client.query(
    `SELECT crisis_risk_score, crisis_severity, crisis_velocity, crisis_relevance,
            volume_anomaly_zscore, brand_health_index, polarization_index, engagement_velocity,
            total_mentions, negative_count
       FROM daily_metric_snapshots
      WHERE agency_id = $1 AND date = $2::date`,
    [agencyId, today],
  );
  const rows = r.rows as SnapshotRow[];
  return rows[0] ?? null;
}

// ============================================================
// Reglas de MÉTRICA genéricas (metric_threshold): Crisis/BHI/Polarización/
// EngVel/Anomalía de volumen sobre el snapshot diario. Misma plomería de
// cooldown + SES + alert_history que crisis_threshold. Decisión de producto:
// estandarizar el alerting en reglas de métrica.
// ============================================================
interface MetricRuleConfig {
  type: 'metric_threshold';
  metric: 'crisis' | 'bhi' | 'polarization' | 'engagement_velocity' | 'volume_anomaly';
  comparator: 'gte' | 'lte';
  threshold: number;
  cooldownHours?: number;
}

const METRIC_LABELS: Record<string, string> = {
  crisis: 'Crisis Score',
  bhi: 'Brand Health Index',
  polarization: 'Índice de Polarización',
  engagement_velocity: 'Velocidad de Engagement',
  volume_anomaly: 'Pico inusual de volumen',
};

/** Las métricas cuyo valor es un nivel interno (0 = usual) y necesitan la
 *  fila aclaratoria en el correo. */
const LEVEL_SCALE_METRICS = new Set(['engagement_velocity', 'volume_anomaly']);

/**
 * Representación pública de un valor de métrica de regla — misma capa de
 * formato que el dashboard (formatMetric). Los z-scores (velocidad de
 * engagement legacy y anomalía de volumen) no tienen display público en el
 * dash; se muestran como sigma con 1 decimal.
 */
function metricRuleDisplay(metric: MetricRuleConfig['metric'], value: number): string {
  switch (metric) {
    case 'crisis': return formatMetric('crisis', value).value ?? String(value);
    case 'bhi': return formatMetric('bhi', value).value ?? String(value);
    case 'polarization': return formatMetric('polarization', value).value ?? String(value);
    case 'engagement_velocity':
    case 'volume_anomaly': {
      // Escala interna sin unidad pública: se muestra el nivel con signo y
      // el correo aclara "0 = nivel usual" — sin σ ni jerga estadística.
      const r = Math.round(value * 10) / 10;
      return `${r > 0 ? '+' : ''}${r.toFixed(1)}`;
    }
    default: return String(value);
  }
}

function snapshotMetricValue(snap: SnapshotRow, metric: MetricRuleConfig['metric']): number | null {
  switch (metric) {
    case 'crisis': return snap.crisis_risk_score;
    case 'bhi': return snap.brand_health_index;
    case 'polarization': return snap.polarization_index;
    case 'engagement_velocity': return snap.engagement_velocity;
    case 'volume_anomaly': return snap.volume_anomaly_zscore;
    default: return null;
  }
}

function escHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

async function evaluateMetricThresholdAlerts(
  client: any,
  agency: AgencyRow,
  today: string,
  force: boolean,
  recipientsOverride?: string[],
): Promise<number> {
  const rulesResult = await client.query(
    `SELECT id, name, config, notify_emails
       FROM alert_rules
      WHERE agency_id = $1 AND is_active = true
        AND config->>'type' = 'metric_threshold'`,
    [agency.id],
  );
  const rules = rulesResult.rows as Array<{ id: string; name: string; config: MetricRuleConfig; notify_emails: string[] }>;
  if (rules.length === 0) return 0;

  const snap = await getTodaySnapshot(client, agency.id, today);
  if (!snap) return 0;

  let fired = 0;
  for (const rule of rules) {
    const cfg = rule.config;
    const value = snapshotMetricValue(snap, cfg.metric);
    if (value == null) continue;
    const meets = cfg.comparator === 'lte' ? value <= cfg.threshold : value >= cfg.threshold;
    if (!force && !meets) continue;

    const cooldownH = cfg.cooldownHours ?? 12;
    if (!force) {
      const recent = await client.query(
        `SELECT triggered_at FROM alert_history WHERE alert_rule_id = $1 AND notification_sent = true ORDER BY triggered_at DESC LIMIT 1`,
        [rule.id],
      );
      const rows = recent.rows as Array<{ triggered_at: string }>;
      if (rows.length > 0) {
        const hoursAgo = (Date.now() - new Date(rows[0].triggered_at).getTime()) / 3.6e6;
        if (hoursAgo < cooldownH) continue;
      }
    }

    const baseRecipients = Array.isArray(rule.notify_emails) ? rule.notify_emails.filter(Boolean) : [];
    const recipients = recipientsOverride && recipientsOverride.length > 0 ? recipientsOverride : baseRecipients;
    if (recipients.length === 0) continue;

    const label = METRIC_LABELS[cfg.metric] ?? cfg.metric;
    const cmp = cfg.comparator === 'lte' ? '≤' : '≥';
    // Valor y umbral en el MISMO formato numérico que el dashboard
    // ("59%", "4.6 / 10", "+2.3σ") — nunca el 0–1 crudo ni niveles verbales.
    const valStr = metricRuleDisplay(cfg.metric, value);
    const thrStr = metricRuleDisplay(cfg.metric, cfg.threshold);
    const subject = buildSubject('Alerta', agencyShortName(agency.slug), `${label} ${valStr} (${cmp} ${thrStr})`);
    const html = renderSimpleAlertHtml({
      agencyName: agency.name,
      agencyShortName: agencyShortName(agency.slug),
      ruleName: rule.name,
      detectedAtLabel: formatShortTimestamp(new Date(), REPORT_TIMEZONE),
      leadHtml: `La métrica <strong>${escHtml(label)}</strong> alcanzó <strong>${escHtml(valStr)}</strong> en la evaluación diaria del ${today}, cruzando el umbral configurado (${cmp} ${escHtml(thrStr)}).`,
      facts: [
        { label: 'Métrica', value: label },
        { label: 'Valor actual', value: valStr, color: '#C8462F' },
        { label: 'Umbral configurado', value: `${cmp} ${thrStr}` },
        ...(LEVEL_SCALE_METRICS.has(cfg.metric)
          ? [{ label: 'Referencia de la escala', value: '0 = nivel usual' }]
          : []),
        { label: 'Día evaluado', value: today },
      ],
      dashboardUrl: `${DASHBOARD_BASE_URL}/dashboard?agency=${agency.slug}`,
    });

    const sent: string[] = [];
    let firstMessageId: string | undefined;
    for (const recipient of recipients) {
      try {
        const res = await ses.send(new SendEmailCommand({
          Source: `${SES_FROM_NAME} <${SES_FROM_EMAIL}>`,
          Destination: { ToAddresses: [recipient] },
          Message: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Html: { Data: html, Charset: 'UTF-8' } } },
        }));
        sent.push(recipient);
        if (!firstMessageId) firstMessageId = res.MessageId;
      } catch (err: any) {
        console.warn(`[metric-alert] ${agency.slug} SKIPPED ${recipient}: ${err?.message ?? err}`);
      }
    }

    const details = {
      type: 'metric_threshold',
      metric: cfg.metric,
      comparator: cfg.comparator,
      threshold: cfg.threshold,
      value,
      trigger_day: today,
      recipients_sent: sent,
      message_id: firstMessageId ?? null,
    };
    await client.query(
      `INSERT INTO alert_history (alert_rule_id, agency_id, triggered_at, mention_ids, details, notification_sent, sent_at)
       VALUES ($1, $2, NOW(), '[]'::jsonb, $3::jsonb, $4, $5)`,
      [rule.id, agency.id, JSON.stringify(details), sent.length > 0, sent.length > 0 ? new Date() : null],
    );
    if (sent.length > 0) fired++;
  }
  return fired;
}

// ============================================================
// Crisis alert: build context, generate editorial, render, send
// ============================================================

async function fireCrisisAlert(
  client: any,
  agency: AgencyRow,
  rule: CrisisRuleRow,
  snap: SnapshotRow,
  recipients: string[],
  today: string,
  opts: { previewOnly: boolean } = { previewOnly: false },
): Promise<string> {
  console.log(`[crisis] ${agency.slug} firing rule ${rule.name} (score=${snap.crisis_risk_score})`);

  // 1. Contexto cuantitativo: día previo + 24h ago para delta.
  const yesterday = addDaysYmd(today, -1);
  const prev = await client.query(
    `SELECT crisis_risk_score, total_mentions, negative_count
       FROM daily_metric_snapshots
      WHERE agency_id = $1 AND date = $2::date`,
    [agency.id, yesterday],
  );
  const prevRows = prev.rows as Array<{
    crisis_risk_score: number | null;
    total_mentions: number;
    negative_count: number;
  }>;
  const prevSnap = prevRows[0] ?? null;

  // 2. Top tópicos con concentración negativa (del día detonante).
  const topicsResult = await client.query(
    `SELECT t.name AS topic,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) = 'negativo')::int AS negative,
            (COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) = 'negativo')::float
              / NULLIF(COUNT(*), 0)) AS neg_share
       FROM mentions m
       JOIN mention_topics mt ON mt.mention_id = m.id
       JOIN topics t ON t.id = mt.topic_id
      WHERE m.agency_id = $1
        AND m.is_duplicate = false
        AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date = $2::date
      GROUP BY t.id, t.name
     HAVING COUNT(*) >= 3
      ORDER BY neg_share DESC, total DESC
      LIMIT 3`,
    [agency.id, today],
  );
  const topicsRows = topicsResult.rows as Array<{
    topic: string;
    total: number;
    negative: number;
    neg_share: number;
  }>;

  // 3. Top municipios negativos.
  const muniResult = await client.query(
    `SELECT mu.name AS municipality,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) = 'negativo')::int AS negative
       FROM mentions m
       JOIN mention_municipalities mm ON mm.mention_id = m.id
       JOIN municipalities mu ON mu.id = mm.municipality_id
      WHERE m.agency_id = $1
        AND m.is_duplicate = false
        AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date = $2::date
        AND COALESCE(m.nlp_sentiment, m.bw_sentiment) = 'negativo'
      GROUP BY mu.id, mu.name
      ORDER BY negative DESC
      LIMIT 3`,
    [agency.id, today],
  );
  const muniRows = muniResult.rows as Array<{
    municipality: string;
    total: number;
    negative: number;
  }>;

  // 4. Muestra de menciones negativas para el LLM y para las voces destacadas.
  //
  // Ranking de relevancia (score híbrido):
  //
  //   score = pertinence_w × (1 + ln(1 + engagement)) × topic_w
  //
  // donde:
  //   - pertinence_w: alta=3, media=2  (baja ya está filtrada).
  //   - engagement: likes+comentarios+shares. `1 + ln(1+e)` arranca en 1
  //     (no en 0 como `ln(1+e)`) — así dos menciones con engagement=0 aún
  //     se diferencian por pertinencia y tópico. Para engagement=100 da ~5.6;
  //     para 10000 da ~10.2. Logarítmico para que un viral no aplaste a
  //     menciones pertinentes pero menos visibles.
  //   - topic_w: 3 si el tópico es el dominante del día (=topicsRows[0]),
  //     2 si está en los top-3 pero no es el dominante, 1 si no está.
  //     El boost al dominante alinea el hero con el ángulo del editorial.
  //
  // El hero se elige entre las que tienen og:image válida — pick por score
  // máximo (no por orden de aparición), así si la mención #1 en relevancia
  // no expone og pero la #3 sí, gana #3 sobre #4 aunque ambas tengan og
  // (siempre y cuando #3 > #4 en score).
  const topNegTopics = topicsRows.map((t) => t.topic);
  const dominantNegTopic = topicsRows[0]?.topic ?? null;
  const samplesResult = await client.query(
    `WITH primary_topic AS (
       SELECT mt.mention_id,
              t.name AS topic_name
         FROM mention_topics mt
         JOIN topics t ON t.id = mt.topic_id
         JOIN (
           SELECT mention_id, MAX(confidence) AS max_conf
             FROM mention_topics
            GROUP BY mention_id
         ) pk ON pk.mention_id = mt.mention_id AND pk.max_conf = mt.confidence
     ),
     scored AS (
       SELECT m.id,
              m.title, m.snippet, m.url,
              COALESCE(m.content_source_name, m.domain) AS source,
              m.page_type,
              m.nlp_pertinence AS pertinence,
              COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
              pt.topic_name AS topic,
              m.published_at,
              COALESCE(m.engagement_score, 0) AS engagement,
              (CASE m.nlp_pertinence WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END)
                * (1 + LN(1 + GREATEST(0, COALESCE(m.engagement_score, 0))))
                * (CASE
                     WHEN pt.topic_name = $4 THEN 3
                     WHEN pt.topic_name = ANY($3::text[]) THEN 2
                     ELSE 1
                   END)
                AS relevance_score
         FROM mentions m
         LEFT JOIN primary_topic pt ON pt.mention_id = m.id
        WHERE m.agency_id = $1
          AND m.is_duplicate = false
          AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date = $2::date
          AND COALESCE(m.nlp_sentiment, m.bw_sentiment) = 'negativo'
          AND COALESCE(m.nlp_pertinence, 'media') IN ('alta', 'media')
     )
     SELECT *
       FROM scored
      ORDER BY relevance_score DESC,
               -- Tiebreaker explícito por si dos menciones empatan en score.
               CASE pertinence WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
               CASE WHEN topic = $4 THEN 0
                    WHEN topic = ANY($3::text[]) THEN 1
                    ELSE 2 END,
               published_at DESC
      LIMIT 20`,
    [agency.id, today, topNegTopics, dominantNegTopic],
  );
  type SampleRow = {
    id: string;
    title: string | null;
    snippet: string | null;
    url: string | null;
    source: string | null;
    page_type: string | null;
    pertinence: string | null;
    sentiment: string | null;
    topic: string | null;
    published_at: string;
    engagement: number | string;
    relevance_score: number | string;
  };
  const sampleRows = samplesResult.rows as SampleRow[];

  const samples: MentionSample[] = sampleRows.map((r: SampleRow) => ({
    id: r.id,
    createdAt: typeof r.published_at === 'string' ? r.published_at : new Date(r.published_at).toISOString(),
    text: [r.title, r.snippet].filter(Boolean).join(' — '),
    sentiment: (r.sentiment?.startsWith('neg') ? 'negative'
              : r.sentiment?.startsWith('pos') ? 'positive'
              : 'neutral'),
    topic: r.topic,
    source: r.source,
    url: r.url,
    pageType: r.page_type,
    pertinence: (r.pertinence === 'alta' || r.pertinence === 'media' || r.pertinence === 'baja') ? r.pertinence : null,
  }));

  // 5. Banda según el score.
  const crisis = snap.crisis_risk_score ?? 0;
  const band: 'NORMAL' | 'ELEVADO' | 'ALERTA' | 'CRISIS' =
    crisis >= 0.60 ? 'CRISIS' : crisis >= 0.40 ? 'ALERTA' : crisis >= 0.25 ? 'ELEVADO' : 'NORMAL';

  // 6. Generar editorial con Bedrock tool-use.
  const editorialInputs: CrisisEditorialInputs = {
    agencyName: agency.name,
    agencyShortName: agencyShortName(agency.slug),
    generatedAtLabel: formatTimestampLabel(new Date(), REPORT_TIMEZONE),
    band,
    crisisRiskScore: snap.crisis_risk_score ?? 0,
    crisisRiskScore24hAgo: prevSnap?.crisis_risk_score ?? null,
    crisisSeverity: snap.crisis_severity ?? 0,
    crisisVelocity: snap.crisis_velocity ?? 0,
    crisisRelevance: snap.crisis_relevance ?? 0,
    volumeAnomalyZscore: snap.volume_anomaly_zscore,
    totalMentions: snap.total_mentions,
    negativeCount: snap.negative_count,
    negativeShare: snap.total_mentions > 0 ? snap.negative_count / snap.total_mentions : 0,
    prevDayTotal: prevSnap?.total_mentions ?? null,
    prevDayNegative: prevSnap?.negative_count ?? null,
    topNegativeTopics: topicsRows.map((t) => ({
      topic: t.topic,
      total: t.total,
      negative: t.negative,
      negativeShare: t.neg_share ?? 0,
    })),
    topNegativeMunicipalities: muniRows.map((m) => ({
      municipality: m.municipality,
      total: m.total,
      negative: m.negative,
    })),
    sampleMentions: samples,
  };

  const editorial = await generateCrisisEditorial(editorialInputs);

  // 7. Trend chart (últimos 14 días de crisis_risk_score) + OG images en paralelo.
  // El fetch de og:image es best-effort: cada URL tiene 3s de timeout y si no
  // hay og:image utilizable el bloque visual simplemente se omite.
  const top6 = sampleRows.slice(0, 6);
  const [trendImageUrl, ogImages] = await Promise.all([
    buildScoreTrendUrl(client, agency.id, today),
    Promise.all(top6.map((r: SampleRow) => r.url ? fetchOgImage(r.url) : Promise.resolve(null))),
  ]);
  // Pick por SCORE máximo entre las og-válidas (no por orden de aparición):
  // si la #1 en relevancia general no expone og, pero la #3 sí y la #5 también,
  // gana la de mayor relevance_score entre #3 y #5 — no la que vino primera.
  // El array ya viene ordenado DESC por score, así que el primer índice
  // ogImages[i] != null es también el de mayor score entre los og-válidos.
  const heroImageIdx = ogImages.findIndex((img) => img != null);
  const heroImageUrl = heroImageIdx >= 0 ? ogImages[heroImageIdx]! : null;
  const heroMention = heroImageIdx >= 0 ? top6[heroImageIdx] : null;
  const heroImageCaption = heroMention
    ? `Foto: ${heroMention.source ?? heroMention.page_type ?? 'fuente'} · ${formatShortTimestamp(heroMention.published_at, REPORT_TIMEZONE)}`
    : null;

  // Diagnóstico: imprime el ranking de las 6 candidatas + cuál ganó el hero.
  // Permite verificar a posteriori que la combinación score+og:image válida
  // produce la mención más relevante a la crisis. Importante porque la
  // calidad subjetiva ("¿esa foto tiene que ver con la crisis?") solo es
  // medible en backtest contra los logs.
  if (top6.length > 0) {
    const ranking = top6.map((r: SampleRow, i) => {
      const isHero = i === heroImageIdx;
      const og = ogImages[i] != null ? 'og:✓' : 'og:✗';
      const score = typeof r.relevance_score === 'string' ? Number(r.relevance_score) : r.relevance_score;
      const eng = typeof r.engagement === 'string' ? Number(r.engagement) : r.engagement;
      const topicMark = topNegTopics.includes(r.topic ?? '') ? '★' : ' ';
      return `${isHero ? '🏆' : '  '} #${i + 1} ${og} pert=${r.pertinence ?? '?'} eng=${eng} topic=${topicMark}${r.topic ?? '—'} score=${(score ?? 0).toFixed(2)} src=${r.source ?? r.page_type ?? '?'}`;
    }).join('\n');
    console.log(`[crisis] ${agency.slug} hero selection ranking:\n${ranking}`);
    if (heroMention) {
      console.log(`[crisis] ${agency.slug} hero selected: id=${heroMention.id} url=${heroMention.url} img=${heroImageUrl}`);
    } else {
      console.log(`[crisis] ${agency.slug} no hero — ninguna candidata tuvo og:image válido`);
    }
  }

  // 8. Render HTML.
  const renderData: CrisisAlertRenderData = {
    agencyName: agency.name,
    agencyShortName: agencyShortName(agency.slug),
    detectedAtLabel: formatTimestampLabel(new Date(), REPORT_TIMEZONE),
    triggerDayLabel: formatShortDay(today),
    band,
    metrics: {
      crisisRiskScore: snap.crisis_risk_score ?? 0,
      crisisRiskScore24hAgo: prevSnap?.crisis_risk_score ?? null,
      crisisSeverity: snap.crisis_severity ?? 0,
      crisisVelocity: snap.crisis_velocity ?? 0,
      crisisRelevance: snap.crisis_relevance ?? 0,
      volumeAnomalyZscore: snap.volume_anomaly_zscore,
    },
    volume: {
      totalMentions: snap.total_mentions,
      negativeCount: snap.negative_count,
      negativeShare: snap.total_mentions > 0 ? snap.negative_count / snap.total_mentions : 0,
      prevDayTotal: prevSnap?.total_mentions ?? null,
      prevDayNegative: prevSnap?.negative_count ?? null,
    },
    topNegativeTopics: editorialInputs.topNegativeTopics,
    topNegativeMunicipalities: editorialInputs.topNegativeMunicipalities,
    highlightedMentions: top6.map((r: SampleRow, i) => ({
      sourceLabel: r.source ?? r.page_type ?? 'Fuente desconocida',
      snippet: truncate(r.snippet ?? r.title ?? '', 240),
      url: r.url ?? null,
      publishedAtLabel: formatShortTimestamp(r.published_at, REPORT_TIMEZONE),
      imageUrl: ogImages[i] ?? null,
    })),
    scoreTrendImageUrl: trendImageUrl,
    heroImageUrl,
    heroImageCaption,
    editorial,
    dashboardUrl: `${DASHBOARD_BASE_URL}/dashboard?agency=${agency.slug}`,
  };

  const html = renderCrisisAlertHtml(renderData);
  // Asunto tipado: "[Crisis]" solo en banda CRISIS; el resto "[Alerta]".
  // Incluye el Crisis Score numérico (mismo formato % que el dashboard).
  const crisisValueStr = formatMetric('crisis', snap.crisis_risk_score).value ?? '—';
  const subject = buildSubject(
    band === 'CRISIS' ? 'Crisis' : 'Alerta',
    agencyShortName(agency.slug),
    `Riesgo de crisis ${crisisValueStr} — ${truncate(editorial.headline, 60)}`,
  );

  // PreviewOnly: salimos sin SES ni alert_history. Útil para iterar el template.
  if (opts.previewOnly) {
    console.log(`[crisis] ${agency.slug} previewOnly — skip SES + alert_history`);
    return html;
  }

  // 9. Enviar individual por destinatario (mismo patrón que weekly-report).
  const sent: string[] = [];
  const failed: { email: string; error: string }[] = [];
  let firstMessageId: string | undefined;
  for (const recipient of recipients) {
    try {
      const result = await ses.send(new SendEmailCommand({
        Source: `${SES_FROM_NAME} <${SES_FROM_EMAIL}>`,
        Destination: { ToAddresses: [recipient] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Html: { Data: html, Charset: 'UTF-8' } },
        },
      }));
      sent.push(recipient);
      if (!firstMessageId) firstMessageId = result.MessageId;
      console.log(`[crisis] ${agency.slug} sent to=${recipient} messageId=${result.MessageId}`);
    } catch (err: any) {
      failed.push({ email: recipient, error: String(err?.message ?? err) });
      console.warn(`[crisis] ${agency.slug} SKIPPED ${recipient}: ${err?.message ?? err}`);
    }
  }

  // 10. Log alert_history (siempre, incluso si SES falló para 0 recipients).
  const details = {
    band,
    crisis_risk_score: snap.crisis_risk_score,
    crisis_severity: snap.crisis_severity,
    crisis_velocity: snap.crisis_velocity,
    crisis_relevance: snap.crisis_relevance,
    volume_anomaly_zscore: snap.volume_anomaly_zscore,
    total_mentions: snap.total_mentions,
    negative_count: snap.negative_count,
    trigger_day: today,
    recipients_sent: sent,
    recipients_failed: failed.map((f) => f.email),
    message_id: firstMessageId ?? null,
    editorial: {
      headline: editorial.headline,
      lede: editorial.lede,
    },
  };
  const mentionIds = sampleRows.slice(0, 6).map((r: SampleRow) => r.id);
  await client.query(
    `INSERT INTO alert_history
       (alert_rule_id, agency_id, triggered_at, mention_ids, details, notification_sent, sent_at)
     VALUES ($1, $2, NOW(), $3::jsonb, $4::jsonb, $5, $6)`,
    [
      rule.id,
      agency.id,
      JSON.stringify(mentionIds),
      JSON.stringify(details),
      sent.length > 0,
      sent.length > 0 ? new Date() : null,
    ],
  );
  return html;
}

// ============================================================
// Bedrock tool-use
// ============================================================

async function generateCrisisEditorial(inputs: CrisisEditorialInputs): Promise<CrisisEditorialOutput> {
  const userPrompt = buildCrisisEditorialPrompt(inputs);
  const tool = {
    name: 'submit_crisis_editorial',
    description: 'Entrega el editorial de crisis como un objeto estructurado.',
    input_schema: {
      type: 'object',
      properties: {
        headline: { type: 'string', description: 'Titular ≤ 120 caracteres.' },
        lede: { type: 'string', description: '1–2 oraciones de apertura.' },
        bodyParagraphsHtml: {
          type: 'array',
          items: { type: 'string' },
          description: '3–4 párrafos en HTML mínimo (solo <strong>).',
        },
        representativeVoices: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              quote: { type: 'string', description: 'Paráfrasis ≤ 30 palabras, sin comillas dentro.' },
              attribution: { type: 'string', description: 'Tipo de canal · día. Ej: "Comentario en Facebook · 18 may".' },
              tone: { type: 'string', enum: ['negative', 'neutral', 'positive'] },
            },
            required: ['quote', 'attribution', 'tone'],
            additionalProperties: false,
          },
          description: 'Exactamente 3 voces representativas (parafraseadas, diferentes entre sí).',
        },
        drivers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Etiqueta ≤ 5 palabras.' },
              description: { type: 'string', description: 'Descripción 1 oración.' },
            },
            required: ['label', 'description'],
            additionalProperties: false,
          },
          description: 'Exactamente 3 drivers descriptivos.',
        },
        closing: { type: 'string', description: 'Frase de cierre contextual.' },
      },
      required: ['headline', 'lede', 'bodyParagraphsHtml', 'representativeVoices', 'drivers', 'closing'],
      additionalProperties: false,
    },
  };

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
          max_tokens: 1500,
          system: CRISIS_EDITORIAL_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
          temperature: 0,
          tools: [tool],
          tool_choice: { type: 'tool', name: tool.name },
        }),
      }));
      const body = JSON.parse(new TextDecoder().decode(response.body));
      const content: Array<{ type: string; name?: string; input?: unknown }> = body.content ?? [];
      const toolUse = content.find((b) => b.type === 'tool_use' && b.name === tool.name);
      if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) {
        throw new Error(`No tool_use block in ${modelId} response`);
      }
      const parsed = toolUse.input as Partial<CrisisEditorialOutput>;
      return {
        headline: String(parsed.headline ?? 'Alerta de crisis').slice(0, 200),
        lede: String(parsed.lede ?? ''),
        bodyParagraphsHtml: Array.isArray(parsed.bodyParagraphsHtml)
          ? parsed.bodyParagraphsHtml.filter((p): p is string => typeof p === 'string').slice(0, 4)
          : [],
        representativeVoices: Array.isArray(parsed.representativeVoices)
          ? parsed.representativeVoices
              .filter((v: any): v is { quote: string; attribution: string; tone: 'negative' | 'neutral' | 'positive' } =>
                v && typeof v.quote === 'string' && typeof v.attribution === 'string'
                && (v.tone === 'negative' || v.tone === 'neutral' || v.tone === 'positive'),
              )
              .slice(0, 3)
          : [],
        drivers: Array.isArray(parsed.drivers)
          ? parsed.drivers
              .filter((d: any): d is { label: string; description: string } =>
                d && typeof d.label === 'string' && typeof d.description === 'string',
              )
              .slice(0, 3)
          : [],
        closing: String(parsed.closing ?? ''),
      };
    } catch (err) {
      lastErr = err;
      console.warn(`[crisis] model ${modelId} failed:`, (err as Error).message);
    }
  }
  // Fallback editorial mínimo si Bedrock falla completo — el correo igual sale,
  // pero sin narrativa. Mejor un correo plano que un correo nunca.
  console.error('[crisis] editorial generation failed completely', lastErr);
  return {
    headline: `Alerta · ${inputs.agencyShortName}: indicadores de crisis elevados`,
    lede: `El Crisis Score del día (${inputs.crisisRiskScore.toFixed(2)}) supera el umbral configurado.`,
    bodyParagraphsHtml: [
      `Se registraron ${inputs.totalMentions} menciones, ${inputs.negativeCount} negativas (${Math.round(inputs.negativeShare * 100)}%).`,
    ],
    representativeVoices: [],
    drivers: [
      { label: 'Concentración negativa', description: `Severidad ${inputs.crisisSeverity.toFixed(2)}.` },
      { label: 'Velocidad', description: `Velocidad ${inputs.crisisVelocity.toFixed(2)}.` },
      { label: 'Relevancia', description: `Relevancia ${inputs.crisisRelevance.toFixed(2)}.` },
    ],
    closing: 'Editorial no disponible; revisar el dashboard para contexto completo.',
  };
}

// ============================================================
// Open Graph image fetcher
// ============================================================

/**
 * Hace best-effort scrape del `og:image` (con fallback a `twitter:image`)
 * de una URL. Timeout corto (3s) y catch-all para que un solo URL lento o
 * bloqueado no tumbe el correo. Devuelve null cuando no hay imagen utilizable.
 *
 * Limitaciones conocidas (todas se traducen en null y se omiten):
 * - URLs detrás de auth (Facebook, X protegido) — el HTML no expone og:image.
 * - URLs que bloquean User-Agent genérico (algunos CDNs antibot).
 * - URLs que devuelven SPA shell sin meta tags pre-renderizados.
 */
async function fetchOgImage(url: string, timeoutMs = 3000): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // UA "realista" para que CDNs / sitios de noticias no nos sirvan página de bot.
        'User-Agent': 'Mozilla/5.0 (compatible; ECO-Radar/1.0; +https://populicom.com)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') ?? '';
    if (!ct.toLowerCase().includes('html')) return null;

    // Lee solo los primeros 64KB del HTML — los <meta> de OG siempre van en <head>.
    // Esto evita descargar megas innecesarios en sitios pesados.
    const reader = resp.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder('utf-8');
    let html = '';
    const MAX_BYTES = 64 * 1024;
    let read = 0;
    while (read < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      read += value.length;
      if (html.includes('</head>')) break;
    }
    try { await reader.cancel(); } catch { /* ignore */ }

    // Match flexible: content antes O después de property/name.
    const patterns: RegExp[] = [
      /<meta\s+[^>]*property=["'](?:og:image(?::secure_url|:url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["']/i,
      /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["'](?:og:image(?::secure_url|:url)?|twitter:image(?::src)?)["']/i,
      /<meta\s+[^>]*name=["'](?:twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["']/i,
    ];
    let img: string | null = null;
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) { img = m[1].trim(); break; }
    }
    if (!img) return null;

    // Normaliza URLs relativas / protocol-relative.
    if (img.startsWith('//')) img = 'https:' + img;
    if (img.startsWith('/')) {
      const u = new URL(url);
      img = `${u.origin}${img}`;
    }
    if (!/^https?:\/\//i.test(img)) return null;

    // Sanity: solo extensiones / paths que parecen imágenes. Algunos sitios
    // ponen rutas tipo /favicon o /logo.svg como og:image y eso queda feo
    // en el hero. No es una validación perfecta — es heurística.
    if (img.endsWith('.svg')) return null;

    // Gmail rechaza URLs largas en su proxy de imágenes (ci3.googleusercontent.com).
    // El límite empírico está alrededor de 2KB; cortamos antes para no quemar
    // una imagen que el cliente igualmente no va a renderizar.
    if (img.length > 1500) return null;

    // Validación final: HEAD a la URL de la imagen para confirmar que es
    // realmente una imagen (no HTML, no redirect a login, no 404). Sin esto,
    // og:image apuntando a páginas autenticadas (FB / X privado / Insta) o a
    // redirects que terminan en CDN bloqueado dejaba el correo con cajas
    // grises en Gmail.
    const ok = await validateImageUrl(img, timeoutMs);
    return ok ? img : null;
  } catch {
    return null;
  }
}

/**
 * Comprueba que `url` apunte a una imagen real, mediante un HEAD request.
 * Aceptamos solo `image/(jpeg|png|webp|gif)` con tamaño razonable (≥ 1KB y
 * ≤ 8MB). Si el servidor no soporta HEAD (algunos CDNs devuelven 405),
 * caemos a un GET parcial leyendo solo la primera respuesta.
 */
async function validateImageUrl(url: string, timeoutMs: number): Promise<boolean> {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  const MIN_BYTES = 1024;
  const MAX_BYTES = 8 * 1024 * 1024;

  const checkHeaders = (resp: Response): boolean => {
    if (!resp.ok) return false;
    const ct = (resp.headers.get('content-type') ?? '').toLowerCase().split(';')[0].trim();
    if (!allowedTypes.includes(ct)) return false;
    const len = Number(resp.headers.get('content-length') ?? '0');
    if (len && (len < MIN_BYTES || len > MAX_BYTES)) return false;
    return true;
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ECO-Radar/1.0; +https://populicom.com)',
        'Accept': 'image/*',
      },
    });
    clearTimeout(timer);
    if (resp.status === 405 || resp.status === 501) {
      // Server no soporta HEAD — fallback a GET con Range request.
      return await validateViaRangeGet(url, timeoutMs);
    }
    return checkHeaders(resp);
  } catch {
    return false;
  }
}

async function validateViaRangeGet(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ECO-Radar/1.0; +https://populicom.com)',
        'Accept': 'image/*',
        // Pedimos solo los primeros 2KB — suficiente para confirmar magic bytes.
        'Range': 'bytes=0-2047',
      },
    });
    clearTimeout(timer);
    if (!resp.ok && resp.status !== 206) return false;
    const ct = (resp.headers.get('content-type') ?? '').toLowerCase().split(';')[0].trim();
    return ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'].includes(ct);
  } catch {
    return false;
  }
}

// ============================================================
// Trend chart (QuickChart)
// ============================================================

async function buildScoreTrendUrl(client: any, agencyId: string, today: string): Promise<string> {
  const result = await client.query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, crisis_risk_score
       FROM daily_metric_snapshots
      WHERE agency_id = $1 AND date <= $2::date
      ORDER BY date DESC
      LIMIT 14`,
    [agencyId, today],
  );
  const rows = (result.rows as Array<{ date: string; crisis_risk_score: number | null }>).slice().reverse();
  if (rows.length < 2) return '';

  const labels = rows.map((r) => formatShortDay(r.date));
  // Escala pública %: el eje del chart debe hablar el mismo idioma que las
  // tarjetas del correo (56%), no el 0–1 interno.
  const data = rows.map((r) => r.crisis_risk_score == null ? 0 : Math.round(r.crisis_risk_score * 100));

  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Crisis Score',
          data,
          borderColor: '#C8462F',
          backgroundColor: 'rgba(200,70,47,0.10)',
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: '#FFFFFF',
          pointBorderColor: '#C8462F',
          pointBorderWidth: 1.5,
          tension: 0.3,
          fill: true,
        },
        // Línea de umbral (banda ALERTA = 40%)
        {
          label: 'Umbral 40%',
          data: rows.map(() => 40),
          borderColor: '#8A93A0',
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      layout: { padding: { top: 8, right: 12, bottom: 4, left: 4 } },
      plugins: { legend: { display: false }, title: { display: false } },
      scales: {
        y: { beginAtZero: true, max: 100, grid: { color: '#EEF0F4', drawBorder: false },
          ticks: { font: { size: 10 }, color: '#8A93A0', padding: 6, maxTicksLimit: 5 } },
        x: { grid: { display: false, drawBorder: false },
          ticks: { font: { size: 11 }, color: '#4A5563', padding: 6 } },
      },
    },
  };
  return `https://quickchart.io/chart?v=4&w=540&h=200&bkg=white&devicePixelRatio=2&c=${encodeURIComponent(JSON.stringify(config))}`;
}

// ============================================================
// Helpers
// ============================================================

function agencyShortName(slug: string): string {
  const map: Record<string, string> = { aaa: 'AAA', ddecpr: 'DDEC' };
  return map[slug] ?? slug.toUpperCase();
}

function bandLabelEs(band: 'NORMAL' | 'ELEVADO' | 'ALERTA' | 'CRISIS'): string {
  if (band === 'CRISIS') return 'Crisis';
  if (band === 'ALERTA') return 'Alerta';
  if (band === 'ELEVADO') return 'Elevado';
  return 'Normal';
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  const clean = s.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).trimEnd() + '…';
}

const ES_MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function ymdInTimeZone(utc: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(utc).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatShortDay(ymd: string | Date): string {
  const s = typeof ymd === 'string' ? ymd : ymd.toISOString().slice(0, 10);
  const [, m, d] = s.split('-').map(Number);
  return `${d} ${ES_MONTH_SHORT[m - 1]}`;
}

function formatTimestampLabel(utc: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(utc).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const day = Number(parts.day);
  const month = ES_MONTH_SHORT[Number(parts.month) - 1] ?? '';
  const hour = Number(parts.hour);
  const minute = parts.minute ?? '00';
  const ampm = (parts.dayPeriod ?? '').toLowerCase().startsWith('p') ? 'p.m.' : 'a.m.';
  return `${day} ${month} · ${hour}:${minute} ${ampm} AST`;
}

function formatShortTimestamp(iso: string | Date, timeZone: string): string {
  const dt = typeof iso === 'string' ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(dt).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const day = Number(parts.day);
  const month = ES_MONTH_SHORT[Number(parts.month) - 1] ?? '';
  const hour = Number(parts.hour);
  const minute = parts.minute ?? '00';
  const ampm = (parts.dayPeriod ?? '').toLowerCase().startsWith('p') ? 'p.m.' : 'a.m.';
  return `${day} ${month}, ${hour}:${minute} ${ampm}`;
}

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }));
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}
