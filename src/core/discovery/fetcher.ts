/**
 * Shared HTTP fetching utilities for discovery
 */

import { BROWSER_CONSTANTS } from "../constants";

/** Fetch text with a browser-like UA. */
export async function fetchTextOnce(url: string): Promise<string> {
  const r = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": BROWSER_CONSTANTS.USER_AGENT,
      accept: BROWSER_CONSTANTS.ACCEPT_HEADER,
      "accept-encoding": BROWSER_CONSTANTS.ACCEPT_ENCODING,
      referer: BROWSER_CONSTANTS.DEFAULT_REFERER,
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

export async function fetchText(
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
