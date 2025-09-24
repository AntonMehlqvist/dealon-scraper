/**
 * Product EAN handling and upserting logic
 */

import type { Product, ProductRecord } from "../types";
import { formatZonedISO, normalizeUrlKey } from "../utils";

/** ID per BUTIK: "<host>|<ean>" eller fallback "<host>|<normalizedUrl>" */
export const idFor = (p: Product, siteHost: string): string =>
  (p.ean && `${siteHost}|${p.ean.trim()}`) ||
  `${siteHost}|${normalizeUrlKey(p.url)}`;

export function upsertByEan(
  store: Record<string, ProductRecord>,
  incoming: Product,
  siteHost: string,
  lastmod?: string,
  trackHistory = false,
  historyKeys: (keyof Product)[] = ["price", "originalPrice", "inStock"],
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
      sourceUrls: [normalizeUrlKey(incoming.url)],
      lastmodByUrl: lastmod ? { [normalizeUrlKey(incoming.url)]: lastmod } : {},
    };
    store[id] = rec;
    return { record: rec, changed: true };
  }

  const merged: ProductRecord = { ...existing };
  const keyUrl = normalizeUrlKey(incoming.url);
  if (!merged.sourceUrls.includes(keyUrl)) merged.sourceUrls.push(keyUrl);
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

  if (trackHistory) {
    const hist: Partial<Product> = {};
    historyKeys.forEach((k) => {
      if ((diff as any)[k] !== undefined) (hist as any)[k] = (diff as any)[k];
    });
    if (Object.keys(hist).length > 0) {
      merged.history = merged.history || [];
      merged.history.push({ ts: nowIso, changes: hist }); // Stockholmstid
    }
  }

  const changed =
    JSON.stringify({ ...existing, history: undefined }) !==
    JSON.stringify({ ...merged, history: undefined });
  merged.lastCrawled = nowIso;
  if (changed) merged.lastUpdated = nowIso;
  store[id] = merged;
  return { record: merged, changed };
}
