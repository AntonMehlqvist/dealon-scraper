/**
 * Snapshot index database operations
 */

import Database from "better-sqlite3";
import type { SnapshotIndex } from "../types";

/**
 * Reads snapshot index data from the database
 * @param db - Database connection
 * @returns Snapshot index containing lastmod and last crawled timestamps by URL
 */
export function readSnapshotIndexDb(db: Database.Database): SnapshotIndex {
  const rows = db
    .prepare(`SELECT url, lastmod, last_crawled_at FROM snapshot_index`)
    .all();
  const lastmodByUrl: Record<string, string> = {};
  const lastCrawledAtByUrl: Record<string, string> = {};
  for (const r of rows as any[]) {
    if (r.lastmod) lastmodByUrl[r.url] = r.lastmod;
    if (r.last_crawled_at) lastCrawledAtByUrl[r.url] = r.last_crawled_at;
  }
  return { lastmodByUrl, lastCrawledAtByUrl };
}

/**
 * Writes snapshot index data to the database
 * @param db - Database connection
 * @param data - Snapshot index data to write
 */
export function writeSnapshotIndexDb(
  db: Database.Database,
  data: SnapshotIndex,
): void {
  const up =
    db.prepare(`INSERT INTO snapshot_index (url, lastmod, last_crawled_at) VALUES (?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET lastmod=excluded.lastmod, last_crawled_at=excluded.last_crawled_at`);
  const tx = db.transaction(() => {
    for (const [u, lm] of Object.entries(data.lastmodByUrl)) {
      up.run(u, lm ?? null, data.lastCrawledAtByUrl[u] ?? null);
    }
    for (const [u, lc] of Object.entries(data.lastCrawledAtByUrl)) {
      if (!(u in data.lastmodByUrl)) up.run(u, null, lc ?? null);
    }
  });
  tx();
}
