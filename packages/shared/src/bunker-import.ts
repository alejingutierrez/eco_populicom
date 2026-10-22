// ============================================================
// ECO Platform — Importación de menciones desde exportes de Bunker
// ============================================================
//
// Para agencias que NO entran por Brandwatch (la primera: DF, Departamento de
// la Familia, oct-2026). El usuario descarga de Bunker un xlsx con una fila
// por mención; `scripts/import-bunker-xlsx.ts` lo lee, convierte cada fila a
// la misma forma `BrandwatchMention` que produce eco-ingestion y la encola en
// SQS `eco-ingestion`. Desde ahí todo es el pipeline de siempre: eco-processor
// deduplica, baja el cuerpo del artículo, clasifica con Claude (sentimiento,
// pertinencia, tópicos, municipios), guarda el embedding y empuja las alertas.
//
// Cómo encuentra el processor la agencia: por `queryId` contra
// `agencies.brandwatch_query_ids`. Las fuentes importadas usan un id NEGATIVO
// (DF = -1001) que nunca choca con uno de Brandwatch, con
// `brandwatch_project_id = NULL` para que eco-ingestion no intente pedirle ese
// query a la API de Brandwatch (selecciona `brandwatch_project_id IS NOT NULL`).
//
// Hechos del formato de Bunker (verificados contra el primer exporte, 3,766
// filas, 16-oct-2026):
// - DATE + TIME vienen en hora de Buenos Aires (UTC−3, sin horario de
//   verano): Metro publicó una nota a las 20:50:21Z y el exporte dice 17:50:21.
// - URL_PHOTO es una miniatura de 50 px servida por el imgproxy de Bunker con
//   la URL original codificada después de `/plain/`. Se usa la ORIGINAL, no la
//   de Bunker: avatar (graph.facebook.com, pbs.twimg.com/profile_images) o
//   imagen del contenido (og:image del artículo, miniatura de YouTube). En
//   Instagram siempre es el logo de Instagram de Wikimedia: se descarta.
// - Interacciones: en Facebook, Instagram, YouTube y web
//   INTERACTIONS = LIKE + COMMENT + SHARE; en X los likes están en
//   FAVORITE_COUNT y los reposts en RETWEET_COUNT; en TikTok en DIGG_COUNT.
// - La misma URL puede repetirse en un exporte (la misma publicación capturada
//   dos veces): el resourceId sale de la URL normalizada, así que la segunda
//   cae en el dedup del processor, igual que al reimportar un exporte que se
//   solapa con el anterior.

import type { BrandwatchMention } from './types';

/** Una fila del xlsx de Bunker, por nombre de columna. */
export type BunkerRow = Record<string, unknown>;

/** ¿El queryId corresponde a una fuente importada (no Brandwatch)? */
export function isImportQueryId(queryId: number): boolean {
  return Number.isFinite(queryId) && queryId < 0;
}

/**
 * Una agencia está archivada (dejó de recolectar, el dashboard avisa que no
 * se actualiza) cuando no tiene NINGUNA fuente: ni proyecto de Brandwatch ni
 * query alguno. Antes bastaba con `brandwatch_project_id IS NULL`, pero una
 * agencia importada tampoco tiene proyecto y sí recibe menciones.
 */
export function isArchivedAgency(a: {
  brandwatchProjectId: number | string | null | undefined;
  brandwatchQueryIds: number[] | null | undefined;
}): boolean {
  return a.brandwatchProjectId == null && !(a.brandwatchQueryIds && a.brandwatchQueryIds.length > 0);
}

const str = (v: unknown): string => (v == null ? '' : String(v)).trim();

function num(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Entero no negativo acotado al rango de `integer` de Postgres. */
function int(v: unknown): number {
  return Math.max(0, Math.min(2_147_483_647, Math.round(num(v))));
}

/**
 * URL canónica para el dedup: sin fragmento, sin parámetros utm_ ni fbclid, host
 * en minúsculas y sin barra final. Dos exportes que capturan la misma
 * publicación producen el mismo resourceId.
 */
export function normalizeMentionUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    for (const k of Array.from(u.searchParams.keys())) {
      if (/^utm_|^fbclid$|^igsh$|^si$/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString().replace(/\/+$/, '');
  } catch {
    return raw.trim();
  }
}

/** cyrb53: hash de 53 bits, determinista y sin dependencias (sirve en Node y en el navegador). */
function cyrb53(s: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** `bunker-<28 hex>`: dos hashes de 53 bits de la URL normalizada (~106 bits). */
export function bunkerResourceId(url: string): string {
  const n = normalizeMentionUrl(url);
  const hex = (x: number) => x.toString(16).padStart(14, '0');
  return `bunker-${hex(cyrb53(n, 0))}${hex(cyrb53(n, 1))}`;
}

/** DATE ('2026-10-16') + TIME ('18:30:39') en UTC−3 → ISO en UTC. */
export function bunkerDateToIso(date: unknown, time: unknown): string | null {
  const d = str(date).slice(0, 10);
  const t = str(time) || '00:00:00';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return null;
  const hms = t.length <= 5 ? `${t}:00` : t;
  const parsed = new Date(`${d}T${hms.padStart(8, '0')}-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** La URL original que el imgproxy de Bunker codifica tras `/plain/`. */
export function bunkerOriginalImageUrl(photo: unknown): string | null {
  const p = str(photo);
  if (!p) return null;
  const m = p.match(/\/plain\/(.+)$/);
  if (!m) return null;
  try {
    const orig = decodeURIComponent(m[1]);
    return /^https?:\/\//i.test(orig) ? orig : null;
  } catch {
    return null;
  }
}

const AVATAR_HOST_RE = /(^|\.)graph\.facebook\.com$|(^|\.)pbs\.twimg\.com$/i;
const GENERIC_PHOTO_RE = /upload\.wikimedia\.org\/.*Instagram_logo/i;

/** Primer país de LOCATIONS en el formato de Brandwatch (nombre + ISO-3). */
const COUNTRIES: Record<string, [string, string]> = {
  PR: ['Puerto Rico', 'PRI'],
  US: ['United States', 'USA'],
  MX: ['Mexico', 'MEX'],
  BR: ['Brazil', 'BRA'],
  UY: ['Uruguay', 'URY'],
  PA: ['Panama', 'PAN'],
  PE: ['Peru', 'PER'],
  PY: ['Paraguay', 'PRY'],
  SV: ['El Salvador', 'SLV'],
  SE: ['Sweden', 'SWE'],
  ES: ['Spain', 'ESP'],
  DO: ['Dominican Republic', 'DOM'],
  CO: ['Colombia', 'COL'],
  VE: ['Venezuela', 'VEN'],
  AR: ['Argentina', 'ARG'],
};

interface SourceShape {
  pageType: string;
  domain: string | null;
  contentSource: string | null;
  contentSourceName: string | null;
  pubType: string | null;
}

/**
 * SOURCE_TYPE de Bunker → los valores que usa Brandwatch para esa red. Bunker
 * escucha publicaciones PÚBLICAS, así que Facebook e Instagram van como
 * `*_public` (los `facebook`/`instagram` a secas son canales propios
 * conectados; sus comentarios cuentan aparte en Sentimiento). Web → `news`
 * para que el processor baje el cuerpo del artículo.
 */
function sourceShape(sourceType: string, url: string): SourceShape {
  let host: string | null = null;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    host = null;
  }
  switch (sourceType) {
    case 'facebook':
      return { pageType: 'facebook_public', domain: 'facebook.com', contentSource: 'facebook_public', contentSourceName: 'Facebook Public', pubType: 'FACEBOOK_PUBLIC' };
    case 'instagram':
      return { pageType: 'instagram_public', domain: 'instagram.com', contentSource: 'instagram_public', contentSourceName: 'Instagram Public', pubType: 'INSTAGRAM_GRAPH_PUBLIC' };
    case 'twitter':
      return { pageType: 'twitter', domain: 'x.com', contentSource: null, contentSourceName: null, pubType: null };
    case 'youtube':
      return { pageType: 'youtube', domain: 'youtube.com', contentSource: 'youtube', contentSourceName: 'YouTube', pubType: null };
    case 'tiktok':
      return { pageType: 'tiktok', domain: 'tiktok.com', contentSource: null, contentSourceName: null, pubType: null };
    default:
      return { pageType: 'news', domain: host, contentSource: 'news', contentSourceName: 'Online News', pubType: null };
  }
}

/** Handle desde la URL cuando la red lo pone ahí (X: /<handle>/status, TikTok: /@handle). */
function handleFromUrl(sourceType: string, url: string): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (sourceType === 'twitter' && parts.length >= 2 && parts[1] === 'status') return parts[0];
    if (sourceType === 'tiktok' && parts[0]?.startsWith('@')) return parts[0].slice(1);
  } catch {
    /* URL inválida: sin handle */
  }
  return null;
}

function subtypeOf(sourceType: string, url: string): string | null {
  if (sourceType === 'youtube' || sourceType === 'tiktok') return 'video';
  if (/\/(reel|reels|videos|watch)\b/i.test(url)) return 'video';
  return null;
}

export interface BunkerMappingContext {
  /** queryId de la agencia (negativo: ver isImportQueryId). */
  queryId: number;
  /** Nombre del query; si falta se usa `Bunker · <KEYWORD_NAME>`. */
  queryName?: string;
}

/**
 * Convierte una fila del exporte de Bunker en la mención que espera
 * eco-processor. Devuelve null si la fila no tiene URL o fecha utilizable
 * (sin URL no hay resourceId estable; sin fecha el processor la rechaza).
 */
export function bunkerRowToMention(row: BunkerRow, ctx: BunkerMappingContext): BrandwatchMention | null {
  const url = str(row.URL);
  const date = bunkerDateToIso(row.DATE, row.TIME);
  if (!url || !date) return null;

  const sourceType = str(row.SOURCE_TYPE).toLowerCase();
  const shape = sourceShape(sourceType, url);
  const from = str(row.FROM);
  const byline = str(row.AUTHOR);
  const title = str(row.TITLE) || null;
  const matched = str(row.MENTION_SNIPPET) || null;

  // En redes, TITLE es el texto de la publicación (Bunker lo corta a 350) y
  // MENTION_SNIPPET, cuando viene, el fragmento donde casó el query: el texto
  // a analizar es la unión. En web, TITLE es el titular y el processor baja
  // el cuerpo completo del artículo.
  const isWeb = shape.pageType === 'news';
  const snippet = isWeb
    ? matched
    : [title, matched && !(title ?? '').includes(matched) ? matched : null].filter(Boolean).join(' … ') || null;

  // Autor: en redes la voz es la cuenta (FROM); en X y TikTok, como en
  // Brandwatch, el handle va en `author` y el nombre visible en `fullname`.
  // En web la voz es el byline (AUTHOR) y el medio queda en `domain`.
  const handle = handleFromUrl(sourceType, url);
  let author: string | null;
  let fullname: string | null;
  if (isWeb) {
    author = byline || from || null;
    fullname = null;
  } else if (handle) {
    author = handle;
    fullname = from && from.toLowerCase() !== handle.toLowerCase() ? `${handle} (${from})` : handle;
  } else {
    author = from || byline || null;
    fullname = from || byline || null;
  }

  const photo = bunkerOriginalImageUrl(row.URL_PHOTO);
  let avatarUrl: string | null = null;
  const mediaUrls: string[] = [];
  if (photo && !GENERIC_PHOTO_RE.test(photo)) {
    let host = '';
    try { host = new URL(photo).hostname; } catch { host = ''; }
    if (AVATAR_HOST_RE.test(host)) avatarUrl = photo;
    else mediaUrls.push(photo);
  }

  let likes = int(row.LIKE_COUNT);
  let shares = int(row.SHARE_COUNT);
  if (sourceType === 'twitter') {
    likes = int(row.FAVORITE_COUNT) || likes;
    shares = int(row.RETWEET_COUNT) || int(row.REPOST_COUNT) || shares;
  } else if (sourceType === 'tiktok') {
    likes = Math.max(likes, int(row.DIGG_COUNT));
  }
  const comments = int(row.COMMENT_COUNT);

  const firstLoc = str(row.LOCATIONS).split(',')[0]?.trim().toUpperCase() ?? '';
  const country = COUNTRIES[firstLoc] ?? null;
  const language = (str(row.LANGUAGES).split(',')[0]?.trim().toLowerCase() || 'es').slice(0, 10);

  return {
    resourceId: bunkerResourceId(url),
    guid: null,
    queryId: ctx.queryId,
    queryName: ctx.queryName ?? `Bunker · ${str(row.KEYWORD_NAME) || 'importación'}`,
    title,
    snippet,
    url,
    originalUrl: url,
    author,
    fullname,
    gender: null,
    avatarUrl,
    domain: shape.domain ?? '',
    pageType: shape.pageType,
    contentSource: shape.contentSource,
    contentSourceName: shape.contentSourceName,
    pubType: shape.pubType,
    subtype: subtypeOf(sourceType, url),
    likes,
    comments,
    shares,
    engagementScore: likes + comments + shares,
    // Bunker da un INFLUENCE_SCORE de 0 a 10; Brandwatch, un impacto de 0 a 100.
    impact: Math.max(0, Math.min(100, num(row.INFLUENCE_SCORE) * 10)),
    reachEstimate: int(row.REACH),
    potentialAudience: int(row.FOLLOWERS_COUNT) || int(row.AUTHOR_FOLLOWER_COUNT),
    monthlyVisitors: 0,
    country: country?.[0] ?? null,
    countryCode: country?.[1] ?? null,
    region: null,
    city: null,
    cityCode: null,
    sentiment: str(row.SENTIMENT).toLowerCase() || 'neutral',
    language,
    date,
    added: date,
    updated: date,
    mediaUrls,
    matchPositions: [],
  };
}

/**
 * Identidad de la PUBLICACIÓN, no de la URL: el id que la red le da al post
 * (status de X, post/reel/video de Facebook, código de Instagram, video de
 * YouTube o TikTok). Dos URL distintas de lo mismo —twitter.com vs x.com,
 * youtu.be vs watch?v=, un post de Facebook con o sin slug— dan la misma
 * clave, aunque su resourceId (hash de la URL) sea distinto. En web la clave
 * es la URL sin protocolo, www, query ni barra final.
 *
 * Un COMENTARIO es su propia publicación aunque su URL sea la del post con
 * un parámetro (`&lc=` en YouTube, `#channels_comment_` en Facebook):
 * Brandwatch los entrega así y antes colapsaban con el post. En web se
 * conserva la query (hay sitios que identifican la nota con `?id=`) salvo
 * los parámetros de rastreo o de vista.
 *
 * No sustituye al resourceId (que sigue siendo la llave del dedup del
 * processor): es la segunda red que usa el plan de importación contra lo que
 * ya está en la base, y eco-processor en las agencias con dos fuentes.
 */
export function mentionPlatformKey(url: string): string {
  const u = (url ?? '').trim();
  const patterns: [RegExp, string][] = [
    [/youtube\.com\/.*[?&]lc=([\w-]{10,})/i, 'ytc'],
    [/facebook\.com\/.*#channels_comment_(\d{6,})/i, 'fbc'],
    [/[?&]comment_id=(\d{6,})/i, 'fbc'],
    [/(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d+)/i, 'x'],
    [/facebook\.com\/.*?\/(?:posts|videos)\/(?:[^/]*\/)?(\d{6,})/i, 'fb'],
    [/facebook\.com\/(?:reel|watch\/?\?v=)\/?(\d{6,})/i, 'fb'],
    [/[?&]story_fbid=(\d{6,})/i, 'fb'],
    [/[?&]fbid=(\d{6,})/i, 'fb'],
    [/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([\w-]{5,})/i, 'ig'],
    [/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i, 'yt'],
    [/tiktok\.com\/@[^/]+\/(?:video|photo)\/(\d+)/i, 'tt'],
  ];
  for (const [re, net] of patterns) {
    const m = u.match(re);
    if (m) return `${net}:${m[1]}`;
  }
  return `url:${webKey(u)}`;
}

/** Parámetros que no cambian QUÉ nota es (rastreo, vista, comentarios). */
const VIEW_PARAMS = /^(utm_.*|fbclid|gclid|igsh|si|s|ref|ref_src|amp|noamp|output|outputtype|scrolltocomments|mc_cid|mc_eid|cmpid|_ga)$/i;

function webKey(raw: string): string {
  const n = normalizeMentionUrl(raw);
  try {
    const x = new URL(n);
    const params = Array.from(x.searchParams.entries())
      .filter(([k]) => !VIEW_PARAMS.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const path = x.pathname.replace(/\/+$/, '');
    const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
    return `${x.hostname.replace(/^www\./i, '')}${path}${query}`.toLowerCase();
  } catch {
    return n.replace(/^https?:\/\/(www\.)?/i, '').split('?')[0].replace(/\/+$/, '').toLowerCase();
  }
}

/** Columnas sin las que un archivo no es un exporte de Bunker utilizable. */
export const BUNKER_REQUIRED_COLUMNS = ['URL', 'DATE', 'TIME', 'SOURCE_TYPE'] as const;

export interface BunkerMappedFile {
  /** Menciones únicas del archivo, de la más vieja a la más nueva. */
  mentions: BrandwatchMention[];
  rows: number;
  /** Filas sin URL o sin fecha utilizable. */
  invalid: number;
  /** Filas cuya URL (o publicación) ya apareció antes en el mismo archivo. */
  dupInFile: number;
  outOfRange: number;
  /** Columnas obligatorias que faltan (vacío = formato reconocido). */
  missingColumns: string[];
  /** Valor más repetido de KEYWORD_NAME (para avisar si el archivo es de otra agencia). */
  keyword: string | null;
}

/**
 * Lee las filas de un exporte de Bunker y devuelve las menciones únicas
 * (por URL normalizada y por publicación) más el recuento de lo que se
 * descartó y por qué. Es puro: el cruce contra la base lo hace quien llama
 * (el script y eco-mention-import), con `mentionPlatformKey` y el resourceId.
 */
export function mapBunkerRows(
  rows: BunkerRow[],
  ctx: BunkerMappingContext & { since?: string; until?: string },
): BunkerMappedFile {
  const header = new Set(rows.length ? Object.keys(rows[0]) : []);
  const missingColumns = BUNKER_REQUIRED_COLUMNS.filter((c) => !header.has(c));
  const byId = new Map<string, BrandwatchMention>();
  const seenKeys = new Set<string>();
  const keywords = new Map<string, number>();
  let invalid = 0;
  let dupInFile = 0;
  let outOfRange = 0;
  for (const row of rows) {
    const kw = str(row.KEYWORD_NAME);
    if (kw) keywords.set(kw, (keywords.get(kw) ?? 0) + 1);
    const m = bunkerRowToMention(row, ctx);
    if (!m) { invalid++; continue; }
    const day = m.date.slice(0, 10);
    if ((ctx.since && day < ctx.since) || (ctx.until && day > ctx.until)) { outOfRange++; continue; }
    const key = mentionPlatformKey(m.url ?? '');
    if (byId.has(m.resourceId) || seenKeys.has(key)) { dupInFile++; continue; }
    byId.set(m.resourceId, m);
    seenKeys.add(key);
  }
  const keyword = Array.from(keywords.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    mentions: Array.from(byId.values()).sort((a, b) => a.date.localeCompare(b.date) || a.resourceId.localeCompare(b.resourceId)),
    rows: rows.length,
    invalid,
    dupInFile,
    outOfRange,
    missingColumns,
    keyword,
  };
}
