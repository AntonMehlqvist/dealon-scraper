// src/sites/webhallen/adapter.ts
import { load as loadHtml } from "cheerio";
import type { Product, SiteAdapter } from "../../../core/types/index";

const PDP_LOG = process.env.PDP_LOG === "1" || process.env.PDP_LOG === "true";

function log(...args: any[]) {
  if (PDP_LOG) console.log(...args);
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    // behåll case i path (Webhallen verkar case-sens i sluggen ibland)
    let href = u.toString();
    // ta bort trailing slash
    if (href.endsWith("/")) href = href.slice(0, -1);
    return href;
  } catch {
    return raw;
  }
}

function parsePrice(input?: string | null): number | null {
  if (!input) return null;
  // Rensa bort valutatext och whitespace
  let s = input
    .replace(/\s+/g, "")
    .replace(/[A-Za-zkrKR]/g, "")
    .replace(/[^\d.,-]/g, "");
  // Svenska format: "1.234,56" eller "1234,56" eller "1 234"
  // Om både . och , förekommer, tolka "," som decimal
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    // bara komma: ersätt med punkt
    s = s.replace(",", ".");
  }
  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

function first<T>(...vals: Array<T | null | undefined>): T | null {
  for (const v of vals) if (v != null) return v as T;
  return null;
}

function textOrNull(s?: string | null): string | null {
  return s != null ? s : null;
}

async function tryConsent(page: import("playwright").Page) {
  // Försök täcka in vanliga varianter
  const candidates = [
    "button#onetrust-accept-btn-handler",
    'button[aria-label*="Acceptera"][id*="onetrust"]',
    'button[aria-label*="Accept"]',
    'button:has-text("Acceptera alla")',
    'button:has-text("Godkänn alla")',
    'button:has-text("Accept all")',
    'button:has-text("OK")',
    'button:has-text("Jag förstår")',
    '[data-testid="uc-accept-all-button"]',
  ];
  for (const sel of candidates) {
    const btn = page.locator(sel).first();
    if (await btn.count()) {
      try {
        await btn.click({ timeout: 1500 });
        log("[consent] clicked", sel);
        break;
      } catch {
        /* ignore */
      }
    }
  }
}

function extractProductFromJsonLd(html: string): Partial<Product> {
  const $ = loadHtml(html);
  const scripts = $('script[type="application/ld+json"]')
    .toArray()
    .map((el) => $(el).text())
    .filter(Boolean);

  let name: string | null = null;
  let price: number | null = null;
  let priceCurrency: string | null = null;
  let ean: string | null = null;
  let brand: string | null = null;
  let imageUrl: string | null = null;
  let inStock: boolean | null = null;

  function pickFromProduct(obj: any) {
    if (!obj || typeof obj !== "object") return;
    const types = Array.isArray(obj["@type"]) ? obj["@type"] : [obj["@type"]];
    if (!types || !types.includes("Product")) return;

    if (!name) name = textOrNull(obj.name);
    if (!brand) {
      if (typeof obj.brand === "string") brand = obj.brand;
      else if (obj.brand && typeof obj.brand === "object") {
        brand = textOrNull(obj.brand.name ?? obj.brand["@name"]);
      }
    }
    if (!imageUrl) {
      if (typeof obj.image === "string") imageUrl = obj.image;
      else if (Array.isArray(obj.image) && obj.image.length) {
        imageUrl = textOrNull(obj.image[0]);
      }
    }
    // EAN/GTIN varianter
    const idKeys = ["gtin13", "gtin", "ean", "mpn"];
    for (const k of idKeys) {
      if (!ean && obj[k] && typeof obj[k] === "string") {
        ean = obj[k];
      }
    }
    // offers
    const offers = obj.offers;
    const firstOffer = Array.isArray(offers) ? offers[0] : offers;
    if (firstOffer && typeof firstOffer === "object") {
      if (price == null) {
        price =
          parsePrice(firstOffer.price) ??
          parsePrice(firstOffer.priceSpecification?.price) ??
          null;
      }
      if (!priceCurrency) {
        priceCurrency =
          textOrNull(firstOffer.priceCurrency) ??
          textOrNull(firstOffer.priceSpecification?.priceCurrency) ??
          null;
      }
      if (inStock == null) {
        const avail =
          firstOffer.availability ??
          firstOffer.itemAvailability ??
          firstOffer.availabilityStatus;
        if (typeof avail === "string") {
          inStock = /InStock$/i.test(avail)
            ? true
            : /OutOfStock$/i.test(avail)
            ? false
            : null;
        }
      }
    }
  }

  for (const raw of scripts) {
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        for (const el of data) pickFromProduct(el);
      } else if (data && typeof data === "object") {
        // @graph variant
        if (Array.isArray((data as any)["@graph"])) {
          for (const el of (data as any)["@graph"]) pickFromProduct(el);
        } else {
          pickFromProduct(data);
        }
      }
    } catch {
      /* ignore invalid JSON-LD blobs */
    }
  }

  return {
    name: name ?? null,
    price: price ?? null,
    currency: priceCurrency ?? null,
    ean: ean ?? null,
    brand: brand ?? null,
    imageUrl: imageUrl ?? null,
    inStock: inStock ?? null,
  };
}

async function extractProductFallback(
  page: import("playwright").Page,
): Promise<Partial<Product>> {
  // H1 / titel
  const titleSelCandidates = [
    "h1",
    '[data-testid="pdp-title"]',
    '[itemprop="name"]',
    'meta[property="og:title"]',
  ];
  let name: string | null = null;
  for (const sel of titleSelCandidates) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      if (sel.startsWith("meta")) {
        const c = await loc.getAttribute("content").catch(() => null);
        if (c) {
          name = c.trim();
          break;
        }
      } else {
        const t = await loc.textContent().catch(() => null);
        if (t && t.trim()) {
          name = t.trim();
          break;
        }
      }
    }
  }

  // Bild
  const imageSelCandidates = [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'img[alt][src*="product"]',
    "picture img",
  ];
  let imageUrl: string | null = null;
  for (const sel of imageSelCandidates) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      const src =
        (await loc.getAttribute("content").catch(() => null)) ??
        (await loc.getAttribute("src").catch(() => null));
      if (src) {
        imageUrl = src;
        break;
      }
    }
  }

  // Pris – testa flera varianter
  const priceSelCandidates = [
    '[data-testid="price"], [data-qa="price"]',
    '[class*="price"]:not(:has(*))',
    '[itemprop="price"]',
    'meta[itemprop="price"]',
    'meta[property="product:price:amount"]',
  ];
  let price: number | null = null;
  for (const sel of priceSelCandidates) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      // meta-varianter
      const metaContent =
        (await loc.getAttribute("content").catch(() => null)) ??
        (await loc.getAttribute("contentvalue").catch(() => null));
      const txt = await loc.textContent().catch(() => null);
      const val = parsePrice(metaContent ?? txt ?? undefined);
      if (val != null) {
        price = val;
        break;
      }
    }
  }

  // Brand
  const brandSelCandidates = [
    '[itemprop="brand"]',
    'a[href*="brand"], [class*="brand"]',
    'meta[itemprop="brand"]',
    'meta[name="og:brand"]',
  ];
  let brand: string | null = null;
  for (const sel of brandSelCandidates) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      const meta = await loc.getAttribute("content").catch(() => null);
      const txt = await loc.textContent().catch(() => null);
      const b = (meta ?? txt)?.trim();
      if (b) {
        brand = b;
        break;
      }
    }
  }

  // EAN – leta i spec/attributtabell
  const eanCandidates = [
    // tabell: "EAN" i vänstercell
    'table:has-text("EAN")',
    // definitaionslistor
    'dl:has(dt:has-text("EAN"))',
    // generisk specifikation
    '[class*="spec"], [data-testid*="spec"]',
  ];
  let ean: string | null = null;

  for (const sel of eanCandidates) {
    const html = await page
      .locator(sel)
      .first()
      .innerHTML()
      .catch(() => null);
    if (!html) continue;
    const $ = loadHtml(html);
    // vanliga mönster: "EAN", "GTIN", "EAN/GTIN"
    const txt = $.root().text();
    const m =
      txt.match(/\b(?:EAN|GTIN)\s*[:：]?\s*([0-9]{8,14})\b/i) ??
      txt.match(/([0-9]{8,14})\s*(?:\(?(?:EAN|GTIN)\)?)/i);
    if (m && m[1]) {
      ean = m[1];
      break;
    }
    // tabell-specifikt: dt/dd eller th/td
    $("dt,th").each((_, el) => {
      const key = $(el).text().trim();
      if (!ean && /^(EAN|GTIN)$/i.test(key)) {
        const dd = $(el).next("dd,td");
        const val = dd
          .text()
          .trim()
          .match(/\d{8,14}/)?.[0];
        if (val) ean = val;
      }
    });
  }

  // Lagerstatus
  let inStock: boolean | null = null;
  const stockText = await page
    .locator(
      ':text-matches("I lager|Finns i lager|Slut i lager|Out of stock", "i")',
    )
    .first()
    .textContent()
    .catch(() => null);
  if (stockText) {
    if (/slut i lager|out of stock/i.test(stockText)) inStock = false;
    else if (/i lager|finns i lager/i.test(stockText)) inStock = true;
  }

  return {
    name: name ?? null,
    imageUrl: imageUrl ?? null,
    price: price ?? null,
    brand: brand ?? null,
    ean: ean ?? null,
    inStock: inStock,
  };
}

const adapter: SiteAdapter = {
  key: "webhallen",
  displayName: "Webhallen",
  baseHost: "www.webhallen.com",

  discovery: {
    sitemapUrl: [
      "https://www.webhallen.com/sitemap.product.xml",
      "https://www.webhallen.com/sitemap.xml",
      // vissa miljöer pekar om eller har .gz
      "https://www.webhallen.com/sitemap.product.xml.gz",
    ],
    productUrlRegex:
      /https?:\/\/www\.webhallen\.com\/se\/product\/\d+-[A-Za-z0-9-]+/i,
  },

  normalizeUrl,

  defaults: { currency: "SEK" },

  pacing: {
    navWaitPdp: "domcontentloaded", // före: "networkidle"
    pdpConcurrency: 6, // lite upp från 3
    pdpTimeoutMs: 9000, // ner från 25s
    gotoMinSpacingMs: 150,
    minDelayMs: 0,
    maxDelayMs: 20,
  },

  consent: async (page) => {
    await tryConsent(page);
  },

  // Primär extraktion i adaptern (för att vi ska kunna ha fallback direkt här)
  customExtract: async (page, url) => {
    const u = normalizeUrl(url);
    // Säkerställ att det är en PDP enligt mönstret (många category/landing dyker upp i sitemapen)
    if (!/\/se\/product\/\d+-/i.test(u)) {
      throw new Error("Not a PDP");
    }

    await page
      .goto(u, { waitUntil: "networkidle", timeout: 30_000 })
      .catch(() => {});
    await tryConsent(page);

    // Vänta på antingen JSON-data, titel eller pris-element
    try {
      await Promise.race([
        page.waitForSelector('script[type="application/ld+json"]', {
          timeout: 5_000,
        }),
        page.waitForSelector("h1", { timeout: 5_000 }),
        page.waitForSelector('[itemprop="price"], [class*="price"]', {
          timeout: 5_000,
        }),
      ]);
    } catch {
      // fortsätt ändå – vissa sidor är långsamma men networkidle räcker ofta
    }

    const html = await page.content();
    const fromJson = extractProductFromJsonLd(html);

    // Om JSON-LD saknar viktiga fält, komplettera från DOM
    const needFallback =
      !fromJson?.name ||
      fromJson.price == null ||
      !fromJson.ean ||
      !fromJson.imageUrl;

    let fromDom: Partial<Product> = {};
    if (needFallback) {
      fromDom = await extractProductFallback(page);
    }

    const merged: Product = {
      name: first(fromJson.name, fromDom.name),
      price: first(fromJson.price, fromDom.price),
      originalPrice: null, // Webhallen exponerar inte alltid 30-d-lägsta; kan byggas ut vid behov
      currency: first(fromJson.currency, fromDom.currency, "SEK"),
      imageUrl: first(fromJson.imageUrl, fromDom.imageUrl),
      ean: first(fromJson.ean, fromDom.ean),
      url: u,
      brand: first(fromJson.brand, fromDom.brand),
      inStock: first(fromJson.inStock, fromDom.inStock),
    };

    if (PDP_LOG) {
      log(
        `[pdp][webhallen] ${merged.name ?? "(no name)"} | price=${
          merged.price
        } | currency=${merged.currency} | ean=${merged.ean}`,
      );
    }

    return merged;
  },
};

export { adapter };
export default adapter;
