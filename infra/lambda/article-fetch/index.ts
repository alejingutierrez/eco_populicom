/**
 * eco-article-fetch — puebla `mentions.full_text` con el cuerpo completo del
 * artículo, descargándolo de la URL de la mención.
 *
 * POR QUÉ UN LAMBDA APARTE (y no dentro del processor): el processor ya hace
 * una llamada a Bedrock por mención dentro de una invocación de SQS. Meterle
 * un fetch HTTP de hasta 12s por registro alargaría la ventana de visibilidad
 * y multiplicaría los reintentos de SQS por fallos que no son del NLP. Aquí el
 * fetch es idempotente, reintentable y sirve tanto para el barrido continuo
 * (EventBridge) como para el backfill histórico (invocación manual con
 * `limit` alto), sin tocar la ruta crítica de ingesta.
 *
 * MODOS (`event.mode`):
 *   'pending' (default) — menciones nunca intentadas (full_text_fetched_at IS NULL).
 *   'retry'             — menciones cuyo fallo era transitorio (red, timeout, 429, 5xx)
 *                         y que no han agotado MAX_ATTEMPTS.
 *   'stats'             — no descarga nada: reporta cobertura por estado y por dominio.
 *
 * El schema se auto-repara en cada arranque (`ensureFullTextSchema`), el mismo
 * patrón idempotente que usa eco-weekly-report. No hace falta pasar por
 * eco-migration, cuyo `exec-write` solo acepta UPDATE/INSERT/DELETE.
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Client } from 'pg';
import { fetchArticleText, createDomainLimiter, type ArticleTextResult } from '@eco/shared';

const sm = new SecretsManagerClient({});
const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;

/** Tras 3 intentos fallidos transitorios se abandona la mención. */
const MAX_ATTEMPTS = 3;

/** Tope de lo que se GUARDA. La extracción puede dar más (el mensaje de
 * presupuesto de la Gobernadora son 60,253 chars legítimos); esto solo protege
 * contra páginas patológicas que concatenan un sitio entero. */
const MAX_STORED_CHARS = 120_000;

/**
 * Margen antes del timeout del Lambda para cerrar y devolver el progreso.
 *
 * NO es una constante: al cruzar el deadline hay hasta `concurrency` peticiones
 * ya encoladas en el limitador y, si caen en el mismo host, drenan de a una
 * cada `gapMs`. Con concurrency 20 y gap 1800 eso son 36 s de cola — más que
 * los 20 s fijos que tenía antes, así que el handler no llegaba a devolver y
 * el Lambda moría con `Status: timeout` (memoria en 777/2048, o sea ya no era
 * el OOM). Las UPDATE ya estaban commiteadas, pero se perdía el resumen y el
 * driver lo leía como error.
 */
function timeSafetyMs(concurrency: number, gapMs: number): number {
  // cola del limitador + un fetch completo en vuelo + cierre de la conexión.
  return Math.min(180_000, Math.max(30_000, concurrency * gapMs + 20_000));
}

/**
 * URLs que nunca tienen cuerpo de artículo. Filtrarlas por patrón ahorra el
 * fetch entero: la sonda encontró que las páginas /video/ de telemundopr.com
 * devuelven 1.4 MB de HTML y 0 caracteres de texto.
 */
const SKIP_URL_PATTERNS = [
  /\/(video|videos|galeria|galer%C3%ADa|gallery|fotos|photos|podcast|audio|en-vivo|live)\//i,
  /\.(pdf|jpg|jpeg|png|gif|webp|mp4|mp3|m3u8)(\?|$)/i,
  /\/(tag|tags|categoria|category|author|autor|buscar|search|page)\//i,
];

interface FetchEvent {
  mode?: 'pending' | 'retry' | 'stats';
  limit?: number;
  concurrency?: number;
  gapMs?: number;
  domain?: string;
  /** No escribe en la DB; solo reporta lo que habría hecho. */
  dryRun?: boolean;
}

interface PendingRow {
  id: string;
  url: string;
  domain: string | null;
  snippet_len: number;
}

/**
 * DDL idempotente. `ADD COLUMN IF NOT EXISTS` sin DEFAULT es instantáneo en
 * PG11+ (no reescribe la tabla), así que es seguro correrlo en cada arranque
 * sobre las 123k filas de `mentions`.
 */
async function ensureFullTextSchema(client: Client): Promise<void> {
  await client.query(`
    ALTER TABLE mentions
      ADD COLUMN IF NOT EXISTS full_text text,
      ADD COLUMN IF NOT EXISTS full_text_chars integer,
      ADD COLUMN IF NOT EXISTS full_text_words integer,
      ADD COLUMN IF NOT EXISTS full_text_method varchar(20),
      ADD COLUMN IF NOT EXISTS full_text_status varchar(24),
      ADD COLUMN IF NOT EXISTS full_text_http_status smallint,
      ADD COLUMN IF NOT EXISTS full_text_fetched_at timestamptz,
      ADD COLUMN IF NOT EXISTS full_text_attempts smallint NOT NULL DEFAULT 0
  `);
  // Índice parcial para que el SELECT de pendientes no escanee las 123k filas.
  // CONCURRENTLY no se puede usar dentro de una transacción implícita del
  // driver, y con 52k filas candidatas el bloqueo dura milisegundos.
  await client.query(`
    CREATE INDEX IF NOT EXISTS mentions_fulltext_pending_idx
      ON mentions (published_at DESC)
      WHERE page_type = 'news' AND full_text_fetched_at IS NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS mentions_fulltext_retry_idx
      ON mentions (full_text_attempts, published_at DESC)
      WHERE page_type = 'news' AND full_text IS NULL AND full_text_fetched_at IS NOT NULL
  `);
}

function shouldSkipUrl(url: string): boolean {
  return SKIP_URL_PATTERNS.some((re) => re.test(url));
}

async function selectRows(client: Client, ev: FetchEvent): Promise<PendingRow[]> {
  const limit = Math.max(1, Math.min(5000, Number(ev.limit ?? 100)));
  const domainFilter = ev.domain ? 'AND domain = $2' : '';
  const params: unknown[] = [limit];
  if (ev.domain) params.push(ev.domain);

  // 'retry': solo fallos transitorios registrados, sin agotar intentos.
  const where = ev.mode === 'retry'
    ? `full_text IS NULL
       AND full_text_fetched_at IS NOT NULL
       AND full_text_attempts < ${MAX_ATTEMPTS}
       AND full_text_status IN (
             'network','timeout','http-error-429','http-error-5xx','http-error-3xx',
             -- Etiquetas por código que escribieron las corridas previas al
             -- agrupamiento en 'http-error-3xx'.
             'http-error-307','http-error-302','http-error-301','http-error-308'
           )`
    : `full_text_fetched_at IS NULL`;

  // ORDEN INTERCALADO POR DOMINIO, no por fecha.
  //
  // El limitador serializa por host, y `mapLimit` consume la lista EN ORDEN.
  // Con `ORDER BY published_at DESC` los primeros 20 elementos son casi todos
  // del mismo medio (las noticias llegan en ráfagas por dominio), así que 15
  // de los 20 workers quedaban haciendo fila detrás de metro.pr y el
  // rendimiento caía de ~9 URL/s a ~2.9. Numerando dentro de cada dominio y
  // ordenando por ese número primero, los 20 primeros elementos son 20
  // dominios distintos y los slots de concurrencia se usan de verdad.
  const res = await client.query(
    `SELECT id, url, domain, snippet_len FROM (
       SELECT id::text AS id, url, domain,
              coalesce(length(snippet), 0) AS snippet_len,
              row_number() OVER (PARTITION BY domain ORDER BY published_at DESC) AS rn
         FROM mentions
        WHERE page_type = 'news'
          AND is_duplicate = false
          AND url IS NOT NULL AND url <> ''
          AND ${where}
          ${domainFilter}
     ) s
     ORDER BY rn, domain
     LIMIT $1`,
    params,
  );
  return res.rows as PendingRow[];
}

/**
 * Normaliza el resultado a un `full_text_status` corto y agrupable. Los 5xx se
 * colapsan en una sola etiqueta para que la tabla de límites sea legible.
 */
function statusLabel(res: ArticleTextResult): string {
  if (res.ok) return 'ok';
  if (res.reason === 'http-error') {
    if (res.status === 429) return 'http-error-429';
    if (res.status >= 500) return 'http-error-5xx';
    // Los 3xx se agrupan igual que los 5xx: son throttles de WAF (Sucuri
    // responde 307 pelado) y no vale la pena una etiqueta por código.
    if (res.status >= 300 && res.status < 400) return 'http-error-3xx';
    return `http-error-${res.status}`;
  }
  return res.reason ?? 'unknown';
}

async function mapLimit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

async function reportStats(client: Client) {
  const byStatus = await client.query(
    `SELECT coalesce(full_text_status, '(sin intentar)') AS status, count(*)::int AS n
       FROM mentions
      WHERE page_type = 'news' AND is_duplicate = false AND url IS NOT NULL AND url <> ''
      GROUP BY 1 ORDER BY 2 DESC`,
  );
  const totals = await client.query(
    `SELECT count(*)::int AS candidatas,
            count(full_text)::int AS con_texto,
            round(avg(full_text_chars) FILTER (WHERE full_text IS NOT NULL))::int AS chars_promedio,
            sum(full_text_chars)::bigint AS chars_totales
       FROM mentions
      WHERE page_type = 'news' AND is_duplicate = false AND url IS NOT NULL AND url <> ''`,
  );
  const worstDomains = await client.query(
    `SELECT domain, count(*)::int AS n,
            count(full_text)::int AS ok,
            (array_agg(DISTINCT full_text_status) FILTER (WHERE full_text IS NULL))[1:3] AS razones
       FROM mentions
      WHERE page_type = 'news' AND is_duplicate = false AND url IS NOT NULL AND url <> ''
        AND full_text_fetched_at IS NOT NULL
      GROUP BY domain
     HAVING count(full_text) < count(*)
      ORDER BY (count(*) - count(full_text)) DESC
      LIMIT 25`,
  );
  return {
    mode: 'stats',
    totals: totals.rows[0],
    byStatus: byStatus.rows,
    domainsConFallos: worstDomains.rows,
  };
}

/** Solo la parte del contexto de Lambda que se usa aquí. */
interface LambdaContext { getRemainingTimeInMillis?: () => number }

export const handler = async (event: FetchEvent = {}, context?: LambdaContext) => {
  const t0 = Date.now();
  // El presupuesto real lo da el runtime. Sin contexto (tests locales) se asume
  // el timeout configurado de 15 min.
  const remaining = context?.getRemainingTimeInMillis?.() ?? 900_000;
  const concurrencyReq = Math.max(1, Math.min(20, Number(event.concurrency ?? 8)));
  const gapMsReq = Number(event.gapMs ?? 1500);
  const deadline = t0 + remaining - timeSafetyMs(concurrencyReq, gapMsReq);

  // `ssl.rejectUnauthorized: false` es el mismo ajuste que usan processor y
  // weekly-report: la RDS exige TLS (pg_hba la rechaza en claro) pero el
  // certificado es el de AWS y no se valida cadena desde el Lambda.
  const client = new Client({
    connectionString: await getDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await ensureFullTextSchema(client);
    if (event.mode === 'stats') return await reportStats(client);

    const rows = await selectRows(client, event);
    // La concurrencia es ENTRE dominios; el limitador serializa cada host. Con
    // concurrencia global y sin limitador, cuatro URLs del mismo sitio salen a
    // la vez y disparan el CAPTCHA de rate de TownNews (medido en la sonda).
    const concurrency = concurrencyReq;
    const limiter = createDomainLimiter(gapMsReq);

    const tally: Record<string, number> = {};
    let stored = 0;
    let skipped = 0;
    let charsTotal = 0;
    let stoppedEarly = false;
    let done = 0;

    // PARADA DURA. El guardia por-item (`Date.now() > deadline`) solo evita
    // EMPEZAR filas nuevas: si un worker se queda clavado —un reader que no
    // cede, un eslabón del limitador que no resuelve— el `mapLimit` no
    // resuelve y el Lambda muere con `Status: timeout` sin devolver nada. Dos
    // invocaciones agotaron los 900 s con memoria de sobra (777 y 613 MB de
    // 2048) exactamente así.
    //
    // Con el race el handler SIEMPRE devuelve. Las UPDATE se commitean fila a
    // fila, así que lo ya hecho queda; las filas en vuelo se quedan
    // pendientes y las recoge la ronda siguiente.
    const lote = mapLimit(rows, concurrency, async (row) => {
      if (Date.now() > deadline) { stoppedEarly = true; return; }

      if (shouldSkipUrl(row.url)) {
        skipped += 1;
        tally['skip-url-pattern'] = (tally['skip-url-pattern'] ?? 0) + 1;
        if (!event.dryRun) {
          await client.query(
            `UPDATE mentions
                SET full_text_status = 'skip-url-pattern',
                    full_text_fetched_at = now(),
                    full_text_attempts = full_text_attempts + 1
              WHERE id = $1`,
            [row.id],
          );
        }
        return;
      }

      const res = await limiter(row.url, () => fetchArticleText(row.url));
      // Latido cada 200 filas: sin esto, una invocación que muere por timeout
      // no deja rastro de cuán lejos llegó ni a qué ritmo iba, y desde fuera
      // se ve igual que una colgada.
      if (++done % 200 === 0) {
        const s0 = (Date.now() - t0) / 1000;
        console.log(`progreso ${done}/${rows.length} · ${stored} guardadas · ${(done / s0).toFixed(1)} URL/s · ${s0.toFixed(0)}s`);
      }
      const label = statusLabel(res);
      tally[label] = (tally[label] ?? 0) + 1;
      if (res.ok && res.text) charsTotal += res.chars;

      if (event.dryRun) return;

      const text = res.ok && res.text ? res.text.slice(0, MAX_STORED_CHARS) : null;
      await client.query(
        `UPDATE mentions
            SET full_text = $2,
                full_text_chars = $3,
                full_text_words = $4,
                full_text_method = $5,
                full_text_status = $6,
                full_text_http_status = $7,
                full_text_fetched_at = now(),
                full_text_attempts = full_text_attempts + 1
          WHERE id = $1`,
        [row.id, text, text ? text.length : null, text ? res.words : null,
         res.ok ? res.method : null, label, res.status || null],
      );
      if (text) stored += 1;
    });

    const cortePorRace = await Promise.race([
      lote.then(() => false),
      new Promise<boolean>((r) => {
        const ms = Math.max(1000, deadline - Date.now());
        setTimeout(() => r(true), ms).unref?.();
      }),
    ]);
    if (cortePorRace) {
      stoppedEarly = true;
      console.log(`parada dura a los ${((Date.now() - t0) / 1000).toFixed(0)}s con ${done}/${rows.length} filas procesadas`);
    }

    const elapsed = (Date.now() - t0) / 1000;
    const result = {
      mode: event.mode ?? 'pending',
      dryRun: !!event.dryRun,
      seleccionadas: rows.length,
      procesadas: done + skipped,
      guardadas: stored,
      saltadas: skipped,
      exito: rows.length ? `${Math.round((100 * stored) / rows.length)}%` : '—',
      charsPromedio: stored ? Math.round(charsTotal / stored) : 0,
      porEstado: Object.fromEntries(Object.entries(tally).sort((a, b) => b[1] - a[1])),
      segundos: Number(elapsed.toFixed(1)),
      urlPorSegundo: rows.length ? Number((rows.length / elapsed).toFixed(1)) : 0,
      cortadoPorTiempo: stoppedEarly,
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await client.end();
  }
};

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }));
  const p = JSON.parse(secret.SecretString!);
  return `postgresql://${p.username}:${encodeURIComponent(p.password)}@${p.host}:${p.port}/${p.dbname}`;
}
