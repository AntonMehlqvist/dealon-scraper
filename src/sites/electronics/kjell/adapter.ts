// src/sites/kjell/adapter.ts
import type { Page, Route, Request } from "playwright";
import type { SiteAdapter, Product } from "../../../core/types";

const ORIGIN = "https://www.kjell.com";
const abs = (u: string | null) =>
  !u ? null : u.startsWith("//") ? "https:" + u : u.startsWith("/") ? ORIGIN + u : u;

export const adapter: SiteAdapter = {
  key: "kjell",
  displayName: "Kjell & Company",
  baseHost: "www.kjell.com",

  discovery: {
    sitemapUrl: [
      "https://www.kjell.com/sitemap.xml",
      "https://www.kjell.com/sitemap_index.xml",
      // Batchade sv-SE ger bättre täckning
      "https://www.kjell.com/sitemap.xml?batch=0&language=sv-se",
      "https://www.kjell.com/sitemap.xml?batch=1&language=sv-se",
    ],
    // ENDAST PDP: slutar på -p<digits> (tillåt ev. / eller ? i slutet)
    productUrlRegex: /\/se\/produkter\/.+-p\d+(?:\/|$|\?)/i,
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

  pacing: {
    hostMaxNavRps: 2.0,
    ramp: [
      { t: 0, rps: 1.0 },
      { t: 120, rps: 1.5 },
      { t: 480, rps: 2.0 },
    ],
    pdpConcurrency: 2,
    pdpTimeoutMs: 25000,
    navWaitPdp: "domcontentloaded",
    gotoMinSpacingMs: 900,
    minDelayMs: 80,
    maxDelayMs: 220,
  },

  defaults: { currency: "SEK" },

  consent: async (page: Page) => {
    const sels = [
      'button:has-text("Acceptera")',
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

  customExtract: async function (_page: Page, url: string): Promise<Product> {
    const page = _page;

    await page.route("**/*", (route: Route) => {
      const req: Request = route.request();
      const t = req.resourceType();
      const u = req.url();
      if (["image", "media", "font", "stylesheet"].includes(t)) return route.abort();
      if (/gtm|googletagmanager|doubleclick|facebook|pixel|hotjar|sentry|optimizely|fullstory/i.test(u))
        return route.abort();
      return route.continue();
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
    try { await this.consent?.(page); } catch {}

    // 1) JSON-LD Product / WebPage->mainEntity / @graph
    const ldNodes = await page.locator('script[type="application/ld+json"]').all();
    const parse = (t: string) => { try { return JSON.parse(t); } catch { return null; } };
    const isType = (n: any, re: RegExp) =>
      (typeof n === "string" && re.test(n)) || (Array.isArray(n) && n.some((x) => typeof x === "string" && re.test(x)));
    const pickProduct = (node: any): any => {
      if (!node) return null;
      if (isType(node?.["@type"], /^(Product|ProductModel|ProductGroup)$/i)) return node;
      if (isType(node?.["@type"], /^WebPage$/i) && node?.mainEntity) return pickProduct(node.mainEntity);
      if (node?.["@graph"]) return pickProduct(node["@graph"]);
      if (Array.isArray(node)) for (const el of node) { const p = pickProduct(el); if (p) return p; }
      return null;
    };
    const parseOffers = (offers: any) => {
      let priceRaw: any = null, curr: string | null = null, avail: string | null = null;
      const num = (v: any) => (v==null?null:(()=>{const n=parseFloat(String(v).replace(/\s/g,"").replace(",","."));return Number.isFinite(n)?n:null;})());
      if (!offers) return { price: null, currency: null, availability: null };
      const many = Array.isArray(offers) ? offers : [offers];
      for (const o of many) {
        if (priceRaw == null) priceRaw = o?.price ?? o?.lowPrice ?? o?.highPrice ?? null;
        if (!curr && typeof o?.priceCurrency === "string") curr = o.priceCurrency;
        if (!avail && typeof o?.availability === "string") avail = o.availability;
      }
      return { price: num(priceRaw), currency: curr, availability: avail };
    };

    for (const s of ldNodes) {
      const txt = await s.innerText().catch(() => "");
      if (!txt) continue;
      const json = parse(txt);
      if (!json) continue;
      const prod = pickProduct(json);
      if (!prod) continue;

      const { price, currency, availability } = parseOffers(prod.offers);
      const brand = (typeof prod.brand === "string" ? prod.brand : prod.brand?.name) ?? null;

      const product: Product = {
        name: prod.name ?? null,
        price,
        originalPrice: null,
        currency: currency || "SEK",
        imageUrl: abs(Array.isArray(prod.image) ? prod.image[0] : prod.image ?? null),
        ean: prod.gtin13 || prod.gtin14 || prod.gtin12 || prod.gtin8 || prod.gtin || null,
        url,
        brand,
        inStock: availability ? /instock/i.test(availability) : null,
      };
      if (product.name && product.price !== null) return product;
    }

    // 2) Nuxt/SSR-state (om de exponerar)
    const nuxt = await page.evaluate(() => (window as any).__NUXT__ || null).catch(() => null);
    if (nuxt?.state?.product) {
      const pd = nuxt.state.product;
      const priceNum = typeof pd.price === "number" ? pd.price : (pd.currentPrice ?? null);
      const p: Product = {
        name: pd.name ?? pd.title ?? null,
        price: typeof priceNum === "number" ? priceNum : (priceNum ? Number(String(priceNum)) : null),
        originalPrice: null,
        currency: pd.currency || "SEK",
        imageUrl: abs(pd?.images?.[0]?.url || pd?.image || null),
        ean: pd.gtin || pd.gtin13 || pd.ean || null,
        url,
        brand: pd.brand?.name || pd.brand || null,
        inStock: typeof pd.inStock === "boolean" ? pd.inStock : null,
      };
      if (p.name && p.price !== null) return p;
    }

    // 3) og-fallback
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute("content").catch(() => null);
    const ogImage = await page.locator('meta[property="og:image"]').getAttribute("content").catch(() => null);
    const ogPrice = await page.locator('meta[property="product:price:amount"]').getAttribute("content").catch(() => null);
    const p: Product = {
      name: ogTitle || null,
      price: ogPrice ? Number(String(ogPrice).replace(",", ".")) : null,
      originalPrice: null,
      currency: "SEK",
      imageUrl: abs(ogImage || null),
      ean: null,
      url,
      brand: null,
      inStock: null,
    };
    if (p.name && p.price !== null) return p;

    throw new Error("Not a PDP");
  },
};

export default adapter;
