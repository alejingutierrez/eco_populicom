import { canonicalizeUrl } from '../url-canonicalizer';
import { fetchJson } from './html-utils';
import type { ScrapeResult } from './types';

// Reddit expone una API JSON pública agregando `.json` al final de cualquier
// URL de post. Devuelve un array [postListing, commentsListing]. No requiere
// auth para posts públicos.
type RedditPostResponse = Array<{
  data?: {
    children?: Array<{
      kind?: string;
      data?: RedditPostData;
    }>;
  };
}>;

interface RedditPostData {
  id?: string;
  title?: string;
  selftext?: string;
  author?: string;
  permalink?: string;
  url?: string;
  thumbnail?: string;
  ups?: number;
  num_comments?: number;
  created_utc?: number;
  subreddit?: string;
  link_flair_text?: string;
}

export async function scrapeReddit(url: string): Promise<ScrapeResult> {
  // Normalizar la URL para el endpoint JSON: stripear query/fragment, añadir .json.
  let jsonUrl = url;
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    // Reddit acepta tanto /comments/abc como /comments/abc/title — .json
    // funciona si terminamos en barra o sin barra. Aseguramos `.json` al final.
    let path = u.pathname.replace(/\/$/, '');
    if (!path.endsWith('.json')) path += '.json';
    u.pathname = path;
    jsonUrl = u.toString();
  } catch {
    // Si la URL no parsea, dejamos jsonUrl = url y dejamos que fetchJson falle
  }

  const warnings: string[] = [];

  try {
    const data = await fetchJson<RedditPostResponse>(jsonUrl);
    const post = data?.[0]?.data?.children?.[0]?.data;
    if (!post) {
      warnings.push('Reddit JSON no contenía un post. Marca como manual.');
      return makeManualResult(url, warnings);
    }

    const publishedAt = post.created_utc ? new Date(post.created_utc * 1000) : undefined;
    const snippet = post.selftext || post.title || undefined;
    const mediaUrls = post.thumbnail && post.thumbnail.startsWith('http') ? [post.thumbnail] : undefined;

    return {
      url,
      urlCanonical: canonicalizeUrl(url) ?? url,
      platform: 'reddit',
      domain: 'reddit.com',
      scrapeMethod: 'json_api',
      warnings,
      title: post.title,
      snippet,
      author: post.author,
      publishedAt,
      mediaUrls,
      likes: post.ups,
      comments: post.num_comments,
    };
  } catch (err) {
    warnings.push(`Reddit JSON falló: ${(err as Error).message}. Rellena manualmente.`);
    return makeManualResult(url, warnings);
  }
}

function makeManualResult(url: string, warnings: string[]): ScrapeResult {
  return {
    url,
    urlCanonical: canonicalizeUrl(url) ?? url,
    platform: 'reddit',
    domain: 'reddit.com',
    scrapeMethod: 'manual_required',
    warnings,
  };
}
