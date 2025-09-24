/**
 * Robots.txt sitemap discovery
 */

import { uniq } from "../utils";

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
