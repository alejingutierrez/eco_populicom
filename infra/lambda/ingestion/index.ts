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
const BRANDWATCH_TOKEN = process.env.BRANDWATCH_TOKEN!;
const BRANDWATCH_PROJECT_ID = Number(process.env.BRANDWATCH_PROJECT_ID!);
const BRANDWATCH_QUERY_ID = Number(process.env.BRANDWATCH_QUERY_ID!);
const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;

interface CursorRow {
  last_mention_date: string;
}

export const handler = async (event: unknown): Promise<{ statusCode: number; body: string }> => {
  console.log('Ingestion handler invoked', JSON.stringify(event));

  const bw = new BrandwatchClient({
    token: BRANDWATCH_TOKEN,
    projectId: BRANDWATCH_PROJECT_ID,
  });

  // Determine time window
  const now = new Date();
  const endDate = now.toISOString();

  // Read cursor from DB (last ingestion timestamp)
  let startDate: string;
  const dbUrl = await getDatabaseUrl();
  const cursor = await readCursor(dbUrl, BRANDWATCH_QUERY_ID);

  if (cursor) {
    // Start 1 minute before last mention to avoid gaps
    const cursorDate = new Date(cursor.last_mention_date);
    cursorDate.setMinutes(cursorDate.getMinutes() - 1);
    startDate = cursorDate.toISOString();
  } else {
    // First run: fetch last 24 hours
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    startDate = yesterday.toISOString();
  }

  console.log(`Fetching mentions from ${startDate} to ${endDate}`);

  let totalMentions = 0;
  let pageIndex = 0;
  let lastMentionDate = startDate;

  for await (const mentions of bw.fetchMentionPages({
    queryId: BRANDWATCH_QUERY_ID,
    startDate,
    endDate,
    pageSize: 100,
    orderBy: 'date',
    orderDirection: 'asc',
  })) {
    // Store raw JSON in S3
    const datePrefix = now.toISOString().split('T')[0];
    const s3Key = `brandwatch/${BRANDWATCH_QUERY_ID}/${datePrefix}/page-${pageIndex}.json`;
    await s3.send(
      new PutObjectCommand({
        Bucket: RAW_BUCKET,
        Key: s3Key,
        Body: JSON.stringify({ results: mentions, fetchedAt: now.toISOString() }),
        ContentType: 'application/json',
      }),
    );

    // Send each mention to SQS (batch of 10 max)
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
    console.log(`Page ${pageIndex}: ${mentions.length} mentions (total: ${totalMentions})`);
  }

  // Update cursor
  if (totalMentions > 0) {
    await updateCursor(dbUrl, BRANDWATCH_QUERY_ID, lastMentionDate, totalMentions);
  }

  const summary = `Ingested ${totalMentions} mentions in ${pageIndex} pages`;
  console.log(summary);

  return { statusCode: 200, body: summary };
};

// ---- Database helpers (raw pg for Lambda simplicity) ----

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }),
  );
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}

async function readCursor(dbUrl: string, queryId: number): Promise<CursorRow | null> {
  // Dynamic import to avoid cold-start overhead when no cursor exists yet
  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query(
      'SELECT last_mention_date FROM ingestion_cursors WHERE query_id = $1',
      [queryId],
    );
    return result.rows[0] ?? null;
  } finally {
    await client.end();
  }
}

async function updateCursor(
  dbUrl: string,
  queryId: number,
  lastMentionDate: string,
  mentionsFetched: number,
): Promise<void> {
  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO ingestion_cursors (query_id, last_mention_date, last_run_at, mentions_fetched, status)
       VALUES ($1, $2, NOW(), $3, 'idle')
       ON CONFLICT (query_id)
       DO UPDATE SET last_mention_date = $2, last_run_at = NOW(), mentions_fetched = ingestion_cursors.mentions_fetched + $3, status = 'idle'`,
      [queryId, lastMentionDate, mentionsFetched],
    );
  } finally {
    await client.end();
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
