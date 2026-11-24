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
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  CRISIS_EDITORIAL_SYSTEM_PROMPT,
  buildCrisisEditorialPrompt,
  buildSubject,
  calculateMetrics,
  crisisCloseHeadline,
  crisisEpisodeDays,
  crisisEpisodePeak,
  decideCrisisEpisode,
  fetchOgImage,
  formatMetric,
  HISTORY_DAYS,
  hourInTimeZone,
  isArticlePageType,
  isExpiringImageUrl,
  isGenericImageUrl,
  loadAgencyCoverage,
  mirrorImage,
  renderCrisisAlertHtml,
  renderCrisisCloseHtml,
  renderSimpleAlertHtml,
  validateImageUrl,
  type CrisisAlertRenderData,
  type CrisisCloseRenderData,
  type CrisisEpisodeValues,
  type SimpleAlertRenderData,
  type CrisisEditorialInputs,
  type CrisisEditorialOutput,
  type DailyAggregates,
  type HistoricalSnapshot,
  type MentionSample,
} from '@eco/shared';

const sm = new SecretsManagerClient({});
const bedrock = new BedrockRuntimeClient({});
const ses = new SESClient({});
const s3 = new S3Client({});

const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1';
const BEDROCK_FALLBACK_MODEL_ID = process.env.BEDROCK_FALLBACK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'agutierrez@populicom.com';
const SES_FROM_NAME = process.env.SES_FROM_NAME ?? 'ECO Radar';
const DASHBOARD_BASE_URL = process.env.DASHBOARD_BASE_URL ?? 'https://citizenecho.com';

/**
 * Copia propia de la foto principal del correo de crisis (COR-02): se guarda
 * en `media/` del bucket crudo y la app la sirve en `/media/<clave>`, igual
 * que el processor con las imágenes de redes. Sin bucket configurado no se
 * copia nada y el correo usa la URL original del medio.
 */
const MEDIA_BUCKET = process.env.MEDIA_BUCKET ?? '';
const MEDIA_PUBLIC_BASE_URL = process.env.MEDIA_PUBLIC_BASE_URL ?? 'https://citizenecho.com/media';

const REPORT_TIMEZONE = 'America/Puerto_Rico';
/** Días que recalcula el backfill programado (sin bordes): 30 de historia + margen. */
const SCHEDULED_BACKFILL_DAYS = 45;

let dbUrl: string | null = null;
let schemaEnsured = false;

interface InvokePayload {
  /** Backfill mode (recalcula snapshots históricos). */
  backfill?: boolean;
  /**
   * Bordes del backfill (YYYY-MM-DD, inclusivos). Con el timeout de 2 min el
   * historial completo no cabe en una invocación: se recalcula por tramos, del
   * más viejo al más nuevo, porque cada día usa los 30 snapshots previos ya
   * recalculados. Con `agencySlug` se limita a esa agencia.
   */
  backfillFrom?: string;
  backfillTo?: string;
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
  /**
   * Renderiza el correo de crisis con datos reales del día y lo devuelve en
   * el body ({preview:true, html}) SIN enviar SES ni insertar alert_history
   * (a diferencia de forceCrisis, no arranca cooldown). Requiere agencySlug.
   */
  previewCrisis?: boolean;
  /**
   * Prueba de los correos de episodio (COR-02) con datos reales de la agencia:
   * 'reaviso' o 'cierre'. Usa el episodio abierto si lo hay; si no, arma uno
   * de prueba con el último aviso enviado. Con `recipientsOverride` lo ENVÍA a
   * esas direcciones; sin él devuelve el HTML ({preview:true, html}). Nunca
   * escribe en alert_history ni en crisis_episodes. Requiere agencySlug.
   */
  crisisEmail?: 'reaviso' | 'cierre';
  /**
   * Con `backfill` + `agencySlug`: tras recalcular, evalúa las reglas de
   * crisis y de métrica en los días recalculados de los últimos
   * `alertLookbackDays` (default 3), del más reciente al más viejo. Lo usa
   * scripts/import-bunker-xlsx.ts al cerrar una importación: en una agencia
   * que entra por exportes, un día en crisis puede llegar después de que el
   * barrido de cada 5 minutos ya dejó de mirarlo (solo evalúa HOY). No repite
   * un día que ya tuvo alerta enviada (alert_history.details.trigger_day).
   */
  evaluateCrisis?: boolean;
  alertLookbackDays?: number;
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
      "SELECT id, slug, name FROM agencies WHERE is_active = true ORDER BY slug",
    );
    const agencies = agenciesResult.rows as Array<{ id: string; slug: string; name: string }>;

    if (isBackfill) {
      // El cron diario llega sin bordes. Recorrer todo el historial (desde
      // ene-2025) × todas las agencias ya no cabe en los 120 s: el 23-oct-2026
      // murió tres veces por timeout y la última agencia del bucle (DF) quedó
      // con sus snapshots de may→oct sin recalcular (el 22-oct contaba 128
      // menciones de 182). Sin bordes se recalculan los últimos
      // SCHEDULED_BACKFILL_DAYS — cubre los 30 previos que usa cada día como
      // historia; el historial completo se rehace a mano por tramos.
      const backfillFrom = event.backfillFrom ?? (event.backfillTo
        ? null
        : addDaysYmd(ymdInTimeZone(new Date(), REPORT_TIMEZONE), -SCHEDULED_BACKFILL_DAYS));
      const datesResult = await client.query(
        `SELECT DISTINCT (published_at AT TIME ZONE 'America/Puerto_Rico')::date AS d
         FROM mentions
         WHERE ($1::date IS NULL OR (published_at AT TIME ZONE 'America/Puerto_Rico')::date >= $1::date)
           AND ($2::date IS NULL OR (published_at AT TIME ZONE 'America/Puerto_Rico')::date <= $2::date)
         ORDER BY d ASC`,
        [backfillFrom, event.backfillTo ?? null],
      );
      const dates = datesResult.rows.map((r: any) =>
        typeof r.d === 'string' ? r.d : r.d.toISOString().split('T')[0],
      );
      let computed = 0;
      for (const agency of agencies) {
        if (event.agencySlug && agency.slug !== event.agencySlug) continue;
        for (const date of dates) {
          await computeForAgency(client, agency.id, date);
          computed++;
        }
      }
      console.log(`[metrics-calculator] backfilled ${computed} snapshots across ${dates.length} days`);

      let alertsFired = 0;
      const agency = event.evaluateCrisis && event.agencySlug
        ? agencies.find((a) => a.slug === event.agencySlug)
        : undefined;
      if (agency) {
        const today = ymdInTimeZone(new Date(), REPORT_TIMEZONE);
        const lookback = Math.max(1, Math.min(14, event.alertLookbackDays ?? 3));
        const oldest = addDaysYmd(today, -(lookback - 1));
        const candidates = dates.filter((d: string) => d >= oldest && d <= today).sort().reverse();
        for (const day of candidates) {
          if (await alertAlreadySentForDay(client, agency.id, day)) {
            console.log(`[crisis] ${agency.slug} ${day} ya tuvo alerta enviada — no se repite`);
            continue;
          }
          try {
            alertsFired += await evaluateCrisisAlerts(client, agency, day, false, event.recipientsOverride);
          } catch (err) {
            console.error(`[crisis] ${agency.slug} ${day} evaluation failed:`, err);
          }
          try {
            alertsFired += await evaluateMetricThresholdAlerts(client, agency, day, false, event.recipientsOverride);
          } catch (err) {
            console.error(`[metric-alert] ${agency.slug} ${day} evaluation failed:`, err);
          }
          // El cooldown de la regla frena las siguientes; la alerta que sale
          // es la del día más reciente que cruzó el umbral.
          if (alertsFired > 0) break;
        }
        console.log(`[metrics-calculator] import evaluation ${agency.slug}: ${candidates.join(', ') || '(sin días)'} → ${alertsFired} alertas`);
      }
      return { statusCode: 200, body: `Backfilled ${computed} snapshots${agency ? `, ${alertsFired} alertas` : ''}` };
    }

    // Prueba de los correos de episodio: reaviso o cierre, sin escribir nada.
    if (event.crisisEmail) {
      const agency = agencies.find((a) => a.slug === event.agencySlug);
      if (!agency) {
        return { statusCode: 400, body: 'crisisEmail requiere un agencySlug válido' };
      }
      const today = ymdInTimeZone(new Date(), REPORT_TIMEZONE);
      const yesterday = addDaysYmd(today, -1);
      await computeForAgency(client, agency.id, today);
      const recipients = (event.recipientsOverride ?? []).filter(Boolean);
      const previewOnly = recipients.length === 0;
      const rule = await getCrisisRuleForTest(client, agency.id);
      const episode = (rule.id !== 'preview' ? await getOpenEpisode(client, rule.id) : null)
        ?? await simulatedEpisode(client, agency.id, today);
      let html: string;
      if (event.crisisEmail === 'cierre') {
        const closedSnap = await getTodaySnapshot(client, agency.id, yesterday);
        html = (await sendCrisisClose(client, agency, rule, episode, yesterday, closedSnap, recipients, { previewOnly, persist: false })).html;
      } else {
        const snap = await getTodaySnapshot(client, agency.id, today);
        if (!snap) return { statusCode: 404, body: `sin snapshot de ${today} para ${agency.slug}` };
        html = (await fireCrisisAlert(client, agency, rule, snap, recipients, today, { previewOnly, skipLog: true, episode })).html;
      }
      return {
        statusCode: 200,
        body: previewOnly
          ? JSON.stringify({ preview: true, html })
          : `Prueba de ${event.crisisEmail} enviada a ${recipients.length} destinatario(s)`,
      };
    }

    // Preview de crisis: render con datos reales, sin SES ni alert_history.
    if (event.previewCrisis) {
      const agency = agencies.find((a) => a.slug === event.agencySlug);
      if (!agency) {
        return { statusCode: 400, body: 'previewCrisis requiere un agencySlug válido' };
      }
      const today = ymdInTimeZone(new Date(), REPORT_TIMEZONE);
      await computeForAgency(client, agency.id, today);
      const snap = await getTodaySnapshot(client, agency.id, today);
      if (!snap) {
        return { statusCode: 404, body: `sin snapshot de ${today} para ${agency.slug}` };
      }
      const previewRule: CrisisRuleRow = { id: 'preview', name: 'preview', config: { type: 'crisis_threshold' }, notify_emails: [] };
      const { html } = await fireCrisisAlert(client, agency, previewRule, snap, [], today, { previewOnly: true });
      return { statusCode: 200, body: JSON.stringify({ preview: true, html }) };
    }

    // Modo normal: compute hoy y evalúa crisis. AYER también se recalcula
    // (solo el snapshot): Brandwatch entrega menciones de ayer hasta ~7 h
    // después de medianoche y ayer es el último día de TODAS las ventanas
    // cerradas del dashboard; sin esto quedaba con el conteo de las 23:59
    // hasta el backfill de las 5 AM (o para siempre si el backfill fallaba).
    const today = ymdInTimeZone(new Date(), REPORT_TIMEZONE);
    const yesterday = addDaysYmd(today, -1);
    let computed = 0;
    let alertsFired = 0;

    for (const agency of agencies) {
      if (event.agencySlug && agency.slug !== event.agencySlug) continue;
      await computeForAgency(client, agency.id, yesterday);
      await computeForAgency(client, agency.id, today);
      computed++;

      try {
        const fired = await evaluateCrisisAlerts(
          client,
          agency,
          today,
          event.forceCrisis === true,
          event.recipientsOverride,
          // Solo el camino normal lleva el episodio: abre, reavisa y cierra.
          { manageEpisode: true },
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
      -- V5 (oct-2026): mismo universo que loadAggregatesForWindow y que los
      -- conteos del producto (pertinencia NLP ≠ 'baja').
      AND (nlp_pertinence IS NULL OR nlp_pertinence <> 'baja')
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
  // Solo desde el inicio de la cobertura continua (coverage.ts): los snapshots
  // anteriores están en 0 porque todavía no se recolectaba, y como historia
  // inflaban el riesgo de crisis de los primeros 30 días (DF, 29–31 jul).
  const { startYmd: coverageStart } = await loadAgencyCoverage(client, agencyId);
  const result = await client.query(
    `SELECT date, total_mentions, negative_count, nss, total_reach,
            total_engagement_score, engagement_rate
     FROM daily_metric_snapshots
     WHERE agency_id = $1 AND date < $2
       AND ($3::date IS NULL OR date >= $3::date)
     ORDER BY date DESC
     LIMIT ${HISTORY_DAYS}`,
    [agencyId, today, coverageStart],
  );
  return result.rows.map((r: any) => ({
    // pg devuelve DATE como Date; la referencia larga de «lo usual» compara YYYY-MM-DD.
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
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

  // Episodios de crisis (COR-02): del primer aviso al día en que el índice
  // vuelve bajo el umbral. Un solo episodio abierto por regla.
  await client.query(`
    CREATE TABLE IF NOT EXISTS crisis_episodes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      alert_rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
      agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      opened_day DATE NOT NULL,
      first_values JSONB NOT NULL,
      first_headline TEXT,
      last_alert_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_alert_day DATE NOT NULL,
      last_values JSONB NOT NULL,
      peak_score REAL NOT NULL,
      peak_day DATE NOT NULL,
      alerts_sent INTEGER NOT NULL DEFAULT 1,
      closed_at TIMESTAMPTZ,
      closed_day DATE,
      close_values JSONB,
      close_notified BOOLEAN,
      close_details JSONB
    );
  `);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_crisis_episodes_open ON crisis_episodes(alert_rule_id) WHERE closed_at IS NULL;`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_crisis_episodes_agency ON crisis_episodes(agency_id, opened_at DESC);`);

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
  opts: { manageEpisode?: boolean } = {},
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

  // El episodio (reaviso con contexto y correo de cierre) solo se lleva en el
  // camino normal de cada 5 minutos. Las pruebas forzadas y la evaluación de
  // días pasados tras un importe avisan como antes, sin abrir ni cerrar nada.
  const manage = opts.manageEpisode === true && !force;

  let fired = 0;
  for (const rule of rules) {
    const cfg = rule.config;
    const threshold = cfg.crisis_min ?? 0.4;
    const severityMin = cfg.severity_min ?? 0;
    const cooldownH = cfg.cooldown_hours ?? 12;

    const crisis = snap.crisis_risk_score ?? 0;
    const severity = snap.crisis_severity ?? 0;
    const above = crisis >= threshold && severity >= severityMin;

    const baseRecipients = Array.isArray(rule.notify_emails) ? rule.notify_emails.filter(Boolean) : [];
    const recipients = recipientsOverride && recipientsOverride.length > 0
      ? recipientsOverride
      : baseRecipients;

    let episode: EpisodeRow | null = null;
    let kind: 'first' | 'followup' = 'first';
    if (!force) {
      episode = manage ? await getOpenEpisode(client, rule.id) : null;

      let hoursSinceLastAlert: number | null = null;
      if (above) {
        const recent = await client.query(
          `SELECT triggered_at FROM alert_history
            WHERE alert_rule_id = $1 AND notification_sent = true
            ORDER BY triggered_at DESC LIMIT 1`,
          [rule.id],
        );
        const recentRows = recent.rows as Array<{ triggered_at: string }>;
        if (recentRows.length > 0) {
          hoursSinceLastAlert = (Date.now() - new Date(recentRows[0].triggered_at).getTime()) / (1000 * 60 * 60);
        }
      }

      // Para cerrar hace falta saber cómo terminó el último día completo.
      const yesterday = addDaysYmd(today, -1);
      let closedSnap: SnapshotRow | null = null;
      let lastClosedDayAbove: boolean | null = null;
      if (episode && !above) {
        closedSnap = await getTodaySnapshot(client, agency.id, yesterday);
        lastClosedDayAbove = closedSnap
          ? (closedSnap.crisis_risk_score ?? 0) >= threshold && (closedSnap.crisis_severity ?? 0) >= severityMin
          : null;
      }

      const decision = decideCrisisEpisode({
        above,
        open: episode ? { lastAlertDay: episode.last_alert_day } : null,
        hoursSinceLastAlert,
        cooldownHours: cooldownH,
        today,
        localHour: hourInTimeZone(new Date(), REPORT_TIMEZONE),
        lastClosedDayAbove,
      });

      if (decision.action === 'none') {
        if (decision.reason === 'below-threshold') {
          console.log(`[crisis] ${agency.slug} below threshold (crisis=${crisis} sev=${severity} min=${threshold}/${severityMin})`);
        } else if (decision.reason === 'cooldown') {
          console.log(`[crisis] ${agency.slug} cooldown active (${(hoursSinceLastAlert ?? 0).toFixed(1)}h < ${cooldownH}h)`);
        } else {
          console.log(`[crisis] ${agency.slug} episodio ${episode?.id} sigue abierto (${decision.reason}; crisis=${crisis})`);
        }
        continue;
      }

      if (decision.action === 'close') {
        try {
          await sendCrisisClose(client, agency, rule, episode!, yesterday, closedSnap, recipients, { previewOnly: false, persist: true });
        } catch (err) {
          console.error(`[crisis] ${agency.slug} close failed:`, err);
        }
        continue;
      }
      kind = decision.kind;
    }

    if (recipients.length === 0) {
      console.warn(`[crisis] ${agency.slug} rule ${rule.id} has no recipients`);
      continue;
    }

    try {
      const result = await fireCrisisAlert(client, agency, rule, snap, recipients, today, {
        previewOnly: false,
        episode: kind === 'followup' ? episode : null,
      });
      fired++;
      // El episodio solo avanza con un aviso que de verdad salió.
      if (manage && result.sent > 0) {
        await recordEpisodeAlert(client, agency, rule, episode, snap, today, result.headline);
      }
    } catch (err) {
      console.error(`[crisis] ${agency.slug} fire failed:`, err);
    }
  }
  return fired;
}

// ============================================================
// Episodio de crisis (COR-02)
// ============================================================

interface EpisodeRow {
  id: string;
  opened_at: string | Date;
  /** YYYY-MM-DD, hora de PR. */
  opened_day: string;
  last_alert_at: string | Date;
  last_alert_day: string;
  first_values: CrisisEpisodeValues;
  last_values: CrisisEpisodeValues;
  peak_score: number;
  peak_day: string;
  alerts_sent: number;
  first_headline: string | null;
}

const EPISODE_COLUMNS = `id, opened_at, to_char(opened_day, 'YYYY-MM-DD') AS opened_day,
            last_alert_at, to_char(last_alert_day, 'YYYY-MM-DD') AS last_alert_day,
            first_values, last_values, peak_score, to_char(peak_day, 'YYYY-MM-DD') AS peak_day,
            alerts_sent, first_headline`;

async function getOpenEpisode(client: any, ruleId: string): Promise<EpisodeRow | null> {
  const r = await client.query(
    `SELECT ${EPISODE_COLUMNS}
       FROM crisis_episodes
      WHERE alert_rule_id = $1 AND closed_at IS NULL
      ORDER BY opened_at DESC
      LIMIT 1`,
    [ruleId],
  );
  const row = (r.rows as EpisodeRow[])[0];
  return row ? { ...row, peak_score: Number(row.peak_score), alerts_sent: Number(row.alerts_sent) } : null;
}

function episodeValues(snap: SnapshotRow, day: string): CrisisEpisodeValues {
  return {
    day,
    score: snap.crisis_risk_score ?? 0,
    severity: snap.crisis_severity,
    totalMentions: snap.total_mentions,
    negativeCount: snap.negative_count,
  };
}

/** Abre el episodio con el primer aviso o anota un reaviso en el que ya está abierto. */
async function recordEpisodeAlert(
  client: any,
  agency: AgencyRow,
  rule: CrisisRuleRow,
  episode: EpisodeRow | null,
  snap: SnapshotRow,
  today: string,
  headline: string,
): Promise<void> {
  const values = episodeValues(snap, today);
  if (!episode) {
    // ON CONFLICT: si otra invocación abrió el episodio en el mismo instante,
    // el índice único de «un abierto por regla» descarta este insert.
    await client.query(
      `INSERT INTO crisis_episodes
         (alert_rule_id, agency_id, opened_day, first_values, first_headline,
          last_alert_day, last_values, peak_score, peak_day)
       VALUES ($1, $2, $3::date, $4::jsonb, $5, $3::date, $4::jsonb, $6, $3::date)
       ON CONFLICT DO NOTHING`,
      [rule.id, agency.id, today, JSON.stringify(values), headline, values.score],
    );
    console.log(`[crisis] ${agency.slug} episodio abierto (${today}, score=${values.score})`);
    return;
  }
  const peak = crisisEpisodePeak({ score: episode.peak_score, day: episode.peak_day }, { score: values.score, day: today });
  await client.query(
    `UPDATE crisis_episodes
        SET last_alert_at = NOW(), last_alert_day = $2::date, last_values = $3::jsonb,
            alerts_sent = alerts_sent + 1, peak_score = $4, peak_day = $5::date
      WHERE id = $1`,
    [episode.id, today, JSON.stringify(values), peak.score, peak.day],
  );
  console.log(`[crisis] ${agency.slug} episodio ${episode.id}: reaviso n.º ${episode.alerts_sent + 1}`);
}

/** Regla de crisis de la agencia para las pruebas de episodio; una ficticia si no tiene. */
async function getCrisisRuleForTest(client: any, agencyId: string): Promise<CrisisRuleRow> {
  const r = await client.query(
    `SELECT id, name, config, notify_emails
       FROM alert_rules
      WHERE agency_id = $1 AND config->>'type' = 'crisis_threshold'
      ORDER BY is_active DESC, created_at ASC
      LIMIT 1`,
    [agencyId],
  );
  return (r.rows as CrisisRuleRow[])[0]
    ?? { id: 'preview', name: 'preview', config: { type: 'crisis_threshold' }, notify_emails: [] };
}

/**
 * Episodio de PRUEBA para ver el reaviso o el cierre cuando la agencia no
 * tiene uno abierto: toma el último aviso de crisis enviado como «aviso
 * anterior». Sin ninguno, usa el snapshot de ayer. No se guarda.
 */
async function simulatedEpisode(client: any, agencyId: string, today: string): Promise<EpisodeRow> {
  const r = await client.query(
    `SELECT triggered_at, details
       FROM alert_history
      WHERE agency_id = $1 AND notification_sent = true
        AND details->>'band' IS NOT NULL
        AND details->>'trigger_day' IS NOT NULL
      ORDER BY triggered_at DESC
      LIMIT 1`,
    [agencyId],
  );
  const last = (r.rows as Array<{ triggered_at: string | Date; details: any }>)[0];
  if (last) {
    const d = last.details ?? {};
    const values: CrisisEpisodeValues = {
      day: String(d.trigger_day),
      score: Number(d.crisis_risk_score ?? 0),
      severity: d.crisis_severity == null ? null : Number(d.crisis_severity),
      totalMentions: Number(d.total_mentions ?? 0),
      negativeCount: Number(d.negative_count ?? 0),
    };
    return {
      id: 'simulado', opened_at: last.triggered_at, opened_day: values.day,
      last_alert_at: last.triggered_at, last_alert_day: values.day,
      first_values: values, last_values: values,
      peak_score: values.score, peak_day: values.day,
      alerts_sent: 1, first_headline: d.editorial?.headline ?? null,
    };
  }
  const yesterday = addDaysYmd(today, -1);
  const snap = await getTodaySnapshot(client, agencyId, yesterday);
  const values: CrisisEpisodeValues = snap
    ? episodeValues(snap, yesterday)
    : { day: yesterday, score: 0, severity: null, totalMentions: 0, negativeCount: 0 };
  const openedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return {
    id: 'simulado', opened_at: openedAt, opened_day: yesterday,
    last_alert_at: openedAt, last_alert_day: yesterday,
    first_values: values, last_values: values,
    peak_score: values.score, peak_day: yesterday,
    alerts_sent: 1, first_headline: null,
  };
}

/**
 * Cierra el episodio y envía el correo de cierre. Primero RECLAMA el cierre
 * (UPDATE … WHERE closed_at IS NULL): si dos invocaciones coinciden, solo una
 * envía. Si el envío falla el episodio queda cerrado igual, con
 * `close_notified = false`: un cierre sin correo es mejor que un correo de
 * cierre repetido cada 5 minutos.
 */
async function sendCrisisClose(
  client: any,
  agency: AgencyRow,
  rule: CrisisRuleRow,
  episode: EpisodeRow,
  closedDay: string,
  closedSnap: SnapshotRow | null,
  recipients: string[],
  opts: { previewOnly: boolean; persist: boolean },
): Promise<{ html: string; sent: number }> {
  const threshold = rule.config.crisis_min ?? 0.4;
  const severityMin = rule.config.severity_min ?? 0;

  if (opts.persist) {
    const claimed = await client.query(
      `UPDATE crisis_episodes SET closed_at = NOW(), closed_day = $2::date
        WHERE id = $1 AND closed_at IS NULL
        RETURNING id`,
      [episode.id, closedDay],
    );
    if (claimed.rows.length === 0) {
      console.log(`[crisis] ${agency.slug} episodio ${episode.id} ya estaba cerrado — no se repite el correo`);
      return { html: '', sent: 0 };
    }
  }

  // La lectura más alta: la mayor entre las de los avisos y los días ya
  // cerrados del episodio (un día puede terminar más alto que a la hora del aviso).
  const peakResult = await client.query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, crisis_risk_score
       FROM daily_metric_snapshots
      WHERE agency_id = $1 AND date BETWEEN $2::date AND $3::date
        AND crisis_risk_score IS NOT NULL
      ORDER BY crisis_risk_score DESC, date ASC
      LIMIT 1`,
    [agency.id, episode.opened_day, closedDay],
  );
  const dayPeak = (peakResult.rows as Array<{ date: string; crisis_risk_score: number }>)[0];
  let peak = { score: episode.peak_score, day: episode.peak_day };
  if (dayPeak) peak = crisisEpisodePeak(peak, { score: Number(dayPeak.crisis_risk_score), day: dayPeak.date });

  const closeValues = {
    day: closedDay,
    score: closedSnap?.crisis_risk_score ?? null,
    severity: closedSnap?.crisis_severity ?? null,
    totalMentions: closedSnap?.total_mentions ?? 0,
    negativeCount: closedSnap?.negative_count ?? 0,
  };
  const daysOpen = crisisEpisodeDays(episode.opened_day, closedDay);
  const renderData: CrisisCloseRenderData = {
    agencyName: agency.name,
    agencyShortName: agencyShortName(agency.slug),
    closedAtLabel: formatTimestampLabel(new Date(), REPORT_TIMEZONE),
    openedAtLabel: formatShortTimestamp(episode.opened_at, REPORT_TIMEZONE),
    daysOpen,
    alertsSent: episode.alerts_sent,
    closedDay: {
      dayLabel: formatShortDay(closedDay),
      score: closeValues.score,
      severity: closeValues.severity,
      totalMentions: closeValues.totalMentions,
      negativeCount: closeValues.negativeCount,
    },
    peak: { score: peak.score, dayLabel: formatShortDay(peak.day) },
    threshold,
    severityMin,
    firstHeadline: episode.first_headline,
    scoreTrend: await loadScoreTrend(client, agency.id, closedDay),
    dashboardUrl: crisisViewUrl(agency.slug),
  };
  const html = renderCrisisCloseHtml(renderData);
  const closeScoreStr = closeValues.score == null ? 'sin lectura' : `riesgo de crisis ${formatMetric('crisis', closeValues.score).value ?? '—'}`;
  const subject = buildSubject(
    'Alerta',
    agencyShortName(agency.slug),
    `${crisisCloseHeadline()} — ${closeScoreStr} el ${formatShortDay(closedDay)}`,
  );

  if (opts.previewOnly) {
    console.log(`[crisis] ${agency.slug} cierre previewOnly — skip SES`);
    return { html, sent: 0 };
  }

  const sent: string[] = [];
  const failed: string[] = [];
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
      console.log(`[crisis] ${agency.slug} cierre sent to=${recipient} messageId=${result.MessageId}`);
    } catch (err: any) {
      failed.push(recipient);
      console.warn(`[crisis] ${agency.slug} cierre SKIPPED ${recipient}: ${err?.message ?? err}`);
    }
  }

  if (opts.persist) {
    await client.query(
      `UPDATE crisis_episodes
          SET close_values = $2::jsonb, close_notified = $3, close_details = $4::jsonb
        WHERE id = $1`,
      [
        episode.id,
        JSON.stringify(closeValues),
        sent.length > 0,
        JSON.stringify({
          days_open: daysOpen,
          peak_score: peak.score,
          peak_day: peak.day,
          recipients_sent: sent,
          recipients_failed: failed,
          message_id: firstMessageId ?? null,
        }),
      ],
    );
    console.log(`[crisis] ${agency.slug} episodio ${episode.id} cerrado (${closedDay}, ${daysOpen} día(s), ${episode.alerts_sent} aviso(s))`);
  }
  return { html, sent: sent.length };
}

/**
 * Vista de crisis de la agencia: el Overview con el detalle de «Riesgo de
 * crisis» ya abierto (`ver=crisis`, que la aplicación consume y quita de la URL).
 */
function crisisViewUrl(slug: string): string {
  return `${DASHBOARD_BASE_URL}/overview?agency=${encodeURIComponent(slug)}&ver=crisis`;
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

/** ¿Ya salió una alerta (enviada) de esta agencia por este día? */
async function alertAlreadySentForDay(client: any, agencyId: string, day: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM alert_history
      WHERE agency_id = $1 AND notification_sent = true
        AND details->>'trigger_day' = $2
      LIMIT 1`,
    [agencyId, day],
  );
  return r.rows.length > 0;
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

/**
 * Medidor del correo de alerta de métrica: solo para las métricas con escala
 * acotada (crisis y polarización 0–100 %, salud de marca 1–10). Las de nivel
 * sin unidad pública (velocidad, anomalía de volumen) no llevan medidor.
 */
function metricGauge(
  metric: MetricRuleConfig['metric'],
  value: number,
  threshold: number,
  caption: string,
  valueLabel: string,
  thresholdLabel: string,
): SimpleAlertRenderData['gauge'] {
  const frac = (v: number) => {
    switch (metric) {
      case 'crisis': return v;          // crudo 0–1
      case 'bhi': return v;             // crudo 0–1 (se muestra 1–10)
      case 'polarization': return v / 100; // crudo 0–100
      default: return null;
    }
  };
  const f = frac(value);
  const tf = frac(threshold);
  if (f == null || tf == null) return null;
  const [scaleStart, scaleEnd] = metric === 'bhi' ? ['1', '10'] : ['0%', '100%'];
  return { valueLabel, caption, fraction: f, thresholdFraction: tf, scaleStart, scaleEnd, thresholdLabel: `umbral ${thresholdLabel}` };
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
      variant: 'metric',
      leadHtml: `La métrica <strong>${escHtml(label)}</strong> alcanzó <strong>${escHtml(valStr)}</strong> en la evaluación diaria del ${escHtml(formatShortDay(today))}, cruzando el umbral configurado (${cmp} ${escHtml(thrStr)}).`,
      gauge: metricGauge(cfg.metric, value, cfg.threshold, `${label} · umbral ${cmp} ${thrStr}`, valStr, thrStr),
      facts: [
        { label: 'Métrica', value: label },
        { label: 'Valor actual', value: valStr, tone: 'warn', mono: true },
        { label: 'Umbral configurado', value: `${cmp} ${thrStr}`, mono: true },
        ...(LEVEL_SCALE_METRICS.has(cfg.metric)
          ? [{ label: 'Referencia de la escala', value: '0 = nivel usual' }]
          : []),
        { label: 'Día evaluado', value: formatShortDay(today), mono: true },
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
  opts: {
    previewOnly: boolean;
    /** Episodio abierto: el correo sale como REAVISO, con su contexto. */
    episode?: EpisodeRow | null;
    /** Envía pero no escribe alert_history (pruebas de episodio). */
    skipLog?: boolean;
  } = { previewOnly: false },
): Promise<{ html: string; sent: number; headline: string }> {
  const episode = opts.episode ?? null;
  console.log(`[crisis] ${agency.slug} firing rule ${rule.name} (score=${snap.crisis_risk_score}${episode ? `, reaviso del episodio ${episode.id}` : ''})`);

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

  // 1b. Display del tile "Velocidad" (ago 2026): cambio % del volumen de HOY
  // vs el promedio de los 7 días previos AL MISMO CORTE HORARIO. La alerta
  // dispara a media jornada con el día parcial — comparar contra días
  // completos daría un negativo enorme en plena crisis, y comparar sin corte
  // contra días pre-onboarding (snapshots en cero) inflaría el %. Por eso:
  //   - cada día previo se cuenta solo hasta la hora actual PR ($3::time),
  //   - solo promedian días con ingesta real (full_cnt > 0),
  //   - mínimo 3 días válidos y promedio ≥ 3 menciones para publicar el %.
  // La crisisVelocity interna (clamp del z-score 30d) sigue viva dentro del
  // crisis_risk_score; aquí solo cambia lo que se MUESTRA.
  const nowTimePR = new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date());
  const avg7Result = await client.query(
    `WITH days AS (
       SELECT d::date AS day
         FROM generate_series(($2::date - 7)::timestamp, ($2::date - 1)::timestamp, interval '1 day') d
     ),
     counts AS (
       SELECT dy.day,
              COUNT(m.id) FILTER (WHERE (m.published_at AT TIME ZONE 'America/Puerto_Rico')::time <= $3::time)::int AS partial_cnt,
              COUNT(m.id)::int AS full_cnt
         FROM days dy
         LEFT JOIN mentions m
           ON m.agency_id = $1
          AND m.is_duplicate = false
          AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
          AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date = dy.day
        GROUP BY dy.day
     )
     SELECT (AVG(partial_cnt) FILTER (WHERE full_cnt > 0))::float AS avg_partial,
            (COUNT(*) FILTER (WHERE full_cnt > 0))::int AS days
       FROM counts`,
    [agency.id, today, nowTimePR],
  );
  const avg7Row = avg7Result.rows[0] as { avg_partial: number | null; days: number } | undefined;
  const avg7 = avg7Row?.avg_partial != null && avg7Row.days >= 3 ? Number(avg7Row.avg_partial) : null;
  const volumeVsAvg7Pct = avg7 != null && avg7 >= 3
    ? Math.round(((snap.total_mentions - avg7) / avg7) * 100)
    : null;

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
        AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
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
        AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
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
              m.resolved_image_url,
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
          AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
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
    resolved_image_url: string | null;
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
    triggerDay: today,
    band,
    crisisRiskScore: snap.crisis_risk_score ?? 0,
    crisisRiskScore24hAgo: prevSnap?.crisis_risk_score ?? null,
    crisisSeverity: snap.crisis_severity ?? 0,
    volumeVsAvg7Pct,
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
    episode: episode
      ? {
          alertNumber: episode.alerts_sent + 1,
          openedDay: episode.opened_day,
          daysOpen: crisisEpisodeDays(episode.opened_day, today),
          previousDay: episode.last_values.day,
          previousScore: episode.last_values.score,
        }
      : null,
  };

  const editorial = await generateCrisisEditorial(editorialInputs);

  // 7. Trend chart (últimos 14 días de crisis_risk_score) + imágenes en paralelo.
  //
  // Dos reglas, aprendidas a golpes (ago–sep 2026: el logo de Instagram fue
  // la foto principal de 10 de 20 correos de crisis):
  //
  //   - El og:image SOLO se pide a noticias/blogs/foros. Instagram, Facebook
  //     y X le sirven a un visitante sin sesión su imagen de marca, que es un
  //     PNG real y pasaba la validación. Para redes usamos la imagen del post
  //     que el processor ya resolvió desde Brandwatch (`resolved_image_url`).
  //   - La foto principal es la foto de una NOTICIA: se elige entre las 20
  //     candidatas (no solo las 6 visibles), en orden de relevancia, y solo
  //     entre las de tipo artículo. Si ninguna tiene foto, el bloque se omite.
  //
  // Todo es best-effort: cada URL tiene 3s de timeout y un null se omite.
  const top6 = sampleRows.slice(0, 6);
  const imageCache = new Map<string, Promise<string | null>>();
  const imageForRow = (r: SampleRow): Promise<string | null> => {
    const cached = imageCache.get(r.id);
    if (cached) return cached;
    const p = (async () => {
      const stored = r.resolved_image_url;
      const storedOk = !!stored && /^https?:\/\//i.test(stored) && !isGenericImageUrl(stored);
      if (isArticlePageType(r.page_type)) {
        if (storedOk && await validateImageUrl(stored!)) return stored!;
        return r.url ? fetchOgImage(r.url) : null;
      }
      // Redes: nunca og:image de la plataforma; solo la media del propio post.
      if (storedOk && await validateImageUrl(stored!)) return stored!;
      return null;
    })().catch(() => null);
    imageCache.set(r.id, p);
    return p;
  };
  //
  // COR-02 (nov 2026): las candidatas a foto principal ya no salen de las 20
  // de la muestra. Esa muestra ordena por interacción y una noticia casi no
  // tiene (engagement 0), así que en agencias con mucha conversación en redes
  // (DF) ninguna nota entraba y el correo salía sin foto aunque hubiera notas
  // con foto ese día. Ahora se buscan aparte las NOTAS del episodio.
  const heroCandidates = await loadHeroCandidates(client, agency.id, today, topNegTopics, dominantNegTopic, sampleRows);
  const [scoreTrend, ogImages, heroImages] = await Promise.all([
    loadScoreTrend(client, agency.id, today),
    Promise.all(top6.map(imageForRow)),
    Promise.all(heroCandidates.map(imageForRow)),
  ]);
  // heroCandidates viene en orden de preferencia: gana la primera nota con
  // foto utilizable. La foto se sirve desde nuestra copia en S3; si la URL de
  // origen caduca (CDN de Meta) y no se pudo copiar, esa nota se salta: una
  // foto que se rompe a los cinco días es peor que la siguiente candidata.
  let heroCandidateIdx = -1;
  let heroImageUrl: string | null = null;
  for (let i = 0; i < heroCandidates.length && heroImageUrl == null; i++) {
    const img = heroImages[i];
    if (!img) continue;
    const own = await ownImageCopy(img);
    if (!own && isExpiringImageUrl(img)) continue;
    heroCandidateIdx = i;
    heroImageUrl = own ?? img;
  }
  const heroMention = heroCandidateIdx >= 0 ? heroCandidates[heroCandidateIdx]! : null;
  const heroImageIdx = heroMention ? top6.findIndex((r) => r.id === heroMention.id) : -1;
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
      console.log(`[crisis] ${agency.slug} no hero — ninguna noticia/blog candidata (${heroCandidates.length}) tuvo foto utilizable`);
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
      volumeVsAvg7Pct,
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
    scoreTrend,
    // Umbral de la banda ALERTA en escala pública (el de la línea del gráfico).
    scoreThreshold: 40,
    heroImageUrl,
    heroImageCaption,
    editorial,
    episode: episode
      ? {
          alertNumber: episode.alerts_sent + 1,
          openedAtLabel: formatShortTimestamp(episode.opened_at, REPORT_TIMEZONE),
          daysOpen: crisisEpisodeDays(episode.opened_day, today),
          previousAtLabel: formatShortTimestamp(episode.last_alert_at, REPORT_TIMEZONE),
          previous: {
            dayLabel: formatShortDay(episode.last_values.day),
            score: episode.last_values.score,
            totalMentions: episode.last_values.totalMentions,
            negativeCount: episode.last_values.negativeCount,
          },
          current: {
            dayLabel: formatShortDay(today),
            score: snap.crisis_risk_score ?? 0,
            totalMentions: snap.total_mentions,
            negativeCount: snap.negative_count,
          },
          peak: (() => {
            const pk = crisisEpisodePeak(
              { score: episode.peak_score, day: episode.peak_day },
              { score: snap.crisis_risk_score ?? 0, day: today },
            );
            return { score: pk.score, dayLabel: formatShortDay(pk.day) };
          })(),
        }
      : null,
    // Vista de crisis de la agencia (COR-02): Overview con el detalle abierto.
    dashboardUrl: crisisViewUrl(agency.slug),
  };

  const html = renderCrisisAlertHtml(renderData);
  // Asunto tipado: "[Crisis]" solo en banda CRISIS; el resto "[Alerta]".
  // Incluye el Crisis Score numérico (mismo formato % que el dashboard).
  const crisisValueStr = formatMetric('crisis', snap.crisis_risk_score).value ?? '—';
  const subject = buildSubject(
    band === 'CRISIS' ? 'Crisis' : 'Alerta',
    agencyShortName(agency.slug),
    episode
      ? `Reaviso n.º ${episode.alerts_sent + 1} · riesgo de crisis ${crisisValueStr} — ${truncate(editorial.headline, 60)}`
      : `Riesgo de crisis ${crisisValueStr} — ${truncate(editorial.headline, 60)}`,
  );

  // PreviewOnly: salimos sin SES ni alert_history. Útil para iterar el template.
  if (opts.previewOnly) {
    console.log(`[crisis] ${agency.slug} previewOnly — skip SES + alert_history`);
    return { html, sent: 0, headline: editorial.headline };
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

  if (opts.skipLog) {
    console.log(`[crisis] ${agency.slug} prueba de episodio — skip alert_history`);
    return { html, sent: sent.length, headline: editorial.headline };
  }

  // 10. Log alert_history (siempre, incluso si SES falló para 0 recipients).
  const details = {
    band,
    kind: episode ? 'followup' : 'first',
    episode_id: episode?.id ?? null,
    hero_image: heroImageUrl ?? null,
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
  return { html, sent: sent.length, headline: editorial.headline };
}

/**
 * Notas candidatas a foto principal, en orden de preferencia.
 *
 * Entran noticias, blogs y foros del día detonante y del anterior (una alerta
 * de la mañana suele venir de la nota de anoche) que sean negativas, o que
 * traten uno de los temas negativos del día sin ser positivas. Orden: primero
 * las del día detonante, las negativas, las más pertinentes, las del tema
 * dominante, las que ya tienen imagen guardada y, al final, las más recientes.
 *
 * Las notas que ya venían en la muestra van primero, en su orden, para no
 * cambiar la foto en los casos que ya funcionaban.
 */
async function loadHeroCandidates<R extends { id: string; page_type: string | null; url: string | null; resolved_image_url: string | null; source: string | null; published_at: string }>(
  client: any,
  agencyId: string,
  today: string,
  topNegTopics: string[],
  dominantNegTopic: string | null,
  sampleRows: R[],
): Promise<R[]> {
  const fromSample = sampleRows.filter((r) => isArticlePageType(r.page_type)).slice(0, 8);
  let extra: R[] = [];
  try {
    const result = await client.query(
      `WITH cand AS (
         SELECT m.id, m.title, m.snippet, m.url,
                COALESCE(m.content_source_name, m.domain) AS source,
                m.page_type, m.resolved_image_url,
                m.nlp_pertinence AS pertinence,
                COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
                m.published_at,
                COALESCE(m.engagement_score, 0) AS engagement,
                0::float AS relevance_score,
                (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date AS pr_day,
                (SELECT t.name
                   FROM mention_topics mt
                   JOIN topics t ON t.id = mt.topic_id
                  WHERE mt.mention_id = m.id
                  ORDER BY mt.confidence DESC NULLS LAST
                  LIMIT 1) AS topic
           FROM mentions m
          WHERE m.agency_id = $1
            AND m.is_duplicate = false
            AND COALESCE(m.nlp_pertinence, 'media') IN ('alta', 'media')
            AND LOWER(m.page_type) IN ('news', 'blog', 'forum')
            AND m.url IS NOT NULL
            AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date BETWEEN ($2::date - 1) AND $2::date
       )
       SELECT *
         FROM cand
        WHERE sentiment = 'negativo'
           OR (topic = ANY($3::text[]) AND COALESCE(sentiment, '') <> 'positivo')
        ORDER BY (pr_day = $2::date) DESC,
                 (sentiment = 'negativo') DESC,
                 CASE pertinence WHEN 'alta' THEN 0 ELSE 1 END,
                 CASE WHEN topic = $4 THEN 0 WHEN topic = ANY($3::text[]) THEN 1 ELSE 2 END,
                 (resolved_image_url IS NOT NULL) DESC,
                 published_at DESC
        LIMIT 12`,
      [agencyId, today, topNegTopics, dominantNegTopic],
    );
    extra = result.rows as R[];
  } catch (err) {
    // La foto nunca tumba el correo: sin candidatas extra se usa la muestra.
    console.warn('[crisis] hero candidates query failed:', err);
  }
  const seen = new Set(fromSample.map((r) => r.id));
  const merged = [...fromSample];
  for (const r of extra) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r);
  }
  return merged.slice(0, 12);
}

/**
 * Copia la imagen a `media/` y devuelve la URL propia; null si no hay bucket
 * configurado o la copia falló (el caller decide si usa la original).
 */
async function ownImageCopy(url: string): Promise<string | null> {
  if (url.startsWith(MEDIA_PUBLIC_BASE_URL)) return url;
  if (!MEDIA_BUCKET) return null;
  return mirrorImage(url, {
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
  }).catch(() => null);
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
  // pero sin narrativa. Mejor un correo plano que un correo nunca. Números en
  // escala pública % (misma regla que el prompt) — nunca el 0–1 interno.
  console.error('[crisis] editorial generation failed completely', lastErr);
  const pubPct = (n: number) => `${Math.round(n * 100)}%`;
  return {
    headline: `Alerta · ${inputs.agencyShortName}: indicadores de crisis elevados`,
    lede: `El riesgo de crisis del día (${pubPct(inputs.crisisRiskScore)}) supera el umbral configurado.`,
    bodyParagraphsHtml: [
      `Se registraron ${inputs.totalMentions} menciones, ${inputs.negativeCount} negativas (${pubPct(inputs.negativeShare)}).`,
    ],
    representativeVoices: [],
    drivers: [
      { label: 'Concentración negativa', description: `Severidad de ${pubPct(inputs.crisisSeverity)} en la conversación del día.` },
      { label: 'Volumen del día', description: inputs.volumeVsAvg7Pct == null
          ? `${inputs.totalMentions} menciones en el día detonante.`
          : `${inputs.totalMentions} menciones, ${inputs.volumeVsAvg7Pct > 0 ? '+' : ''}${inputs.volumeVsAvg7Pct}% vs el promedio de los 7 días previos a esta hora.` },
      { label: 'Riesgo de crisis', description: `Score del día en ${pubPct(inputs.crisisRiskScore)}.` },
    ],
    closing: 'Editorial no disponible; revisar el dashboard para contexto completo.',
  };
}

// ============================================================
// Evolución del Crisis Score (datos para el gráfico en tablas HTML)
// ============================================================

/**
 * Crisis Score de los últimos 14 días en escala pública 0–100 (la misma de
 * las tarjetas del correo: 56%, no el 0–1 interno), del más viejo al más
 * nuevo. El correo lo dibuja con tablas HTML; con menos de 2 puntos se oculta.
 */
async function loadScoreTrend(client: any, agencyId: string, today: string): Promise<Array<{ label: string; score: number }>> {
  const result = await client.query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, crisis_risk_score
       FROM daily_metric_snapshots
      WHERE agency_id = $1 AND date <= $2::date
      ORDER BY date DESC
      LIMIT 14`,
    [agencyId, today],
  );
  const rows = (result.rows as Array<{ date: string; crisis_risk_score: number | null }>).slice().reverse();
  return rows.map((r) => ({
    label: formatShortDay(r.date),
    score: r.crisis_risk_score == null ? 0 : Math.round(Number(r.crisis_risk_score) * 100),
  }));
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
