// ============================================================
// URL canonicalizer — dedup key compartida entre Brandwatch y manual imports
// ============================================================
//
// Reglas (orden de aplicación):
//   1. Trim, lowercase scheme + host
//   2. Strip `www.` y `m.` del host
//   3. Mapeos por plataforma:
//        twitter.com / mobile.twitter.com / x.com  → x.com
//          /(:user)?/status/:id  → /i/status/:id  (handle puede cambiar)
//          /i/web/status/:id     → /i/status/:id
//        youtu.be/:id           → youtube.com/watch?v=:id
//        youtube.com/shorts/:id → youtube.com/watch?v=:id
//        youtube.com/embed/:id  → youtube.com/watch?v=:id
//        reddit.com paths:      collapse /r/x/comments/id/title → /r/x/comments/id
//   4. Strip query params de tracking: utm_*, fbclid, gclid, igshid, _ga,
//      mc_*, ref_*, ref, source, src, s, t, si, share, share_id
//   5. Sort remaining query params alfabéticamente
//   6. Strip trailing slash (excepto cuando el path es solo "/")
//   7. Strip fragment (#...)
//
// Devuelve null para URLs inválidas (no parseables como URL absoluta).
//
// IMPORTANT: esta función es pura y sincrónica. Para shortened URLs
// (t.co, bit.ly, lnkd.in, etc.) se debe llamar primero a `expandShortened`
// que sigue el redirect HTTP HEAD antes de canonicalizar.

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'dclid',
  'igshid', 'igsh',
  '_ga', '_gl',
  'mc_cid', 'mc_eid',
  'ref', 'ref_src', 'ref_url', 'referer', 'referrer', 'source', 'src',
  's', 't', 'si',
  'share', 'share_id', 'shared',
  'feature',
]);

const SHORT_DOMAINS = new Set([
  't.co', 'bit.ly', 'tinyurl.com', 'shorturl.at', 'ow.ly', 'buff.ly',
  'lnkd.in', 'goo.gl', 'cutt.ly', 'rebrand.ly', 'is.gd', 'tiny.cc',
  'rb.gy', 'short.io', 'fb.me', 'fb.watch', 'youtu.be',
  // Nota: youtu.be entra aquí porque es un shortener técnicamente, pero
  // lo expandimos in-place (no via HEAD) en canonicalizeUrl directamente.
]);

export function isShortenedDomain(host: string): boolean {
  return SHORT_DOMAINS.has(host.toLowerCase().replace(/^www\./, ''));
}

/**
 * Canonicaliza una URL para dedup. Devuelve null si la entrada no parsea
 * como URL absoluta (ej. "foo bar", "/path-only").
 */
export function canonicalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    // Intento con esquema implícito
    try {
      u = new URL(`https://${trimmed}`);
    } catch {
      return null;
    }
  }

  // Solo http/https. fbschemes, mailto, etc → null
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  // Normalize host
  let host = u.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  if (host.startsWith('m.') && !host.startsWith('m.media-')) host = host.slice(2);

  let path = u.pathname;
  let searchParams = new URLSearchParams(u.search);

  // --- Twitter / X ---
  if (host === 'twitter.com' || host === 'mobile.twitter.com' || host === 'x.com') {
    host = 'x.com';
    // /:user/status/:id  → /i/status/:id
    // /i/web/status/:id  → /i/status/:id
    // /i/status/:id     → /i/status/:id (no change)
    const statusMatch = path.match(/^\/(?:i\/(?:web\/)?status|[^/]+\/status)\/(\d+)/i);
    if (statusMatch) {
      path = `/i/status/${statusMatch[1]}`;
    }
  }

  // --- YouTube ---
  if (host === 'youtu.be') {
    const idMatch = path.match(/^\/([A-Za-z0-9_-]{6,})/);
    if (idMatch) {
      host = 'youtube.com';
      path = '/watch';
      searchParams = new URLSearchParams();
      searchParams.set('v', idMatch[1]);
    }
  } else if (host === 'youtube.com' || host === 'm.youtube.com') {
    host = 'youtube.com';
    const shortsMatch = path.match(/^\/shorts\/([A-Za-z0-9_-]{6,})/);
    const embedMatch = path.match(/^\/embed\/([A-Za-z0-9_-]{6,})/);
    const id = shortsMatch?.[1] ?? embedMatch?.[1];
    if (id) {
      path = '/watch';
      searchParams = new URLSearchParams();
      searchParams.set('v', id);
    }
  }

  // --- Reddit: collapse /r/{sub}/comments/{id}/{title}/  → /r/{sub}/comments/{id} ---
  if (host === 'reddit.com' || host === 'old.reddit.com' || host === 'new.reddit.com') {
    host = 'reddit.com';
    const redditMatch = path.match(/^\/r\/([^/]+)\/comments\/([^/]+)/);
    if (redditMatch) {
      path = `/r/${redditMatch[1]}/comments/${redditMatch[2]}`;
    }
  }

  // --- Facebook: m.facebook → facebook.com ---
  if (host === 'm.facebook.com' || host === 'web.facebook.com') {
    host = 'facebook.com';
  }

  // --- Instagram: m.instagram → instagram.com ---
  if (host === 'm.instagram.com') {
    host = 'instagram.com';
  }

  // Strip tracking params
  const filteredParams = new URLSearchParams();
  const keys: string[] = [];
  searchParams.forEach((_value, key) => {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) keys.push(key);
  });
  keys.sort();
  for (const k of keys) {
    const v = searchParams.get(k);
    if (v !== null) filteredParams.append(k, v);
  }
  const queryString = filteredParams.toString();

  // Strip trailing slash (except root)
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  return `${host}${path}${queryString ? '?' + queryString : ''}`;
}

/**
 * Expande una URL acortada siguiendo el primer redirect HTTP HEAD. Para
 * dominios conocidos de shorteners (t.co, bit.ly, etc.). Si no es un
 * shortener, devuelve el input sin tocar. Si HEAD falla o timeout, devuelve
 * el input — la canonicalización funciona aunque sea con la URL corta.
 *
 * Solo sigue 1 redirect (no recursivo) — los shorteners legítimos rara vez
 * encadenan. Timeout 3s. Usa AbortController para cancelar.
 */
export async function expandShortened(raw: string): Promise<string> {
  if (!raw) return raw;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!SHORT_DOMAINS.has(host) || host === 'youtu.be') {
    // youtu.be tiene canonicalización in-place (no HEAD)
    return raw;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(raw, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
    });
    // 3xx con Location → expandir
    const loc = res.headers.get('location');
    if (loc) {
      // Si Location es relativa al shortener, ignorar.
      if (loc.startsWith('http')) return loc;
    }
  } catch {
    // Timeout / network → fallback al original
  } finally {
    clearTimeout(timer);
  }
  return raw;
}

/**
 * Helper conveniente: expande shortener (si aplica) y luego canonicaliza.
 * Usa esto en el preview lambda y en el scraper de URL para garantizar la
 * misma llave de dedup que las menciones de Brandwatch.
 */
export async function expandAndCanonicalize(raw: string): Promise<string | null> {
  const expanded = await expandShortened(raw);
  return canonicalizeUrl(expanded);
}

/**
 * Detecta plataforma a partir del host normalizado. Útil para el scraper
 * dispatcher y para setear `page_type` cuando el Excel no lo trae.
 */
export type ScrapePlatform =
  | 'twitter' | 'facebook' | 'instagram' | 'youtube' | 'tiktok'
  | 'reddit' | 'linkedin' | 'tumblr' | 'web' | 'unknown';

export function detectPlatform(url: string): ScrapePlatform {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
  if (host === 'twitter.com' || host === 'x.com' || host.endsWith('.twitter.com') || host.endsWith('.x.com')) return 'twitter';
  if (host === 'facebook.com' || host === 'fb.com' || host.endsWith('.facebook.com') || host === 'fb.watch') return 'facebook';
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
  if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) return 'youtube';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) return 'reddit';
  if (host === 'linkedin.com' || host === 'lnkd.in' || host.endsWith('.linkedin.com')) return 'linkedin';
  if (host === 'tumblr.com' || host.endsWith('.tumblr.com')) return 'tumblr';
  return 'web';
}
