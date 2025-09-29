// src/core/storage.ts
import { closeDb, openDb } from "./database/connection";
import {
  ensureStore,
  getProductsBySite,
  upsertProduct,
} from "./database/operations";
import { ProductRecord } from "./types";

/** Migrate JSON snapshot/shops into SQLite if DB is empty but JSON exists */
// Migration from JSON removed (SQLite only)

/* --------------------------- product store helpers --------------------------- */

/**
 * Reads all products for a specific site from the database
 * @param dbPath - Database file path
 * @param siteHost - Site host to filter by
 * @returns Record of product records keyed by product ID
 */
export async function readPerSiteStore(
  dbPath: string,
  siteHost: string,
): Promise<Record<string, ProductRecord>> {
  const h = openDb(dbPath);
  try {
    const rows = getProductsBySite(h.db, siteHost);
    const map: Record<string, ProductRecord> = {};
    for (const r of rows) map[r.id] = r;
    return map;
  } finally {
    closeDb(h);
  }
}

/**
 * Reads all products from all sites in the database
 * @param dbPath - Database file path
 * @returns Record of all product records keyed by product ID
 */
export async function readGlobalStore(
  dbPath: string,
): Promise<Record<string, ProductRecord>> {
  const h = openDb(dbPath);
  try {
    // Global store = all products across hosts
    // Reuse getProductsBySite by selecting all distinct hosts first
    const hosts = h.db
      .prepare(`SELECT DISTINCT site_host AS host FROM products`)
      .all()
      .map((x: any) => x.host);
    const map: Record<string, ProductRecord> = {};
    for (const host of hosts) {
      for (const r of getProductsBySite(h.db, host)) map[r.id] = r;
    }
    return map;
  } finally {
    closeDb(h);
  }
}

/**
 * Writes product records for a specific site to the database
 * @param dbPath - Database file path
 * @param _siteHost - Site host (currently unused, derived from product URLs)
 * @param store - Record of product records to write
 */
export async function writePerSiteStore(
  dbPath: string,
  _siteHost: string,
  store: Record<string, ProductRecord>,
): Promise<void> {
  const h = openDb(dbPath);
  try {
    const tx = h.db.transaction((records: ProductRecord[]) => {
      for (const rec of records) {
        const host = new URL(rec.url).host;
        const storeId = ensureStore(h.db, host);
        upsertProduct(h.db, rec, storeId);
      }
    });
    tx(Object.values(store));
  } finally {
    closeDb(h);
  }
}

/**
 * Writes all product records to the database
 * @param dbPath - Database file path
 * @param store - Record of all product records to write
 */
export async function writeGlobalStore(
  dbPath: string,
  store: Record<string, ProductRecord>,
): Promise<void> {
  const h = openDb(dbPath);
  try {
    const tx = h.db.transaction((records: ProductRecord[]) => {
      for (const rec of records) {
        const host = new URL(rec.url).host;
        const storeId = ensureStore(h.db, host);
        upsertProduct(h.db, rec, storeId);
      }
    });
    tx(Object.values(store));
  } finally {
    closeDb(h);
  }
}
