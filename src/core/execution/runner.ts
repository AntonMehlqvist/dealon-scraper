/**
 * Main execution runner
 */

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import pLimit from "p-limit";

import { launchBrowser, optimizePage } from "../browser";
import { discoverProductUrls } from "../discovery";
import { extractStandard } from "../extraction";
import { upsertByEan } from "../product";
import {
  readGlobalStore,
  readPerSiteStore,
  writeGlobalStore,
  writePerSiteStore,
} from "../storage";
import type { ProductRecord, SiteAdapter } from "../types";
import { formatDuration } from "../utils";

export interface RunnerOptions {
  outDirBase: string;
  snapshotPath: string;
  eanStorePath: string; // kept for compat; DB is used instead
  globalEanStorePath: string; // kept for compat; DB is used instead
  runMode: "full" | "delta" | "refresh";
  productsLimit: number;
  progressEvery: number;
  deltaGraceSeconds: number;
  refreshTtlDays: number;
}

/* ------------------------------- small utils ------------------------------- */
async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.promises.readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------- runSite --------------------------------- */

export async function runSite(adapter: SiteAdapter, options: RunnerOptions) {
  const t0 = performance.now();

  const siteKey = adapter.key;
  const siteHost = adapter.baseHost;

  const dbPath = process.env.DB_PATH || "state/data.sqlite";

  const perSiteStore = await readPerSiteStore(dbPath, siteHost);
  const globalStore = await readGlobalStore(dbPath);
  const prevStore: Record<string, ProductRecord> = JSON.parse(
    JSON.stringify(perSiteStore),
  );

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
  const snapshotOnlyTouched = /^true|1$/i.test(
    process.env.SNAPSHOT_ONLY_TOUCHED || "false",
  );

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
    await writePerSiteStore(dbPath, siteHost, perSiteStore);
    await writeGlobalStore(dbPath, globalStore);

    const now = new Date();
    const outDir = path.join(
      options.outDirBase,
      `${siteKey}-${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}`,
    );
    await fs.promises.mkdir(outDir, { recursive: true });
    await writeJson(path.join(outDir, "products.json"), []);

    const dur = ((performance.now() - t0) / 1000).toFixed(2);
    console.log(
      `[info] done site=${siteKey} ok=0 fails=0 wrote=0 visited=0 priceUpdates=0 elapsedSec=${dur}`,
    );
    return;
  }

  const browser = await launchBrowser();

  const visitedIds = new Set<string>();
  let ok = 0;
  let fails = 0;
  let priceUpdates = 0;

  const PROGRESS_EVERY = Math.max(0, options.progressEvery || 0);
  const PDP_LOG = /^true|1$/i.test(process.env.PDP_LOG || "false");

  const concurrency = Math.max(
    1,
    Math.min(adapter.pacing?.pdpConcurrency || 1, 3),
  ); // cap at 3 to avoid OOM
  const limit = pLimit(concurrency);
  let consecutiveErrors = 0;
  let batchCount = 0;
  const BATCH_SIZE = 50; // flush every 50 products

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

            const product = adapter.customExtract
              ? await adapter.customExtract(page, url)
              : await extractStandard(adapter, page, url);

            const { record } = upsertByEan(
              perSiteStore,
              product,
              siteHost,
              undefined,
            );
            try {
              const now = new Date();
              perSiteStore[record.id].lastCrawled = new Date(
                now.getTime() - now.getTimezoneOffset() * 60000,
              )
                .toISOString()
                .replace("Z", "+00:00");
            } catch {}
            upsertByEan(globalStore, product, siteHost, undefined);

            const prev = prevStore[record.id];
            if (
              prev &&
              typeof prev.price === "number" &&
              typeof product.price === "number" &&
              prev.price !== product.price
            ) {
              priceUpdates++;
            }

            visitedIds.add(record.id);
            ok++;
            consecutiveErrors = 0;
            batchCount++;

            // batch flush to avoid OOM
            if (batchCount >= BATCH_SIZE) {
              await writePerSiteStore(dbPath, siteHost, perSiteStore);
              await writeGlobalStore(dbPath, globalStore);
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
  if (batchCount > 0) {
    await writePerSiteStore(dbPath, siteHost, perSiteStore);
    await writeGlobalStore(dbPath, globalStore);
  }

  const now = new Date();
  const outDir = path.join(
    options.outDirBase,
    `${siteKey}-${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}`,
  );

  const allRecords: ProductRecord[] = Object.values(perSiteStore);
  const touchedRecords: ProductRecord[] = allRecords.filter((r) =>
    visitedIds.has(r.id),
  );
  const toWrite = snapshotOnlyTouched ? touchedRecords : allRecords;

  await fs.promises.mkdir(outDir, { recursive: true });
  await writeJson(path.join(outDir, "products.json"), toWrite);

  const dur = ((performance.now() - t0) / 1000).toFixed(2);
  console.log(
    `[info] done site=${siteKey} ok=${ok} fails=${fails} wrote=${toWrite.length} visited=${visitedIds.size} priceUpdates=${priceUpdates} elapsedSec=${dur}`,
  );
}

export default runSite;
