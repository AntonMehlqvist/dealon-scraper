/**
 * Standard product extraction logic
 */

import type { Page } from "playwright";
import type { Product, SiteAdapter } from "../types/index";

/**
 * Extracts product information using standard JSON-LD and DOM fallback methods
 * First attempts to parse structured data from JSON-LD scripts, then falls back to DOM selectors
 * @param adapter - Site adapter configuration
 * @param page - Playwright page instance
 * @param url - URL being processed
 * @returns Extracted product information
 */
export async function extractStandard(
  adapter: SiteAdapter,
  page: Page,
  url: string,
): Promise<Product> {
  await page.goto(url, {
    waitUntil: adapter.pacing?.navWaitPdp || "domcontentloaded",
    timeout: adapter.pacing?.pdpTimeoutMs ?? 30000,
  });

  if (adapter.consent) {
    try {
      await adapter.consent(page);
    } catch {}
  }

  const ldHandles = await page
    .locator('script[type="application/ld+json"]')
    .all();
  for (let i = 0; i < ldHandles.length; i++) {
    try {
      const txt = await ldHandles[i].innerText();
      const node = JSON.parse(txt);

      const nodes: any[] = Array.isArray(node) ? node : [node];
      for (const n of nodes) {
        const types = Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]];
        const isProduct =
          types.some(
            (t) => typeof t === "string" && /product/i.test(t || ""),
          ) ||
          (typeof n["@type"] === "string" && /product/i.test(n["@type"]));

        if (!isProduct) continue;

        const offers = Array.isArray(n.offers) ? n.offers[0] : n.offers;
        const priceNum =
          offers?.price != null
            ? Number(
                String(offers.price)
                  .replace(/[^\d.,]/g, "")
                  .replace(",", "."),
              )
            : null;
        const currency =
          offers?.priceCurrency || adapter.defaults?.currency || "SEK";

        const p: Product = {
          name: n.name ?? null,
          price: Number.isFinite(priceNum as number)
            ? (priceNum as number)
            : null,
          originalPrice: null,
          currency,
          imageUrl: Array.isArray(n.image) ? n.image[0] : n.image ?? null,
          ean: n.gtin13 || n.gtin || null,
          url,
          brand: n.brand?.name || n.brand || null,
          inStock:
            typeof offers?.availability === "string"
              ? /instock/i.test(offers.availability)
              : null,
        };

        const html = await page.content();
        return adapter.fastpathAdjust ? adapter.fastpathAdjust(html, p) : p;
      }
    } catch {}
  }

  // --- Fallback (DOM) ---
  const getText = async (sels?: string[]) => {
    if (!sels) return null;
    for (const s of sels) {
      try {
        const txt = await page.locator(s).first().innerText({ timeout: 1000 });
        if (txt) return txt.trim();
      } catch {}
    }
    return null;
  };
  const getAttr = async (sels?: string[]) => {
    if (!sels) return null;
    for (const s of sels) {
      const [css, attr] = s.split("@");
      try {
        const val = await page
          .locator(css)
          .first()
          .getAttribute(attr || "content", {
            timeout: 1000,
          });
        if (val) return val.trim();
      } catch {}
    }
    return null;
  };

  const title = await getText(adapter.fallbackSelectors?.title);
  const priceRaw = await getText(adapter.fallbackSelectors?.price);
  const origRaw = await getText(adapter.fallbackSelectors?.original);
  const brand = await getText(adapter.fallbackSelectors?.brand);
  const image = await getAttr(adapter.fallbackSelectors?.image);

  const toNum = (s: string | null) =>
    s
      ? Number(
          s
            .replace(/\u00a0/g, " ")
            .replace(/[^\d.,]/g, "")
            .replace(",", "."),
        )
      : null;

  const p: Product = {
    name: title || null,
    price: toNum(priceRaw),
    originalPrice: toNum(origRaw),
    currency: adapter.defaults?.currency || "SEK",
    imageUrl: image || null,
    ean: null,
    url,
    brand: brand || null,
    inStock: null,
  };

  const html = await page.content();
  return adapter.fastpathAdjust ? adapter.fastpathAdjust(html, p) : p;
}
