/**
 * Centralized application configuration
 */

export class AppConfig {
  // Database configuration
  static readonly DB_PATH = process.env.DB_PATH || "state/data.sqlite";
  static readonly SNAPSHOT_DB_PATH =
    process.env.SNAPSHOT_DB_PATH || "state/data.sqlite";

  // Output configuration
  static readonly OUT_DIR_BASE = process.env.OUT_DIR_BASE || "out";

  // Browser configuration
  static readonly HEADLESS = !/^false|0$/i.test(process.env.HEADLESS || "true");
  static readonly DEBUG = /^true|1$/i.test(process.env.DEBUG || "false");

  // Execution configuration
  static readonly RUN_MODE = (process.env.RUN_MODE || "delta") as
    | "full"
    | "delta"
    | "refresh";
  static readonly PRODUCTS_LIMIT = Number(process.env.PRODUCTS_LIMIT || "0");
  static readonly PROGRESS_EVERY = Number(process.env.PROGRESS_EVERY || "100");
  static readonly DELTA_GRACE_SECONDS = Number(
    process.env.DELTA_GRACE_SECONDS || "120",
  );
  static readonly REFRESH_TTL_DAYS = Number(
    process.env.REFRESH_TTL_DAYS || "30",
  );

  // Discovery configuration
  static readonly DISCOVERY_ATTEMPTS = Number(
    process.env.DISCOVERY_ATTEMPTS || "2",
  );
  static readonly DISCOVERY_BACKOFF_MS = Number(
    process.env.DISCOVERY_BACKOFF_MS || "2000",
  );
  static readonly SITEMAP_OVERRIDE = process.env.SITEMAP_OVERRIDE || "";
  static readonly EXTRA_SITEMAP_URLS = process.env.EXTRA_SITEMAP_URLS || "";
  static readonly SEED_FILE = process.env.SEED_FILE || "";
  static readonly SEED_URLS = process.env.SEED_URLS || "";
  static readonly SEED_ONLY = /^true|1$/i.test(
    process.env.SEED_ONLY || "false",
  );
  static readonly SNAPSHOT_ONLY_TOUCHED = /^true|1$/i.test(
    process.env.SNAPSHOT_ONLY_TOUCHED || "false",
  );

  // Logging configuration
  static readonly PDP_LOG = /^true|1$/i.test(process.env.PDP_LOG || "false");

  // Site-specific configuration
  static readonly SITE = process.env.SITE;

  // Apohem chunked configuration
  static readonly APOHEM_CHUNK_SIZE = Number(
    process.env.APOHEM_CHUNK_SIZE || "1200",
  );
  static readonly APOK_HEADSTART_MS = Number(
    process.env.APOK_HEADSTART_MS || "4000",
  );

  /**
   * Get environment variable as string with default
   */
  static getString(key: string, defaultValue: string): string {
    return process.env[key] ?? defaultValue;
  }

  /**
   * Get environment variable as number with default
   */
  static getNumber(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (!value) return defaultValue;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

  /**
   * Get environment variable as boolean with default
   */
  static getBoolean(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (!value) return defaultValue;
    return /^(1|true|yes|on)$/i.test(value);
  }

  /**
   * Get environment variable as array (comma-separated)
   */
  static getArray(key: string, defaultValue: string[] = []): string[] {
    const value = process.env[key];
    if (!value) return defaultValue;
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
}
