/**
 * Sitemap parsing and URL discovery
 */

import type { SiteAdapter } from "../types";
import { normalizeUrlKey, resolveLocation, uniq } from "../utils";
import { fetchText } from "./fetcher";
import { robotsSitemaps } from "./robots";

/** Very lenient <loc> extractor */
function extractLocs(xml: string): string[] {
  const re = /<loc>\s*([^<\s][^<]*)\s*<\/loc>/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

export async function discoverProductUrls(
  adapter: SiteAdapter,
): Promise<string[]> {
  const rx = adapter.discovery?.productUrlRegex;
  const startCandidates: string[] = [];

  // NEW: allow overriding sitemap list via env
  const override = (process.env.SITEMAP_OVERRIDE || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (override.length) startCandidates.push(...override);

  if (!override.length && adapter.discovery?.sitemapUrl) {
    const urls = Array.isArray(adapter.discovery.sitemapUrl)
      ? adapter.discovery.sitemapUrl
      : [adapter.discovery.sitemapUrl];
    startCandidates.push(...urls);
  }

  const extra = (process.env.EXTRA_SITEMAP_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((u) => {
      try {
        const host = new URL(u).host;
        return adapter.baseHost ? host.endsWith(adapter.baseHost) : true;
      } catch {
        return false;
      }
    });
  startCandidates.push(...extra);

  const robots = await robotsSitemaps(adapter.baseHost);
  startCandidates.push(...robots);

  const queue = uniq(startCandidates);
  const seen = new Set<string>();
  const productUrls: string[] = [];

  while (queue.length > 0) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    let xml = "";
    try {
      xml = await fetchText(url);
    } catch {
      continue;
    }

    const lower = xml.toLowerCase();

    if (lower.includes("<sitemapindex")) {
      const locs = extractLocs(xml);
      for (const loc of locs) {
        const abs = resolveLocation(url, loc, adapter.baseHost);
        if (abs) queue.push(abs);
      }
      continue;
    }

    if (lower.includes("<urlset")) {
      const locs = extractLocs(xml);
      for (const loc of locs) {
        const abs = resolveLocation(url, loc, adapter.baseHost);
        if (!abs) continue;
        const u = normalizeUrlKey(abs);
        if (rx ? rx.test(u) : true) productUrls.push(u);
      }
      continue;
    }
  }

  return uniq(productUrls);
}
