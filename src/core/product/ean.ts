/**
 * Product EAN handling and upserting logic
 */

import type { Product, ProductRecord } from "../types";
import { formatZonedISO, normalizeUrlKey } from "../utils";

/**
 * Generates a unique ID for a product based on EAN or normalized URL
 * @param p - The product to generate ID for
 * @param siteHost - The site host for the ID prefix
 * @returns Unique product ID in format "<host>|<ean>" or "<host>|<normalizedUrl>"
 */
export const idFor = (p: Product, siteHost: string): string =>
  (p.ean && `${siteHost}|${p.ean.trim()}`) ||
  `${siteHost}|${normalizeUrlKey(p.url)}`;

/**
 * Upserts a product into the store by EAN, handling deduplication
 * @param store - The product store to update
 * @param incoming - The new product data
 * @param siteHost - The site host for ID generation
 * @param lastmod - Optional last modification timestamp
 * @returns Object with the updated record and whether it changed
 */
export function upsertByEan(
  store: Record<string, ProductRecord>,
  incoming: Product,
  siteHost: string,
  lastmod?: string,
) {
  const id = idFor(incoming, siteHost);
  const nowIso = formatZonedISO(new Date()); // Stockholmstid
  const existing = store[id];

  if (!existing) {
    const rec: ProductRecord = {
      ...incoming,
      id,
      firstSeen: nowIso,
      lastUpdated: nowIso,
      lastCrawled: nowIso,
      lastmodByUrl: lastmod ? { [normalizeUrlKey(incoming.url)]: lastmod } : {},
    };
    store[id] = rec;
    return { record: rec, changed: true };
  }

  const merged: ProductRecord = { ...existing };
  const keyUrl = normalizeUrlKey(incoming.url);
  merged.lastmodByUrl = merged.lastmodByUrl || {};
  if (lastmod) merged.lastmodByUrl[keyUrl] = lastmod;

  const diff: Partial<Product> = {};
  (
    [
      "name",
      "price",
      "originalPrice",
      "currency",
      "imageUrl",
      "ean",
      "brand",
      "inStock",
    ] as (keyof Product)[]
  ).forEach((k) => {
    const nv = incoming[k];
    if (nv !== undefined && nv !== null && nv !== (merged as any)[k]) {
      (merged as any)[k] = nv;
      (diff as any)[k] = nv;
    }
  });

  const changed = JSON.stringify(existing) !== JSON.stringify(merged);
  merged.lastCrawled = nowIso;
  if (changed) merged.lastUpdated = nowIso;
  store[id] = merged;
  return { record: merged, changed };
}
