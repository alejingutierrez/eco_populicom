import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { BrandwatchClient } from '@eco/brandwatch';
import type { BrandwatchMention } from '@eco/shared';

const s3 = new S3Client({});
const sqs = new SQSClient({});
const sm = new SecretsManagerClient({});

const RAW_BUCKET = process.env.RAW_BUCKET!;
const INGESTION_QUEUE_URL = process.env.INGESTION_QUEUE_URL!;
const BRANDWATCH_TOKEN_SECRET_ARN = process.env.BRANDWATCH_TOKEN_SECRET_ARN!;
const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;

// Cache the Brandwatch token across warm invocations so rotation is picked up
// on the next cold start (no redeploy needed) without hitting SM every run.
let cachedBrandwatchToken: string | null = null;

interface CursorRow {
  last_mention_date: string;
}

interface AgencyRow {
  slug: string;
  brandwatch_project_id: number;
  brandwatch_query_ids: number[];
}

async function loadActiveAgencies(client: any): Promise<AgencyRow[]> {
  const result = await client.query<AgencyRow>(
    `SELECT slug, brandwatch_project_id, brandwatch_query_ids FROM agencies
     WHERE is_active = true AND brandwatch_project_id IS NOT NULL AND brandwatch_query_ids IS NOT NULL`,
  );
  return result.rows;
}

interface IngestEvent {
  // Backfill mode: re-fetch a specific window WITHOUT touching the cursor.
  // Brandwatch indexes some mentions retroactively (the publish_date is in the
  // past but the mention surfaces days later), and our normal cursor-driven
  // ingest only moves forward — so those late arrivals are silently missed.
  // Invoke with { backfillStartDate, backfillEndDate } to catch them up.
  backfillStartDate?: string;
  backfillEndDate?: string;
  backfillQueryIds?: number[];
}

export const handler = async (event: unknown): Promise<{ statusCode: number; body: string }> => {
  console.log('Ingestion handler invoked', JSON.stringify(event));

  const evt = (event ?? {}) as IngestEvent;
  const isBackfill = Boolean(evt.backfillStartDate);
  const now = new Date();
  const endDate = isBackfill ? (evt.backfillEndDate ?? now.toISOString()) : now.toISOString();
  const datePrefix = now.toISOString().split('T')[0];

  const dbUrl = await getDatabaseUrl();
  const brandwatchToken = await getBrandwatchToken();
  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const agencySummaries: string[] = [];

  try {
    const agencies = await loadActiveAgencies(client);
    console.log(`Found ${agencies.length} active agencies${isBackfill ? ` (backfill ${evt.backfillStartDate} → ${endDate})` : ''}`);

    for (const agency of agencies) {
      const bw = new BrandwatchClient({
        token: brandwatchToken,
        projectId: agency.brandwatch_project_id,
      });

      for (const queryId of agency.brandwatch_query_ids) {
        // Skip queries not in the backfill whitelist (if one was provided).
        if (isBackfill && evt.backfillQueryIds && !evt.backfillQueryIds.includes(queryId)) {
          continue;
        }

        // Determine time window from cursor (normal mode) or from the event
        // (backfill mode — cursor is left alone so the regular cron keeps
        // advancing from wherever it was).
        let startDate: string;
        const cursor = isBackfill ? null : await readCursor(client, queryId);

        if (isBackfill) {
          startDate = evt.backfillStartDate!;
        } else if (cursor) {
          const cursorDate = new Date(cursor.last_mention_date);
          cursorDate.setMinutes(cursorDate.getMinutes() - 1);
          startDate = cursorDate.toISOString();
        } else {
          const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          startDate = yesterday.toISOString();
        }

        console.log(`[${agency.slug}] Query ${queryId}: fetching ${startDate} → ${endDate}`);

        let totalMentions = 0;
        let pageIndex = 0;
        let lastMentionDate = startDate;

        for await (const mentions of bw.fetchMentionPages({
          queryId,
          startDate,
          endDate,
          pageSize: 100,
          orderBy: 'date',
          orderDirection: 'asc',
        })) {
          // Store raw JSON in S3 under agency-scoped path
          const s3Key = `brandwatch/${agency.slug}/${queryId}/${datePrefix}/page-${pageIndex}.json`;
          await s3.send(
            new PutObjectCommand({
              Bucket: RAW_BUCKET,
              Key: s3Key,
              Body: JSON.stringify({ results: mentions, fetchedAt: now.toISOString() }),
              ContentType: 'application/json',
            }),
          );

          // Send each mention to SQS (batches of 10 max)
          const batches = chunk(mentions, 10);
          for (const batch of batches) {
            await sqs.send(
              new SendMessageBatchCommand({
                QueueUrl: INGESTION_QUEUE_URL,
                Entries: batch.map((mention, idx) => ({
                  Id: `msg-${pageIndex}-${idx}-${mention.resourceId}`.slice(0, 80),
                  MessageBody: JSON.stringify(mention),
                })),
              }),
            );
          }

          // Track last mention date for cursor update
          const lastMention = mentions[mentions.length - 1];
          if (lastMention?.date) {
            lastMentionDate = lastMention.date;
          }

          totalMentions += mentions.length;
          pageIndex++;
          console.log(`[${agency.slug}] Query ${queryId}: page ${pageIndex} — ${mentions.length} mentions (total: ${totalMentions})`);
        }

        // Update cursor only in normal mode — backfill re-scans a past window
        // and must not push the cursor backwards or count duplicates.
        if (!isBackfill && totalMentions > 0) {
          await updateCursor(client, queryId, lastMentionDate, totalMentions);
        }

        const summary = `[${agency.slug}] Query ${queryId}: ${totalMentions} mentions in ${pageIndex} pages${isBackfill ? ' (backfill)' : ''}`;
        console.log(summary);
        agencySummaries.push(summary);
      }
    }
  } finally {
    await client.end();
  }

  const body = agencySummaries.length > 0
    ? agencySummaries.join('; ')
    : 'No active agencies with Brandwatch configuration found';

  console.log('Ingestion complete:', body);
  return { statusCode: 200, body };
};

// ---- Database helpers (raw pg for Lambda simplicity) ----

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }),
  );
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}

async function getBrandwatchToken(): Promise<string> {
  if (cachedBrandwatchToken) return cachedBrandwatchToken;
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: BRANDWATCH_TOKEN_SECRET_ARN }),
  );
  const raw = secret.SecretString ?? '';
  // Support both plain-string secrets and {"token":"..."} JSON blobs.
  let token = raw;
  try {
    const parsed = JSON.parse(raw);
    token = typeof parsed === 'string' ? parsed : (parsed.token ?? raw);
  } catch {
    // raw is already a plain string — keep it.
  }
  cachedBrandwatchToken = token;
  return token;
}

async function readCursor(client: any, queryId: number): Promise<CursorRow | null> {
  const result = await client.query(
    'SELECT last_mention_date FROM ingestion_cursors WHERE query_id = $1',
    [queryId],
  );
  return result.rows[0] ?? null;
}

async function updateCursor(
  client: any,
  queryId: number,
  lastMentionDate: string,
  mentionsFetched: number,
): Promise<void> {
  await client.query(
    `INSERT INTO ingestion_cursors (query_id, last_mention_date, last_run_at, mentions_fetched, status)
     VALUES ($1, $2, NOW(), $3, 'idle')
     ON CONFLICT (query_id)
     DO UPDATE SET last_mention_date = $2, last_run_at = NOW(), mentions_fetched = ingestion_cursors.mentions_fetched + $3, status = 'idle'`,
    [queryId, lastMentionDate, mentionsFetched],
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
