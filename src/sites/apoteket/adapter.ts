// src/sites/apoteket/adapter.ts
import type { Page, Route, Request } from "playwright";
import type { SiteAdapter, Product } from "../../core/types";

const ORIGIN = "https://www.apoteket.se";
const abs = (u: string | null) => (!u ? null : u.startsWith("//") ? "https:" + u : u.startsWith("/") ? ORIGIN + u : u);

export const adapter: SiteAdapter = {
  key: "apoteket",
  displayName: "Apoteket",
  baseHost: "www.apoteket.se",   // ✅ ren host, inte [www...]()

  discovery: {
    sitemapUrl: [
      "https://www.apoteket.se/api/sitemap/sitemapindex.xml",
      "https://api.apoteket.se/sitemap/sitemapindex.xml",
    ],
    productUrlRegex: /\/produkt\//i,
  },
  
  // 🔧 Sänk farten + längre timeout
  pacing: {
    hostMaxNavRps: 2.0,
    ramp: [
      { t: 0, rps: 1.0 },
      { t: 180, rps: 1.5 },
      { t: 900, rps: 2.0 },
    ],
    pdpConcurrency: 1,
    pdpTimeoutMs: 30000,
    navWaitPdp: "domcontentloaded",
    gotoMinSpacingMs: 6000,
    minDelayMs: 150,
    maxDelayMs: 400,
    fetchRetries: 6,
    fetchRetryBaseMs: 900,
    errorWindow: 900,
    errorRateWarn: 0.05,
    errorRateGood: 0.02,
    cooldownSeconds: 150,
  },

  defaults: { currency: "SEK" },

  consent: async (page: Page) => {
    const btns = [
      'button:has-text("Acceptera alla")',
      'button:has-text("Tillåt alla")',
      'button:has-text("Acceptera")',
      'button:has-text("Godkänn")',
      '[data-testid*="accept" i]',
      '[aria-label*="acceptera" i]',
    ];
    for (const s of btns) {
      try {
        const el = page.locator(s).first();
        if (await el.isVisible().catch(() => false)) {
          await el.click({ timeout: 1200 }).catch(() => {});
          break;
        }
      } catch {}
    }
  },

  // 👇 Viktigt: blockera tunga/resurskrävande requests för färre timeouts
  customExtract: async (page: Page, url: string): Promise<Product> => {
    await page.route("**/*", (route: Route) => {
      const req: Request = route.request();
      const type = req.resourceType();
      const u = req.url();
      if (["image", "media", "font", "stylesheet"].includes(type)) return route.abort();
      if (/analytics|gtm|googletagmanager|doubleclick|hotjar|segment|optimizely|facebook|pixel|sentry|fullstory/i.test(u))
        return route.abort();
      if (/\.(mp4|webm|avi|mov)(\?|$)/i.test(u)) return route.abort();
      return route.continue();
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});

    // Consent (snabb)
    try {
      for (const s of ['button:has-text("Acceptera")','button:has-text("Acceptera alla")','button:has-text("Godkänn")']) {
        const el = page.locator(s).first();
        if (await el.isVisible({ timeout: 800 }).catch(() => false)) {
          await el.click({ timeout: 1200 }).catch(() => {});
          break;
        }
      }
    } catch {}

    // --- JSON-LD först
    const parseJson = (t: string) => { try { return JSON.parse(t); } catch { return null; } };
    const hasType = (t: any, re: RegExp) =>
      (typeof t === "string" && re.test(t)) || (Array.isArray(t) && t.some((x) => typeof x === "string" && re.test(x)));
    const pickProductLike = (node: any): any => {
      if (!node) return null;
      if (hasType(node?.["@type"], /^(Product|ProductModel|ProductGroup)$/i)) return node;
      if (hasType(node?.["@type"], /^WebPage$/i) && node?.mainEntity) return pickProductLike(node.mainEntity);
      if (node?.["@graph"]) return pickProductLike(node["@graph"]);
      if (Array.isArray(node)) for (const el of node) { const p = pickProductLike(el); if (p) return p; }
      return null;
    };
    const parseOffers = (offers: any) => {
      let priceRaw: any = null, curr: string | null = null, avail: string | null = null;
      const norm = (v: any) => {
        if (v == null) return null;
        const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
        return Number.isFinite(n) ? n : null;
      };
      if (!offers) return { price: null, currency: null, availability: null };
      if (Array.isArray(offers)) {
        for (const o of offers) {
          if (priceRaw == null) priceRaw = o?.price ?? o?.lowPrice ?? o?.highPrice ?? null;
          if (curr == null && typeof o?.priceCurrency === "string") curr = o.priceCurrency;
          if (avail == null && typeof o?.availability === "string") avail = o.availability;
        }
        return { price: norm(priceRaw), currency: curr, availability: avail };
      }
      if (offers?.["@type"] === "AggregateOffer") { priceRaw = offers.price ?? offers.lowPrice ?? offers.highPrice ?? null; curr = offers.priceCurrency ?? null; }
      else { priceRaw = offers?.price ?? null; curr = offers?.priceCurrency ?? null; }
      avail = typeof offers?.availability === "string" ? offers.availability : null;
      return { price: norm(priceRaw), currency: curr, availability: avail };
    };

    try {
      const scripts = await page.locator('script[type="application/ld+json"]').all();
      for (const s of scripts) {
        const txt = await s.innerText().catch(() => "");
        if (!txt) continue;
        const json = parseJson(txt);
        if (!json) continue;
        const prod = pickProductLike(json);
        if (prod) {
          const { price, currency, availability } = parseOffers(prod.offers);
          const brandName = (typeof prod.brand === "string" ? prod.brand : prod.brand?.name) ?? null;
          const p: Product = {
            name: prod.name ?? null,
            price,
            originalPrice: null,
            currency: currency || "SEK",
            imageUrl: abs(Array.isArray(prod.image) ? prod.image[0] : prod.image ?? null),
            ean: prod.gtin13 || prod.gtin14 || prod.gtin12 || prod.gtin8 || prod.gtin || null,
            url,
            brand: brandName,
            inStock: availability ? /instock/i.test(availability) : null,
          };
          if (p.name && p.price !== null) return p;
        }
      }
    } catch {}

    // --- Snabb DOM-fallback
    const getAttr = async (sel: string) => page.locator(sel).first().getAttribute("content").catch(() => null);
    const getText = async (sel: string) => page.locator(sel).first().innerText().then(t => t?.trim() ?? null).catch(() => null);

    const title = (await getText("h1")) ?? (await getAttr('meta[property="og:title"]'));
    const priceMeta =
      (await getAttr('meta[itemprop="price"]')) ??
      (await getAttr('meta[property="product:price:amount"]')) ??
      (await getAttr('meta[property="og:price:amount"]'));
    let price: number | null = null;
    if (priceMeta) {
      const n = Number(String(priceMeta).replace(/[^\d.,]/g, "").replace(",", "."));
      price = Number.isFinite(n) ? n : null;
    }
    if (price === null) {
      const txt =
        (await page.locator("[class*='price' i]").first().innerText().catch(() => "")) ||
        (await page.getByText(/\b\d[\d\s]*(?:,\d{2})?\s*kr\b/i).first().innerText().catch(() => ""));
      if (txt) {
        const m = /\b(\d[\d\s]*)(?:,(\d{2}))?\s*kr\b/i.exec(txt.replace(/\u00a0/g, " "));
        if (m) {
          const whole = m[1].replace(/\s/g, "");
          const dec = m[2] ? "." + m[2] : "";
          const n = Number(whole + dec);
          if (Number.isFinite(n)) price = n;
        }
      }
    }

    const imageUrl = abs(
      (await getAttr('meta[property="og:image"]')) ||
      (await page.locator("img[alt][src]").first().getAttribute("src").catch(() => null))
    );

    const stockTxt = (await page.locator('#stock-status, [class*="stock" i]').first().innerText().catch(() => "")) || "";
    let inStock: boolean | null = null;
    if (/webblager|i lager|finns i webblager/i.test(stockTxt)) inStock = true;
    else if (/slut|tillfälligt slut|ej i lager/i.test(stockTxt)) inStock = false;

    const brand =
      (await page.locator("a[href*='/varumarken/']").first().innerText().catch(() => null)) ?? null;

    if (!title && price === null) throw new Error("Not a PDP");

    return {
      name: title ?? null,
      price,
      originalPrice: null,
      currency: "SEK",
      imageUrl,
      ean: null,
      url,
      brand,
      inStock,
    };
  },

  // Behåll SEK även om JSON-LD saknar
  fastpathAdjust: (_html, prod) => {
    if (!prod.currency) prod.currency = "SEK";
    prod.imageUrl = abs(prod.imageUrl);
    return prod;
  },

  // Minimal fallback-selektorprofil (används ej när customExtract träffar)
  fallbackSelectors: {
    title: ["h1", 'meta[property="og:title"]@content'],
    price: ['meta[itemprop="price"]@content', "[class*='price' i]"],
    brand: ['[itemprop="brand"]', ".brand"],
    image: ['meta[property="og:image"]@content', 'img[alt][src]@src'],
  },
};

export default adapter;
