/**
 * Database-related types
 */

import Database from "better-sqlite3";

export interface DbHandles {
  db: Database.Database;
}

export interface ProductRow {
  id: string;
  site_host: string;
  store_id: number | null;
  ean: string | null;
  url: string;
  name: string | null;
  price: number | null;
  original_price: number | null;
  currency: string | null;
  image_url: string | null;
  brand: string | null;
  in_stock: number | null;
  first_seen: string;
  last_updated: string;
  last_crawled: string | null;
}

export interface StoreRow {
  id: number;
  host: string;
  site_key: string | null;
  created_at: string;
  active: number;
}
