/**
 * ETL de menciones desde un exporte xlsx de Bunker hacia el pipeline de ECO.
 *
 * Para agencias que no entran por Brandwatch (DF, oct-2026). Lee la primera
 * hoja, convierte cada fila con `bunkerRowToMention` (@eco/shared) a la forma
 * que produce eco-ingestion y la encola en SQS `eco-ingestion`; eco-processor
 * hace el resto (dedup, cuerpo del artículo, NLP con Claude, tópicos,
 * municipios, embedding, alertas). El queryId sale de la agencia en la DB
 * (`agencies.brandwatch_query_ids`, un id negativo), así que no se puede
 * encolar para una agencia que el processor no reconozca.
 *
 * Idempotente: el resourceId sale de la URL normalizada, las filas que ya
 * están en `mentions` se saltan antes de encolar y, si alguna se cuela, el
 * processor la descarta por `bw_resource_id`. Reimportar un exporte que se
 * solapa con el anterior solo encola lo nuevo.
 *
 * Uso (desde la raíz del repo, con las credenciales del .env):
 *   set -a && source .env && set +a
 *   node_modules/.bin/tsx scripts/import-bunker-xlsx.ts --file mentions.xlsx --agency df --dry-run
 *   node_modules/.bin/tsx scripts/import-bunker-xlsx.ts --file mentions.xlsx --agency df --per-minute 90
 *
 * Opciones:
 *   --file <xlsx>       exporte de Bunker (obligatorio)
 *   --agency <slug>     agencia destino (obligatorio; debe tener un query negativo)
 *   --dry-run           no encola: imprime el resumen y escribe --out
 *   --out <jsonl>       guarda las menciones mapeadas (una por línea)
 *   --per-minute <n>    ritmo de encolado (default 90). El processor corre con
 *                       Opus y comparte cuota de Bedrock con la ingesta en vivo:
 *                       un alud lo empuja al modelo de respaldo para todos.
 *   --since / --until   solo filas con fecha (UTC) dentro del rango YYYY-MM-DD
 *   --limit <n>         encola como mucho n (para probar con pocas)
 *   --no-archive        no sube el xlsx original a S3 (por defecto se guarda en
 *                       s3://<RAW_BUCKET>/bunker/<agencia>/<fecha>/ para auditoría)
 *   --no-refresh        no espera al processor ni recalcula métricas al final
 *
 * Al terminar de encolar (salvo --no-refresh) espera a que la cola
 * eco-ingestion se vacíe, recalcula los snapshots diarios desde el día más
 * viejo importado hasta hoy (en tramos de 15 días, del más viejo al más
 * nuevo) y en el último tramo pide a eco-metrics-calculator que evalúe las
 * reglas de crisis de los últimos 3 días: el barrido de cada 5 minutos solo
 * mira HOY, así que sin esto un día en crisis que llega en un exporte tardío
 * nunca alertaría.
 */
import { basename } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SQSClient, SendMessageBatchCommand, GetQueueUrlCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { addDaysYmd, isImportQueryId, mapBunkerRows, mentionPlatformKey, ymdInTimeZone } from '@eco/shared';
import { readXlsxRows } from '@eco/shared/src/xlsx-lite';

const RAW_BUCKET = process.env.RAW_BUCKET ?? 'eco-raw-863956448838';
const QUEUE_NAME = process.env.INGESTION_QUEUE_NAME ?? 'eco-ingestion';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const lambda = new LambdaClient({});
const sqs = new SQSClient({});
const s3 = new S3Client({});

/** SELECT vía eco-migration (la DB vive en la VPC). */
async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const res = await lambda.send(new InvokeCommand({
    FunctionName: 'eco-migration',
    Payload: Buffer.from(JSON.stringify({ action: 'custom-query', query: sql })),
  }));
  const payload = JSON.parse(Buffer.from(res.Payload!).toString('utf8'));
  const body = typeof payload.body === 'string' ? JSON.parse(payload.body) : payload.body;
  if (!body || body.error || payload.errorMessage) throw new Error(`custom-query: ${body?.error ?? payload.errorMessage ?? 'sin body'}`);
  return (body.rows ?? []) as T[];
}

const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const file = arg('file');
  const slug = arg('agency');
  if (!file || !slug) {
    console.error('Uso: import-bunker-xlsx.ts --file <xlsx> --agency <slug> [--dry-run] [--out f.jsonl] [--per-minute n]');
    process.exit(2);
  }
  const dryRun = flag('dry-run');
  const perMinute = Math.max(1, Number(arg('per-minute') ?? 90));
  const limit = arg('limit') ? Number(arg('limit')) : Infinity;
  const since = arg('since');
  const until = arg('until');

  // 1) Agencia y su query de importación.
  const [agency] = await query<{ id: string; slug: string; name: string; is_active: boolean; brandwatch_query_ids: number[] | null }>(
    `SELECT id, slug, name, is_active, brandwatch_query_ids FROM agencies WHERE slug = ${sqlStr(slug)}`,
  );
  if (!agency) throw new Error(`No existe la agencia '${slug}'`);
  if (!agency.is_active) throw new Error(`La agencia '${slug}' está inactiva: el processor no la reconocería`);
  const importIds = (agency.brandwatch_query_ids ?? []).map(Number).filter(isImportQueryId);
  if (importIds.length !== 1) {
    throw new Error(`'${slug}' debe tener exactamente un query de importación (negativo) en brandwatch_query_ids; tiene ${JSON.stringify(agency.brandwatch_query_ids)}`);
  }
  const queryId = importIds[0];

  // 2) Leer y mapear (únicas por URL y por publicación dentro del archivo).
  const parsed = mapBunkerRows(readXlsxRows(readFileSync(file)), { queryId, since, until });
  if (parsed.missingColumns.length) throw new Error(`No parece un exporte de Bunker: faltan ${parsed.missingColumns.join(', ')}`);
  const mapped = parsed.mentions;

  // 3) Saltar las que ya están en la DB: por resourceId (único por agencia) y por
  //    publicación (la misma con otra URL) en la ventana del archivo ± 3 días.
  const existing = new Set<string>();
  const ids = mapped.map((m) => m.resourceId);
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const found = await query<{ bw_resource_id: string }>(
      `SELECT bw_resource_id FROM mentions WHERE agency_id = ${sqlStr(agency.id)} AND bw_resource_id IN (${chunk.map(sqlStr).join(',')})`,
    );
    for (const r of found) existing.add(r.bw_resource_id);
  }
  const known = new Set<string>();
  if (mapped.length) {
    const urls = await query<{ url: string }>(
      `SELECT url FROM mentions WHERE agency_id = ${sqlStr(agency.id)} AND url IS NOT NULL
         AND published_at BETWEEN ${sqlStr(mapped[0].date)}::timestamptz - interval '3 days'
                              AND ${sqlStr(mapped[mapped.length - 1].date)}::timestamptz + interval '3 days'`,
    );
    for (const u of urls) known.add(mentionPlatformKey(u.url));
  }
  let otherUrl = 0;
  const pending = mapped.filter((m) => {
    if (existing.has(m.resourceId)) return false;
    if (known.has(mentionPlatformKey(m.url ?? ''))) { otherUrl++; return false; }
    return true;
  }).slice(0, limit);

  const byType: Record<string, number> = {};
  for (const m of pending) byType[m.pageType] = (byType[m.pageType] ?? 0) + 1;
  console.log(`[${slug}] ${agency.name} · queryId ${queryId}`);
  console.log(`  filas en el xlsx:      ${parsed.rows}`);
  console.log(`  sin URL o fecha:       ${parsed.invalid}`);
  console.log(`  fuera de rango:        ${parsed.outOfRange}`);
  console.log(`  repetidas en el xlsx:  ${parsed.dupInFile}`);
  console.log(`  ya en la DB:           ${existing.size + otherUrl}${otherUrl ? ` (${otherUrl} con otra URL)` : ''}`);
  console.log(`  por encolar:           ${pending.length}  ${JSON.stringify(byType)}`);
  if (pending.length) console.log(`  rango:                 ${pending[0].date} → ${pending[pending.length - 1].date}`);

  const out = arg('out');
  if (out) {
    writeFileSync(out, pending.map((m) => JSON.stringify(m)).join('\n') + '\n');
    console.log(`  escrito:               ${out}`);
  }
  if (dryRun || pending.length === 0) return;

  // 4) Copia del exporte original para auditoría (como el JSON crudo de Brandwatch).
  if (!flag('no-archive')) {
    const key = `bunker/${slug}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${basename(file)}`;
    await s3.send(new PutObjectCommand({
      Bucket: RAW_BUCKET, Key: key, Body: readFileSync(file),
      ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));
    console.log(`  archivado:             s3://${RAW_BUCKET}/${key}`);
  }

  // 5) Encolar en lotes de 10 al ritmo pedido, reintentando las entradas fallidas.
  const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: QUEUE_NAME }));
  const msPerBatch = (60_000 / perMinute) * 10;
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < pending.length; i += 10) {
    const t0 = Date.now();
    let entries = pending.slice(i, i + 10).map((m) => ({ Id: m.resourceId.slice(0, 80), MessageBody: JSON.stringify(m) }));
    const total = entries.length;
    for (let attempt = 0; attempt < 4 && entries.length > 0; attempt++) {
      const res = await sqs.send(new SendMessageBatchCommand({ QueueUrl, Entries: entries }));
      const failedIds = new Set((res.Failed ?? []).map((f) => f.Id));
      entries = entries.filter((e) => failedIds.has(e.Id));
      if (entries.length) await sleep(500 * (attempt + 1));
    }
    failed += entries.length;
    sent += total - entries.length;
    if ((i / 10) % 10 === 0 || i + 10 >= pending.length) {
      console.log(`  encoladas ${sent}/${pending.length}${failed ? ` · fallidas ${failed}` : ''}`);
    }
    const wait = msPerBatch - (Date.now() - t0);
    if (wait > 0 && i + 10 < pending.length) await sleep(wait);
  }
  console.log(`[${slug}] listo: ${sent} encoladas, ${failed} fallidas`);
  if (failed) process.exitCode = 1;
  if (flag('no-refresh') || sent === 0) return;

  // 6) Esperar al processor: la cola compartida vacía dos lecturas seguidas.
  console.log(`[${slug}] esperando a que eco-processor termine…`);
  const t0 = Date.now();
  let empty = 0;
  while (empty < 2 && Date.now() - t0 < 30 * 60_000) {
    await sleep(20_000);
    const { Attributes: q } = await sqs.send(new GetQueueAttributesCommand({
      QueueUrl, AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
    }));
    const depth = Number(q?.ApproximateNumberOfMessages ?? 0) + Number(q?.ApproximateNumberOfMessagesNotVisible ?? 0);
    empty = depth === 0 ? empty + 1 : 0;
    if (depth) console.log(`  en cola: ${depth}`);
  }
  if (empty < 2) console.warn('  la cola no se vació en 30 min; recalculo igual con lo que haya');

  // 7) Snapshots de los días tocados + evaluación de crisis en el último tramo.
  const TZ = 'America/Puerto_Rico';
  const today = ymdInTimeZone(new Date(), TZ);
  const from = ymdInTimeZone(new Date(pending[0].date), TZ);
  for (let start = from; start <= today; start = addDaysYmd(start, 15)) {
    const end = addDaysYmd(start, 14) < today ? addDaysYmd(start, 14) : today;
    const last = end === today;
    const res = await lambda.send(new InvokeCommand({
      FunctionName: 'eco-metrics-calculator',
      Payload: Buffer.from(JSON.stringify({
        backfill: true, agencySlug: slug, backfillFrom: start, backfillTo: end,
        ...(last ? { evaluateCrisis: true } : {}),
      })),
    }));
    const out = JSON.parse(Buffer.from(res.Payload!).toString('utf8'));
    if (res.FunctionError) throw new Error(`metrics-calculator ${start}→${end}: ${out.errorMessage ?? 'error'}`);
    console.log(`  métricas ${start} → ${end}: ${out.body}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
