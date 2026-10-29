import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { BrandwatchClient, RunBudget } from '@eco/brandwatch';
import type { BrandwatchMention } from '@eco/shared';
import { advanceCursorMs, cursorToCommit, shouldTouchCursor } from './cursor';
import { orderQueryJobs } from './query-order';
import type { QueryServedAt } from './query-order';
import { RunBreaker, computeDeadlineMs, planRun, resolveRunMode } from './run-guard';

const s3 = new S3Client({});
const sqs = new SQSClient({});
const sm = new SecretsManagerClient({});

const RAW_BUCKET = process.env.RAW_BUCKET!;
const INGESTION_QUEUE_URL = process.env.INGESTION_QUEUE_URL!;
// Tope de páginas por query por corrida (modo normal). 20 páginas × 100 =
// ~2000 menciones/corrida; el cursor avanza, así que el resto se ingiere en
// corridas siguientes. Evita que un backlog post-caída agote la cuota de BW.
const MAX_PAGES_PER_RUN = 20;
// Cuánto se re-escanea hacia atrás del cursor en cada corrida normal. Brandwatch
// indexa con retraso (mediana ~3 h web, p90 ~7 h, cola de >24 h): con el cursor
// en la mención más reciente, lo que llega tarde queda "detrás" y solo lo
// recogería el refresh diario de 07:00Z. Cada corrida paga la ventana completa
// (más horas = más páginas): con 12 h salían 11–13 requests por corrida (22–26
// de los ~30 por 10 min de cuota, compartida con biq-ingestion) y el 29-oct
// 07:15Z DF agotó sus reintentos. Con 8 h bajan a ~8: lo que ocupa las páginas
// son sobre todo los shells de X (81–83 % de los resultados de Gobernadora y
// DF, sin fecha ni texto). A 8 h, ~7 % de las menciones tardías (rezago > 8 h;
// muestra de 20 h, n≈320) esperan al refresh en vez de entrar a la corrida
// siguiente; con 6 h solo se ahorraría ~1 request más y se perdería ~11 %.
const INCREMENTAL_LOOKBACK_MS = 8 * 60 * 60 * 1000;
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

/** Una query por servir en la corrida y la agencia a la que pertenece. */
interface QueryJob {
  agency: AgencyRow;
  queryId: number;
}

async function loadActiveAgencies(client: any): Promise<AgencyRow[]> {
  const result = await client.query(
    `SELECT slug, brandwatch_project_id, brandwatch_query_ids FROM agencies
     WHERE is_active = true AND brandwatch_project_id IS NOT NULL AND brandwatch_query_ids IS NOT NULL`,
  );
  return result.rows as AgencyRow[];
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
  // Convenience for the LateArrivalRefresh cron: backfill the last N hours
  // ending at "now". Equivalent to setting backfillStartDate = now - hours.
  // Ignored if backfillStartDate is also set.
  refreshLastHours?: number;
}

// Solo lo que usamos del Context de Lambda (opcional: en local no hay).
interface LambdaContextLike {
  getRemainingTimeInMillis?: () => number;
}

export const handler = async (
  event: unknown,
  context?: LambdaContextLike,
): Promise<{ statusCode: number; body: string }> => {
  console.log('Ingestion handler invoked', JSON.stringify(event));

  const evt = (event ?? {}) as IngestEvent;
  const now = new Date();
  // El modo se resuelve ANTES de traducir refreshLastHours a una ventana de
  // backfill: de él dependen los reintentos, el pacing y el presupuesto.
  const plan = planRun(resolveRunMode(evt));
  const deadlineMs = computeDeadlineMs(
    now.getTime(),
    plan.budgetMs,
    context?.getRemainingTimeInMillis?.(),
  );
  // Presupuesto único de la corrida, compartido por los clientes de todas las
  // agencias: tiempo, tope de requests y pacing son de la corrida entera.
  const budget = new RunBudget({
    deadlineMs,
    maxRequests: plan.maxRequests,
    minIntervalMs: plan.minRequestIntervalMs,
  });
  // Cortacircuitos: una query que agota sus reintentos por 429 (o el
  // presupuesto) aborta lo que falta de la corrida.
  const breaker = new RunBreaker();
  const skippedQueries: string[] = [];
  // Translate refreshLastHours to a real backfill window so the cron of
  // LateArrivalRefresh actually re-scans recent history.
  if (evt.refreshLastHours && !evt.backfillStartDate) {
    evt.backfillStartDate = new Date(now.getTime() - evt.refreshLastHours * 3600 * 1000).toISOString();
    evt.backfillEndDate = evt.backfillEndDate ?? now.toISOString();
  }
  const isBackfill = Boolean(evt.backfillStartDate);
  const endDate = isBackfill ? (evt.backfillEndDate ?? now.toISOString()) : now.toISOString();
  const datePrefix = now.toISOString().split('T')[0];

  const dbUrl = await getDatabaseUrl();
  const brandwatchToken = await getBrandwatchToken();
  // Sin tipos a propósito: en el bundle de esbuild `pg.default` existe (interop CJS).
  const pg: any = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const agencySummaries: string[] = [];

  try {
    const agencies = await loadActiveAgencies(client);
    console.log(`Found ${agencies.length} active agencies${isBackfill ? ` (backfill ${evt.backfillStartDate} → ${endDate})` : ''}`);
    console.log(
      `Run plan: mode=${plan.mode} maxAttempts=${plan.retry.maxAttempts} ` +
        `budget=${Math.round((deadlineMs - now.getTime()) / 1000)}s ` +
        `pacing=${plan.minRequestIntervalMs}ms maxRequests=${plan.maxRequests ?? 'none'}`,
    );

    // Lista plana de las queries por servir (todas las agencias). Se recorre de
    // la más desatendida a la más reciente (ver ./query-order): si el
    // cortacircuitos aborta la corrida, lo que se saltó va primero la próxima.
    // El backfill manual conserva el orden de la tabla (ventana explícita, sin
    // cursores de por medio).
    let jobs: QueryJob[] = [];
    for (const agency of agencies) {
      for (const rawQueryId of agency.brandwatch_query_ids) {
        const queryId = Number(rawQueryId);
        // Una agencia puede mezclar fuentes: DF recibe Brandwatch y además
        // exportes importados (queryId negativo, ver isImportQueryId en
        // @eco/shared). Esos no existen en la API de Brandwatch.
        if (!Number.isFinite(queryId) || queryId < 0) continue;
        // Skip queries not in the backfill whitelist (if one was provided).
        if (isBackfill && evt.backfillQueryIds && !evt.backfillQueryIds.includes(queryId)) {
          continue;
        }
        jobs.push({ agency, queryId });
      }
    }
    if (plan.mode !== 'backfill') jobs = await orderByStaleness(client, jobs);
    console.log(`Query order: ${jobs.map((j) => `${j.agency.slug}:${j.queryId}`).join(', ') || '(none)'}`);

    // Un cliente por agencia (project id propio), creado la primera vez que se
    // necesita; el presupuesto de la corrida es uno solo para todos.
    const clients = new Map<string, BrandwatchClient>();
    const clientFor = (agency: AgencyRow): BrandwatchClient => {
      let bw = clients.get(agency.slug);
      if (!bw) {
        bw = new BrandwatchClient({
          token: brandwatchToken,
          projectId: agency.brandwatch_project_id,
          retry: plan.retry,
          budget,
        });
        clients.set(agency.slug, bw);
      }
      return bw;
    };

    for (const { agency, queryId } of jobs) {
      // Cortacircuitos abierto: no se sondea lo que falta (cada query
      // volvería a gastar su escalera de reintentos y más cupo compartido).
      // Sus cursores no se tocan; la próxima corrida los retoma.
      if (breaker.isOpen) {
        skippedQueries.push(`${agency.slug}:${queryId}`);
        continue;
      }
      const bw = clientFor(agency);

      // Estado de la query hoisteado fuera del try: si falla a media
      // paginación (429 en la página 5 de 8) el catch compromete el avance
      // de las páginas que SÍ se encolaron (ver cursorToCommit).
      let startDate: string | null = null;
      let totalMentions = 0;
      let pageIndex = 0;
      // Fecha máxima válida entre TODAS las menciones traídas (null = ninguna
      // con fecha). Los shells de X vienen con date null, ver ./cursor.
      let cursorMs: number | null = null;
      let sendFailures = 0; // entries que SQS rechazó tras reintentos

      // Un query que falla (5xx de Brandwatch, query borrado, cuota) no debe
      // tumbar la corrida: sin esto, los queries que vienen después en el
      // loop se quedan sin sondear (incidente de jul-2026, SGPR/Gobernadora
      // tres días sin ingesta). El cursor del que falló no avanza más allá
      // de lo ya encolado, así que la próxima corrida lo retoma. Si el
      // fallo es de cuota (429 sin reintentos) o de presupuesto, además se
      // abre el cortacircuitos y se abortan las queries que faltan.
      try {
        // Determine time window from cursor (normal mode) or from the event
        // (backfill mode — cursor is left alone so the regular cron keeps
        // advancing from wherever it was).
        const cursor = isBackfill ? null : await readCursor(client, queryId);

        if (isBackfill) {
          startDate = evt.backfillStartDate!;
        } else if (cursor) {
          startDate = new Date(new Date(cursor.last_mention_date).getTime() - INCREMENTAL_LOOKBACK_MS).toISOString();
        } else {
          const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          startDate = yesterday.toISOString();
        }

        console.log(`[${agency.slug}] Query ${queryId}: fetching ${startDate} → ${endDate}`);

        const endMs = Date.parse(endDate);

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

          // Send each mention to SQS (batches of 10 max). SendMessageBatch es
          // de éxito PARCIAL: las entries en `Failed` nunca llegan al processor
          // y, como el cursor avanzaría igual, se perderían para siempre.
          // Reintentamos las fallidas; las que persistan se contabilizan para
          // NO avanzar el cursor de esta query (la próxima corrida re-escanea;
          // el UNIQUE (agency_id, bw_resource_id) deduplica las que sí entraron).
          const batches = chunk(mentions, 10);
          for (const batch of batches) {
            let entries = batch.map((mention, idx) => ({
              Id: `msg-${pageIndex}-${idx}-${mention.resourceId}`.slice(0, 80),
              MessageBody: JSON.stringify(mention),
            }));
            for (let attempt = 0; attempt < 3 && entries.length > 0; attempt++) {
              const res = await sqs.send(
                new SendMessageBatchCommand({ QueueUrl: INGESTION_QUEUE_URL, Entries: entries }),
              );
              const failedIds = new Set((res.Failed || []).map((f) => f.Id));
              entries = entries.filter((e) => failedIds.has(e.Id));
              if (entries.length > 0) await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
            }
            if (entries.length > 0) {
              sendFailures += entries.length;
              console.error(`[${agency.slug}] Query ${queryId}: ${entries.length} mentions no se pudieron encolar tras reintentos`);
            }
          }

          // Track latest mention date for cursor update
          cursorMs = advanceCursorMs(cursorMs, mentions, endMs);

          totalMentions += mentions.length;
          pageIndex++;
          console.log(`[${agency.slug}] Query ${queryId}: page ${pageIndex} — ${mentions.length} mentions (total: ${totalMentions})`);

          // Page-cap (solo modo normal): tope de requests por corrida para que un
          // backlog tras una caída no consuma toda la cuota de Brandwatch en una
          // sola invocación (el "death spiral"). El cursor avanza al último
          // mention encolado, así que la próxima corrida continúa donde quedó.
          if (!isBackfill && pageIndex >= MAX_PAGES_PER_RUN) {
            console.warn(`[${agency.slug}] Query ${queryId}: cap de ${MAX_PAGES_PER_RUN} páginas/corrida alcanzado; continúa en la próxima corrida`);
            break;
          }
        }

        // Update cursor only in normal mode — backfill re-scans a past window
        // and must not push the cursor backwards or count duplicates. Si hubo
        // fallos de encolado, NO avanzamos el cursor: la ventana se re-escanea
        // la próxima corrida para recuperar las menciones que no se encolaron.
        // Sin ninguna mención con fecha (todo shells) queda startDate; el
        // GREATEST de updateCursor impide que eso mueva el cursor atrás.
        const lastMentionDate = cursorToCommit({ isBackfill, totalMentions, sendFailures, cursorMs, startDate });
        if (lastMentionDate !== null) {
          await updateCursor(client, queryId, lastMentionDate, totalMentions);
        } else if (shouldTouchCursor({ isBackfill, totalMentions, sendFailures })) {
          // Sin menciones no hay cursor que mover, pero la query sí se sirvió:
          // se anota para el orden de la próxima corrida (ver ./query-order).
          await touchCursor(client, queryId);
        } else if (sendFailures > 0) {
          console.error(`[${agency.slug}] Query ${queryId}: cursor NO avanzado por ${sendFailures} fallos de encolado`);
        }

        const summary = `[${agency.slug}] Query ${queryId}: ${totalMentions} mentions in ${pageIndex} pages${isBackfill ? ' (backfill)' : ''}`;
        console.log(summary);
        agencySummaries.push(summary);
      } catch (err) {
        const opened = breaker.record(err, `[${agency.slug}] Query ${queryId}`);
        const summary = opened
          ? `[${agency.slug}] Query ${queryId}: FAILED (cortacircuitos: se aborta el resto): ${(err as Error)?.message ?? err}`
          : `[${agency.slug}] Query ${queryId}: FAILED (continúa el resto): ${(err as Error)?.message ?? err}`;
        console.error(summary);
        agencySummaries.push(summary);

        // Lo ya encolado antes del fallo no se re-baja la próxima corrida.
        const partialDate =
          startDate === null
            ? null
            : cursorToCommit({ isBackfill, totalMentions, sendFailures, cursorMs, startDate, partial: true });
        if (partialDate !== null) {
          try {
            await updateCursor(client, queryId, partialDate, totalMentions);
            console.warn(`[${agency.slug}] Query ${queryId}: cursor avanzado a ${partialDate} con las ${pageIndex} páginas encoladas antes del fallo`);
          } catch (cursorErr) {
            console.error(`[${agency.slug}] Query ${queryId}: no se pudo guardar el avance parcial del cursor: ${(cursorErr as Error)?.message ?? cursorErr}`);
          }
        }
      }
    }
  } finally {
    await client.end();
  }

  if (breaker.isOpen) {
    const aborted =
      `ABORTED por cortacircuitos (${breaker.reason}); ${skippedQueries.length} queries sin sondear` +
      `${skippedQueries.length > 0 ? `: ${skippedQueries.join(', ')}` : ''}`;
    console.error(aborted);
    agencySummaries.push(aborted);
  }
  agencySummaries.push(
    `[run] mode=${plan.mode} requests=${budget.requestsMade} elapsed=${Math.round((Date.now() - now.getTime()) / 1000)}s`,
  );

  const body = agencySummaries.length > 1
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
  // GREATEST: el cursor nunca retrocede (una corrida sin menciones con fecha
  // llega con startDate = cursor − lookback y antes lo hacía retroceder).
  await client.query(
    `INSERT INTO ingestion_cursors (query_id, last_mention_date, last_run_at, mentions_fetched, status)
     VALUES ($1, $2, NOW(), $3, 'idle')
     ON CONFLICT (query_id)
     DO UPDATE SET last_mention_date = GREATEST(ingestion_cursors.last_mention_date, $2), last_run_at = NOW(), mentions_fetched = ingestion_cursors.mentions_fetched + $3, status = 'idle'`,
    [queryId, lastMentionDate, mentionsFetched],
  );
}

/**
 * Cuándo se sirvió por última vez cada query (ingestion_cursors). Pg devuelve
 * query_id (bigint) como string y las fechas como Date.
 */
async function loadServedAt(client: any, queryIds: number[]): Promise<Map<number, QueryServedAt>> {
  const result = await client.query(
    'SELECT query_id, last_run_at, last_mention_date FROM ingestion_cursors WHERE query_id = ANY($1::bigint[])',
    [queryIds],
  );
  const served = new Map<number, QueryServedAt>();
  for (const row of result.rows as Array<{ query_id: string | number; last_run_at: Date | string | null; last_mention_date: Date | string | null }>) {
    served.set(Number(row.query_id), { lastRunAt: row.last_run_at, lastMentionDate: row.last_mention_date });
  }
  return served;
}

/**
 * Ordena las queries de la corrida de la más desatendida a la más reciente. Es
 * una optimización del reparto de cuota, no parte de la ingesta: si no se puede
 * leer ingestion_cursors se conserva el orden de la tabla y la corrida sigue.
 */
async function orderByStaleness(client: any, jobs: QueryJob[]): Promise<QueryJob[]> {
  if (jobs.length < 2) return jobs;
  try {
    return orderQueryJobs(jobs, await loadServedAt(client, jobs.map((j) => j.queryId)));
  } catch (err) {
    console.warn(
      `No se pudo leer ingestion_cursors para ordenar las queries (se usa el orden de la tabla): ${(err as Error)?.message ?? err}`,
    );
    return jobs;
  }
}

/**
 * Anota que la query se sirvió sin mover su cursor ni contar menciones. Solo
 * alimenta el orden y el diagnóstico: un fallo aquí no debe marcar la query
 * como fallida (ya encoló todo lo que traía).
 */
async function touchCursor(client: any, queryId: number): Promise<void> {
  try {
    await client.query('UPDATE ingestion_cursors SET last_run_at = NOW() WHERE query_id = $1', [queryId]);
  } catch (err) {
    console.warn(`Query ${queryId}: no se pudo anotar last_run_at: ${(err as Error)?.message ?? err}`);
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
