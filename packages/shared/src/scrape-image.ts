/**
 * scrape-image — resolución best-effort de una imagen representativa para una
 * mención. Sin dependencias pesadas: usa `fetch` global + AbortController (3s).
 *
 * La lógica de scraping (`fetchOgImage` + `validateImageUrl`) fue COPIADA desde
 * `infra/lambda/metrics-calculator/index.ts` (donde alimenta el hero del correo
 * semanal). Aquí se generaliza para menciones individuales con una cadena de
 * fallbacks: mediaUrl directa → thumbnail de YouTube → og:image (solo
 * news/blog/forum) → avatar del autor → null.
 *
 * Limitaciones conocidas (todas se traducen en null y se omiten):
 * - URLs detrás de auth (Facebook, X protegido) — el HTML no expone og:image.
 * - URLs que bloquean User-Agent genérico (algunos CDNs antibot).
 * - URLs que devuelven SPA shell sin meta tags pre-renderizados.
 */

const UA = 'Mozilla/5.0 (compatible; ECO-Radar/1.0; +https://populicom.com)';

/**
 * Decodifica las entidades HTML más comunes que aparecen en `content=` de un
 * `<meta>` (`&amp;`, `&#38;`, etc.). Las URLs de og:image suelen venir con `&`
 * escapado como `&amp;`, lo que rompe query strings de CDNs firmados.
 */
export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#0*38;/g, '&')
    .replace(/&#x0*26;/gi, '&');
}

/**
 * Extrae el ID de un video de YouTube de una URL (`?v=`, `youtu.be/`) y
 * devuelve la miniatura `hqdefault.jpg`. Devuelve null si no matchea.
 */
export function youtubeThumbFromUrl(url: string): string | null {
  if (!url) return null;
  const m = url.match(/[?&]v=([\w-]{11})/) ?? url.match(/youtu\.be\/([\w-]{11})/);
  if (!m || !m[1]) return null;
  return `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`;
}

/**
 * Hace best-effort scrape del `og:image` (con fallback a `twitter:image`)
 * de una URL. Timeout corto (3s) y catch-all para que un solo URL lento o
 * bloqueado no tumbe el caller. Devuelve null cuando no hay imagen utilizable.
 */
export async function fetchOgImage(url: string, timeoutMs = 3000): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // UA "realista" para que CDNs / sitios de noticias no nos sirvan página de bot.
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') ?? '';
    if (!ct.toLowerCase().includes('html')) return null;

    // Lee solo los primeros 64KB del HTML — los <meta> de OG siempre van en <head>.
    // Esto evita descargar megas innecesarios en sitios pesados.
    const reader = resp.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder('utf-8');
    let html = '';
    const MAX_BYTES = 64 * 1024;
    let read = 0;
    while (read < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      read += value.length;
      if (html.includes('</head>')) break;
    }
    try { await reader.cancel(); } catch { /* ignore */ }

    // Match flexible: content antes O después de property/name.
    const patterns: RegExp[] = [
      /<meta\s+[^>]*property=["'](?:og:image(?::secure_url|:url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["']/i,
      /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["'](?:og:image(?::secure_url|:url)?|twitter:image(?::src)?)["']/i,
      /<meta\s+[^>]*name=["'](?:twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["']/i,
    ];
    let img: string | null = null;
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) { img = m[1].trim(); break; }
    }
    if (!img) return null;

    // Decodifica entidades HTML (&amp;→& etc.) antes de validar — los CDNs
    // firmados rompen si el query string queda con `&amp;`.
    img = decodeHtmlEntities(img);

    // Normaliza URLs relativas / protocol-relative.
    if (img.startsWith('//')) img = 'https:' + img;
    if (img.startsWith('/')) {
      const u = new URL(url);
      img = `${u.origin}${img}`;
    }
    if (!/^https?:\/\//i.test(img)) return null;

    // Sanity: solo extensiones / paths que parecen imágenes. Algunos sitios
    // ponen rutas tipo /favicon o /logo.svg como og:image y eso queda feo.
    // No es una validación perfecta — es heurística.
    if (img.endsWith('.svg')) return null;

    // Límite empírico de longitud (proxies de imagen rechazan URLs largas).
    if (img.length > 1500) return null;

    // Validación final: HEAD a la URL de la imagen para confirmar que es
    // realmente una imagen (no HTML, no redirect a login, no 404).
    const ok = await validateImageUrl(img, timeoutMs);
    return ok ? img : null;
  } catch {
    return null;
  }
}

/**
 * Comprueba que `url` apunte a una imagen real, mediante un HEAD request.
 * Aceptamos solo `image/(jpeg|png|webp|gif)` con tamaño razonable (≥ 1KB y
 * ≤ 8MB). Si el servidor no soporta HEAD (algunos CDNs devuelven 405),
 * caemos a un GET parcial leyendo solo la primera respuesta.
 */
export async function validateImageUrl(url: string, timeoutMs = 3000): Promise<boolean> {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  const MIN_BYTES = 1024;
  const MAX_BYTES = 8 * 1024 * 1024;

  const checkHeaders = (resp: Response): boolean => {
    if (!resp.ok) return false;
    const ct = (resp.headers.get('content-type') ?? '').toLowerCase().split(';')[0].trim();
    if (!allowedTypes.includes(ct)) return false;
    const len = Number(resp.headers.get('content-length') ?? '0');
    if (len && (len < MIN_BYTES || len > MAX_BYTES)) return false;
    return true;
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept': 'image/*',
      },
    });
    clearTimeout(timer);
    if (resp.status === 405 || resp.status === 501) {
      // Server no soporta HEAD — fallback a GET con Range request.
      return await validateViaRangeGet(url, timeoutMs);
    }
    return checkHeaders(resp);
  } catch {
    return false;
  }
}

async function validateViaRangeGet(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept': 'image/*',
        // Pedimos solo los primeros 2KB — suficiente para confirmar magic bytes.
        'Range': 'bytes=0-2047',
      },
    });
    clearTimeout(timer);
    if (!resp.ok && resp.status !== 206) return false;
    const ct = (resp.headers.get('content-type') ?? '').toLowerCase().split(';')[0].trim();
    return ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'].includes(ct);
  } catch {
    return false;
  }
}

/**
 * Resuelve la mejor imagen representativa para una mención, siguiendo una
 * cadena de fallbacks de mayor a menor confianza:
 *   1. mediaUrl directa (Brandwatch ya nos dio una imagen del post).
 *   2. thumbnail de YouTube derivada de la URL del contenido.
 *   3. og:image scrapeada de la página — SOLO para news/blog/forum (evita
 *      pegarle a redes sociales que devuelven login walls o SPA shells).
 *   4. avatar del autor (mejor que nada para dar cara al feed).
 *   5. null.
 *
 * Nunca lanza — cualquier error de red se traduce en pasar al siguiente
 * eslabón o en null.
 */
export async function scrapeImageForMention(args: {
  mediaUrl?: string | null;
  pageType?: string | null;
  url?: string | null;
  avatarUrl?: string | null;
  timeoutMs?: number;
}): Promise<string | null> {
  const { mediaUrl, pageType, url, avatarUrl, timeoutMs = 3000 } = args;

  // 1) mediaUrl directa de Brandwatch.
  if (mediaUrl && /^https?:\/\//i.test(mediaUrl)) return mediaUrl;

  // 2) thumbnail de YouTube.
  if (url) {
    const yt = youtubeThumbFromUrl(url);
    if (yt) return yt;
  }

  // 3) og:image — solo para tipos de página que suelen pre-renderizar meta tags.
  const pt = (pageType ?? '').toLowerCase();
  if (url && (pt === 'news' || pt === 'blog' || pt === 'forum')) {
    const og = await fetchOgImage(url, timeoutMs);
    if (og) return og;
  }

  // 4) avatar del autor.
  if (avatarUrl && /^https?:\/\//i.test(avatarUrl)) return avatarUrl;

  // 5) nada utilizable.
  return null;
}
