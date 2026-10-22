// Backfill de una query de Brandwatch SIN gastar cuota de la API: encola en
// eco-ingestion (SQS) menciones ya descargadas (JSON de /data/mentions, el
// mismo formato que manda eco-ingestion) y guarda las páginas crudas en S3
// como la ingesta. El processor hace el resto (dedup por resourceId y, en
// agencias con dos fuentes, por publicación).
//
// Se usó el 22-oct-2026 para DF (query 2004156405, 16-jul → 22-oct): el
// eco-ingestion pagina de a 100 y el histórico costaba ~180 llamadas contra
// una cuota de 30/10 min compartida con el cron.
//
//   node scripts/enqueue-bw-backfill.mjs --file menciones.json --slug df \
//     --query 2004156405 [--per-minute 90] [--dry-run]
import { readFileSync } from 'node:fs';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const file = arg('file'); const slug = arg('slug'); const queryId = Number(arg('query'));
const perMinute = Number(arg('per-minute', '90')); const dryRun = process.argv.includes('--dry-run');
const QUEUE = 'https://sqs.us-east-1.amazonaws.com/863956448838/eco-ingestion';
const BUCKET = 'eco-raw-863956448838';
if (!file || !slug || !queryId) throw new Error('faltan --file, --slug o --query');

const all = JSON.parse(readFileSync(file, 'utf8'));
// Los posts de X llegan sin texto, URL ni fecha (licencia): el processor los
// descarta igual; no tiene sentido encolarlos.
const mentions = all
  .filter((m) => Number(m.queryId) === queryId && (m.title?.trim() || m.snippet?.trim() || m.url?.trim()))
  .sort((a, b) => String(a.date).localeCompare(String(b.date)));
console.log(`${all.length} en el archivo → ${mentions.length} con contenido de la query ${queryId}`);
if (dryRun) process.exit(0);

const sqs = new SQSClient({}); const s3 = new S3Client({});
const day = new Date().toISOString().slice(0, 10);
const PAGE = 100;
for (let p = 0; p * PAGE < mentions.length; p++) {
  const page = mentions.slice(p * PAGE, (p + 1) * PAGE);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: `brandwatch/${slug}/${queryId}/${day}/backfill-page-${p}.json`,
    Body: JSON.stringify({ results: page, fetchedAt: new Date().toISOString(), backfill: true }), ContentType: 'application/json',
  }));
  const started = Date.now();
  for (let i = 0; i < page.length; i += 10) {
    let entries = page.slice(i, i + 10).map((m, j) => ({ Id: `b${p}-${i + j}`, MessageBody: JSON.stringify(m) }));
    for (let a = 0; a < 3 && entries.length; a++) {
      const res = await sqs.send(new SendMessageBatchCommand({ QueueUrl: QUEUE, Entries: entries }));
      const failed = new Set((res.Failed ?? []).map((f) => f.Id));
      entries = entries.filter((e) => failed.has(e.Id));
    }
    if (entries.length) console.error(`  ${entries.length} sin encolar en la página ${p}`);
  }
  const wait = (page.length / perMinute) * 60_000 - (Date.now() - started);
  console.log(`página ${p + 1}/${Math.ceil(mentions.length / PAGE)} (${page[0].date?.slice(0, 10)}) encolada`);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
console.log('listo');
