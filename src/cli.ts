import "dotenv/config";
import { envInt, envStr } from "./core/config";
import { runSite } from "./core/execution";

// Adaptrar
import { adapter as template } from "./sites/_template/adapter";
import { adapter as apohem } from "./sites/apohem/adapter";
import { adapter as apotea } from "./sites/apotea/adapter";
import { adapter as apoteket } from "./sites/apoteket/adapter";
import { adapter as hjartat } from "./sites/hjartat/adapter";
import { adapter as kronans } from "./sites/kronans/adapter";

const registry = new Map<string, any>([
  ["apoteket", apoteket],
  ["apotea", apotea],
  ["kronans", kronans],
  ["apohem", apohem],
  ["hjartat", hjartat],
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
    console.log(`Usage:
node dist/cli.js --site <key> [--mode full|delta|refresh] [--limit N]

Options:
  --site     Vilken sajtadapter som ska köras
  --mode     Körläge (default: delta)
  --limit    Max antal produkter i körningen (default: 0 = ingen gräns)
  --list     Lista tillgängliga sajter

Available sites: ${Array.from(registry.keys()).join(", ")}`);
    process.exit(0);
  }

  if (hasFlag("--list")) {
    console.log(`Available sites: ${Array.from(registry.keys()).join(", ")}`);
    process.exit(0);
  }

  const siteKey = getArg("--site") || process.env.SITE;
  if (!siteKey) {
    console.error("❌ Missing --site or SITE env variable");
    console.error(`Available sites: ${Array.from(registry.keys()).join(", ")}`);
    process.exit(1);
  }

  const runMode = (getArg("--mode") || process.env.RUN_MODE || "delta") as
    | "full"
    | "delta"
    | "refresh";

  const limit = Number(
    getArg("--limit") ?? (process.env.PRODUCTS_LIMIT || "0"),
  );

  const adapter = registry.get(siteKey);
  if (!adapter) {
    console.error(`❌ Unknown --site ${siteKey}`);
    console.error(`Available sites: ${Array.from(registry.keys()).join(", ")}`);
    process.exit(2);
  }

  const outBase = envStr("OUT_DIR_BASE", "out");
  const snap = envStr("SNAPSHOT_DB_PATH", "state/data.sqlite");

  await runSite(adapter, {
    outDirBase: outBase,
    snapshotPath: snap,
    eanStorePath: "sqlite",
    globalEanStorePath: "sqlite",
    runMode,
    productsLimit: limit,
    progressEvery: envInt("PROGRESS_EVERY", 100),
    deltaGraceSeconds: envInt("DELTA_GRACE_SECONDS", 120),
    refreshTtlDays: envInt("REFRESH_TTL_DAYS", 30),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
