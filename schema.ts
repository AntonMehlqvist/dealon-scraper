import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// ---------------- SCRAPED DATA TABLES (keep separate from main data) ----------------

export const stores = pgTable(
  "stores",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 1000 }).unique().notNull(),
    displayName: varchar("display_name", { length: 1000 }),
    storeDomain: varchar("store_domain", { length: 1000 }).unique().notNull(),
    slug: varchar("slug", { length: 1000 }).unique().notNull(),
    description: text("description"),
    logoUrl: varchar("logo_url", { length: 1000 }),
    isActive: boolean("is_active").default(true),
    published: boolean("published").default(true),
    createdAt: timestamp("created_at", { mode: "date" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    uniqueStoreDomainIndex: uniqueIndex("uniqueStoreDomainIndex").on(
      table.storeDomain,
    ),
  }),
);

export const scrapedStores = pgTable(
  "scraped_stores",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 1000 }).notNull(),
    domain: varchar("domain", { length: 1000 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    uniqueScrapedStoreDomain: uniqueIndex("uniqueScrapedStoreDomain").on(
      table.domain,
    ),
  }),
);

export const scrapedProductListings = pgTable(
  "scraped_product_listings",
  {
    id: serial("id").primaryKey(),
    productName: varchar("product_name", { length: 2000 }).notNull(),
    ean: varchar("ean", { length: 100 }), // NEW: for EAN-based lookups
    price: integer("price"),
    currency: varchar("currency", { length: 16 }),
    inStock: boolean("in_stock").default(false),
    productUrl: varchar("product_url", { length: 5000 }),
    imageUrl: varchar("image_url", { length: 5000 }),
    scrapedStoreId: integer("scraped_store_id")
      .references(() => scrapedStores.id)
      .notNull(),
    matchedStoreId: integer("matched_store_id").references(() => stores.id), // nullable FK to stores
    rawData: jsonb("raw_data").notNull(), // full scraped data for flexibility
    createdAt: timestamp("created_at", { mode: "date" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    scrapedStoreIdIndex: index("scrapedStoreIdIndex").on(table.scrapedStoreId),
    matchedStoreIdIndex: index("matchedStoreIdIndex").on(table.matchedStoreId),
    urlIndex: index("scrapedProductUrlIndex").on(table.productUrl),
  }),
);
