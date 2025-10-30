// src/core/storage.ts
import { eq, inArray } from "drizzle-orm";
import { scrapedProductListings, scrapedStores, stores } from "../schema";
import { db } from "./drizzleClient";
import sanitizeEan from "./utils/sanitizeEan";

function getTopLevelDomain(urlOrHost: string): string {
  let host = urlOrHost;
  try {
    // Prefix scheme if missing to allow URL parsing
    const u = urlOrHost.includes("://")
      ? new URL(urlOrHost)
      : new URL(`https://${urlOrHost}`);
    host = u.hostname;
  } catch {}
  const splitName = host.split(".").filter(Boolean);
  const topLevel = splitName.length > 2 ? splitName.slice(-2) : splitName;
  return topLevel.join(".");
}

function normalizeDomainCandidates(urlOrHost: string): {
  dotHost: string;
  hyphenHost: string;
} {
  const tld = getTopLevelDomain(urlOrHost).replace(/^www\./i, "");
  const dotHost = tld;
  const hyphenHost = tld.replaceAll(".", "-");
  return { dotHost, hyphenHost };
}

export async function saveScrapedStoreDrizzle(store: {
  name: string;
  domain: string;
}) {
  const { dotHost, hyphenHost } = normalizeDomainCandidates(store.domain);

  // 1) Try to find a match in main stores table by either convention
  const prodMatch = await db
    .select()
    .from(stores)
    .where(inArray(stores.storeDomain, [dotHost, hyphenHost]))
    .limit(1);

  // 2) Ensure scraped_stores row exists (always required for FK)
  const scrapedMatch = await db
    .select()
    .from(scrapedStores)
    .where(eq(scrapedStores.domain, dotHost))
    .limit(1);

  let scrapedRowId: number | null = scrapedMatch[0]?.id ?? null;
  if (!scrapedRowId) {
    const [inserted] = await db
      .insert(scrapedStores)
      .values({ name: store.name, domain: dotHost })
      .returning();
    scrapedRowId = inserted.id;
  }

  const matchedStoreId = prodMatch[0]?.id ?? null;
  return { scrapedStoreId: scrapedRowId, matchedStoreId };
}

export async function saveScrapedProductListings(
  listings: Array<{
    productName: string;
    ean?: string | null;
    price: number;
    currency: string;
    inStock: boolean;
    productUrl: string;
    imageUrl?: string | null;
    store: { name: string; domain: string };
    rawData?: any;
  }>,
) {
  for (const l of listings) {
    const storeIds = await saveScrapedStoreDrizzle(l.store);
    const rawEan = l.ean ?? l.rawData?.ean ?? null;
    const ean = rawEan ? sanitizeEan(rawEan) : null;
    const priceInt = Number.isFinite(l.price) ? Math.round(l.price) : null;
    await db
      .insert(scrapedProductListings)
      .values({
        productName: l.productName,
        ean: ean,
        price: priceInt ?? undefined,
        currency: l.currency,
        inStock: l.inStock,
        productUrl: l.productUrl,
        imageUrl: l.imageUrl || null,
        scrapedStoreId: storeIds.scrapedStoreId,
        matchedStoreId: storeIds.matchedStoreId ?? undefined,
        rawData: l.rawData ? l.rawData : {},
      })
      .onConflictDoNothing();
  }
}
