/**
 * Sitemap parsing and URL discovery
 */

import type { SiteAdapter } from "../types";
import { normalizeUrlKey, resolveLocation, uniq } from "../utils";

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

/** Fetch text with a browser-like UA. */
async function fetchTextOnce(url: string): Promise<string> {
  const r = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit(537.36) Chrome/124.0.0.0 Safari/537.36",
      accept: "application/xml,text/xml,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "accept-encoding": "gzip, deflate, br",
      referer: "https://www.google.com/",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);

  let buf: Uint8Array = Buffer.from(await r.arrayBuffer());
  if (/\.gz($|\?)/i.test(url)) {
    try {
      const zlib = await import("node:zlib");
      buf = zlib.gunzipSync(buf);
    } catch {}
  }

  try {
    return new TextDecoder("utf-8").decode(buf);
  } catch {
    return Buffer.from(buf).toString("utf-8");
  }
}

async function fetchText(
  url: string,
  retries = 4,
  baseDelayMs = 500,
): Promise<string> {
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetchTextOnce(url);
    } catch (e) {
      lastErr = e;
      if (i < retries) {
        const jitter = Math.floor(Math.random() * 250);
        const delay = baseDelayMs * Math.pow(2, i) + jitter;
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function robotsSitemaps(baseHost: string): Promise<string[]> {
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
