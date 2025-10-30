// src/orchestrator.ts
import "dotenv/config";
import { promises as fs } from "fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { envInt, envStr } from "./core/config";
import { DEFAULT_SITES } from "./core/config/sites";
import { runSite } from "./core/execution";

// Pharmacy Adapters
import { adapter as apohem } from "./sites/pharmacy/apohem/adapter";
import { adapter as apotea } from "./sites/pharmacy/apotea/adapter";
import { adapter as apoteket } from "./sites/pharmacy/apoteket/adapter";
import { adapter as hjartat } from "./sites/pharmacy/hjartat/adapter";
import { adapter as kronans } from "./sites/pharmacy/kronans/adapter";

// Electronics Adapters
import { adapter as elgiganten } from "./sites/electronics/elgiganten/adapter";
import { adapter as inet } from "./sites/electronics/inet/adapter";
import { adapter as kjell } from "./sites/electronics/kjell/adapter";
import { adapter as netonnet } from "./sites/electronics/netonnet/adapter";
import { adapter as power } from "./sites/electronics/power/adapter";
import { adapter as webhallen } from "./sites/electronics/webhallen/adapter";

// Template
import { adapter as template } from "./sites/_template/adapter";

/* ---------------- Site Categories ---------------- */
const SITE_CATEGORIES = {
  pharmacy: {
    name: "Pharmacy",
    sites: ["apoteket", "apotea", "kronans", "apohem", "hjartat"],
    description: "Swedish pharmacy websites",
  },
  electronics: {
    name: "Electronics",
    sites: ["elgiganten", "webhallen", "netonnet", "power", "kjell", "inet"],
    description: "Electronics and technology retailers",
  },
  template: {
    name: "Template",
    sites: ["_template"],
    description: "Template for new adapters",
  },
} as const;

/* ---------------- Site Registry ---------------- */
const registry = new Map<string, any>([
  // Pharmacy sites
  ["apoteket", apoteket],
  ["apotea", apotea],
  ["kronans", kronans],
  ["apohem", apohem],
  ["hjartat", hjartat],

  // Electronics sites
  ["elgiganten", elgiganten],
  ["webhallen", webhallen],
  ["netonnet", netonnet],
  ["power", power],
  ["kjell", kjell],
  ["inet", inet],

  // Template
  ["_template", template],
]);

/* ---------------- CLI Helpers ---------------- */
function showHelp() {
  console.log(`
Multi-Site Scraper - Site Selection Options

Usage:
  npm start                           # Run all default sites
  npm start -- --category pharmacy    # Run all pharmacy sites
  npm start -- --category electronics # Run all electronics sites
  npm start -- --sites apotea,elgiganten # Run specific sites
  npm start -- --list                 # List all available sites

Categories:
${Object.entries(SITE_CATEGORIES)
  .map(
    ([key, cat]) =>
      `  ${key.padEnd(12)} - ${cat.name}: ${cat.sites.join(", ")}`,
  )
  .join("\n")}

Available Sites:
  ${Array.from(registry.keys()).sort().join(", ")}
`);
}

function parseCliArgs() {
  const argv = process.argv.slice(2);

  // Show help
  if (argv.includes("--help") || argv.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  // List sites
  if (argv.includes("--list")) {
    console.log("Available sites by category:");
    Object.entries(SITE_CATEGORIES).forEach(([key, cat]) => {
      console.log(`\n${cat.name} (${key}):`);
      cat.sites.forEach((site) => {
        const adapter = registry.get(site);
        console.log(
          `  ${site.padEnd(12)} - ${adapter?.displayName || "Unknown"}`,
        );
      });
    });
    process.exit(0);
  }

  // Parse category
  const categoryIdx = argv.indexOf("--category");
  if (categoryIdx >= 0 && argv[categoryIdx + 1]) {
    const category = argv[categoryIdx + 1];
    if (category in SITE_CATEGORIES) {
      return SITE_CATEGORIES[category as keyof typeof SITE_CATEGORIES].sites;
    } else {
      console.error(`❌ Unknown category: ${category}`);
      console.error(
        `Available categories: ${Object.keys(SITE_CATEGORIES).join(", ")}`,
      );
      process.exit(1);
    }
  }

  // Parse specific sites
  const sitesIdx = argv.indexOf("--sites");
  if (sitesIdx >= 0 && argv[sitesIdx + 1]) {
    return argv[sitesIdx + 1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return null;
}

/* ---------------- small utils ---------------- */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit(537.36) Chrome/124.0.0.0 Safari/537.36",
      accept: "application/xml,text/xml,application/xhtml+xml;q=0.9,*/*;q=0.8",
      referer: "https://www.google.com/",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return new TextDecoder("utf-8").decode(buf);
}

function extractLocs(xml: string): string[] {
  const re = /<loc>\s*([^<\s][^<]*)\s*<\/loc>/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return Array.from(new Set(out));
}

/* --------------- run helpers ------------------- */
const runOpts = (siteKey: string) => ({
  outDirBase: envStr("OUT_DIR_BASE", "out"),
  runMode: (process.env.RUN_MODE || "delta") as "full" | "delta" | "refresh",
  productsLimit: Number(process.env.PRODUCTS_LIMIT || "0"),
  progressEvery: envInt("PROGRESS_EVERY", 100),
  deltaGraceSeconds: envInt("DELTA_GRACE_SECONDS", 120),
  refreshTtlDays: envInt("REFRESH_TTL_DAYS", 30),
});

/* -------- Apohem chunked runner (child processes) -------- */
async function runApohemChunked() {
  console.log(
    `\n=== Starting site: apohem (chunked via SEED_FILE + global progress) ===`,
  );

  // 1) Collect all <loc> from the batch indices (0..3). If a batch 500s, skip it.
  const batches = [0, 1, 2, 3].map(
    (b) => `https://www.apohem.se/sitemap.xml?batch=${b}&language=sv-se`,
  );
  const allUrls: string[] = [];
  for (const u of batches) {
    try {
      const xml = await fetchText(u);
      const locs = extractLocs(xml);
      if (locs.length === 0) {
        console.log(
          `[apohem] ${u} has no <loc> entries; using index itself as seed`,
        );
        allUrls.push(u); // runner will recurse into it
      } else {
        allUrls.push(...locs);
      }
    } catch (e: any) {
      console.log(`[apohem] warn: could not fetch ${u}: ${e?.message || e}`);
      // still push index URL so discovery can try inside the child
      allUrls.push(u);
    }
  }

  // 2) Dedup + chunk to disk
  const uniqUrls = Array.from(new Set(allUrls));
  const chunkSize = Math.max(
    200,
    parseInt(process.env.APOHEM_CHUNK_SIZE || "1200", 10) || 1200,
  );
  const chunks: string[][] = [];
  for (let i = 0; i < uniqUrls.length; i += chunkSize) {
    chunks.push(uniqUrls.slice(i, i + chunkSize));
  }
  console.log(
    `[apohem] total urls=${uniqUrls.length} chunks=${chunks.length} chunkSize=${chunkSize}`,
  );

  // Prepare tmp dir
  await fs.mkdir("tmp/apohem-chunks", { recursive: true });

  // 3) Run each chunk in a fresh process with SEED_FILE + SEED_ONLY=1
  let ok = 0,
    fails = 0;
  for (let i = 0; i < chunks.length; i++) {
    const list = chunks[i];
    const file = path.join(
      "tmp/apohem-chunks",
      `chunk-${String(i + 1).padStart(3, "0")}.txt`,
    );
    await fs.writeFile(file, list.join("\n"), "utf8");

    console.log(
      `[apohem chunk ${i + 1}/${chunks.length}] start size=${list.length}`,
    );

    await new Promise<void>((resolve) => {
      const env = {
        ...process.env,
        SEED_FILE: file,
        SEED_ONLY: "1",
        // ensure progress cadence matches others
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
          console.log(
            `[apohem chunk ${i + 1}/${chunks.length}] ❌ failed (exit ${code})`,
          );
        }
        resolve();
      });
    });

    // small jitter to give OS a breather
    await sleep(500);
  }

  console.log(`[apohem] finished chunks. ok=${ok} fails=${fails}`);
  console.log(`=== Finished site: apohem ===\n`);
}

/* --------------------- main --------------------- */
async function main() {
  // Parse CLI arguments
  let siteKeys = parseCliArgs();

  if (!siteKeys) {
    // No command line sites provided, use defaults
    siteKeys = DEFAULT_SITES.filter((k) => registry.has(k));
  } else {
    // Filter to only include valid sites
    const validSites = siteKeys.filter((k) => registry.has(k));
    const invalidSites = siteKeys.filter((k) => !registry.has(k));

    if (invalidSites.length > 0) {
      console.error(`❌ Unknown sites: ${invalidSites.join(", ")}`);
      console.error(
        `Available sites: ${Array.from(registry.keys()).join(", ")}`,
      );
      process.exit(1);
    }

    siteKeys = validSites;
  }

  if (siteKeys.length === 0) {
    console.error("❌ No valid sites to run");
    process.exit(1);
  }

  console.log(`🚀 Starting ${siteKeys.length} site(s): ${siteKeys.join(", ")}`);

  const HEADSTART_MS = Number(process.env.APOK_HEADSTART_MS || 4000);
  const hasApoteket = siteKeys.includes("apoteket");
  const hasApohem = siteKeys.includes("apohem");

  const startSite = async (siteKey: string) => {
    if (siteKey === "apohem") {
      // Special: chunked runner (child processes reading SEED_FILE)
      await runApohemChunked();
      return siteKey;
    }

    const adapter = registry.get(siteKey);
    if (!adapter) {
      console.error(`❌ Unknown site: ${siteKey}`);
      console.error(`Available: ${Array.from(registry.keys()).join(", ")}`);
      return null;
    }
    console.log(`\n=== Starting site: ${siteKey} (${adapter.displayName}) ===`);
    await runSite(adapter, runOpts(siteKey));
    console.log(`=== Finished site: ${siteKey} ===\n`);
    return siteKey;
  };

  const tasks: Promise<string | null>[] = [];

  if (hasApoteket) {
    tasks.push(startSite("apoteket"));
    if (HEADSTART_MS > 0) await sleep(HEADSTART_MS);
  }

  // Start others in parallel; Apohem will self-chunk internally
  const others = siteKeys;
  for (const key of others) {
    if (key === "apoteket") continue; // already started with headstart
    tasks.push(startSite(key));
  }

  const results = await Promise.all(tasks);
  console.log("✅ All sites finished:", results.filter(Boolean));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
