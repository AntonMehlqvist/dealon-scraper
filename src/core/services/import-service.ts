/**
 * Import Service - Reusable import orchestrator
 * Can be imported and used from CLI, BullMQ workers, or any other context
 */

import { promises as fs } from "fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { DEFAULT_SITES, SITE_CATEGORIES, registry } from "../../sites/registry";
import { envInt, envStr } from "../config/index";
import { runSite } from "../execution/index";
import { Logger } from "../utils/logger";

export interface ImportServiceOptions {
  siteKeys?: string[];
  category?: keyof typeof SITE_CATEGORIES;
  runMode?: "full" | "delta" | "refresh";
  productsLimit?: number;
  progressEvery?: number;
  deltaGraceSeconds?: number;
  refreshTtlDays?: number;
}

export interface ImportResult {
  siteKey: string;
  success: boolean;
  error?: string;
}

/**
 * Run apohem in chunked mode using child processes
 */
async function runApohemChunked(): Promise<ImportResult> {
  Logger.info(
    `\n=== Starting site: apohem (chunked via SEED_FILE + global progress) ===`,
  );

  const batches = [0, 1, 2, 3].map(
    (b) => `https://www.apohem.se/sitemap.xml?batch=${b}&language=sv-se`,
  );
  const allUrls: string[] = [];

  // Fetch XML from batches
  for (const u of batches) {
    try {
      const r = await fetch(u, {
        redirect: "follow",
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit(537.36) Chrome/124.0.0.0 Safari/537.36",
          accept:
            "application/xml,text/xml,application/xhtml+xml;q=0.9,*/*;q=0.8",
          referer: "https://www.google.com/",
        },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const xml = await r.text();
      const re = /<loc>\s*([^<\s][^<]*)\s*<\/loc>/gi;
      const locs: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml))) locs.push(m[1].trim());

      if (locs.length === 0) {
        Logger.info(
          `[apohem] ${u} has no <loc> entries; using index itself as seed`,
        );
        allUrls.push(u);
      } else {
        allUrls.push(...locs);
      }
    } catch (e: any) {
      Logger.warn(`[apohem] warn: could not fetch ${u}: ${e?.message || e}`);
      allUrls.push(u);
    }
  }

  const uniqUrls = Array.from(new Set(allUrls));
  const chunkSize = Math.max(
    200,
    parseInt(process.env.APOHEM_CHUNK_SIZE || "1200", 10) || 1200,
  );
  const chunks: string[][] = [];
  for (let i = 0; i < uniqUrls.length; i += chunkSize) {
    chunks.push(uniqUrls.slice(i, i + chunkSize));
  }
  Logger.info(
    `[apohem] total urls=${uniqUrls.length} chunks=${chunks.length} chunkSize=${chunkSize}`,
  );

  await fs.mkdir("tmp/apohem-chunks", { recursive: true });

  let ok = 0,
    fails = 0;
  for (let i = 0; i < chunks.length; i++) {
    const list = chunks[i];
    const file = path.join(
      "tmp/apohem-chunks",
      `chunk-${String(i + 1).padStart(3, "0")}.txt`,
    );
    await fs.writeFile(file, list.join("\n"), "utf8");

    Logger.info(
      `[apohem chunk ${i + 1}/${chunks.length}] start size=${list.length}`,
    );

    await new Promise<void>((resolve) => {
      const env = {
        ...process.env,
        SEED_FILE: file,
        SEED_ONLY: "1",
        PROGRESS_EVERY: process.env.PROGRESS_EVERY || "1000",
      };
      const child = spawn(
        process.execPath,
        ["dist/cli.js", "--site", "apohem"],
        { stdio: "inherit", env },
      );
      child.on("exit", (code) => {
        if (code === 0) ok++;
        else {
          fails++;
          Logger.warn(
            `[apohem chunk ${i + 1}/${chunks.length}] ❌ failed (exit ${code})`,
          );
        }
        resolve();
      });
    });

    await new Promise((r) => setTimeout(r, 500));
  }

  Logger.info(`[apohem] finished chunks. ok=${ok} fails=${fails}`);
  Logger.info(`=== Finished site: apohem ===\n`);

  return {
    siteKey: "apohem",
    success: fails === 0,
  };
}

/**
 * Main import service function
 * Can be called from CLI, BullMQ workers, or any other context
 */
export async function runImport(
  options: ImportServiceOptions = {},
): Promise<ImportResult[]> {
  const {
    siteKeys,
    category,
    runMode = (process.env.RUN_MODE || "delta") as "full" | "delta" | "refresh",
    productsLimit = Number(process.env.PRODUCTS_LIMIT || "0"),
    progressEvery = envInt("PROGRESS_EVERY", 100),
    deltaGraceSeconds = envInt("DELTA_GRACE_SECONDS", 120),
    refreshTtlDays = envInt("REFRESH_TTL_DAYS", 30),
  } = options;

  // Determine which sites to run
  let targetSites: string[];

  if (siteKeys && siteKeys.length > 0) {
    targetSites = siteKeys;
  } else if (category) {
    if (category in SITE_CATEGORIES) {
      targetSites = [
        ...SITE_CATEGORIES[category as keyof typeof SITE_CATEGORIES].sites,
      ];
    } else {
      throw new Error(
        `Unknown category: ${category}. Available: ${Object.keys(
          SITE_CATEGORIES,
        ).join(", ")}`,
      );
    }
  } else {
    targetSites = [...DEFAULT_SITES];
  }

  // Validate sites
  const validSites = targetSites.filter((k) => registry.has(k));
  const invalidSites = targetSites.filter((k) => !registry.has(k));

  if (invalidSites.length > 0) {
    throw new Error(
      `Unknown sites: ${invalidSites.join(", ")}. Available: ${Array.from(
        registry.keys(),
      ).join(", ")}`,
    );
  }

  if (validSites.length === 0) {
    throw new Error("No valid sites to run");
  }

  Logger.info(
    `🚀 Starting ${validSites.length} site(s): ${validSites.join(", ")}`,
  );

  const results: ImportResult[] = [];
  const runOpts = {
    outDirBase: envStr("OUT_DIR_BASE", "out"),
    runMode,
    productsLimit,
    progressEvery,
    deltaGraceSeconds,
    refreshTtlDays,
  };

  // Handle apoteket headstart
  const HEADSTART_MS = Number(process.env.APOK_HEADSTART_MS || 4000);
  const hasApoteket = validSites.includes("apoteket");

  if (hasApoteket) {
    const adapter = registry.get("apoteket");
    if (adapter) {
      Logger.info(`\n=== Starting site: apoteket (${adapter.displayName}) ===`);
      try {
        await runSite(adapter, runOpts);
        results.push({ siteKey: "apoteket", success: true });
        Logger.info(`=== Finished site: apoteket ===\n`);
      } catch (error: any) {
        results.push({
          siteKey: "apoteket",
          success: false,
          error: error?.message || String(error),
        });
        Logger.error(`Failed to import apoteket: ${error?.message || error}`);
      }
    }
    if (HEADSTART_MS > 0) {
      await new Promise((r) => setTimeout(r, HEADSTART_MS));
    }
  }

  // Handle other sites (including apohem which will self-chunk)
  const others = validSites.filter((k) => k !== "apoteket");
  for (const siteKey of others) {
    try {
      if (siteKey === "apohem") {
        const result = await runApohemChunked();
        results.push(result);
        continue;
      }

      const adapter = registry.get(siteKey);
      if (!adapter) {
        results.push({
          siteKey,
          success: false,
          error: "Adapter not found",
        });
        continue;
      }

      Logger.info(
        `\n=== Starting site: ${siteKey} (${adapter.displayName}) ===`,
      );
      await runSite(adapter, runOpts);
      results.push({ siteKey, success: true });
      Logger.info(`=== Finished site: ${siteKey} ===\n`);
    } catch (error: any) {
      results.push({
        siteKey,
        success: false,
        error: error?.message || String(error),
      });
      Logger.error(`Failed to import ${siteKey}: ${error?.message || error}`);
    }
  }

  Logger.info(`✅ All imports finished`);
  return results;
}

/**
 * Get all available categories
 */
export function getCategories() {
  return SITE_CATEGORIES;
}

/**
 * Get all available site keys
 */
export function getSiteKeys() {
  return Array.from(registry.keys());
}
