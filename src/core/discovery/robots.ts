/**
 * Robots.txt sitemap discovery
 */

import { uniq } from "../utils/index";
import { fetchText } from "./fetcher";

/**
 * Discovers sitemap URLs from robots.txt file
 * @param baseHost - Base host to fetch robots.txt from
 * @returns Array of sitemap URLs found in robots.txt
 */
export async function robotsSitemaps(baseHost: string): Promise<string[]> {
  const robotsUrl = `https://${baseHost}/robots.txt`;
  try {
    const txt = await fetchText(robotsUrl);
    const lines = txt.split(/\r?\n/);
    const urls: string[] = [];
    for (const ln of lines) {
      const m = ln.match(/^\s*Sitemap:\s*(\S+)/i);
      if (m) urls.push(m[1].trim());
    }
    return uniq(urls);
  } catch {
    return [];
  }
}
