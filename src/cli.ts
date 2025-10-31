import "dotenv/config";
import http from "http";
import { getSiteKeys, runImport } from "./core/services/import-service";
import { Logger } from "./core/utils/logger";

async function main() {
  const argv = process.argv.slice(2);

  const hasFlag = (flag: string) => argv.includes(flag);
  const getArg = (flag: string) => {
    const i = argv.lastIndexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  if (hasFlag("--help")) {
    Logger.info(`Usage:
node dist/cli.js --site <key> [--mode full|delta|refresh] [--limit N]
node dist/cli.js --sites <key1,key2,key3> [--mode full|delta|refresh] [--limit N]

CLI Mode - Bypass queue and run directly

Options:
  --site     Single site to run
  --sites    Multiple sites to run (comma-separated)
  --mode     Run mode (default: delta)
  --limit    Max products in run (default: 0 = no limit)
  --list     List available sites

Examples:
  npm run cli -- --site elgiganten --limit 10
  npm run cli -- --sites elgiganten,apotea,webhallen --limit 5

Available sites: ${getSiteKeys().join(", ")}
    
Note: For queue-based processing, use: npm start (uses dist/index.js)`);
    process.exit(0);
  }

  if (hasFlag("--list")) {
    Logger.info(`Available sites: ${getSiteKeys().join(", ")}`);
    process.exit(0);
  }

  const siteKey = getArg("--site") || process.env.SITE;
  const sitesArg = getArg("--sites");

  if (!siteKey && !sitesArg) {
    Logger.error("❌ Missing --site, --sites, or SITE env variable");
    Logger.info(`Available sites: ${getSiteKeys().join(", ")}`);
    process.exit(1);
  }

  const runMode = (getArg("--mode") || process.env.RUN_MODE || "delta") as
    | "full"
    | "delta"
    | "refresh";

  const limit = Number(
    getArg("--limit") ?? (process.env.PRODUCTS_LIMIT || "0"),
  );

  try {
    let siteKeys: string[] | undefined;
    if (sitesArg) {
      siteKeys = sitesArg
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (siteKey) {
      siteKeys = [siteKey];
    }

    const results = await runImport({
      siteKeys,
      runMode,
      productsLimit: limit,
    });

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    Logger.info(
      `✅ Import completed: ${successCount} successful, ${failCount} failed`,
    );
  } catch (error: any) {
    Logger.error(`❌ Import failed: ${error?.message || error}`);
    process.exit(1);
  }
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
server.listen(
  process.env.HEALTH_PORT ? Number(process.env.HEALTH_PORT) : 3210,
  () => {
    Logger.info("Health check endpoint listening on /healthz");
  },
);

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
