// src/orchestrator.ts
import "dotenv/config";
import { promises as fs } from "fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { envInt, envStr } from "./core/config";
import { runSite } from "./core/execution";

// Adapters
import { adapter as template } from "./sites/_template/adapter";
import { adapter as apohem } from "./sites/apohem/adapter";
import { adapter as apotea } from "./sites/apotea/adapter";
import { adapter as apoteket } from "./sites/apoteket/adapter";
import { adapter as hjartat } from "./sites/hjartat/adapter";
import { adapter as kronans } from "./sites/kronans/adapter";

/* ---------------- registry ---------------- */
const registry = new Map<string, any>([
  ["apoteket", apoteket],
  ["apotea", apotea],
  ["kronans", kronans],
  ["apohem", apohem],
  ["hjartat", hjartat],
  ["_template", template],
]);

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

/* --------------- CLI arg parsing --------------- */
function parseArgvSites(): string[] | null {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf("--sites");
  if (idx >= 0 && argv[idx + 1]) {
    return argv[idx + 1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return null;
}

/* --------------- run helpers ------------------- */
const runOpts = (siteKey: string) => ({
  outDirBase: envStr("OUT_DIR_BASE", "out"),
  snapshotPath: envStr("SNAPSHOT_DB_PATH", "state/data.sqlite"),
  eanStorePath: "sqlite",
  globalEanStorePath: "sqlite",
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
  // Accept --sites (comma) OR sites.json fallback
  let siteKeys = parseArgvSites();
  if (!siteKeys) {
    const raw = await fs.readFile("sites.json", "utf8").catch(() => "{}");
    const cfg = JSON.parse(raw || "{}") as { sites?: string[] };
    if (!cfg.sites?.length) {
      console.error(
        "❌ Provide --sites a,b,c or sites.json with { sites: [...] }",
      );
      process.exit(1);
    }
    siteKeys = cfg.sites.filter((k) => registry.has(k));
  } else {
    siteKeys = siteKeys.filter((k) => registry.has(k));
  }

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
    console.log(`\n=== Starting site: ${siteKey} ===`);
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
