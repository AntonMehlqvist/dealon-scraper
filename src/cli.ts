import "dotenv/config";
import { envInt, envStr } from "./core/config";
import { runSite } from "./core/execution";
import { Logger } from "./core/utils/logger";
import http from "http";

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

async function main() {
  const argv = process.argv.slice(2);

  const hasFlag = (flag: string) => argv.includes(flag);
  const getArg = (flag: string) => {
    // Ta ALLTID sista förekomsten om flaggan anges flera gånger
    const i = argv.lastIndexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  if (hasFlag("--help")) {
    Logger.info(`Usage:
node dist/cli.js --site <key> [--mode full|delta|refresh] [--limit N]
node dist/cli.js --sites <key1,key2,key3> [--mode full|delta|refresh] [--limit N]

Options:
  --site     Single site to run
  --sites    Multiple sites to run (comma-separated)
  --mode     Run mode (default: delta)
  --limit    Max products in run (default: 0 = no limit)
  --list     List available sites

Examples:
  npm start -- --site elgiganten --limit 10
  npm start -- --sites elgiganten,apotea,webhallen --limit 5

Available sites: ${Array.from(registry.keys()).join(", ")}`);
    process.exit(0);
  }

  if (hasFlag("--list")) {
    Logger.info(`Available sites: ${Array.from(registry.keys()).join(", ")}`);
    process.exit(0);
  }

  const siteKey = getArg("--site") || process.env.SITE;
  const sitesArg = getArg("--sites");

  if (!siteKey && !sitesArg) {
    Logger.error("❌ Missing --site, --sites, or SITE env variable");
    Logger.info(`Available sites: ${Array.from(registry.keys()).join(", ")}`);
    process.exit(1);
  }

  const runMode = (getArg("--mode") || process.env.RUN_MODE || "delta") as
    | "full"
    | "delta"
    | "refresh";

  const limit = Number(
    getArg("--limit") ?? (process.env.PRODUCTS_LIMIT || "0"),
  );

  const outBase = envStr("OUT_DIR_BASE", "out");
  const snap = envStr("SNAPSHOT_DB_PATH", "state/data.sqlite");

  // Handle multiple sites
  if (sitesArg) {
    const siteKeys = sitesArg
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const validSites = siteKeys.filter((k) => registry.has(k));
    const invalidSites = siteKeys.filter((k) => !registry.has(k));

    if (invalidSites.length > 0) {
      Logger.error(`❌ Unknown sites: ${invalidSites.join(", ")}`);
      Logger.info(
        `Available sites: ${Array.from(registry.keys()).join(", ")}`,
      );
      process.exit(2);
    }

    if (validSites.length === 0) {
      Logger.error("❌ No valid sites provided");
      process.exit(2);
    }

    Logger.info(
      `🚀 Running ${validSites.length} site(s): ${validSites.join(", ")}`,
    );

    // Run sites sequentially
    for (const key of validSites) {
      const adapter = registry.get(key);
      if (!adapter) continue;

      Logger.info(`\n=== Starting site: ${key} (${adapter.displayName}) ===`);
      await runSite(adapter, {
        outDirBase: outBase,
        runMode,
        productsLimit: limit,
        progressEvery: envInt("PROGRESS_EVERY", 100),
        deltaGraceSeconds: envInt("DELTA_GRACE_SECONDS", 120),
        refreshTtlDays: envInt("REFRESH_TTL_DAYS", 30),
      });
      Logger.info(`=== Finished site: ${key} ===\n`);
    }

    Logger.info("✅ All sites finished");
    return;
  }

  // Handle single site
  const adapter = registry.get(siteKey!);
  if (!adapter) {
    Logger.error(`❌ Unknown --site ${siteKey}`);
    Logger.info(`Available sites: ${Array.from(registry.keys()).join(", ")}`);
    process.exit(2);
  }

  await runSite(adapter, {
    outDirBase: outBase,
    runMode,
    productsLimit: limit,
    progressEvery: envInt("PROGRESS_EVERY", 100),
    deltaGraceSeconds: envInt("DELTA_GRACE_SECONDS", 120),
    refreshTtlDays: envInt("REFRESH_TTL_DAYS", 30),
  });
}

// Health check server
const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(process.env.HEALTH_PORT ? Number(process.env.HEALTH_PORT) : 8080, () => {
  Logger.info("Health check endpoint listening on /healthz");
});

const shutdown = () => {
  Logger.info("Graceful shutdown initiated");
  server.close(() => {
    Logger.info("Health server closed");
    process.exit(0);
  });
  setTimeout(() => {
    Logger.warn("Forced exit after 5s");
    process.exit(1);
  }, 5000);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((e) => {
  Logger.error(e);
  process.exit(1);
});
