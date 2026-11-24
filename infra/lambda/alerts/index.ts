/**
 * eco-alerts Lambda — alertas de REGLAS por mención (SQS).
 *
 * Evalúa las reglas configuradas en `alert_rules` (sentimiento negativo,
 * keyword, pico de volumen) contra cada mención encolada por el processor y
 * envía el correo de alerta con el template compartido de @eco/shared
 * (render-simple-alert): asunto "[Alerta] SIGLAS · regla", etiqueta ámbar,
 * datos clave en números y la mención que la detonó (con su imagen si trae).
 *
 * (Las alertas de crisis y de umbral de métrica viven en
 * eco-metrics-calculator — mismos chrome y convención de asunto.)
 */
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import type { SQSEvent } from 'aws-lambda';
import {
  buildSubject,
  fetchOgImage,
  formatUpdatedAtLabel,
  isArticlePageType,
  isGenericImageUrl,
  renderSimpleAlertHtml,
  validateImageUrl,
  type SimpleAlertRenderData,
  inCooldown,
  keywordList,
  mentionRuleCooldownHours,
  negativeShareParams,
  negativeShareTriggered,
  volumeSpikeParams,
} from '@eco/shared';

const ses = new SESClient({});
const sm = new SecretsManagerClient({});

const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'alerts@citizenecho.com';
const SES_FROM_NAME = process.env.SES_FROM_NAME ?? 'ECO Radar';
const DASHBOARD_BASE_URL = process.env.DASHBOARD_BASE_URL ?? 'https://citizenecho.com';
const ALERT_TIMEZONE = 'America/Puerto_Rico';

let dbUrl: string | null = null;

interface AlertMessage {
  mentionId: string;
  agencyId: string;
  sentiment: string;
  emotions: string[];
  topics: Array<{ topic_slug: string; subtopic_slug: string | null; confidence: number }>;
  publishedAt: string;
}

export const handler = async (event: SQSEvent): Promise<void> => {
  console.log(`Alerts handler processing ${event.Records.length} records`);

  if (!dbUrl) {
    dbUrl = await getDatabaseUrl();
  }

  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    for (const record of event.Records) {
      const alert: AlertMessage = JSON.parse(record.body);
      await evaluateAlertRules(client, alert);
    }
  } finally {
    await client.end();
  }
};

function agencyShortName(slug: string): string {
  const map: Record<string, string> = { aaa: 'AAA', ddecpr: 'DDEC' };
  return map[slug] ?? slug.toUpperCase();
}

function sentimentEs(s: string): string {
  if (s === 'negativo') return 'Negativo';
  if (s === 'positivo') return 'Positivo';
  if (s === 'neutral') return 'Neutral';
  return s;
}

async function evaluateAlertRules(pgClient: any, alert: AlertMessage): Promise<void> {
  // Agencia (siglas + nombre) para el asunto y el header del correo.
  const agencyRes = await pgClient.query(
    'SELECT slug, name FROM agencies WHERE id = $1',
    [alert.agencyId],
  );
  const agency = agencyRes.rows[0] ?? { slug: 'eco', name: 'ECO' };

  // Fetch active alert rules for this agency
  const rulesResult = await pgClient.query(
    'SELECT id, name, config, notify_emails FROM alert_rules WHERE agency_id = $1 AND is_active = true',
    [alert.agencyId],
  );

  for (const rule of rulesResult.rows) {
    const config = rule.config;
    let shouldTrigger = false;
    // Contexto del pico de volumen para las filas de "Datos clave".
    let volumeContext: { count: number; threshold: number; windowMinutes: number } | null = null;
    let negativeContext: { total: number; negative: number; thresholdPct: number; windowHours: number } | null = null;

    // Solo los tres tipos por mención se evalúan aquí; las reglas de métrica y
    // de crisis las lleva eco-metrics-calculator.
    if (config?.type !== 'negative_sentiment' && config?.type !== 'keyword' && config?.type !== 'volume_spike') continue;

    // Cooldown (COR-04): sin él, una regla mandaba un correo por cada mención
    // mientras la condición siguiera cumpliéndose. Se mira ANTES de evaluar
    // para no gastar consultas en una regla que no puede avisar todavía.
    const lastResult = await pgClient.query(
      'SELECT MAX(triggered_at) AS last FROM alert_history WHERE alert_rule_id = $1',
      [rule.id],
    );
    const last = lastResult.rows[0]?.last ? new Date(lastResult.rows[0].last) : null;
    if (inCooldown(last, new Date(), mentionRuleCooldownHours(config))) continue;

    switch (config.type) {
      case 'negative_sentiment': {
        // Proporción negativa de la ventana, no «cualquier mención negativa»:
        // solo se mide cuando la que acaba de llegar es negativa.
        if (alert.sentiment !== 'negativo') break;
        const { thresholdPct, windowHours } = negativeShareParams(config);
        const shareResult = await pgClient.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE COALESCE(nlp_sentiment, bw_sentiment) = 'negativo')::int AS negative
             FROM mentions
            WHERE agency_id = $1
              AND is_duplicate = false
              AND (nlp_pertinence IS NULL OR nlp_pertinence <> 'baja')
              AND published_at >= NOW() - ($2::int * INTERVAL '1 hour')`,
          [alert.agencyId, Math.round(windowHours)],
        );
        const total = Number(shareResult.rows[0]?.total ?? 0);
        const negative = Number(shareResult.rows[0]?.negative ?? 0);
        shouldTrigger = negativeShareTriggered(total, negative, thresholdPct);
        negativeContext = { total, negative, thresholdPct, windowHours };
        break;
      }

      case 'keyword': {
        // Check if any keyword appears in topic slugs or the mention
        const mentionResult = await pgClient.query(
          'SELECT title, snippet FROM mentions WHERE id = $1',
          [alert.mentionId],
        );
        if (mentionResult.rows.length > 0) {
          const text = `${mentionResult.rows[0].title ?? ''} ${mentionResult.rows[0].snippet ?? ''}`.toLowerCase();
          shouldTrigger = keywordList(config).some((kw) => text.includes(kw));
          if (config.sentiment) {
            shouldTrigger = shouldTrigger && alert.sentiment === config.sentiment;
          }
        }
        break;
      }

      case 'volume_spike': {
        // Count mentions in the configured time window
        // Una regla mal formada (umbral que no es número) no dispara nunca.
        const spike = volumeSpikeParams(config);
        if (!spike) break;
        const windowMinutes = spike.windowMinutes;
        const windowMs = windowMinutes * 60 * 1000;
        const windowStart = new Date(Date.now() - windowMs).toISOString();
        const countResult = await pgClient.query(
          'SELECT COUNT(*) as cnt FROM mentions WHERE agency_id = $1 AND published_at >= $2',
          [alert.agencyId, windowStart],
        );
        const count = parseInt(countResult.rows[0].cnt, 10);
        const threshold = spike.threshold;
        shouldTrigger = count >= threshold;
        volumeContext = { count, threshold, windowMinutes };
        break;
      }
    }

    if (shouldTrigger) {
      console.log(`Alert rule "${rule.name}" triggered for mention ${alert.mentionId}`);

      // Record alert in history
      await pgClient.query(
        `INSERT INTO alert_history (alert_rule_id, agency_id, triggered_at, mention_ids, details, notification_sent, sent_at)
         VALUES ($1, $2, NOW(), $3, $4, true, NOW())`,
        [
          rule.id,
          alert.agencyId,
          JSON.stringify([alert.mentionId]),
          JSON.stringify({ sentiment: alert.sentiment, emotions: alert.emotions, topics: alert.topics }),
        ],
      );

      // Send email notification
      const emails: string[] = rule.notify_emails ?? [];
      if (emails.length > 0) {
        const mentionResult = await pgClient.query(
          `SELECT title, snippet, url, nlp_summary, content_source_name, domain, page_type,
                  resolved_image_url, published_at
             FROM mentions WHERE id = $1`,
          [alert.mentionId],
        );
        const mention = mentionResult.rows[0];
        const mentionImage = mention ? await mentionImageUrl(mention) : null;

        const topicNames = alert.topics
          .map((t) => t.topic_slug.replace(/-/g, ' '))
          .join(', ');

        const html = renderSimpleAlertHtml(
          buildRuleAlertRenderData(agency, rule.name, config, alert, mention, mentionImage, topicNames, volumeContext, negativeContext),
        );
        const subject = buildSubject('Alerta', agencyShortName(agency.slug), rule.name);

        // Envío individual por destinatario: en SES sandbox una dirección no
        // verificada tumba el mensaje entero si va en TO compartido (mismo
        // patrón que weekly-report y metrics-calculator).
        for (const recipient of emails) {
          try {
            await ses.send(
              new SendEmailCommand({
                Source: `${SES_FROM_NAME} <${SES_FROM_EMAIL}>`,
                Destination: { ToAddresses: [recipient] },
                Message: {
                  Subject: { Data: subject, Charset: 'UTF-8' },
                  Body: { Html: { Data: html, Charset: 'UTF-8' } },
                },
              }),
            );
            console.log(`Email sent to ${recipient} for alert "${rule.name}"`);
          } catch (err: any) {
            console.warn(`Alert email SKIPPED ${recipient}: ${err?.message ?? err}`);
          }
        }
      }
    }
  }
}

function buildRuleAlertRenderData(
  agency: { slug: string; name: string },
  ruleName: string,
  config: any,
  alert: AlertMessage,
  mention: any,
  mentionImage: string | null,
  topicNames: string,
  volumeContext: { count: number; threshold: number; windowMinutes: number } | null,
  negativeContext: { total: number; negative: number; thresholdPct: number; windowHours: number } | null = null,
): SimpleAlertRenderData {
  const facts: SimpleAlertRenderData['facts'] = [];
  let leadHtml: string;
  let mentionCard: SimpleAlertRenderData['mention'] = null;

  if (config.type === 'volume_spike' && volumeContext) {
    leadHtml = `El volumen de menciones de los últimos <strong>${volumeContext.windowMinutes} minutos</strong> alcanzó <strong>${volumeContext.count}</strong>, superando el umbral configurado de ${volumeContext.threshold}.`;
    facts.push(
      { label: 'Menciones en la ventana', value: String(volumeContext.count), tone: 'warn', mono: true },
      { label: 'Umbral configurado', value: `≥ ${volumeContext.threshold}`, mono: true },
      { label: 'Ventana', value: `${volumeContext.windowMinutes} min`, mono: true },
    );
  } else {
    // Reglas por mención (negative_sentiment / keyword): el lede es el
    // resumen NLP de la mención cuando existe.
    leadHtml = typeof mention?.nlp_summary === 'string' && mention.nlp_summary.trim().length > 0
      ? mention.nlp_summary
      : `Se registró una mención que coincide con la regla configurada "${ruleName}".`;
    if (config.type === 'negative_sentiment' && negativeContext && negativeContext.total > 0) {
      const pct = Math.round((negativeContext.negative / negativeContext.total) * 100);
      leadHtml = `En las últimas <strong>${negativeContext.windowHours} horas</strong>, <strong>${negativeContext.negative} de ${negativeContext.total}</strong> menciones fueron negativas (<strong>${pct}%</strong>), sobre el umbral configurado de ${negativeContext.thresholdPct}%. Esta es la más reciente.`;
      facts.push(
        { label: 'Proporción negativa', value: `${pct}%`, tone: 'neg', mono: true },
        { label: 'Umbral configurado', value: `≥ ${negativeContext.thresholdPct}%`, mono: true },
        { label: 'Ventana', value: `${negativeContext.windowHours} h`, mono: true },
      );
    }
    if (config.type === 'keyword' && Array.isArray(config.keywords) && config.keywords.length > 0) {
      facts.push({ label: 'Palabras clave', value: config.keywords.join(', ') });
    }
    const sentimentTone = alert.sentiment === 'negativo' ? 'neg' : alert.sentiment === 'positivo' ? 'pos' : undefined;
    facts.push({ label: 'Sentimiento', value: sentimentEs(alert.sentiment), tone: sentimentTone, swatch: true });
    if (topicNames) facts.push({ label: 'Tópicos', value: topicNames });
    if (alert.emotions?.length) facts.push({ label: 'Emociones', value: alert.emotions.join(' · ') });

    if (mention) {
      mentionCard = {
        sourceLabel: mention.content_source_name ?? mention.domain ?? mention.page_type ?? 'Fuente desconocida',
        title: mention.title ?? null,
        snippet: String(mention.snippet ?? '').slice(0, 280),
        url: mention.url ?? null,
        publishedAtLabel: mention.published_at ? formatUpdatedAtLabel(new Date(mention.published_at), ALERT_TIMEZONE) : null,
        imageUrl: mentionImage,
      };
    }
  }

  return {
    agencyName: agency.name,
    agencyShortName: agencyShortName(agency.slug),
    ruleName,
    detectedAtLabel: formatUpdatedAtLabel(new Date(), ALERT_TIMEZONE),
    leadHtml,
    facts,
    mention: mentionCard,
    dashboardUrl: `${DASHBOARD_BASE_URL}/dashboard?agency=${agency.slug}`,
  };
}

/**
 * Imagen de la mención para el correo: la media del propio post que el
 * processor ya resolvió (`resolved_image_url`); para noticias/blogs, si no
 * hay, el og:image de la nota. Nunca el og:image de una red social (a un
 * visitante sin sesión le sirven su logo). Best-effort, 3s por URL.
 */
async function mentionImageUrl(m: { url?: string | null; page_type?: string | null; resolved_image_url?: string | null }): Promise<string | null> {
  try {
    const stored = m.resolved_image_url;
    if (stored && /^https?:\/\//i.test(stored) && !isGenericImageUrl(stored) && await validateImageUrl(stored)) return stored;
    if (isArticlePageType(m.page_type) && m.url) return await fetchOgImage(m.url);
  } catch (err) {
    console.warn('[alerts] mention image lookup failed', err);
  }
  return null;
}

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }),
  );
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}
