/**
 * BullMQ Worker Entry Point
 * Processes import jobs from the queue
 */

import "dotenv/config";
import http from "http";
import { createImportWorker } from "./core/services/queue";
import { Logger } from "./core/utils/logger";

/**
 * Main worker function
 */
async function main() {
  Logger.info("Starting BullMQ worker for import jobs");

  // Create worker to process jobs with default processor and event handlers
  const worker = createImportWorker();

  // Graceful shutdown
  const shutdown = async () => {
    Logger.info("Graceful shutdown initiated");
    await worker.close();
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

  Logger.info("Worker is ready and listening for jobs");
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
  process.env.HEALTH_PORT ? Number(process.env.HEALTH_PORT) : 8081,
  () => {
    Logger.info("Worker health check endpoint listening on /healthz");
  },
);

main().catch((e) => {
  Logger.error(e);
  process.exit(1);
});
