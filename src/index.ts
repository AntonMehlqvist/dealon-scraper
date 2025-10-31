/**
 * Main Entry Point
 * Starts the BullMQ worker and upserts recurring jobs
 * This is the primary way to run the application in queue mode
 */

import "dotenv/config";
import http from "http";
import { getCategories } from "./core/services/import-service";
import {
  createImportQueue,
  createImportWorker,
  scheduleRecurringImport,
} from "./core/services/queue";
import { Logger } from "./core/utils/logger";

/**
 * Main application function
 */
async function main() {
  Logger.info("Starting multi-site scraper application");

  // Create the import queue
  const queue = createImportQueue();

  // Upsert recurring jobs for all categories
  const categories = getCategories();
  Logger.info("Setting up recurring import schedules");

  for (const [key] of Object.entries(categories)) {
    // Skip template category
    if (key === "template") continue;

    try {
      await scheduleRecurringImport(queue, key, {
        runMode: (process.env.RUN_MODE || "delta") as
          | "full"
          | "delta"
          | "refresh",
        cron: "0 2 * * *", // Daily at 2 AM
      });
      Logger.info(`✅ Scheduled recurring import for: ${key}`);
    } catch (error: any) {
      Logger.error(
        `Failed to schedule ${key}: ${error?.message || String(error)}`,
      );
    }
  }

  // Create worker to process jobs with default processor and event handlers
  const worker = createImportWorker();

  // Graceful shutdown
  const shutdown = async () => {
    Logger.info("Graceful shutdown initiated");
    await worker.close();
    await queue.close();
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

  Logger.info("🚀 Application is ready and listening for jobs");
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
  process.env.HEALTH_PORT ? Number(process.env.HEALTH_PORT) : 8080,
  () => {
    Logger.info("Health check endpoint listening on /healthz");
  },
);

main().catch((e) => {
  Logger.error(e);
  process.exit(1);
});
