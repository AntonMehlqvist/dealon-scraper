import type { Page } from "playwright";

/** Produktfält (minimikrav) */
export interface Product {
  name: string | null;
  price: number | null;
  originalPrice: number | null; // t.ex. tidigare/listpris eller 30-dagars lägsta (site-spec)
  currency: string | null; // ex "SEK"
  imageUrl: string | null;
  ean: string | null; // GTIN-8/12/13/14
  url: string; // canonical/normalized url
  brand: string | null;
  inStock: boolean | null;
}

/** Internt record (persisteras i ean-store) */
export interface ProductRecord extends Product {
  id: string; // "<host>|<ean>" eller "<host>|<normalizedUrl>"
  firstSeen: string; // ISO med tz (t.ex. Europe/Stockholm)
  lastUpdated: string; // ISO med tz
  lastCrawled?: string; // ISO när den senast besöktes
  lastmodByUrl?: Record<string, string>;
}

/** Rampsteg för pacing */
export interface RampStep {
  t: number; // sekunder sedan start
  rps: number; // mål-RPS vid den tiden
}

/** Pacing/rate-limiting per sajt */
export interface PacingConfig {
  hostMaxNavRps?: number;
  ramp?: RampStep[];
  pdpConcurrency?: number;
  pdpTimeoutMs?: number;
  navWaitPdp?: "domcontentloaded" | "load" | "networkidle";
  gotoMinSpacingMs?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  fetchRetries?: number;
  fetchRetryBaseMs?: number;
  errorWindow?: number;
  errorRateWarn?: number;
  errorRateGood?: number;
  cooldownSeconds?: number;
}

/** Discovery (sitemap etc) */
// src/core/types.ts
export interface DiscoveryConfig {
  sitemapUrl?: string | string[]; // ← tillåt array
  productUrlRegex?: RegExp;
}

/** SiteAdapter – kontrakt för alla sajter */
export interface SiteAdapter {
  key: string;
  displayName: string;
  baseHost: string;

  discovery?: DiscoveryConfig;

  /** Normalisera URL (t.ex. ta bort query/hash/trailing slash) */
  normalizeUrl?: (raw: string) => string;

  pacing?: PacingConfig;

  /** Hantera cookie/consent innan extraktion */
  consent?: (page: Page) => Promise<void>;

  /** Fallback-selektorer när JSON-LD inte finns/är ofullständig */
  fallbackSelectors?: {
    title?: string[];
    price?: string[];
    original?: string[];
    brand?: string[];
    image?: string[];
  };

  /** Postprocess av fastpath-resultat (t.ex. sätt valuta) */
  fastpathAdjust?: (html: string, p: Product) => Product;

  /** Standardvärden per sajt */
  defaults?: { currency?: string };

  /**
   * (valfritt) Site-specifik PDP-extraktion.
   * Om den finns används den istället för standardrutinen i runnern.
   */
  customExtract?: (page: Page, url: string) => Promise<Product>;
}

/** Sitemap-entry */
export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

/** Snapshot-metadata (lagras ihop med products.json om man vill) */
export interface Snapshot {
  startedAt: string; // ISO
  finishedAt: string; // ISO
  site: string;
  ok: number;
  visited: number;
  wrote: number;
  errors: number;
}
