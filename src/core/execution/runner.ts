/**
 * Main execution runner
 */

import fs from "node:fs";
import { performance } from "node:perf_hooks";
const { default: pLimit } = await import("p-limit");

import { launchBrowser, optimizePage } from "../browser/index";
import { discoverProductUrls } from "../discovery/index";
import { extractStandard } from "../extraction/index";
import { saveScrapedProductListings } from "../storage";
import type { Product } from "../types/product";
import { formatDuration } from "../utils/index";
import sanitizeEan from "../utils/sanitizeEan";

/**
 * Configuration options for running a site extraction
 */
export interface RunnerOptions {
  outDirBase: string;
  runMode: "full" | "delta" | "refresh";
  productsLimit: number;
  progressEvery: number;
  deltaGraceSeconds: number;
  refreshTtlDays: number;
}

/* ------------------------------- small utils ------------------------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------- runSite --------------------------------- */

/**
 * Main site extraction runner that orchestrates the entire process
 * Handles URL discovery, product extraction, database storage, and output generation
 * @param adapter - Site adapter configuration
 * @param options - Runner configuration options
 */
export async function runSite(adapter: any, options: RunnerOptions) {
  const t0 = performance.now();

  const siteKey = adapter.key;
  const siteHost = adapter.baseHost;

  // NEW: file-based seeds
  const seedFile = (process.env.SEED_FILE || "").trim();
  let fileSeeds: string[] = [];
  if (seedFile) {
    try {
      const txt = await fs.promises.readFile(seedFile, "utf8");
      fileSeeds = txt
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    } catch (e) {
      console.warn(`[warn] could not read SEED_FILE=${seedFile}: ${String(e)}`);
    }
  }

  const seedUrlsEnv = (process.env.SEED_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seedOnly = /^true|1$/i.test(process.env.SEED_ONLY || "false");

  let discoveryUrls: string[] = [];

  if ((fileSeeds.length > 0 || seedUrlsEnv.length > 0) && seedOnly) {
    discoveryUrls = [...fileSeeds, ...seedUrlsEnv];
    console.log(
      `[info] discovery (seed-only) site=${siteKey} urls=${discoveryUrls.length}`,
    );
  } else {
    const attempts = Number(process.env.DISCOVERY_ATTEMPTS || "2");
    const backoffBase = Number(process.env.DISCOVERY_BACKOFF_MS || "2000");
    const forcedApok =
      "https://www.apoteket.se/api/sitemap/sitemapindex.xml,https://api.apoteket.se/sitemap/sitemapindex.xml";
    const baseExtraEnv = process.env.EXTRA_SITEMAP_URLS || "";

    for (let i = 1; i <= attempts; i++) {
      if (siteKey === "apoteket" && i >= 2) {
        const merged = [baseExtraEnv, forcedApok].filter(Boolean).join(",");
        process.env.EXTRA_SITEMAP_URLS = merged;
      }

      const urls = await discoverProductUrls(adapter);
      console.log(
        `[info] discovery attempt ${i} site=${siteKey} urls=${urls.length}`,
      );
      if (urls.length > 0) {
        discoveryUrls = urls;
        break;
      }

      if (i < attempts) {
        const jitter = Math.floor(Math.random() * 400);
        const delay = backoffBase * Math.pow(2, i - 1) + jitter;
        await sleep(delay);
      }
    }
    process.env.EXTRA_SITEMAP_URLS = baseExtraEnv;
  }

  discoveryUrls = [...new Set(discoveryUrls)];
  if (
    options.productsLimit > 0 &&
    discoveryUrls.length > options.productsLimit
  ) {
    discoveryUrls = discoveryUrls.slice(0, options.productsLimit);
  }

  if (discoveryUrls.length === 0) {
    const dur = ((performance.now() - t0) / 1000).toFixed(2);
    console.log(
      `[info] done site=${siteKey} ok=0 fails=0 wrote=0 visited=0 priceUpdates=0 elapsedSec=${dur}`,
    );
    return;
  }

  const browser = await launchBrowser();

  let ok = 0;
  let fails = 0;
  let batchCount = 0;

  const PROGRESS_EVERY = Math.max(0, options.progressEvery || 0);
  const PDP_LOG = /^true|1$/i.test(process.env.PDP_LOG || "false");

  const concurrency = Math.max(
    1,
    Math.min(adapter.pacing?.pdpConcurrency || 1, 3),
  ); // cap at 3 to avoid OOM
  const limit = pLimit(concurrency);
  let consecutiveErrors = 0;
  const BATCH_SIZE = 50; // flush every 50 products

  const scrapedProducts: Array<{
    productName: string;
    ean?: string | null;
    price: number;
    currency: string;
    inStock: boolean;
    productUrl: string;
    imageUrl?: string | null;
    store: { name: string; domain: string };
    rawData?: any;
  }> = [];

  const tasks = discoveryUrls.map((url) =>
    limit(async () => {
      // simple error cooldown
      if (consecutiveErrors >= 5) {
        const cooldownMs = (adapter.pacing?.cooldownSeconds ?? 120) * 1000;
        await sleep(cooldownMs);
        consecutiveErrors = 0;
      }

      const page = await browser.newPage();
      await optimizePage(page);

      // retry loop
      const maxRetries = Math.max(0, adapter.pacing?.fetchRetries ?? 3);
      const baseDelayMs = Math.max(0, adapter.pacing?.fetchRetryBaseMs ?? 800);
      let lastErr: any = null;
      try {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const resp = await page.goto(url, {
              waitUntil: adapter.pacing?.navWaitPdp || "domcontentloaded",
              timeout: adapter.pacing?.pdpTimeoutMs ?? 30000,
            });
            const status = resp?.status();
            if (status === 429 || status === 503) {
              const ra = Number(resp?.headers()["retry-after"] || "0");
              const wait =
                ra > 0 ? ra * 1000 : baseDelayMs * Math.pow(2, attempt);
              await sleep(wait);
              throw new Error(`HTTP ${status}`);
            }

            const product: Product = adapter.customExtract
              ? await adapter.customExtract(page, url)
              : await extractStandard(adapter, page, url);

            scrapedProducts.push({
              productName: product.name || "",
              ean: product.ean ? sanitizeEan(product.ean) || null : null,
              price: product.price ?? 0,
              currency: product.currency || "SEK",
              inStock: !!product.inStock,
              productUrl: product.url,
              imageUrl: product.imageUrl || null,
              store: { name: siteKey, domain: siteHost },
              rawData: product,
            });

            ok++;
            consecutiveErrors = 0;
            batchCount++;

            // batch flush to avoid OOM
            if (batchCount >= BATCH_SIZE) {
              await saveScrapedProductListings(scrapedProducts);
              batchCount = 0;
            }

            if (PDP_LOG) {
              console.log(
                `[pdp][${siteKey}] ${product.name} | price=${product.price} | original=${product.originalPrice}`,
              );
            }

            if (PROGRESS_EVERY > 0 && ok % PROGRESS_EVERY === 0) {
              const elapsed = (performance.now() - t0) / 1000;
              const total = discoveryUrls.length;
              const rate = ok > 0 ? ok / elapsed : 0;
              const remaining = Math.max(0, total - ok);
              const eta = rate > 0 ? remaining / rate : 0;
              console.log(
                `[progress][${siteKey}] ${ok}/${total} | elapsed=${formatDuration(
                  elapsed,
                )} | eta=${formatDuration(eta)} | rate=${rate.toFixed(1)}/s`,
              );
            }

            return; // success
          } catch (e: any) {
            lastErr = e;
            if (attempt < maxRetries) {
              const jitter = Math.floor(Math.random() * 250);
              const wait = baseDelayMs * Math.pow(2, attempt) + jitter;
              await sleep(wait);
              continue;
            }
            throw e;
          }
        }
      } catch (err: any) {
        fails++;
        consecutiveErrors++;
        console.warn(
          `[warn] PDP fail ${url}: ${lastErr?.message || err?.message || err}`,
        );
      } finally {
        await page.close().catch(() => {});
      }
    }),
  );

  try {
    await Promise.all(tasks);
  } finally {
    await browser.close().catch(() => {});
  }

  // final flush
  if (scrapedProducts.length > 0) {
    await saveScrapedProductListings(scrapedProducts);
  }

  const dur = ((performance.now() - t0) / 1000).toFixed(2);
  console.log(
    `[info] done site=${siteKey} ok=${ok} fails=${fails} wrote=${scrapedProducts.length} elapsedSec=${dur}`,
  );
}

export default runSite;
