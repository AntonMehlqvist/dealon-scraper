/**
 * Product-related types
 */

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
