/**
 * Database schema initialization and migrations
 */

import Database from "better-sqlite3";

/**
 * Initializes the database schema with all required tables, indexes, and views
 * Also handles lightweight migrations for existing databases
 * @param db - Database connection to initialize
 */
export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host TEXT NOT NULL UNIQUE,
      site_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      site_host TEXT NOT NULL,
      store_id INTEGER,
      ean TEXT,
      url TEXT NOT NULL,
      name TEXT,
      price REAL,
      original_price REAL,
      currency TEXT,
      image_url TEXT,
      brand TEXT,
      in_stock INTEGER,
      first_seen TEXT NOT NULL,
      last_updated TEXT NOT NULL,
      last_crawled TEXT,
      FOREIGN KEY (store_id) REFERENCES stores(id)
    );

    CREATE TABLE IF NOT EXISTS product_sources (
      id TEXT NOT NULL,
      url TEXT NOT NULL,
      PRIMARY KEY (id, url)
    );

    /* -------------------- indexes & unique constraints -------------------- */
    /* Use non-unique indexes for now to avoid failing on existing duplicates.
       We can backfill/dedupe and then promote to UNIQUE later. */
    CREATE INDEX IF NOT EXISTS ix_products_site_url ON products(site_host, url);
    CREATE INDEX IF NOT EXISTS ix_products_site_ean ON products(site_host, ean) WHERE ean IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_products_site_updated ON products(site_host, last_updated DESC);
    CREATE INDEX IF NOT EXISTS idx_products_ean ON products(ean) WHERE ean IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_products_last_crawled ON products(last_crawled);

    CREATE INDEX IF NOT EXISTS idx_sources_url ON product_sources(url);
    CREATE INDEX IF NOT EXISTS idx_history_id_ts ON product_history(id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_snapshot_last_crawled ON snapshot_index(last_crawled_at);
  `);

  // --- lightweight migration: add missing columns on existing DBs ---
  try {
    const cols: any[] = db.prepare(`PRAGMA table_info(products)`).all();
    const hasLastCrawled = cols.some((c) => String(c.name) === "last_crawled");
    if (!hasLastCrawled) {
      db.exec(`ALTER TABLE products ADD COLUMN last_crawled TEXT`);
    }
    const hasStoreId = cols.some((c) => String(c.name) === "store_id");
    if (!hasStoreId) {
      db.exec(`ALTER TABLE products ADD COLUMN store_id INTEGER`);
    }
  } catch {}

  // ensure indexes related to stores
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_stores_host ON stores(host);
    CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id);
  `);
}
