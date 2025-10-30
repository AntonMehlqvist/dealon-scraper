/**
 * BullMQ Queue Configuration
 * Handles job scheduling and processing for import tasks
 */

import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { Logger } from "../utils/logger";
import { runImport } from "./import-service";

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

/**
 * Redis connection configuration
 */
export const connection = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: null, // Required for BullMQ
});

export interface ImportJobData {
  siteKeys?: string[];
  category?: string;
  runMode?: "full" | "delta" | "refresh";
  productsLimit?: number;
}

export const QUEUE_NAMES = {
  SCRAPE: "scrape-jobs",
} as const;

/**
 * Create a new import queue
 */
export function createImportQueue() {
  return new Queue<ImportJobData>(QUEUE_NAMES.SCRAPE, {
    connection,
  });
}

/**
 * Default processor for import jobs
 * Processes a job by calling runImport with the job data
 */
export async function processImportJob(job: any) {
  const { siteKeys, category, runMode, productsLimit } =
    job.data as ImportJobData;

  Logger.info(`Processing job ${job.id}`, {
    siteKeys,
    category,
    runMode,
  });

  try {
    const results = await runImport({
      siteKeys,
      category: category as any,
      runMode,
      productsLimit,
    });

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    Logger.info(`Job ${job.id} completed`, {
      successCount,
      failCount,
      results,
    });

    return {
      success: true,
      results,
    };
  } catch (error: any) {
    Logger.error(
      `Job ${job.id} failed`,
      error instanceof Error
        ? error
        : new Error(error?.message || String(error)),
    );
    throw error;
  }
}

/**
 * Setup default event handlers for a worker
 */
export function setupWorkerEventHandlers(worker: Worker) {
  worker.on("completed", (job) => {
    Logger.info(`Job ${job.id} completed successfully`);
  });

  worker.on("failed", (job, err) => {
    Logger.error(`Job ${job?.id} failed: ${err.message}`);
  });

  worker.on("error", (err) => {
    Logger.error(`Worker error: ${err.message}`);
  });
}

/**
 * Create a worker to process import jobs
 * Can use default processor or custom processor
 */
export function createImportWorker(
  processor: (job: any) => Promise<any> = processImportJob,
  setupEvents = true,
) {
  const worker = new Worker<ImportJobData>(
    QUEUE_NAMES.SCRAPE,
    async (job) => {
      Logger.info(`Processing import job: ${job.id}`, {
        data: job.data,
      });
      return await processor(job);
    },
    {
      connection,
      concurrency: 1, // Process one import at a time
      limiter: {
        max: 1,
        duration: 1000,
      },
    },
  );

  if (setupEvents) {
    setupWorkerEventHandlers(worker);
  }

  return worker;
}

/**
 * Schedule recurring daily imports for a category using upsertJobScheduler
 * This simplifies the API and automatically handles upsert logic
 */
export async function scheduleRecurringImport(
  queue: Queue<ImportJobData>,
  category: string,
  options: {
    runMode?: "full" | "delta" | "refresh";
    productsLimit?: number;
    cron?: string; // Default: daily at 2 AM
  } = {},
) {
  const { runMode = "delta", productsLimit = 0, cron } = options;

  // Use upsertJobScheduler to create or update the recurring job
  await queue.upsertJobScheduler(
    `import-${category}`, // jobSchedulerId - unique identifier
    {
      pattern: cron, // cron pattern for scheduling
    },
    {
      // jobTemplate - defines the actual job that will be created
      name: `import-${category}`,
      data: {
        category,
        runMode,
        productsLimit,
      },
      opts: {
        removeOnComplete: {
          age: 24 * 3600, // Keep completed jobs for 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 3600, // Keep failed jobs for 7 days
        },
      },
    },
  );

  Logger.info(`Scheduled recurring import for category: ${category}`, {
    cron,
    runMode,
  });
}

/**
 * Schedule a one-time import job
 */
export async function scheduleOneTimeImport(
  queue: Queue<ImportJobData>,
  data: ImportJobData,
  options: { delay?: number } = {},
) {
  const job = await queue.add("import-onetime", data, {
    delay: options.delay,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 60000, // 1 minute
    },
  });

  Logger.info(`Scheduled one-time import job: ${job.id}`, { data });

  return job;
}

/**
 * Get all scheduled jobs using the new Job Scheduler API
 */
export async function getScheduledJobs(queue: Queue<ImportJobData>) {
  const schedulers = await queue.getJobSchedulers();
  return schedulers;
}

/**
 * Remove a scheduled recurring job by scheduler ID
 */
export async function removeScheduledJob(
  queue: Queue<ImportJobData>,
  schedulerId: string,
) {
  await queue.removeJobScheduler(schedulerId);
  Logger.info(`Removed scheduled job: ${schedulerId}`);
}
