// src/core/storage.ts
import { closeDb, openDb } from "./database/connection";
import {
  ensureStore,
  getProductsBySite,
  upsertProduct,
} from "./database/operations";
import { readSnapshotIndexDb, writeSnapshotIndexDb } from "./database/snapshot";
import { ProductRecord, SnapshotIndex } from "./types";

/** Läs/skriv index för lastmod och senaste crawl-tid per URL */
export async function readSnapshotIndex(
  dbPathOrJsonPath: string,
): Promise<SnapshotIndex> {
  const h = openDb(dbPathOrJsonPath);
  try {
    return readSnapshotIndexDb(h.db);
  } finally {
    closeDb(h);
  }
}

export async function writeSnapshotIndex(
  dbPathOrJsonPath: string,
  data: SnapshotIndex,
): Promise<void> {
  const h = openDb(dbPathOrJsonPath);
  try {
    writeSnapshotIndexDb(h.db, data);
  } finally {
    closeDb(h);
  }
}

/** Migrate JSON snapshot/shops into SQLite if DB is empty but JSON exists */
// Migration from JSON removed (SQLite only)

/* --------------------------- product store helpers --------------------------- */

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
