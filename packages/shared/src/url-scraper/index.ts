import { detectPlatform, expandShortened, isShortenedDomain } from '../url-canonicalizer';
import { scrapeTwitter } from './twitter';
import { scrapeYouTube } from './youtube';
import { scrapeTikTok } from './tiktok';
import { scrapeReddit } from './reddit';
import { scrapeOpenGraph } from './og-scraper';
import type { ScrapeResult, ScrapeOutcome } from './types';

export type { ScrapeResult, ScrapeOutcome } from './types';

/**
 * Dispatcher principal: detecta plataforma y delega al scraper específico.
 * Si la URL viene acortada (t.co, bit.ly, etc.) la expande primero.
 *
 * Nunca lanza — siempre devuelve un ScrapeResult, posiblemente con
 * `scrapeMethod='manual_required'` y warnings poblados. El UI muestra esos
 * warnings al admin y le permite rellenar campos faltantes antes de commit.
 */
export async function scrapeUrl(rawUrl: string): Promise<ScrapeResult> {
  // 1. Expandir shortener (HEAD follow, 3s timeout)
  let workingUrl = rawUrl;
  try {
    const u = new URL(rawUrl);
    if (isShortenedDomain(u.hostname)) {
      workingUrl = await expandShortened(rawUrl);
    }
  } catch {
    // URL inválida — dejamos que el scraper específico falle con warning
  }

  const platform = detectPlatform(workingUrl);

  switch (platform) {
    case 'twitter':
      return scrapeTwitter(workingUrl);
    case 'youtube':
      return scrapeYouTube(workingUrl);
    case 'tiktok':
      return scrapeTikTok(workingUrl);
    case 'reddit':
      return scrapeReddit(workingUrl);
    case 'facebook':
    case 'instagram':
    case 'linkedin':
    case 'tumblr':
    case 'web':
    case 'unknown':
    default:
      return scrapeOpenGraph(workingUrl, platform);
  }
}
