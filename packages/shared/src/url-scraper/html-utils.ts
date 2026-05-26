// ============================================================
// HTML parsing utilities — regex-based, sin deps
// ============================================================
//
// Por qué no usamos cheerio: el scraper corre en lambdas con bundle limits
// y queremos mantener @eco/shared puro (zero runtime deps). Para los tags
// que nos importan (OG tags, Twitter cards, JSON-LD), regex es suficiente:
// los sitios serios siempre usan la sintaxis estándar `<meta property="..."
// content="...">` y JSON-LD en `<script type="application/ld+json">`.

/**
 * Extrae el primer `<meta>` tag que matchee {property|name}=`<value>`.
 * Soporta tanto orden `property="og:x" content="y"` como `content="y"
 * property="og:x"` y variantes con name= en lugar de property=.
 */
export function extractMetaContent(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // property="og:x" content="..."
  let m = html.match(
    new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']*)["'][^>]*>`,
      'i',
    ),
  );
  if (m?.[1]) return decodeHtmlEntities(m[1]);
  // content="..." property="og:x"
  m = html.match(
    new RegExp(
      `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*>`,
      'i',
    ),
  );
  if (m?.[1]) return decodeHtmlEntities(m[1]);
  return undefined;
}

/** Extrae el primer `<title>...</title>`. */
export function extractTitleTag(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m?.[1]) return decodeHtmlEntities(stripTags(m[1])).trim();
  return undefined;
}

/**
 * Extrae todos los bloques JSON-LD. Devuelve el primero que tenga `@type`
 * matching `Article` | `NewsArticle` | `SocialMediaPosting` (los que traen
 * `headline`, `datePublished`, `author`).
 */
export function extractJsonLdArticle(html: string): Record<string, unknown> | undefined {
  const regex = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const candidates: Record<string, unknown>[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      // JSON-LD puede ser array o objeto
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object') candidates.push(item);
        }
      } else if (parsed && typeof parsed === 'object') {
        candidates.push(parsed);
        // @graph nest
        const graph = (parsed as Record<string, unknown>)['@graph'];
        if (Array.isArray(graph)) {
          for (const item of graph) {
            if (item && typeof item === 'object') candidates.push(item as Record<string, unknown>);
          }
        }
      }
    } catch {
      // skip malformed JSON-LD
    }
  }
  const articleTypes = new Set(['Article', 'NewsArticle', 'BlogPosting', 'SocialMediaPosting', 'Report']);
  for (const c of candidates) {
    const t = c['@type'];
    if (typeof t === 'string' && articleTypes.has(t)) return c;
    if (Array.isArray(t) && t.some((x) => typeof x === 'string' && articleTypes.has(x))) return c;
  }
  return candidates[0];
}

/** Strip HTML tags retornando solo texto. */
export function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Decodifica las HTML entities más comunes. No es exhaustivo. */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/**
 * GET con timeout y user-agent realista (sitios bloquean curl/node-fetch
 * defaults). Devuelve texto o lanza si status >= 400 / timeout.
 */
export async function fetchHtml(url: string, timeoutMs = 8000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EcoPopulicomBot/1.0; +https://populicom.com)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-PR,es;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** GET JSON con mismo timeout y headers. */
export async function fetchJson<T = unknown>(url: string, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EcoPopulicomBot/1.0; +https://populicom.com)',
        'Accept': 'application/json',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Extrae todos los hrefs de imagen (`<meta property="og:image">` y similares). */
export function extractMediaUrls(html: string): string[] {
  const urls: string[] = [];
  const og = extractMetaContent(html, 'og:image');
  if (og) urls.push(og);
  const tw = extractMetaContent(html, 'twitter:image');
  if (tw && !urls.includes(tw)) urls.push(tw);
  return urls;
}
