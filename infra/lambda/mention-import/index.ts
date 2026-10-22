/**
 * eco-mention-import — ETL completo de un exporte de menciones (hoy: Bunker)
 * subido desde Configuración → Importar menciones.
 *
 * Es el mismo proceso que `scripts/import-bunker-xlsx.ts`, pero dirigido desde
 * el dashboard y con su estado en la tabla `mention_import_jobs` para que la
 * pantalla muestre el avance:
 *
 *   preview    el web sube el xlsx a S3 y pide `preview`: se lee, se mapea y
 *              se cruza contra la base (sin encolar nada). Queda la fila con
 *              el resumen: nuevas / ya cargadas / repetidas en el archivo.
 *   enqueuing  `start`: se rehace el plan (por si entró otro exporte mientras
 *              tanto), se guarda en S3 y se encola en SQS `eco-ingestion` al
 *              ritmo de PER_MINUTE. eco-processor hace el resto: dedup por
 *              bw_resource_id y text_hash, cuerpo del artículo, NLP, tópicos,
 *              municipios, embedding y alertas.
 *   processing espera a que esas menciones aparezcan en `mentions` (o a que la
 *              cola se vacíe dos lecturas seguidas: el processor puede
 *              descartar alguna).
 *   metrics    recalcula los snapshots diarios desde el día más viejo
 *              importado hasta hoy, en tramos de 15 días, y en el último pide
 *              `evaluateCrisis` (el barrido de 5 min solo mira HOY).
 *   done / failed / discarded
 *
 * Cada fase trabaja con un presupuesto de tiempo y, si no termina, se
 * re-invoca a sí misma (asíncrono) con `continue`. Para que un reintento de
 * Lambda no deje dos invocaciones trabajando la misma importación, cada
 * `continue` toma un arriendo (`lease_until`) con un UPDATE condicional.
 *
 * Idempotente como el script: el resourceId sale de la URL normalizada y lo
 * que ya está en `mentions` (por resourceId o por la misma publicación con otra
 * URL, ver mentionPlatformKey) no se encola.
 *
 * El schema se auto-repara en cada arranque (ensureSchema), igual que
 * eco-article-fetch: eco-migration no acepta DDL.
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageBatchCommand, GetQueueUrlCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Pool } from 'pg';
import {
  addDaysYmd, isImportQueryId, mapBunkerRows, mentionPlatformKey, ymdInTimeZone,
  type BrandwatchMention,
} from '@eco/shared';
import { readXlsxRows } from '@eco/shared/src/xlsx-lite';

const sm = new SecretsManagerClient({});
const s3 = new S3Client({});
const sqs = new SQSClient({});
const lambda = new LambdaClient({});

const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
const RAW_BUCKET = process.env.RAW_BUCKET ?? 'eco-raw-863956448838';
const QUEUE_NAME = process.env.INGESTION_QUEUE_NAME ?? 'eco-ingestion';
const METRICS_FUNCTION = process.env.METRICS_FUNCTION_NAME ?? 'eco-metrics-calculator';
/**
 * Ritmo de encolado. El processor corre con Opus y comparte cuota de Bedrock
 * con la ingesta en vivo: un alud lo empuja al modelo de respaldo para todos.
 * 90/min es lo que usa el script desde el primer exporte de DF.
 */
const PER_MINUTE = Number(process.env.PER_MINUTE ?? 90);
/** Cuánto esperar al processor antes de recalcular igual con lo que haya. */
const MAX_PROCESSING_MS = 45 * 60_000;
const TZ = 'America/Puerto_Rico';
/** Margen antes del timeout para guardar el avance y re-invocarse. */
const SAFETY_MS = 90_000;
const LEASE_MINUTES = 16;

type Status = 'preview' | 'enqueuing' | 'processing' | 'metrics' | 'done' | 'failed' | 'discarded';

interface ImportEvent {
  action: 'preview' | 'start' | 'continue' | 'resume' | 'discard';
  importId?: string;
  /** preview: dónde dejó el web el archivo. */
  s3Key?: string;
  agencySlug?: string;
  fileName?: string;
  uploadedBy?: string;
}

interface LambdaContext {
  functionName: string;
  getRemainingTimeInMillis(): number;
}

interface ImportRow {
  id: string;
  agency_id: string;
  agency_slug: string;
  file_name: string;
  s3_key: string;
  status: Status;
  summary: Record<string, unknown> | null;
  detail: Record<string, unknown> | null;
  total: number;
  enqueued: number;
  processed: number;
  date_from: string | null;
  updated_at: string;
}

interface Summary {
  rows: number;
  invalid: number;
  dupInFile: number;
  outOfRange: number;
  alreadyInDb: number;
  /** De las ya cargadas, cuántas eran la misma publicación con OTRA URL. */
  alreadyInDbOtherUrl: number;
  toImport: number;
  byType: Record<string, number>;
  byDay: Record<string, number>;
  dateFrom: string | null;
  dateTo: string | null;
  keyword: string | null;
  queryId: number;
}

// ---------------------------------------------------------------- DB

let pool: Pool | null = null;
async function db(): Promise<Pool> {
  if (pool) return pool;
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }));
  const p = JSON.parse(secret.SecretString!);
  // RDS exige TLS; el certificado es el de AWS y no se valida cadena (igual que
  // processor, weekly-report y article-fetch).
  pool = new Pool({
    connectionString: `postgresql://${p.username}:${encodeURIComponent(p.password)}@${p.host}:${p.port}/${p.dbname}`,
    ssl: { rejectUnauthorized: false },
    max: 3,
  });
  return pool;
}

let schemaReady = false;
async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const c = await db();
  await c.query(`
    CREATE TABLE IF NOT EXISTS mention_import_jobs (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      agency_id    uuid NOT NULL REFERENCES agencies(id),
      agency_slug  text NOT NULL,
      source       text NOT NULL DEFAULT 'bunker',
      file_name    text NOT NULL,
      s3_key       text NOT NULL,
      uploaded_by  text,
      status       text NOT NULL,
      summary      jsonb,
      detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
      total        integer NOT NULL DEFAULT 0,
      enqueued     integer NOT NULL DEFAULT 0,
      processed    integer NOT NULL DEFAULT 0,
      date_from    timestamptz,
      date_to      timestamptz,
      error        text,
      lease_until  timestamptz,
      created_at   timestamptz NOT NULL DEFAULT now(),
      started_at   timestamptz,
      updated_at   timestamptz NOT NULL DEFAULT now(),
      finished_at  timestamptz
    )`);
  await c.query(`CREATE INDEX IF NOT EXISTS mention_import_jobs_agency_created_idx ON mention_import_jobs (agency_id, created_at DESC)`);
  schemaReady = true;
}

async function getImport(id: string): Promise<ImportRow | null> {
  const { rows } = await (await db()).query<ImportRow>(`SELECT * FROM mention_import_jobs WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

async function patch(id: string, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  sets.push('updated_at = now()');
  await (await db()).query(
    `UPDATE mention_import_jobs SET ${sets.join(', ')} WHERE id = $1`,
    [id, ...keys.map((k) => {
      const v = fields[k];
      return v != null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
    })],
  );
}

// ---------------------------------------------------------------- Plan

async function readS3(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: RAW_BUCKET, Key: key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}

/** Agencia destino y su query de importación (negativo). */
async function loadAgency(slug: string): Promise<{ id: string; slug: string; name: string; queryId: number }> {
  const { rows } = await (await db()).query<{ id: string; slug: string; name: string; is_active: boolean; brandwatch_query_ids: number[] | null }>(
    `SELECT id, slug, name, is_active, brandwatch_query_ids FROM agencies WHERE slug = $1`, [slug],
  );
  const a = rows[0];
  if (!a) throw new Error(`No existe la agencia '${slug}'`);
  if (!a.is_active) throw new Error(`La agencia '${slug}' está inactiva: el processor no la reconocería`);
  const ids = (a.brandwatch_query_ids ?? []).map(Number).filter(isImportQueryId);
  if (ids.length !== 1) {
    throw new Error(`'${slug}' no recibe importaciones: necesita exactamente un query negativo en brandwatch_query_ids (tiene ${JSON.stringify(a.brandwatch_query_ids)})`);
  }
  return { id: a.id, slug: a.slug, name: a.name, queryId: ids[0] };
}

/**
 * Lee el archivo, mapea y cruza contra la base: por resourceId (global, como
 * el processor) y por publicación (`mentionPlatformKey`) contra las menciones
 * de la agencia en la ventana del archivo ± 3 días.
 */
async function buildPlan(s3Key: string, agency: { id: string; queryId: number }): Promise<{ summary: Summary; pending: BrandwatchMention[] }> {
  const rows = readXlsxRows(await readS3(s3Key));
  const mapped = mapBunkerRows(rows, { queryId: agency.queryId });
  if (mapped.missingColumns.length) {
    throw new Error(`El archivo no parece un exporte de Bunker: faltan las columnas ${mapped.missingColumns.join(', ')}`);
  }
  const c = await db();
  const existing = new Set<string>();
  const ids = mapped.mentions.map((m) => m.resourceId);
  for (let i = 0; i < ids.length; i += 1000) {
    const { rows: found } = await c.query<{ bw_resource_id: string }>(
      `SELECT bw_resource_id FROM mentions WHERE bw_resource_id = ANY($1::text[])`, [ids.slice(i, i + 1000)],
    );
    for (const r of found) existing.add(r.bw_resource_id);
  }
  let otherUrl = 0;
  const known = new Set<string>();
  if (mapped.mentions.length) {
    const from = mapped.mentions[0].date;
    const to = mapped.mentions[mapped.mentions.length - 1].date;
    const { rows: urls } = await c.query<{ url: string }>(
      `SELECT url FROM mentions WHERE agency_id = $1 AND url IS NOT NULL
         AND published_at BETWEEN $2::timestamptz - interval '3 days' AND $3::timestamptz + interval '3 days'`,
      [agency.id, from, to],
    );
    for (const u of urls) known.add(mentionPlatformKey(u.url));
  }
  const pending: BrandwatchMention[] = [];
  for (const m of mapped.mentions) {
    if (existing.has(m.resourceId)) continue;
    if (known.has(mentionPlatformKey(m.url ?? ''))) { otherUrl++; continue; }
    pending.push(m);
  }
  const byType: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  for (const m of pending) {
    byType[m.pageType] = (byType[m.pageType] ?? 0) + 1;
    const d = ymdInTimeZone(new Date(m.date), TZ);
    byDay[d] = (byDay[d] ?? 0) + 1;
  }
  return {
    pending,
    summary: {
      rows: mapped.rows,
      invalid: mapped.invalid,
      dupInFile: mapped.dupInFile,
      outOfRange: mapped.outOfRange,
      alreadyInDb: existing.size + otherUrl,
      alreadyInDbOtherUrl: otherUrl,
      toImport: pending.length,
      byType,
      byDay,
      dateFrom: pending[0]?.date ?? null,
      dateTo: pending[pending.length - 1]?.date ?? null,
      keyword: mapped.keyword,
      queryId: agency.queryId,
    },
  };
}

const planKey = (row: Pick<ImportRow, 's3_key'>) => `${row.s3_key}.plan.jsonl`;

async function readPlan(row: ImportRow): Promise<BrandwatchMention[]> {
  return (await readS3(planKey(row))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------- Fases

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let queueUrl: string | null = null;
async function getQueueUrl(): Promise<string> {
  if (!queueUrl) queueUrl = (await sqs.send(new GetQueueUrlCommand({ QueueName: QUEUE_NAME }))).QueueUrl!;
  return queueUrl;
}

async function queueDepth(): Promise<number> {
  const { Attributes: q } = await sqs.send(new GetQueueAttributesCommand({
    QueueUrl: await getQueueUrl(),
    AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed'],
  }));
  return Number(q?.ApproximateNumberOfMessages ?? 0) + Number(q?.ApproximateNumberOfMessagesNotVisible ?? 0)
    + Number(q?.ApproximateNumberOfMessagesDelayed ?? 0);
}

/** Encola desde `enqueued` hasta agotar el plan o el tiempo. true = terminó. */
async function phaseEnqueue(row: ImportRow, ctx: LambdaContext): Promise<boolean> {
  const plan = await readPlan(row);
  const QueueUrl = await getQueueUrl();
  const msPerBatch = (60_000 / PER_MINUTE) * 10;
  let i = row.enqueued;
  let failed = Number(row.detail?.failedEnqueue ?? 0);
  while (i < plan.length) {
    if (ctx.getRemainingTimeInMillis() < SAFETY_MS) break;
    const t0 = Date.now();
    const batch = plan.slice(i, i + 10);
    let entries = batch.map((m) => ({ Id: m.resourceId.slice(0, 80), MessageBody: JSON.stringify(m) }));
    for (let attempt = 0; attempt < 4 && entries.length > 0; attempt++) {
      const res = await sqs.send(new SendMessageBatchCommand({ QueueUrl, Entries: entries }));
      const failedIds = new Set((res.Failed ?? []).map((f) => f.Id));
      entries = entries.filter((e) => failedIds.has(e.Id));
      if (entries.length) await sleep(500 * (attempt + 1));
    }
    failed += entries.length;
    i += batch.length;
    // Avance visible en la pantalla cada ~100.
    if ((i / 10) % 10 === 0 || i >= plan.length) {
      await patch(row.id, { enqueued: i, detail: { ...(row.detail ?? {}), failedEnqueue: failed } });
    }
    const wait = msPerBatch - (Date.now() - t0);
    if (wait > 0 && i < plan.length) await sleep(wait);
  }
  await patch(row.id, { enqueued: i, detail: { ...(row.detail ?? {}), failedEnqueue: failed } });
  if (i < plan.length) return false;
  await patch(row.id, {
    status: 'processing',
    detail: { ...(row.detail ?? {}), failedEnqueue: failed, enqueueFinishedAt: new Date().toISOString(), emptyReads: 0 },
  });
  return true;
}

async function countProcessed(row: ImportRow, ids: string[]): Promise<{ processed: number; duplicates: number }> {
  const { rows } = await (await db()).query<{ n: string; dup: string }>(
    `SELECT count(*) AS n, count(*) FILTER (WHERE is_duplicate) AS dup
       FROM mentions WHERE bw_resource_id = ANY($1::text[])`, [ids],
  );
  return { processed: Number(rows[0]?.n ?? 0), duplicates: Number(rows[0]?.dup ?? 0) };
}

/** Espera al processor. true = listo para métricas. */
async function phaseProcessing(row: ImportRow, ctx: LambdaContext): Promise<boolean> {
  const ids = (await readPlan(row)).map((m) => m.resourceId);
  const startedWaiting = Date.parse(String(row.detail?.enqueueFinishedAt ?? row.updated_at));
  let empty = Number(row.detail?.emptyReads ?? 0);
  for (;;) {
    const { processed, duplicates } = await countProcessed(row, ids);
    const depth = await queueDepth();
    empty = depth === 0 ? empty + 1 : 0;
    const timedOut = Date.now() - startedWaiting > MAX_PROCESSING_MS;
    const done = processed >= ids.length || empty >= 2 || timedOut;
    await patch(row.id, {
      processed,
      detail: {
        ...(row.detail ?? {}), emptyReads: empty, queueDepth: depth, duplicates,
        ...(done && timedOut && processed < ids.length ? { processingTimedOut: true } : {}),
      },
    });
    if (done) {
      const fresh = (await getImport(row.id))!;
      await patch(row.id, { status: 'metrics', detail: { ...(fresh.detail ?? {}), metricsCursor: null } });
      return true;
    }
    if (ctx.getRemainingTimeInMillis() < SAFETY_MS) return false;
    await sleep(20_000);
  }
}

/** Snapshots en tramos de 15 días + crisis en el último. true = terminó. */
async function phaseMetrics(row: ImportRow, ctx: LambdaContext): Promise<boolean> {
  const today = ymdInTimeZone(new Date(), TZ);
  const first = row.date_from ? ymdInTimeZone(new Date(row.date_from), TZ) : today;
  let start = String(row.detail?.metricsCursor ?? first);
  const chunks: string[] = Array.isArray(row.detail?.metricsChunks) ? (row.detail!.metricsChunks as string[]) : [];
  while (start <= today) {
    if (ctx.getRemainingTimeInMillis() < SAFETY_MS + 120_000) return false;
    const end = addDaysYmd(start, 14) < today ? addDaysYmd(start, 14) : today;
    const last = end === today;
    const res = await lambda.send(new InvokeCommand({
      FunctionName: METRICS_FUNCTION,
      Payload: Buffer.from(JSON.stringify({
        backfill: true, agencySlug: row.agency_slug, backfillFrom: start, backfillTo: end,
        ...(last ? { evaluateCrisis: true } : {}),
      })),
    }));
    const out = JSON.parse(Buffer.from(res.Payload!).toString('utf8'));
    if (res.FunctionError) throw new Error(`metrics-calculator ${start}→${end}: ${out.errorMessage ?? 'error'}`);
    chunks.push(`${start} → ${end}: ${typeof out.body === 'string' ? out.body : JSON.stringify(out.body ?? out)}`);
    start = addDaysYmd(end, 1);
    const fresh = (await getImport(row.id))!;
    await patch(row.id, { detail: { ...(fresh.detail ?? {}), metricsCursor: start, metricsChunks: chunks } });
  }
  const ids = (await readPlan(row)).map((m) => m.resourceId);
  const { processed, duplicates } = await countProcessed(row, ids);
  const fresh = (await getImport(row.id))!;
  await patch(row.id, {
    status: 'done', processed, finished_at: new Date(),
    detail: { ...(fresh.detail ?? {}), duplicates },
  });
  return true;
}

// ---------------------------------------------------------------- Handler

async function selfInvoke(ctx: LambdaContext, importId: string): Promise<void> {
  await lambda.send(new InvokeCommand({
    FunctionName: ctx.functionName,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify({ action: 'continue', importId })),
  }));
}

async function preview(ev: ImportEvent): Promise<unknown> {
  if (!ev.s3Key || !ev.agencySlug || !ev.fileName) throw new Error('preview necesita s3Key, agencySlug y fileName');
  if (!ev.s3Key.startsWith('bunker/')) throw new Error('s3Key fuera de bunker/');
  const agency = await loadAgency(ev.agencySlug);
  const { summary } = await buildPlan(ev.s3Key, agency);
  const { rows } = await (await db()).query<ImportRow>(
    `INSERT INTO mention_import_jobs (agency_id, agency_slug, file_name, s3_key, uploaded_by, status, summary, total, date_from, date_to)
     VALUES ($1, $2, $3, $4, $5, 'preview', $6, $7, $8, $9) RETURNING *`,
    [agency.id, agency.slug, ev.fileName, ev.s3Key, ev.uploadedBy ?? null, JSON.stringify(summary),
      summary.toImport, summary.dateFrom, summary.dateTo],
  );
  return { import: rows[0] };
}

async function start(ev: ImportEvent, ctx: LambdaContext): Promise<unknown> {
  const row = ev.importId ? await getImport(ev.importId) : null;
  if (!row) throw new Error('No existe esa importación');
  if (row.status !== 'preview') throw new Error(`La importación ya está en «${row.status}»`);
  const { rows: busy } = await (await db()).query(
    `SELECT id FROM mention_import_jobs WHERE agency_id = $1 AND status IN ('enqueuing','processing','metrics') AND id <> $2`,
    [row.agency_id, row.id],
  );
  if (busy.length) throw new Error('Ya hay otra importación en curso para esta agencia; espera a que termine.');
  // Plan fresco: si entró otro exporte desde la vista previa, lo ya cargado se salta.
  const agency = await loadAgency(row.agency_slug);
  const { summary, pending } = await buildPlan(row.s3_key, agency);
  await s3.send(new PutObjectCommand({
    Bucket: RAW_BUCKET, Key: planKey(row),
    Body: pending.map((m) => JSON.stringify(m)).join('\n') + '\n',
    ContentType: 'application/x-ndjson',
  }));
  if (pending.length === 0) {
    await patch(row.id, { status: 'done', summary, total: 0, started_at: new Date(), finished_at: new Date() });
    return { import: await getImport(row.id) };
  }
  await patch(row.id, {
    status: 'enqueuing', summary, total: pending.length, enqueued: 0, processed: 0,
    date_from: summary.dateFrom, date_to: summary.dateTo, started_at: new Date(),
  });
  await selfInvoke(ctx, row.id);
  return { import: await getImport(row.id) };
}

async function proceed(ev: ImportEvent, ctx: LambdaContext): Promise<unknown> {
  const id = ev.importId!;
  // Arriendo: solo una invocación trabaja cada importación.
  const { rowCount } = await (await db()).query(
    `UPDATE mention_import_jobs SET lease_until = now() + ($2::int * interval '1 minute')
      WHERE id = $1 AND status IN ('enqueuing','processing','metrics')
        AND (lease_until IS NULL OR lease_until < now())`,
    [id, LEASE_MINUTES],
  );
  if (!rowCount) return { skipped: true };
  try {
    for (;;) {
      const row = (await getImport(id))!;
      let finished: boolean;
      if (row.status === 'enqueuing') finished = await phaseEnqueue(row, ctx);
      else if (row.status === 'processing') finished = await phaseProcessing(row, ctx);
      else if (row.status === 'metrics') finished = await phaseMetrics(row, ctx);
      else return { status: row.status };
      if (!finished) {
        await patch(id, { lease_until: null });
        await selfInvoke(ctx, id);
        return { continued: true };
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[mention-import] ${id} falló`, err);
    await patch(id, { status: 'failed', error: msg.slice(0, 2000), lease_until: null, finished_at: new Date() });
    return { error: msg };
  }
}

export async function handler(ev: ImportEvent, ctx: LambdaContext): Promise<unknown> {
  await ensureSchema();
  console.log(`[mention-import] ${ev.action} ${ev.importId ?? ev.s3Key ?? ''}`);
  try {
    switch (ev.action) {
      case 'preview': return await preview(ev);
      case 'start': return await start(ev, ctx);
      case 'continue': return await proceed(ev, ctx);
      case 'resume': {
        // Botón «Reanudar» de la pantalla: solo si lleva 5 min sin avanzar (cada
        // fase escribe al menos cada ~2 min), o sea, la invocación que la
        // llevaba murió (timeout, despliegue) sin soltar el arriendo.
        const { rowCount } = await (await db()).query(
          `UPDATE mention_import_jobs SET lease_until = NULL
            WHERE id = $1 AND status IN ('enqueuing','processing','metrics') AND updated_at < now() - interval '5 minutes'`,
          [ev.importId],
        );
        if (!rowCount) throw new Error('La importación sigue avanzando (o ya terminó); no hace falta reanudarla.');
        await selfInvoke(ctx, ev.importId!);
        return { import: await getImport(ev.importId!) };
      }
      case 'discard': {
        const row = ev.importId ? await getImport(ev.importId) : null;
        if (!row) throw new Error('No existe esa importación');
        if (row.status !== 'preview') throw new Error(`Solo se descarta una vista previa (está en «${row.status}»)`);
        await patch(row.id, { status: 'discarded', finished_at: new Date() });
        return { import: await getImport(row.id) };
      }
      default:
        throw new Error(`Acción desconocida: ${String((ev as { action?: unknown }).action)}`);
    }
  } catch (err) {
    // preview/start/discard son síncronas: el web muestra este mensaje tal cual.
    const msg = err instanceof Error ? err.message : String(err);
    if (ev.action !== 'continue') return { error: msg };
    throw err;
  }
}
