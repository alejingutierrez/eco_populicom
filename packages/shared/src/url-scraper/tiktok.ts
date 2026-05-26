import { canonicalizeUrl } from '../url-canonicalizer';
import { fetchJson, stripTags, decodeHtmlEntities } from './html-utils';
import type { ScrapeResult } from './types';

interface OEmbedTikTokResponse {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  html?: string;
  type?: string;
}

export async function scrapeTikTok(url: string): Promise<ScrapeResult> {
  const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
  const warnings: string[] = ['TikTok oEmbed no provee likes / shares — métricas quedan en 0.'];
  let scrapeMethod: ScrapeResult['scrapeMethod'] = 'oembed';

  let title: string | undefined;
  let snippet: string | undefined;
  let author: string | undefined;
  let mediaUrls: string[] | undefined;

  try {
    const data = await fetchJson<OEmbedTikTokResponse>(oembedUrl);
    title = data.title;
    if (data.title) snippet = decodeHtmlEntities(stripTags(data.title));
    if (data.author_url) {
      const m = data.author_url.match(/@([^/?#]+)/);
      author = m?.[1] ?? data.author_name;
    } else {
      author = data.author_name;
    }
    if (data.thumbnail_url) mediaUrls = [data.thumbnail_url];
  } catch (err) {
    warnings.push(`TikTok oEmbed falló: ${(err as Error).message}`);
    scrapeMethod = 'manual_required';
  }

  warnings.push('TikTok oEmbed no expone fecha de publicación — asigna manualmente.');

  return {
    url,
    urlCanonical: canonicalizeUrl(url) ?? url,
    platform: 'tiktok',
    domain: 'tiktok.com',
    scrapeMethod,
    warnings,
    title,
    snippet,
    author,
    mediaUrls,
  };
}
