// src/orchestrator.ts
import "dotenv/config";
import {
  getCategories,
  getSiteKeys,
  runImport,
} from "./core/services/import-service";
import { Logger } from "./core/utils/logger";

/* ---------------- CLI Helpers ---------------- */
function showHelp() {
  const categories = getCategories();
  console.log(`
Multi-Site Scraper - Site Selection Options

Usage:
  npm start                           # Run all default sites
  npm start -- --category pharmacy    # Run all pharmacy sites
  npm start -- --category electronics # Run all electronics sites
  npm start -- --sites apotea,elgiganten # Run specific sites
  npm start -- --list                 # List all available sites

Categories:
${Object.entries(categories)
  .map(
    ([key, cat]) =>
      `  ${key.padEnd(12)} - ${cat.name}: ${cat.sites.join(", ")}`,
  )
  .join("\n")}

Available Sites:
  ${getSiteKeys().sort().join(", ")}
`);
}

function parseCliArgs() {
  const argv = process.argv.slice(2);
  const categories = getCategories();

  // Show help
  if (argv.includes("--help") || argv.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  // List sites
  if (argv.includes("--list")) {
    console.log("Available sites by category:");
    Object.entries(categories).forEach(([key, cat]) => {
      console.log(`\n${cat.name} (${key}):`);
      cat.sites.forEach((site) => {
        console.log(`  ${site.padEnd(12)}`);
      });
    });
    process.exit(0);
  }

  // Parse category
  const categoryIdx = argv.indexOf("--category");
  if (categoryIdx >= 0 && argv[categoryIdx + 1]) {
    const category = argv[categoryIdx + 1];
    if (category in categories) {
      return { category: category as keyof typeof categories };
    } else {
      console.error(`❌ Unknown category: ${category}`);
      console.error(
        `Available categories: ${Object.keys(categories).join(", ")}`,
      );
      process.exit(1);
    }
  }

  // Parse specific sites
  const sitesIdx = argv.indexOf("--sites");
  if (sitesIdx >= 0 && argv[sitesIdx + 1]) {
    return {
      siteKeys: argv[sitesIdx + 1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  return null;
}

/* --------------------- main --------------------- */
async function main() {
  const parsedArgs = parseCliArgs();

  try {
    const results = await runImport(parsedArgs || {});

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    Logger.info(
      `✅ All imports finished: ${successCount} successful, ${failCount} failed`,
    );

    if (failCount > 0) {
      results.forEach((r) => {
        if (!r.success) {
          Logger.error(`Failed: ${r.siteKey} - ${r.error}`);
        }
      });
      process.exit(1);
    }
  } catch (error: any) {
    Logger.error(error);
    process.exit(1);
  }
}

main().catch((e) => {
  Logger.error(e);
  process.exit(1);
});
