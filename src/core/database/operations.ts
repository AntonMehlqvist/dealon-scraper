/**
 * Database operations for products and stores
 */

import Database from "better-sqlite3";
import type { ProductRecord } from "../types";

/**
 * Upserts a product record into the database
 * @param db - Database connection
 * @param record - Product record to upsert
 * @param storeId - Optional store ID to associate with the product
 */
export function upsertProduct(
  db: Database.Database,
  record: ProductRecord,
  storeId?: number,
): void {
  const i = db.prepare(`INSERT INTO products (
    id, site_host, store_id, ean, url, name, price, original_price, currency, image_url, brand, in_stock, first_seen, last_updated, last_crawled
  ) VALUES (@id, @site_host, @store_id, @ean, @url, @name, @price, @original_price, @currency, @image_url, @brand, @in_stock, @first_seen, @last_updated, @last_crawled)
  ON CONFLICT(id) DO UPDATE SET
    site_host=excluded.site_host,
    store_id=COALESCE(excluded.store_id, products.store_id),
    ean=excluded.ean,
    url=excluded.url,
    name=excluded.name,
    price=excluded.price,
    original_price=excluded.original_price,
    currency=excluded.currency,
    image_url=excluded.image_url,
    brand=excluded.brand,
    in_stock=excluded.in_stock,
    last_updated=excluded.last_updated,
    last_crawled=excluded.last_crawled
  `);

  i.run({
    id: record.id,
    site_host: new URL(record.url).host,
    store_id: storeId ?? null,
    ean: record.ean ?? null,
    url: record.url,
    name: record.name ?? null,
    price: record.price ?? null,
    original_price: record.originalPrice ?? null,
    currency: record.currency ?? null,
    image_url: record.imageUrl ?? null,
    brand: record.brand ?? null,
    in_stock: record.inStock == null ? null : record.inStock ? 1 : 0,
    first_seen: record.firstSeen,
    last_updated: record.lastUpdated,
    last_crawled: record.lastCrawled ?? null,
  });
}

/**
 * Retrieves all products for a specific site from the database
 * @param db - Database connection
 * @param siteHost - The site host to filter by
 * @returns Array of product records for the site
 */
export function getProductsBySite(
  db: Database.Database,
  siteHost: string,
): ProductRecord[] {
  const rows = db
    .prepare(`SELECT * FROM products WHERE site_host = ?`)
    .all(siteHost);
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    price: r.price,
    originalPrice: r.original_price,
    currency: r.currency,
    imageUrl: r.image_url,
    ean: r.ean,
    url: r.url,
    brand: r.brand,
    inStock: r.in_stock == null ? null : !!r.in_stock,
    firstSeen: r.first_seen,
    lastUpdated: r.last_updated,
    lastCrawled: r.last_crawled ?? null,
  }));
}

/**
 * Ensures a store exists in the database, creating it if necessary
 * @param db - Database connection
 * @param host - Store host identifier
 * @param siteKey - Optional site key for the store
 * @returns The store ID (existing or newly created)
 */
export function ensureStore(
  db: Database.Database,
  host: string,
  siteKey?: string,
): number {
  const ins =
    db.prepare(`INSERT INTO stores(host, site_key, active) VALUES(?, ?, 1)
    ON CONFLICT(host) DO UPDATE SET site_key=COALESCE(excluded.site_key, stores.site_key)`);
  ins.run(host, siteKey ?? null);
  const row = db
    .prepare(`SELECT id FROM stores WHERE host = ?`)
    .get(host) as any;
  return Number(row.id);
}

/**
 * Retrieves a store ID by host name
 * @param db - Database connection
 * @param host - Store host to look up
 * @returns Store ID if found, null otherwise
 */
export function getStoreIdByHost(
  db: Database.Database,
  host: string,
): number | null {
  const row = db
    .prepare(`SELECT id FROM stores WHERE host = ?`)
    .get(host) as any;
  return row ? Number(row.id) : null;
}

/**
 * Sets a configuration value in the database
 * @param db - Database connection
 * @param key - Configuration key
 * @param value - Configuration value
 */
export function setConfigValue(
  db: Database.Database,
  key: string,
  value: string,
): void {
  const stmt = db.prepare(`
    INSERT INTO configuration (key, value) 
    VALUES (?, ?) 
    ON CONFLICT(key) DO UPDATE SET 
      value = excluded.value,
      updated_at = datetime('now')
  `);
  stmt.run(key, value);
}

/**
 * Gets a configuration value from the database
 * @param db - Database connection
 * @param key - Configuration key
 * @returns Configuration value if found, null otherwise
 */
export function getConfigValue(
  db: Database.Database,
  key: string,
): string | null {
  const row = db
    .prepare(`SELECT value FROM configuration WHERE key = ?`)
    .get(key) as any;
  return row ? row.value : null;
}

/**
 * Gets all configuration values from the database
 * @param db - Database connection
 * @returns Record of all configuration key-value pairs
 */
export function getAllConfigValues(
  db: Database.Database,
): Record<string, string> {
  const rows = db
    .prepare(`SELECT key, value FROM configuration`)
    .all() as any[];
  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.key] = row.value;
  }
  return config;
}
