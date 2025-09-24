/**
 * Robots.txt sitemap discovery
 */

import { uniq } from "../utils";
import { fetchText } from "./fetcher";

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
