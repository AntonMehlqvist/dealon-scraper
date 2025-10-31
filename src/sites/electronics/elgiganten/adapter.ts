// src/sites/elgiganten/adapter.ts
import type { Page, Request, Route } from "playwright";
import type { Product, SiteAdapter } from "../../../core/types/index";

const ORIGIN = "https://www.elgiganten.se";
const abs = (u: string | null) =>
  !u
    ? null
    : u.startsWith("//")
    ? "https:" + u
    : u.startsWith("/")
    ? ORIGIN + u
    : u;

/** Elgiganten – fastpath-first med aggressiv pacing (kort CLI) */
export const adapter: SiteAdapter = {
  key: "elgiganten",
  displayName: "Elgiganten",
  baseHost: "www.elgiganten.se",

  discovery: {
    sitemapUrl: [
      "https://www.elgiganten.se/sitemap.xml",
      "https://www.elgiganten.se/sitemap_index.xml",
    ],
    // /product/ men skippa brus (disabled-item, tjänster, merch, & några icke-elektronik-kategorier)
    productUrlRegex:
      /^(?!.*\/(?:disabled-item|services?|tjanster|MERCH|film-musik|leksaker|sport-fritid)(?:\/|$)).+:\/\/[^\/]+\/product\/.+/i,
  },

  normalizeUrl: (raw) => {
    const u = new URL(raw);
    u.search = "";
    u.hash = "";
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.toString();
  },

  // Pacing i adapter (kan överskridas via env om man vill labba)
  pacing: {
    hostMaxNavRps: 4.0,
    ramp: [
      { t: 0, rps: 2.5 },
      { t: 180, rps: 3.3 },
      { t: 900, rps: 4.0 },
    ],
    pdpConcurrency: 28, // ↑ från 16 → högre sustained rate
    pdpTimeoutMs: 20_000,
    navWaitPdp: "domcontentloaded",
    gotoMinSpacingMs: 0,
    minDelayMs: 0,
    maxDelayMs: 12, // liten jitter för att undvika “lockstep”
    fetchRetries: 1, // färre retries → mindre backoff-kostnad
    fetchRetryBaseMs: 120,
    errorWindow: 600,
    errorRateWarn: 0.02,
    errorRateGood: 0.005,
    cooldownSeconds: 120,
  },

  defaults: { currency: "SEK" },

  consent: async (page: Page) => {
    const sels = [
      'button:has-text("Acceptera")',
      'button:has-text("Acceptera alla")',
      'button:has-text("Godkänn")',
      '[data-testid*="accept" i]',
      '[aria-label*="acceptera" i]',
    ];
    for (const s of sels) {
      try {
        const btn = page.locator(s).first();
        if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
          await btn.click({ timeout: 1200 }).catch(() => {});
          break;
        }
      } catch {}
    }
  },

  fastpathAdjust: (_html, p) => {
    if (!p.currency) p.currency = "SEK";
    p.imageUrl = abs(p.imageUrl);
    return p;
  },

  /** Browser-fallback (endast om ALLOW_BROWSER_FALLBACK=true) */
  customExtract: async function (
    this: SiteAdapter,
    page: Page,
    url: string,
  ): Promise<Product> {
    await page.route("**/*", (route: Route) => {
      const req: Request = route.request();
      const type = req.resourceType();
      const u = req.url();
      const sameOrigin = (() => {
        try {
          return /(?:^|\.)elgiganten\.se$/i.test(new URL(u).host);
        } catch {
          return false;
        }
      })();

      if (["image", "media", "font", "stylesheet"].includes(type))
        return route.abort();
      if (type === "script" && !sameOrigin) return route.abort();
      if (
        /analytics|gtm|googletagmanager|doubleclick|hotjar|segment|optimizely|facebook|pixel|sentry|fullstory|clarity|newrelic/i.test(
          u,
        )
      )
        return route.abort();
      if (/\.(mp4|webm|avi|mov)(\?|$)/i.test(u)) return route.abort();
      return route.continue();
    });

    await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 })
      .catch(() => {});
    try {
      await this.consent?.(page);
    } catch {}

    // JSON-LD Product
    const parseJson = (t: string) => {
      try {
        return JSON.parse(t);
      } catch {
        return null;
      }
    };
    const hasType = (t: any, re: RegExp) =>
      (typeof t === "string" && re.test(t)) ||
      (Array.isArray(t) && t.some((x) => typeof x === "string" && re.test(x)));
    const pickProductLike = (node: any): any => {
      if (!node) return null;
      if (hasType(node?.["@type"], /^(Product|ProductModel|ProductGroup)$/i))
        return node;
      if (hasType(node?.["@type"], /^WebPage$/i) && node?.mainEntity)
        return pickProductLike(node.mainEntity);
      if (node?.["@graph"]) return pickProductLike(node["@graph"]);
      if (Array.isArray(node))
        for (const el of node) {
          const p = pickProductLike(el);
          if (p) return p;
        }
      return null;
    };
    const parseOffers = (offers: any) => {
      let priceRaw: any = null,
        curr: string | null = null,
        avail: string | null = null;
      const norm = (v: any) => {
        if (v == null) return null;
        const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
        return Number.isFinite(n) ? n : null;
      };
      if (!offers) return { price: null, currency: null, availability: null };
      if (Array.isArray(offers)) {
        for (const o of offers) {
          if (priceRaw == null)
            priceRaw = o?.price ?? o?.lowPrice ?? o?.highPrice ?? null;
          if (curr == null && typeof o?.priceCurrency === "string")
            curr = o.priceCurrency;
          if (avail == null && typeof o?.availability === "string")
            avail = o.availability;
        }
        return { price: norm(priceRaw), currency: curr, availability: avail };
      }
      if (offers?.["@type"] === "AggregateOffer") {
        priceRaw = offers.price ?? offers.lowPrice ?? offers.highPrice ?? null;
        curr = offers.priceCurrency ?? null;
      } else {
        priceRaw = offers?.price ?? null;
        curr = offers?.priceCurrency ?? null;
      }
      avail =
        typeof offers?.availability === "string" ? offers.availability : null;
      return { price: norm(priceRaw), currency: curr, availability: avail };
    };

    const scripts = await page
      .locator('script[type="application/ld+json"]')
      .all();
    for (const s of scripts) {
      const txt = await s.innerText().catch(() => "");
      if (!txt) continue;
      const json = parseJson(txt);
      if (!json) continue;
      const prod = pickProductLike(json);
      if (!prod) continue;

      const { price, currency, availability } = parseOffers(prod.offers);
      const brandName =
        (typeof prod.brand === "string" ? prod.brand : prod.brand?.name) ??
        null;
      const p: Product = {
        name: prod.name ?? null,
        price,
        originalPrice: null,
        currency: currency || "SEK",
        imageUrl: abs(
          Array.isArray(prod.image) ? prod.image[0] : prod.image ?? null,
        ),
        ean:
          prod.gtin13 ||
          prod.gtin14 ||
          prod.gtin12 ||
          prod.gtin8 ||
          prod.gtin ||
          null,
        url,
        brand: brandName,
        inStock: availability ? /instock/i.test(availability) : null,
      };
      if (p.name && p.price !== null) return p;
    }
    throw new Error("Not a PDP");
  },

  // Minimal fallback (normalt ej använd)
  fallbackSelectors: {
    title: ["h1", 'meta[property="og:title"]@content'],
    price: [
      'meta[itemprop="price"]@content',
      'meta[property="product:price:amount"]@content',
      "[class*='price' i]",
    ],
    brand: ['[itemprop="brand"]', ".brand"],
    image: ['meta[property="og:image"]@content', "img[alt][src]@src"],
  },
};

export default adapter;
