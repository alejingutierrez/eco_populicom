import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import type { SQSEvent } from 'aws-lambda';

const ses = new SESClient({});
const sm = new SecretsManagerClient({});

const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@populicom.com';

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
  const client = new pg.default.Client({ connectionString: dbUrl });
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

async function evaluateAlertRules(pgClient: any, alert: AlertMessage): Promise<void> {
  // Fetch active alert rules for this agency
  const rulesResult = await pgClient.query(
    'SELECT id, name, config, notify_emails FROM alert_rules WHERE agency_id = $1 AND is_active = true',
    [alert.agencyId],
  );

  for (const rule of rulesResult.rows) {
    const config = rule.config;
    let shouldTrigger = false;

    switch (config.type) {
      case 'negative_sentiment':
        // Trigger on any negative mention (simplified for now)
        shouldTrigger = alert.sentiment === 'negativo';
        break;

      case 'keyword': {
        // Check if any keyword appears in topic slugs or the mention
        const mentionResult = await pgClient.query(
          'SELECT title, snippet FROM mentions WHERE id = $1',
          [alert.mentionId],
        );
        if (mentionResult.rows.length > 0) {
          const text = `${mentionResult.rows[0].title ?? ''} ${mentionResult.rows[0].snippet ?? ''}`.toLowerCase();
          shouldTrigger = config.keywords.some((kw: string) => text.includes(kw.toLowerCase()));
          if (config.sentiment) {
            shouldTrigger = shouldTrigger && alert.sentiment === config.sentiment;
          }
        }
        break;
      }

      case 'volume_spike': {
        // Count mentions in the configured time window
        const windowMs = (config.window_minutes ?? 60) * 60 * 1000;
        const windowStart = new Date(Date.now() - windowMs).toISOString();
        const countResult = await pgClient.query(
          'SELECT COUNT(*) as cnt FROM mentions WHERE agency_id = $1 AND published_at >= $2',
          [alert.agencyId, windowStart],
        );
        shouldTrigger = parseInt(countResult.rows[0].cnt, 10) >= (config.threshold ?? 50);
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
          'SELECT title, snippet, url, nlp_summary FROM mentions WHERE id = $1',
          [alert.mentionId],
        );
        const mention = mentionResult.rows[0];

        const topicNames = alert.topics.map((t) => t.topic_slug.replace(/-/g, ' ')).join(', ');

        await ses.send(
          new SendEmailCommand({
            Source: SES_FROM_EMAIL,
            Destination: { ToAddresses: emails },
            Message: {
              Subject: { Data: `[ECO Alerta] ${rule.name} — ${alert.sentiment}` },
              Body: {
                Html: {
                  Data: `
                    <h2>Alerta: ${rule.name}</h2>
                    <p><strong>Sentimiento:</strong> ${alert.sentiment}</p>
                    <p><strong>Tópicos:</strong> ${topicNames}</p>
                    <p><strong>Resumen:</strong> ${mention?.nlp_summary ?? 'N/A'}</p>
                    <p><strong>Título:</strong> ${mention?.title ?? 'Sin título'}</p>
                    <p>${mention?.snippet ?? ''}</p>
                    ${mention?.url ? `<p><a href="${mention.url}">Ver mención original</a></p>` : ''}
                    <hr>
                    <p style="color: #666; font-size: 12px;">ECO — Plataforma de Social Listening del Gobierno de Puerto Rico</p>
                  `,
                },
              },
            },
          }),
        );
        console.log(`Email sent to ${emails.join(', ')} for alert "${rule.name}"`);
      }
    }
  }
}

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }),
  );
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}
