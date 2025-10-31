// src/sites/netonnet/adapter.ts
import type { Page, Route, Request } from "playwright";
import type { SiteAdapter, Product } from "../../../core/types/index";

const ORIGIN = "https://www.netonnet.se";
const abs = (u: string | null) => !u ? null : u.startsWith("//") ? "https:" + u : u.startsWith("/") ? ORIGIN + u : u;

export const adapter: SiteAdapter = {
  key: "netonnet",
  displayName: "NetOnNet",
  baseHost: "www.netonnet.se",

  discovery: {
    sitemapUrl: [
      "https://www.netonnet.se/sitemap.xml",
      "https://www.netonnet.se/sitemap_index.xml",
    ],
    // NetOnNet PDP: ofta /art/... (artiklar/produkter)
    productUrlRegex: /\/art\//i,
  },

  normalizeUrl: (raw) => {
    const u = new URL(raw);
    u.hash = ""; u.search = "";
    if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  },

  pacing: {
    hostMaxNavRps: 2.0,
    pdpConcurrency: 10,
    pdpTimeoutMs: 25000,
    navWaitPdp: "domcontentloaded",
    gotoMinSpacingMs: 400,
    minDelayMs: 20,
    maxDelayMs: 80,
    fetchRetries: 5,
    fetchRetryBaseMs: 700,
    errorWindow: 900,
    errorRateWarn: 0.05,
    errorRateGood: 0.02,
    cooldownSeconds: 90,
  },

  defaults: { currency: "SEK" },

  consent: async (page: Page) => {
    const sels = [
      'button:has-text("Acceptera")',
      'button:has-text("Godkänn")',
      '[data-testid*="accept" i]',
      '[aria-label*="acceptera" i]',
    ];
    for (const s of sels) {
      try {
        const b = page.locator(s).first();
        if (await b.isVisible({ timeout: 800 }).catch(() => false)) { await b.click({ timeout: 1200 }).catch(()=>{}); break; }
      } catch {}
    }
  },

  fastpathAdjust: (_html, p) => { if (!p.currency) p.currency = "SEK"; p.imageUrl = abs(p.imageUrl); return p; },

  customExtract: async function (this: SiteAdapter, page: Page, url: string): Promise<Product> {
    await page.route("**/*", (route: Route) => {
      const r: Request = route.request(); const t=r.resourceType(); const u=r.url();
      if (["image","media","font","stylesheet"].includes(t)) return route.abort();
      if (/analytics|gtm|doubleclick|hotjar|optimizely|facebook|pixel|fullstory|sentry/i.test(u)) return route.abort();
      return route.continue();
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(()=>{});
    await this.consent?.(page);

    const parse = (t:string)=>{ try{ return JSON.parse(t);}catch{ return null; } };
    const hasType = (v:any,re:RegExp)=> (typeof v==="string"&&re.test(v))||(Array.isArray(v)&&v.some(x=>typeof x==="string"&&re.test(x)));
    const pickProduct=(n:any):any=>{
      if (!n) return null;
      if (hasType(n?.["@type"], /^(Product|ProductModel|ProductGroup)$/i)) return n;
      if (hasType(n?.["@type"], /^WebPage$/i) && n?.mainEntity) return pickProduct(n.mainEntity);
      if (n?.["@graph"]) return pickProduct(n["@graph"]);
      if (Array.isArray(n)) { for (const el of n){ const p=pickProduct(el); if(p) return p; } }
      return null;
    };
    const num=(v:any)=> v==null?null:(()=>{ const n=parseFloat(String(v).replace(/\s/g,"").replace(",", ".")); return Number.isFinite(n)?n:null; })();

    for (const h of await page.locator('script[type="application/ld+json"]').all()) {
      const txt = await h.innerText().catch(()=> ""); if (!txt) continue;
      const j = parse(txt); if (!j) continue;
      const prod = pickProduct(j); if (!prod) continue;

      const offers = Array.isArray(prod.offers) ? prod.offers[0] : prod.offers;
      const availability = typeof offers?.availability === "string" ? offers.availability : null;
      const price = num(offers?.price ?? offers?.lowPrice ?? offers?.highPrice ?? null);
      const currency = offers?.priceCurrency || "SEK";
      const brand = (typeof prod.brand === "string" ? prod.brand : prod.brand?.name) ?? null;

      const p: Product = {
        name: prod.name ?? null,
        price,
        originalPrice: null,
        currency,
        imageUrl: abs(Array.isArray(prod.image)?prod.image[0]:prod.image ?? null),
        ean: prod.gtin13 || prod.gtin14 || prod.gtin12 || prod.gtin8 || prod.gtin || null,
        url,
        brand,
        inStock: availability ? /instock/i.test(availability) : null,
      };
      if (p.name && p.price !== null) return p;
    }

    // Fallback
    const txt = async (sels: string[]) => { for (const s of sels){ try{ const t=await page.locator(s).first().innerText({timeout:1000}); if(t) return t.trim(); }catch{}} return null;};
    const attr = async (sels: string[]) => { for (const s of sels){ const [css,a]=s.split("@"); try{ const v=await page.locator(css).first().getAttribute(a||"content",{timeout:1000}); if(v) return v.trim(); }catch{}} return null;};
    const toNum = (s:string|null)=> s?Number(s.replace(/\u00a0/g," ").replace(/[^\d.,]/g,"").replace(",", ".")):null;

    const name = await txt(["h1","meta[property='og:title']@content"]);
    const priceRaw = await attr(["meta[itemprop='price']@content","meta[property='product:price:amount']@content"]) ?? await txt(["[class*='price' i]"]);
    const img = await attr(["meta[property='og:image']@content","img[alt][src]@src"]);
    const brand = await txt(["[itemprop='brand']",".brand"]);
    return { name: name||null, price: toNum(priceRaw), originalPrice: null, currency: "SEK", imageUrl: abs(img), ean: null, url, brand: brand||null, inStock: null };
  },
};

export default adapter;
