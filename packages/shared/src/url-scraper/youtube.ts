import { canonicalizeUrl } from '../url-canonicalizer';
import { fetchJson } from './html-utils';
import type { ScrapeResult } from './types';

interface OEmbedYouTubeResponse {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  type?: string;
}

export async function scrapeYouTube(url: string): Promise<ScrapeResult> {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const warnings: string[] = ['YouTube oEmbed no provee views / likes — métricas quedan en 0.'];

  let title: string | undefined;
  let author: string | undefined;
  let authorAvatarUrl: string | undefined;
  let mediaUrls: string[] | undefined;
  let scrapeMethod: ScrapeResult['scrapeMethod'] = 'oembed';

  try {
    const data = await fetchJson<OEmbedYouTubeResponse>(oembedUrl);
    title = data.title;
    author = data.author_name;
    if (data.thumbnail_url) mediaUrls = [data.thumbnail_url];
  } catch (err) {
    warnings.push(`YouTube oEmbed falló: ${(err as Error).message}`);
    scrapeMethod = 'manual_required';
  }

  warnings.push('YouTube oEmbed no expone fecha de publicación — asigna manualmente.');

  return {
    url,
    urlCanonical: canonicalizeUrl(url) ?? url,
    platform: 'youtube',
    domain: 'youtube.com',
    scrapeMethod,
    warnings,
    title,
    author,
    authorAvatarUrl,
    mediaUrls,
  };
}
