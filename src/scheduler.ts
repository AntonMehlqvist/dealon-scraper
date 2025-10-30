/**
 * Scheduler Entry Point
 * Sets up recurring daily import jobs for all categories
 */

import "dotenv/config";
import { getCategories } from "./core/services/import-service";
import {
  createImportQueue,
  getScheduledJobs,
  scheduleRecurringImport,
} from "./core/services/queue";
import { Logger } from "./core/utils/logger";

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`
Scheduler - Configure recurring import jobs

Usage:
  npm run scheduler                    # Schedule all categories with default settings
  npm run scheduler -- --category <cat>  # Schedule specific category only

Options:
  --category <category>  Schedule only a specific category (pharmacy, electronics, all)
  --cron <pattern>       Custom cron pattern (default: "0 2 * * *" = daily at 2 AM)
  --mode <mode>          Run mode: full, delta, refresh (default: delta)
  
Environment Variables:
  REDIS_HOST             Redis host (default: localhost)
  REDIS_PORT             Redis port (default: 6379)
  REDIS_PASSWORD         Redis password (optional)

Examples:
  npm run scheduler
  npm run scheduler -- --category pharmacy
  npm run scheduler -- --cron "0 0 * * *" --mode full
`);
    process.exit(0);
  }

  Logger.info("Starting scheduler to configure recurring imports");

  const categories = getCategories();
  const queue = createImportQueue();

  // Parse command line arguments
  const categoryIndex = argv.indexOf("--category");
  const cronIndex = argv.indexOf("--cron");
  const modeIndex = argv.indexOf("--mode");

  const targetCategory = categoryIndex >= 0 ? argv[categoryIndex + 1] : null;
  const cronPattern = cronIndex >= 0 ? argv[cronIndex + 1] : "0 2 * * *";
  const runMode =
    modeIndex >= 0
      ? (argv[modeIndex + 1] as "full" | "delta" | "refresh")
      : "delta";

  // Get categories to schedule
  const categoriesToSchedule = targetCategory
    ? [targetCategory]
    : ["pharmacy", "electronics", "all"];

  Logger.info("Scheduling recurring imports", {
    categories: categoriesToSchedule,
    cron: cronPattern,
    mode: runMode,
  });

  // Schedule recurring imports for each category
  for (const cat of categoriesToSchedule) {
    if (!(cat in categories)) {
      Logger.warn(`Unknown category: ${cat}, skipping`);
      continue;
    }

    try {
      await scheduleRecurringImport(queue, cat, {
        runMode,
        cron: cronPattern,
      });
      Logger.info(`✅ Scheduled recurring import for: ${cat}`);
    } catch (error: any) {
      Logger.error(
        `Failed to schedule ${cat}: ${error?.message || String(error)}`,
      );
    }
  }

  // Show current scheduled jobs
  const scheduled = await getScheduledJobs(queue);
  Logger.info(`Total scheduled jobs: ${scheduled.length}`);
  scheduled.forEach((scheduler) => {
    Logger.info(
      `  - ${scheduler.id}: ${scheduler.pattern || scheduler.every}ms`,
    );
  });

  await queue.close();
  Logger.info("Scheduler completed");
  process.exit(0);
}

main().catch((e) => {
  Logger.error(e);
  process.exit(1);
});
