/**
 * Database connection management
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { initSchema } from "./schema";

export interface DbHandles {
  db: Database.Database;
}

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

export function closeDb(h: DbHandles): void {
  h.db.close();
}
