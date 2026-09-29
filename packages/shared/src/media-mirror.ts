/**
 * Copia propia de las imágenes que CADUCAN.
 *
 * Medido el 29-sep-2026 sobre 60 imágenes guardadas de los últimos 90 días:
 * las de medios (El Nuevo Día, El Vocero, Metro…) y YouTube siguen cargando
 * meses después —la firma `auth=` del resizer de Arc es fija, no temporal—,
 * pero las del CDN de Facebook/Instagram llevan su vencimiento en la URL
 * (`oe=<hex unix>`) y responden 403 unos 5 días después de publicadas: 1 de
 * 22 seguía viva. Eso rompía las miniaturas de redes en el dashboard y en
 * los correos ya enviados.
 *
 * El processor resuelve la imagen minutos después de la publicación, cuando
 * la URL todavía es válida: ahí se descarga, se guarda en S3 (`media/`) y la
 * mención pasa a apuntar a una URL propia estable servida por la app
 * (`/media/<clave>`). Este módulo no depende del SDK de S3: quien lo llama
 * inyecta `put`.
 */

const EXPIRING_HOSTS: RegExp[] = [
  /(^|\.)fbcdn\.net$/i,        // Facebook / Instagram (scontent-*.xx.fbcdn.net)
  /(^|\.)cdninstagram\.com$/i, // Instagram
];

/** Parámetros de URL que fijan un vencimiento (CDN de Meta, S3 prefirmado). */
const EXPIRY_PARAMS = ['oe', 'x-amz-expires', 'expires'];

/** ¿Esta URL de imagen dejará de servir en unos días? */
export function isExpiringImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (EXPIRING_HOSTS.some((re) => re.test(u.hostname))) return true;
  for (const k of u.searchParams.keys()) {
    if (EXPIRY_PARAMS.includes(k.toLowerCase())) return true;
  }
  return false;
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Clave estable de una imagen: SHA-256 de su URL de origen, 32 hex. */
export async function mediaKeyFor(sourceUrl: string, contentType: string): Promise<string | null> {
  const ext = EXT_BY_TYPE[contentType.split(';')[0].trim().toLowerCase()];
  if (!ext) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceUrl));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 32)}.${ext}`;
}

/** Forma válida de una clave pública (la ruta `/media/<clave>` la exige). */
export const MEDIA_KEY_RE = /^[a-f0-9]{32}\.(jpg|png|webp|gif)$/;

export interface MirrorOptions {
  /** Guarda el objeto en `media/<key>` (S3 PutObject en el processor). */
  put: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
  /** Base pública, sin barra final: "https://citizenecho.com/media". */
  publicBaseUrl: string;
  timeoutMs?: number;
  /** Tope de tamaño; una imagen más grande no se copia. Default 5 MB. */
  maxBytes?: number;
}

/**
 * Descarga la imagen y la guarda como copia propia. Devuelve la URL pública
 * estable, o null si no se pudo (el caller conserva la URL original, que es
 * exactamente lo que pasaba antes). Nunca lanza.
 */
export async function mirrorImage(sourceUrl: string, opts: MirrorOptions): Promise<string | null> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 5000);
  try {
    const res = await fetch(sourceUrl, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ECO-Radar/1.0; +https://citizenecho.com)' },
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > maxBytes) return null;
    const key = await mediaKeyFor(sourceUrl, contentType);
    if (!key) return null;
    const body = new Uint8Array(await res.arrayBuffer());
    if (body.byteLength === 0 || body.byteLength > maxBytes) return null;
    await opts.put(key, body, contentType === 'image/jpg' ? 'image/jpeg' : contentType);
    return `${opts.publicBaseUrl.replace(/\/+$/, '')}/${key}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
