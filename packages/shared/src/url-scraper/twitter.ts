import { canonicalizeUrl } from '../url-canonicalizer';
import { decodeHtmlEntities, fetchJson, stripTags } from './html-utils';
import type { ScrapeResult } from './types';

// Epoch del snowflake de Twitter: 1288834974657ms (4 Nov 2010). Cada ID de
// tweet codifica el timestamp en los bits altos (>> 22 + epoch).
const TWITTER_SNOWFLAKE_EPOCH = 1288834974657;

interface OEmbedTwitterResponse {
  author_name?: string;
  author_url?: string;
  html?: string;
  url?: string;
  type?: string;
  cache_age?: string;
}

/**
 * Decodifica el timestamp embebido en el ID del tweet. Los IDs de Twitter
 * son snowflakes: 64-bit con los 41 bits altos representando ms desde la
 * epoch de Twitter. Esto nos da `publishedAt` sin necesidad de API auth.
 */
function parseTweetIdToDate(tweetIdRaw: string): Date | undefined {
  try {
    const id = BigInt(tweetIdRaw);
    // `22n` BigInt literal requiere target ES2020; usamos BigInt(22) para
    // ser compatibles con el target ES2017 de apps/web.
    const ms = Number(id >> BigInt(22)) + TWITTER_SNOWFLAKE_EPOCH;
    if (Number.isFinite(ms) && ms > 0) return new Date(ms);
  } catch {
    /* invalid id */
  }
  return undefined;
}

function extractTweetIdFromUrl(url: string): string | undefined {
  const m = url.match(/\/status(?:es)?\/(\d+)/);
  return m?.[1];
}

export async function scrapeTwitter(url: string): Promise<ScrapeResult> {
  const tweetId = extractTweetIdFromUrl(url);
  const publishedAt = tweetId ? parseTweetIdToDate(tweetId) : undefined;

  const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true&dnt=true`;

  let snippet: string | undefined;
  let author: string | undefined;
  let authorFullname: string | undefined;
  const warnings: string[] = [];
  let scrapeMethod: ScrapeResult['scrapeMethod'] = 'oembed';

  try {
    const data = await fetchJson<OEmbedTwitterResponse>(oembedUrl);
    authorFullname = data.author_name;
    if (data.author_url) {
      const m = data.author_url.match(/twitter\.com\/([^/?#]+)/i) ?? data.author_url.match(/x\.com\/([^/?#]+)/i);
      author = m?.[1];
    }
    if (data.html) {
      // El HTML del oembed es algo como:
      //   <blockquote class="twitter-tweet"><p>contenido</p>— Autor (@handle) <a>fecha</a></blockquote>
      // Extraer el texto del <p> es suficiente para el snippet.
      const pMatch = data.html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      if (pMatch?.[1]) {
        snippet = decodeHtmlEntities(stripTags(pMatch[1])).trim();
      }
    }
  } catch (err) {
    // Tweets borrados, protegidos, o de cuentas suspendidas → oEmbed 404
    warnings.push(`Twitter oEmbed falló: ${(err as Error).message}. Continúa con datos parciales.`);
    scrapeMethod = 'manual_required';
  }

  if (!snippet) {
    warnings.push('Sin texto del tweet — verifica si está borrado/protegido. Rellena manualmente.');
  }
  if (!publishedAt) {
    warnings.push('No se pudo derivar la fecha del tweet (ID inválido). Asigna manualmente.');
  }

  warnings.push('Twitter oEmbed no provee likes / retweets / replies — usa 0 o pide manual al admin.');

  const urlCanonical = canonicalizeUrl(url) ?? url;

  return {
    url,
    urlCanonical,
    platform: 'twitter',
    domain: 'x.com',
    scrapeMethod,
    warnings,
    title: snippet ? snippet.slice(0, 140) : undefined,
    snippet,
    author,
    authorFullname,
    publishedAt,
    language: undefined,
  };
}
