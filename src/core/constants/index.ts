/**
 * Application constants
 */

// Database constants
export const DB_CONSTANTS = {
  CACHE_SIZE: -200000,
  MMAP_SIZE: 268435456,
  JOURNAL_MODE: "WAL",
  SYNCHRONOUS: "NORMAL",
} as const;

// Execution constants
export const EXECUTION_CONSTANTS = {
  BATCH_SIZE: 50, // flush every 50 products
  MAX_CONCURRENCY: 3, // cap at 3 to avoid OOM
  COOLDOWN_THRESHOLD: 5, // consecutive errors before cooldown
  DEFAULT_TIMEOUT_MS: 30000,
  DEFAULT_RETRIES: 3,
  DEFAULT_BASE_DELAY_MS: 800,
  DEFAULT_COOLDOWN_SECONDS: 120,
} as const;

// Discovery constants
export const DISCOVERY_CONSTANTS = {
  DEFAULT_ATTEMPTS: 2,
  DEFAULT_BACKOFF_MS: 2000,
  DEFAULT_RETRIES: 4,
  DEFAULT_BASE_DELAY_MS: 500,
  JITTER_MAX_MS: 250,
} as const;

// Browser constants
export const BROWSER_CONSTANTS = {
  USER_AGENT:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit(537.36) Chrome/124.0.0.0 Safari/537.36",
  ACCEPT_HEADER:
    "application/xml,text/xml,application/xhtml+xml;q=0.9,*/*;q=0.8",
  ACCEPT_ENCODING: "gzip, deflate, br",
  DEFAULT_REFERER: "https://www.google.com/",
} as const;

// Pacing constants
export const PACING_CONSTANTS = {
  DEFAULT_HOST_MAX_NAV_RPS: 1.0,
  DEFAULT_PDP_CONCURRENCY: 1,
  DEFAULT_PDP_TIMEOUT_MS: 30000,
  DEFAULT_GOTO_MIN_SPACING_MS: 0,
  DEFAULT_MIN_DELAY_MS: 0,
  DEFAULT_MAX_DELAY_MS: 0,
  DEFAULT_FETCH_RETRIES: 3,
  DEFAULT_FETCH_RETRY_BASE_MS: 800,
  DEFAULT_ERROR_WINDOW: 600,
  DEFAULT_ERROR_RATE_WARN: 0.05,
  DEFAULT_ERROR_RATE_GOOD: 0.02,
  DEFAULT_COOLDOWN_SECONDS: 120,
} as const;
