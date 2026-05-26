import { canonicalizeUrl, detectPlatform } from '../url-canonicalizer';
import {
  extractMetaContent,
  extractTitleTag,
  extractJsonLdArticle,
  extractMediaUrls,
  fetchHtml,
} from './html-utils';
import type { ScrapeResult } from './types';

/**
 * Scraper genérico via Open Graph + Twitter cards + JSON-LD. Funciona para
 * sitios de prensa, blogs, y cualquier página con metatags estándar.
 *
 * Es el fallback cuando no hay scraper específico para la plataforma. También
 * lo usamos para Facebook / Instagram (que no tienen oEmbed público útil).
 *
 * Advertencias: ninguno de estos métodos da engagement; warns lo deja claro.
 */
export async function scrapeOpenGraph(url: string, platformHint?: ReturnType<typeof detectPlatform>): Promise<ScrapeResult> {
  const platform = platformHint ?? detectPlatform(url);
  const warnings: string[] = [];
  let scrapeMethod: ScrapeResult['scrapeMethod'] = 'og_tags';

  let html: string;
  try {
    html = await fetchHtml(url);
  } catch (err) {
    // Login walls (Instagram/Facebook) suelen retornar 401/403. En ese caso
    // no podemos parsear nada — el admin debe rellenar manualmente.
    return {
      url,
      urlCanonical: canonicalizeUrl(url) ?? url,
      platform,
      domain: safeDomain(url),
      scrapeMethod: 'manual_required',
      warnings: [`HTTP fetch falló: ${(err as Error).message}. Login wall o sitio caído — rellena manualmente.`],
    };
  }

  // Tag extraction priorizando OG > Twitter cards > JSON-LD > <title>
  const ogTitle = extractMetaContent(html, 'og:title');
  const twitterTitle = extractMetaContent(html, 'twitter:title');
  const ogDescription = extractMetaContent(html, 'og:description');
  const twitterDescription = extractMetaContent(html, 'twitter:description');
  const ogSiteName = extractMetaContent(html, 'og:site_name');
  const articleAuthor = extractMetaContent(html, 'article:author') ?? extractMetaContent(html, 'author');
  const articlePublished = extractMetaContent(html, 'article:published_time')
    ?? extractMetaContent(html, 'datePublished')
    ?? extractMetaContent(html, 'date');
  const ogLocale = extractMetaContent(html, 'og:locale');
  const language = ogLocale?.split('_')[0]?.toLowerCase();

  const jsonLd = extractJsonLdArticle(html);
  let jsonLdAuthor: string | undefined;
  let jsonLdPublished: string | undefined;
  let jsonLdTitle: string | undefined;
  let jsonLdSnippet: string | undefined;
  if (jsonLd) {
    if (typeof jsonLd.headline === 'string') jsonLdTitle = jsonLd.headline;
    if (typeof jsonLd.description === 'string') jsonLdSnippet = jsonLd.description;
    if (typeof jsonLd.datePublished === 'string') jsonLdPublished = jsonLd.datePublished;
    const author = jsonLd.author;
    if (typeof author === 'string') {
      jsonLdAuthor = author;
    } else if (author && typeof author === 'object' && !Array.isArray(author)) {
      const name = (author as Record<string, unknown>).name;
      if (typeof name === 'string') jsonLdAuthor = name;
    } else if (Array.isArray(author) && author.length > 0) {
      const first = author[0];
      if (typeof first === 'string') jsonLdAuthor = first;
      else if (first && typeof first === 'object') {
        const name = (first as Record<string, unknown>).name;
        if (typeof name === 'string') jsonLdAuthor = name;
      }
    }
  }
  if (jsonLd) scrapeMethod = 'json_ld';

  const title = ogTitle ?? twitterTitle ?? jsonLdTitle ?? extractTitleTag(html);
  const snippet = ogDescription ?? twitterDescription ?? jsonLdSnippet;
  const author = articleAuthor ?? jsonLdAuthor;
  const publishedRaw = articlePublished ?? jsonLdPublished;
  const publishedAt = publishedRaw ? parseDateLoose(publishedRaw) : undefined;

  const mediaUrls = extractMediaUrls(html);

  if (!publishedAt) {
    warnings.push('No se encontró fecha de publicación en metatags. Asigna manualmente.');
  }
  if (!title && !snippet) {
    warnings.push('Sin título ni snippet — la página puede ser un login wall.');
    scrapeMethod = 'manual_required';
  }
  if (platform === 'facebook' || platform === 'instagram') {
    warnings.push(`${platform} no expone engagement vía OG tags. Likes/comentarios/shares quedan en 0 — rellena manualmente.`);
  }

  return {
    url,
    urlCanonical: canonicalizeUrl(url) ?? url,
    platform,
    domain: safeDomain(url),
    scrapeMethod,
    warnings,
    title,
    snippet,
    author,
    authorFullname: ogSiteName,
    publishedAt,
    language,
    mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
  };
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function parseDateLoose(raw: string): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isFinite(d.getTime())) return d;
  return undefined;
}
