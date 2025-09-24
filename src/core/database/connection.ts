/**
 * Database connection management
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { initSchema } from "./schema";

/**
 * Database connection handles
 */
export interface DbHandles {
  db: Database.Database;
}

/**
 * Opens a database connection with optimized settings and initializes schema
 * @param dbPath - Path to the SQLite database file
 * @returns Database handles object containing the connection
 */
export function openDb(dbPath: string): DbHandles {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  try {
    db.pragma("cache_size = -200000");
  } catch {}
  try {
    db.pragma("temp_store = MEMORY");
  } catch {}
  try {
    db.pragma("mmap_size = 268435456");
  } catch {}
  initSchema(db);
  return { db };
}

/**
 * Closes a database connection
 * @param h - Database handles to close
 */
export function closeDb(h: DbHandles): void {
  h.db.close();
}
