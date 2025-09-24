/**
 * Database operations for products and stores
 */

import Database from "better-sqlite3";
import type { ProductRecord } from "../types";

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

  if (record.sourceUrls && record.sourceUrls.length) {
    const insSrc = db.prepare(
      `INSERT OR IGNORE INTO product_sources (id, url) VALUES (?, ?)`,
    );
    const tx = db.transaction((urls: string[]) => {
      for (const u of urls) insSrc.run(record.id, u);
    });
    tx(record.sourceUrls);
  }

  if (record.history && record.history.length) {
    const insHist = db.prepare(
      `INSERT INTO product_history (id, ts, changes_json) VALUES (?, ?, ?)`,
    );
    const tx = db.transaction((hist: NonNullable<ProductRecord["history"]>) => {
      for (const h of hist)
        insHist.run(record.id, h.ts, JSON.stringify(h.changes));
    });
    tx(record.history);
  }
}

export function getProductsBySite(
  db: Database.Database,
  siteHost: string,
): ProductRecord[] {
  const rows = db
    .prepare(`SELECT * FROM products WHERE site_host = ?`)
    .all(siteHost);
  const srcStmt = db.prepare(`SELECT url FROM product_sources WHERE id = ?`);
  const histStmt = db.prepare(
    `SELECT ts, changes_json FROM product_history WHERE id = ? ORDER BY ts ASC`,
  );
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
    sourceUrls: srcStmt.all(r.id).map((x: any) => x.url),
    history: histStmt
      .all(r.id)
      .map((x: any) => ({ ts: x.ts, changes: JSON.parse(x.changes_json) })),
  }));
}

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

export function getStoreIdByHost(
  db: Database.Database,
  host: string,
): number | null {
  const row = db
    .prepare(`SELECT id FROM stores WHERE host = ?`)
    .get(host) as any;
  return row ? Number(row.id) : null;
}
