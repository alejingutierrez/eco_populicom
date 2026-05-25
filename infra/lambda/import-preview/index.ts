/**
 * eco-import-preview — parsea uploads manuales y deja preview en DB.
 *
 * Trigger: invocación directa (InvocationType=Event) desde el API route
 * /api/admin/mentions/import/file o /url. Payload: `{ importId }`.
 *
 * Flujo:
 *   1. SELECT mention_imports WHERE id = importId
 *   2. UPDATE status='parsing'
 *   3a. sourceType='excel': GetObject S3 → xlsx.read → mapear filas a
 *       ManualMentionInput[] (header por nombre, no por índice)
 *   3b. sourceType='url'  : scrapeUrl(sourceUrl) → 1 ManualMentionInput
 *   4. Para cada input: canonicalizar (ya viene canonicalizado, redundancia
 *      defensiva), validar campos mínimos
 *   5. Batch SELECT mentions WHERE url_canonical = ANY(...) AND agency_id = ...
 *      para detectar duplicados / updates
 *   6. UPDATE mention_imports SET preview_json, rows_*, status='preview_ready'
 *
 * Cap: 500 filas por upload (sin contar duplicates). Si Excel tiene más,
 * status='failed' con mensaje claro.
 */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import {
  canonicalizeUrl,
  detectPlatform,
  expandShortened,
  scrapeUrl,
  type ManualMentionInput,
} from '@eco/shared';
import * as XLSX from 'xlsx';

const sm = new SecretsManagerClient({});
const s3 = new S3Client({});

const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
const IMPORTS_BUCKET = process.env.IMPORTS_BUCKET!;

// Cap de filas por upload. Originalmente 500 para acotar costo NLP. Subido
// a 2000 tras smoke testing — 2000 × ~$0.05 ≈ $100 worst case, y la mayoría
// de uploads reales en producción son re-imports de exports Brandwatch que
// dedup ≥80% a duplicate/update (NLP solo se corre en `new` y `update`).
// Si en el futuro cambia el patrón de uso, considerar reducirlo.
const MAX_ROWS = 2000;

let dbUrl: string | null = null;

interface ImportRow {
  id: string;
  agency_id: string;
  source_type: 'excel' | 'url';
  s3_key: string | null;
  source_url: string | null;
  default_timezone: string;
  status: string;
}

type PreviewStatus = 'new' | 'duplicate' | 'update' | 'error';

interface PreviewRow {
  rowIndex: number;
  status: PreviewStatus;
  urlCanonical?: string;
  errorMessage?: string;
  conflictMentionId?: string;
  fieldsToFill?: string[];
  mention?: ManualMentionInput;
}

export const handler = async (event: { importId: string }): Promise<{ statusCode: number; body: string }> => {
  const { importId } = event;
  if (!importId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'importId required' }) };
  }

  if (!dbUrl) dbUrl = await getDatabaseUrl();

  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const sel = await client.query<ImportRow>(
      `SELECT id, agency_id, source_type, s3_key, source_url, default_timezone, status
         FROM mention_imports WHERE id = $1`,
      [importId],
    );
    if (sel.rows.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: 'import not found' }) };
    }
    const imp = sel.rows[0];
    if (imp.status !== 'pending') {
      // Idempotente: si ya se procesó, no re-correr (evita double-spend en caso de retry)
      return { statusCode: 200, body: JSON.stringify({ message: `already ${imp.status}` }) };
    }

    await client.query(`UPDATE mention_imports SET status = 'parsing' WHERE id = $1`, [importId]);

    let inputs: ManualMentionInput[] = [];
    let parseErrors: { rowIndex: number; errorMessage: string; raw?: unknown }[] = [];

    if (imp.source_type === 'excel') {
      if (!imp.s3_key) throw new Error('Excel import without s3_key');
      const parsed = await parseExcelFromS3(imp.s3_key, imp.default_timezone);
      inputs = parsed.inputs;
      parseErrors = parsed.errors;
    } else if (imp.source_type === 'url') {
      if (!imp.source_url) throw new Error('URL import without source_url');
      const result = await scrapeAndBuild(imp.source_url, imp.default_timezone);
      if (result.ok) {
        inputs = [result.input];
      } else {
        parseErrors = [{ rowIndex: 0, errorMessage: result.error, raw: { url: imp.source_url } }];
      }
    } else {
      throw new Error(`Unknown source_type: ${imp.source_type}`);
    }

    // Hard cap: protege contra Excels gigantes que harían explotar costo
    // de NLP. Errores de parsing no cuentan al cap.
    if (inputs.length > MAX_ROWS) {
      await client.query(
        `UPDATE mention_imports
            SET status = 'failed',
                error_message = $2,
                total_rows = $3
          WHERE id = $1`,
        [importId, `Demasiadas filas: ${inputs.length}. Máximo ${MAX_ROWS} por upload. Divide el archivo.`, inputs.length],
      );
      return { statusCode: 200, body: JSON.stringify({ status: 'failed', reason: 'too_many_rows' }) };
    }

    // Batch dedup query — un solo SELECT
    const canonicals = inputs.map((i) => i.urlCanonical).filter(Boolean);
    let existingByCanonical = new Map<string, { id: string; missingFields: string[] }>();
    if (canonicals.length > 0) {
      const existing = await client.query(
        `SELECT id, url_canonical,
                title, snippet, author, author_fullname, author_avatar_url,
                likes, comments, shares, reach_estimate, potential_audience,
                media_urls, nlp_sentiment, nlp_emotions, nlp_pertinence, nlp_summary
           FROM mentions
          WHERE agency_id = $1 AND url_canonical = ANY($2::text[])`,
        [imp.agency_id, canonicals],
      );
      for (const row of existing.rows as Array<Record<string, unknown>>) {
        const missing: string[] = [];
        if (!row.title) missing.push('title');
        if (!row.snippet) missing.push('snippet');
        if (!row.author) missing.push('author');
        if (!row.author_fullname) missing.push('author_fullname');
        if (!row.author_avatar_url) missing.push('author_avatar_url');
        if ((row.likes as number) === 0) missing.push('likes');
        if ((row.comments as number) === 0) missing.push('comments');
        if ((row.shares as number) === 0) missing.push('shares');
        if ((row.reach_estimate as number) === 0) missing.push('reach_estimate');
        if (!row.nlp_sentiment) missing.push('nlp_sentiment');
        existingByCanonical.set(row.url_canonical as string, {
          id: row.id as string,
          missingFields: missing,
        });
      }
    }

    // Construir preview rows
    const preview: PreviewRow[] = [];
    let rowsNew = 0;
    let rowsDuplicate = 0;
    let rowsUpdate = 0;

    inputs.forEach((input, idx) => {
      const existing = existingByCanonical.get(input.urlCanonical);
      if (!existing) {
        preview.push({ rowIndex: idx, status: 'new', urlCanonical: input.urlCanonical, mention: input });
        rowsNew += 1;
      } else if (existing.missingFields.length === 0) {
        preview.push({
          rowIndex: idx,
          status: 'duplicate',
          urlCanonical: input.urlCanonical,
          conflictMentionId: existing.id,
        });
        rowsDuplicate += 1;
      } else {
        preview.push({
          rowIndex: idx,
          status: 'update',
          urlCanonical: input.urlCanonical,
          conflictMentionId: existing.id,
          fieldsToFill: existing.missingFields,
          mention: input,
        });
        rowsUpdate += 1;
      }
    });

    const parseErrorRows: PreviewRow[] = parseErrors.map((e) => ({
      rowIndex: e.rowIndex,
      status: 'error',
      errorMessage: e.errorMessage,
    }));

    const allPreview = [...preview, ...parseErrorRows];
    const totalRows = allPreview.length;

    await client.query(
      `UPDATE mention_imports SET
        status = 'preview_ready',
        total_rows = $2,
        rows_new = $3,
        rows_duplicate = $4,
        rows_update = $5,
        rows_error = $6,
        preview_json = $7::jsonb,
        errors_json = $8::jsonb
      WHERE id = $1`,
      [
        importId,
        totalRows,
        rowsNew,
        rowsDuplicate,
        rowsUpdate,
        parseErrors.length,
        JSON.stringify(allPreview),
        JSON.stringify(parseErrors),
      ],
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        importId,
        status: 'preview_ready',
        totalRows,
        rowsNew,
        rowsDuplicate,
        rowsUpdate,
        rowsError: parseErrors.length,
      }),
    };
  } catch (err) {
    console.error('import-preview failed:', err);
    await client.query(
      `UPDATE mention_imports SET status = 'failed', error_message = $2 WHERE id = $1`,
      [importId, (err as Error).message],
    );
    throw err;
  } finally {
    await client.end();
  }
};

// --------------------------------------------------------------
// Excel parser
// --------------------------------------------------------------

async function parseExcelFromS3(s3Key: string, defaultTz: string): Promise<{
  inputs: ManualMentionInput[];
  errors: { rowIndex: number; errorMessage: string; raw?: unknown }[];
}> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: IMPORTS_BUCKET, Key: s3Key }));
  if (!obj.Body) throw new Error(`S3 object empty: ${s3Key}`);
  const bytes = await obj.Body.transformToByteArray();
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('Excel sin sheets');

  // Convert to array-of-objects con header detection. xlsx maneja el header
  // por defecto (primera fila como keys). Header keys vienen como strings
  // exactos del Excel — los normalizamos con normalizeHeader.
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
    dateNF: 'yyyy-mm-dd',
  });

  const inputs: ManualMentionInput[] = [];
  const errors: { rowIndex: number; errorMessage: string; raw?: unknown }[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const row = normalizeHeaders(rawRows[i]);
    try {
      const input = await rowToManualInput(row, defaultTz);
      if (input) inputs.push(input);
    } catch (err) {
      errors.push({
        rowIndex: i,
        errorMessage: (err as Error).message,
        raw: { url: row.url, date: row.date, title: typeof row.title === 'string' ? row.title.slice(0, 80) : undefined },
      });
    }
  }

  return { inputs, errors };
}

/**
 * Normaliza claves del header: lowercase, replace whitespace y guiones por
 * underscores. BunkerDB exporta columnas como "DATE", "MENTION_SNIPPET",
 * "LIKE_COUNT" — todas se normalizan a snake_case lowercase. También maneja
 * variantes en español ("FECHA", "TITULO") si BunkerDB cambia idioma.
 */
function normalizeHeaders(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const normalized = k
      .trim()
      .toLowerCase()
      .replace(/[\s\-]+/g, '_')
      .replace(/[^\w]/g, '');
    out[normalized] = v;
  }
  return out;
}

/**
 * Mapea una fila normalizada a ManualMentionInput. Maneja:
 *   • DATE + TIME → ISO 8601 con TZ default
 *   • URL → canonicalizar (también expande shorteners)
 *   • SOURCE_TYPE → pageType + platform
 *   • Engagement metrics (LIKE_COUNT, FAVORITE_COUNT, LOVE_COUNT → max)
 *   • AUTO_SENTIMENT → bwSentiment
 *
 * Tira si falta URL o fecha. Otros campos son opcionales.
 */
async function rowToManualInput(
  row: Record<string, unknown>,
  defaultTz: string,
): Promise<ManualMentionInput | null> {
  const url = strOrNull(row.url) ?? strOrNull(row.link) ?? strOrNull(row.url_link);
  if (!url) throw new Error('Falta columna URL/link');

  // Date + Time. BunkerDB separa: DATE='2026-05-23', TIME='17:35:26'. Pueden
  // venir como Date object (xlsx cellDates) o strings.
  const dateRaw = row.date ?? row.fecha;
  const timeRaw = row.time ?? row.hora;
  const publishedAt = parseDateTime(dateRaw, timeRaw, defaultTz);
  if (!publishedAt) throw new Error('Falta o no parsea columna DATE/TIME');

  // Expansion + canonicalization
  let canonicalSource = url;
  try {
    const u = new URL(url);
    if (u.hostname) canonicalSource = await expandShortened(url);
  } catch { /* ignore */ }
  const urlCanonical = canonicalizeUrl(canonicalSource);
  if (!urlCanonical) throw new Error(`URL no canonicalizable: ${url}`);

  const sourceType = strOrNull(row.source_type) ?? '';
  const platform = detectPlatform(canonicalSource);
  const pageType = mapSourceTypeToPageType(sourceType, platform);
  const domain = safeDomain(canonicalSource);

  // Engagement aggregation — algunas plataformas usan distintos campos
  // (FAVORITE_COUNT en Twitter, LOVE_COUNT en Facebook reactions, etc.).
  // Tomamos el máximo no-NULL para no perder data.
  const likes = maxNum(row.like_count, row.favorite_count, row.love_count, row.reddit_score);
  const comments = numOrZero(row.comment_count);
  const shares = maxNum(row.share_count, row.retweet_count, row.repost_count, row.digg_count);
  const reach = numOrZero(row.reach);
  const followers = numOrZero(row.followers_count, row.author_follower_count);

  // BW sentiment del Excel
  const autoSent = strOrNull(row.auto_sentiment)?.toLowerCase();
  const manualSent = strOrNull(row.manual_sentiment)?.toLowerCase();
  const bwSentiment = mapSentiment(manualSent ?? autoSent);

  return {
    url: canonicalSource,
    urlCanonical,
    title: strOrNull(row.title) ?? strOrNull(row.headline) ?? undefined,
    snippet: strOrNull(row.mention_snippet) ?? strOrNull(row.snippet) ?? undefined,
    author: strOrNull(row.author) ?? strOrNull(row.from) ?? undefined,
    authorFullname: strOrNull(row.from) ?? undefined,
    authorAvatarUrl: strOrNull(row.url_photo) ?? undefined,
    domain,
    pageType,
    contentSource: sourceType || undefined,
    contentSourceName: strOrNull(row.tweet_source_name) ?? undefined,
    subtype: undefined,
    language: strOrNull(row.languages)?.toLowerCase().split(',')[0]?.trim() ?? 'es',
    publishedAt,
    likes,
    comments,
    shares,
    reachEstimate: reach,
    potentialAudience: followers,
    monthlyVisitors: 0,
    engagementScore: numOrZero(row.engagement_rate) * (reach || 1),
    impact: numOrZero(row.virality),
    bwSentiment,
    bwCountry: pickFirstLocation(row.locations),
    bwCity: undefined,
    mediaUrls: undefined,
  };
}

function strOrNull(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

function numOrZero(...vals: unknown[]): number {
  for (const v of vals) {
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function maxNum(...vals: unknown[]): number {
  let max = 0;
  for (const v of vals) {
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function mapSentiment(s: string | undefined): 'positive' | 'neutral' | 'negative' | undefined {
  if (!s) return undefined;
  if (s.startsWith('pos')) return 'positive';
  if (s.startsWith('neg')) return 'negative';
  if (s.startsWith('neu')) return 'neutral';
  return undefined;
}

function pickFirstLocation(v: unknown): string | undefined {
  const s = strOrNull(v);
  if (!s) return undefined;
  return s.split(',')[0]?.trim();
}

function mapSourceTypeToPageType(source: string, platform: string): string {
  if (source) {
    const s = source.toLowerCase();
    if (s.includes('twitter') || s.includes('x.com')) return 'twitter';
    if (s.includes('facebook')) return 'facebook';
    if (s.includes('instagram')) return 'instagram';
    if (s.includes('youtube')) return 'youtube';
    if (s.includes('tiktok')) return 'tiktok';
    if (s.includes('reddit')) return 'reddit';
    if (s.includes('linkedin')) return 'linkedin';
    if (s.includes('tumblr')) return 'tumblr';
    if (s === 'web' || s.includes('news')) return 'news';
  }
  if (platform !== 'unknown' && platform !== 'web') return platform;
  return 'web';
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Combina DATE + TIME a ISO 8601 con offset. La TZ default es la del import
 * (America/Puerto_Rico salvo override). Acepta:
 *   • Date object (xlsx con cellDates:true)
 *   • String '2026-05-23' o '5/23/2026' + TIME '17:35:26' o '5:35:26 PM'
 */
function parseDateTime(date: unknown, time: unknown, tz: string): string | null {
  if (!date) return null;

  let y: number, m: number, d: number;
  if (date instanceof Date && Number.isFinite(date.getTime())) {
    y = date.getUTCFullYear();
    m = date.getUTCMonth() + 1;
    d = date.getUTCDate();
  } else {
    const ds = String(date).trim();
    const iso = ds.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const us = ds.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (iso) {
      y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]);
    } else if (us) {
      m = Number(us[1]); d = Number(us[2]); y = Number(us[3]);
    } else {
      // Last resort: Date.parse
      const parsed = new Date(ds);
      if (!Number.isFinite(parsed.getTime())) return null;
      y = parsed.getUTCFullYear(); m = parsed.getUTCMonth() + 1; d = parsed.getUTCDate();
    }
  }

  let hh = 0, mm = 0, ss = 0;
  if (time) {
    if (time instanceof Date && Number.isFinite(time.getTime())) {
      hh = time.getUTCHours();
      mm = time.getUTCMinutes();
      ss = time.getUTCSeconds();
    } else {
      const ts = String(time).trim();
      const t24 = ts.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      const t12 = ts.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
      if (t12) {
        hh = Number(t12[1]) % 12;
        if (t12[4].toUpperCase() === 'PM') hh += 12;
        mm = Number(t12[2]); ss = t12[3] ? Number(t12[3]) : 0;
      } else if (t24) {
        hh = Number(t24[1]); mm = Number(t24[2]); ss = t24[3] ? Number(t24[3]) : 0;
      }
    }
  }

  // Construir ISO en la TZ indicada. Node tiene Intl.DateTimeFormat para
  // formatear, pero crear desde componentes en una TZ específica requiere
  // un offset calculado. Usamos un truco: construir como UTC, luego ajustar
  // por offset.
  const offset = getTimezoneOffsetMinutes(tz, new Date(Date.UTC(y, m - 1, d, hh, mm, ss)));
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const oh = Math.floor(abs / 60).toString().padStart(2, '0');
  const om = (abs % 60).toString().padStart(2, '0');
  const isoLocal = `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}T${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
  return `${isoLocal}${sign}${oh}:${om}`;
}

/**
 * Offset en minutos para una TZ y fecha dada. Usa Intl.DateTimeFormat con
 * timeZoneName='longOffset' (Node 18+ y modernos navegadores). Devuelve
 * negativo para zonas west of UTC (America/Puerto_Rico = -240 = -4h).
 */
function getTimezoneOffsetMinutes(tz: string, date: Date): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'longOffset',
    });
    const parts = fmt.formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    const m = tzPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (m) {
      const sign = m[1] === '+' ? 1 : -1;
      const h = Number(m[2]);
      const mm = m[3] ? Number(m[3]) : 0;
      return sign * (h * 60 + mm);
    }
  } catch {
    /* fallback */
  }
  // Default: America/Puerto_Rico = -4h
  return -240;
}

// --------------------------------------------------------------
// URL scraper → ManualMentionInput
// --------------------------------------------------------------

async function scrapeAndBuild(
  url: string,
  defaultTz: string,
): Promise<{ ok: true; input: ManualMentionInput } | { ok: false; error: string }> {
  try {
    const result = await scrapeUrl(url);

    if (result.scrapeMethod === 'manual_required') {
      // Aún así devolvemos el input con la URL canonicalizada para que el
      // admin pueda completar el resto en preview. El UI muestra los warns.
      const stub: ManualMentionInput = {
        url: result.url,
        urlCanonical: result.urlCanonical,
        domain: result.domain,
        pageType: mapSourceTypeToPageType(result.platform, result.platform),
        publishedAt: result.publishedAt?.toISOString() ?? new Date().toISOString(),
        language: result.language ?? 'es',
        title: result.title,
        snippet: result.snippet,
        author: result.author,
        authorFullname: result.authorFullname,
        authorAvatarUrl: result.authorAvatarUrl,
        mediaUrls: result.mediaUrls,
        likes: result.likes ?? 0,
        comments: result.comments ?? 0,
        shares: result.shares ?? 0,
        reachEstimate: result.reachEstimate ?? 0,
        potentialAudience: 0,
        monthlyVisitors: 0,
        engagementScore: 0,
        impact: 0,
      };
      return { ok: true, input: stub };
    }

    const publishedAt = result.publishedAt
      ? result.publishedAt.toISOString()
      : new Date().toISOString();

    const input: ManualMentionInput = {
      url: result.url,
      urlCanonical: result.urlCanonical,
      domain: result.domain,
      pageType: mapSourceTypeToPageType(result.platform, result.platform),
      publishedAt,
      language: result.language ?? 'es',
      title: result.title,
      snippet: result.snippet,
      author: result.author,
      authorFullname: result.authorFullname,
      authorAvatarUrl: result.authorAvatarUrl,
      mediaUrls: result.mediaUrls,
      likes: result.likes ?? 0,
      comments: result.comments ?? 0,
      shares: result.shares ?? 0,
      reachEstimate: result.reachEstimate ?? 0,
      potentialAudience: 0,
      monthlyVisitors: 0,
      engagementScore: 0,
      impact: 0,
    };
    return { ok: true, input };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// --------------------------------------------------------------
// DB helpers
// --------------------------------------------------------------

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }));
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}
