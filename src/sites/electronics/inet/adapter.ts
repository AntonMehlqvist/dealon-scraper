// src/sites/inet/adapter.ts
import type { Page, Route, Request } from "playwright";
import type { SiteAdapter, Product } from "../../../core/types";

const ORIGIN = "https://www.inet.se";
const abs = (u: string | null) =>
  !u ? null : u.startsWith("//") ? "https:" + u : u.startsWith("/") ? ORIGIN + u : u;

/* ------------------------------ price helper ------------------------------ */
function parsePriceLike(input?: string | number | null): number | null {
  if (input == null) return null;
  let s = String(input)
    .replace(/\u00a0/g, " ")
    .replace(/[A-Za-zkrKR]/g, "")
    .replace(/[^\d.,-]/g, "")
    .trim();
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------- EAN helpers ------------------------------ */
const DIGITS = /\d/g;
const isGtinLen = (s: string) => [8, 12, 13, 14].includes(s.length);
const normDigits = (s: string) => (s ? s.replace(/\D+/g, "") : "");

function chooseBestGtin(cands: string[]): string | null {
  const uniq = Array.from(new Set(cands.map(normDigits).filter(isGtinLen)));
  if (!uniq.length) return null;
  // Prioritet 13/14 → 12 → 8
  const score = (x: string) =>
    x.length === 13 || x.length === 14 ? 3 : x.length === 12 ? 2 : x.length === 8 ? 1 : 0;
  uniq.sort((a, b) => score(b) - score(a));
  return uniq[0] || null;
}

/** Hämta __NEXT_DATA__ block (serverrenderad Next.js payload) */
function extractNextData(html: string): any | null {
  const m =
    html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i) ||
    html.match(/window\.__NEXT_DATA__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    try {
      return JSON.parse(m[1].replace(/<\/?script[^>]*>/gi, "").trim());
    } catch {
      return null;
    }
  }
}

/* --------------------- JSON-LD deep EAN/GTIN extraction -------------------- */
function extractLdBlocks(html: string): any[] {
  const out: any[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const txt = (m[1] || "").trim();
    if (!txt) continue;
    try {
      const j = JSON.parse(txt);
      out.push(j);
    } catch {
      // vissa butiker har trailing-kommentarer – ignorera
    }
  }
  return out;
}

type AnyObj = Record<string, any>;

function collectGtinsFromJsonLdNode(node: any, out: string[]) {
  if (!node || typeof node !== "object") return;

  // Direkta nycklar
  const directKeys = [
    "gtin",
    "gtin13",
    "gtin14",
    "gtin12",
    "gtin8",
    "ean",
    "ean13",
    "eanCode",
    "barcode",
    "upc",
    "globalTradeItemNumber",
  ];
  for (const k of directKeys) {
    const v = node[k];
    if (typeof v === "string" && DIGITS.test(v)) out.push(v);
  }

  // offers -> identifier/sku/mpn kan ibland innehålla GTIN
  const offers = node.offers;
  const offersArr = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const o of offersArr) {
    const ov = [o?.gtin13, o?.gtin, o?.ean, o?.barcode, o?.identifier, o?.sku, o?.mpn].filter(
      (x) => typeof x === "string"
    );
    out.push(...(ov as string[]));
  }

  // additionalProperty (Schema.org PropertyValue)
  // { "@type":"PropertyValue", "name":"EAN", "value":"123..." }
  const props = (node.additionalProperty || node.additionalProperties) as any;
  const propArr = Array.isArray(props) ? props : props ? [props] : [];
  for (const pv of propArr) {
    const name = String(pv?.name || pv?.propertyID || "").toLowerCase();
    const val = String(pv?.value || "").trim();
    if (val && /(ean|gtin|barcode|upc)/i.test(name)) out.push(val);
  }

  // identifier-fält i olika varianter
  const ident = node.identifier;
  const identArr = Array.isArray(ident) ? ident : ident ? [ident] : [];
  for (const id of identArr) {
    if (!id) continue;
    if (typeof id === "string") {
      if (/\d{8,14}/.test(id)) out.push(id);
    } else if (typeof id === "object") {
      const name = String(id?.propertyID || id?.name || "").toLowerCase();
      const val = String(id?.value || id?.identifier || "").trim();
      if (val && /(ean|gtin|barcode|upc)/i.test(name)) out.push(val);
    }
  }

  // isVariantOf/hasVariant kan bära GTIN
  const variantish = [node.isVariantOf, node.hasVariant, node.model, node.productModel];
  for (const v of variantish) {
    if (v) collectGtinsFromJsonLdNode(v, out);
    if (Array.isArray(v)) for (const el of v) collectGtinsFromJsonLdNode(el, out);
  }

  // @graph / @type arrays / barn
  if (Array.isArray((node as AnyObj)["@graph"])) {
    for (const el of (node as AnyObj)["@graph"]) collectGtinsFromJsonLdNode(el, out);
  }
  if (Array.isArray(node["@type"])) {
    for (const el of node["@type"]) if (el && typeof el === "object") collectGtinsFromJsonLdNode(el, out);
  }

  // generisk traversal
  for (const k of Object.keys(node)) {
    const v = (node as AnyObj)[k];
    if (v && typeof v === "object") collectGtinsFromJsonLdNode(v, out);
    if (Array.isArray(v)) for (const el of v) if (el && typeof el === "object") collectGtinsFromJsonLdNode(el, out);
  }
}

function extractGtinFromAllLd(html: string): string | null {
  const blocks = extractLdBlocks(html);
  const cands: string[] = [];
  for (const b of blocks) collectGtinsFromJsonLdNode(b, cands);
  return chooseBestGtin(cands);
}

/* ----------------------- lightweight HTML field scrape ---------------------- */
function extractLightFromHtml(html: string): Partial<Product> {
  const meta = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"))
      ?. [1] ||
    html.match(new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1];

  const name = meta("og:title") ?? null;
  const priceMeta = meta("product:price:amount") || meta("price");
  const price = parsePriceLike(priceMeta) ?? null;
  const currency = meta("product:price:currency") || "SEK";
  const imageUrl = abs((meta("og:image") || meta("twitter:image") || null));

  // Brand (heuristiskt)
  const brand =
    meta("og:brand") ||
    html.match(/itemprop=["']brand["'][^>]*>([^<]+)</i)?.[1] ||
    html.match(/class=["'][^"']*brand[^"']*["'][^>]*>([^<]+)</i)?.[1] ||
    null;

  // Lagerstatus grovt
  const stockTxt = html.match(/(i lager|finns i lager|slut i lager|out of stock)/i)?.[1] || null;
  const inStock =
    stockTxt ? (/(slut i lager|out of stock)/i.test(stockTxt) ? false : true) : undefined;

  return { name, price, currency, imageUrl, brand: brand?.trim() || null, inStock: inStock ?? null };
}

/* -------------------------------- adapter -------------------------------- */
export const adapter: SiteAdapter = {
  key: "inet",
  displayName: "Inet",
  baseHost: "www.inet.se",

  discovery: {
    sitemapUrl: ["https://www.inet.se/sitemap.xml"],
    productUrlRegex: /\/produkt\/\d+(?:\/|$)/i,
  },

  normalizeUrl: (raw) => {
    const u = new URL(raw);
    u.search = "";
    u.hash = "";
    if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  },

  pacing: {
    hostMaxNavRps: 2.2,
    ramp: [
      { t: 0, rps: 1.2 },
      { t: 120, rps: 1.8 },
      { t: 600, rps: 2.2 },
    ],
    pdpConcurrency: 5,
    pdpTimeoutMs: 25000,
    navWaitPdp: "domcontentloaded",
    gotoMinSpacingMs: 700,
    minDelayMs: 50,
    maxDelayMs: 150,
    fetchRetries: 2,
    fetchRetryBaseMs: 400,
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
        const btn = page.locator(s).first();
        if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
          await btn.click({ timeout: 1200 }).catch(() => {});
          break;
        }
      } catch {}
    }
  },

  /**
   * Snabb fastpath-justering: fyll EAN/GTIN via:
   *  1) JSON-LD (djuptraversering av alla block)
   *  2) __NEXT_DATA__
   *  3) Lätta meta/og-heuristiker
   */
  fastpathAdjust: (html, p) => {
    if (!p.currency) p.currency = "SEK";
    p.imageUrl = abs(p.imageUrl);

    // 1) JSON-LD – djupt
    if (!p.ean) {
      const fromLd = extractGtinFromAllLd(html);
      if (fromLd) p.ean = fromLd;
    }

    // 2) __NEXT_DATA__
    if (!p.ean) {
      const next = extractNextData(html);
      const pd = next?.props?.pageProps?.product ?? next?.props?.pageProps?.data?.product ?? null;
      if (pd && typeof pd === "object") {
        const pool: string[] = [];
        const keys = [
          "gtin13",
          "gtin14",
          "gtin12",
          "gtin8",
          "gtin",
          "ean",
          "ean13",
          "eanCode",
          "barcode",
          "globalTradeItemNumber",
          "upc",
        ];
        for (const k of keys) {
          const v = pd[k];
          if (typeof v === "string") pool.push(v);
          if (pd.identifiers && typeof pd.identifiers === "object") {
            const w = pd.identifiers[k];
            if (typeof w === "string") pool.push(w);
          }
        }
        const best = chooseBestGtin(pool);
        if (best) p.ean = best;

        // Komplettera övriga fält billigt
        if (!p.name) p.name = pd.name ?? pd.title ?? null;
        if (p.price == null) {
          const priceNum =
            typeof pd.price === "number"
              ? pd.price
              : pd?.pricing?.price ?? pd.currentPrice ?? null;
          p.price = typeof priceNum === "number" ? priceNum : parsePriceLike(priceNum);
        }
        if (!p.imageUrl) p.imageUrl = abs(pd?.images?.[0]?.url || pd?.image || null);
        if (!p.brand) p.brand = pd.brand?.name || pd.brand || null;
        if (p.inStock == null && typeof pd.inStock === "boolean") p.inStock = pd.inStock;
      }
    }

    // 3) Meta/OG fallback (snabb)
    if (!p.ean || !p.name || p.price == null || !p.imageUrl || !p.brand) {
      const lite = extractLightFromHtml(html);
      if (!p.ean) {
        // som sista chans: kombinera LD + NEXT + meta, välj bästa
        const combined = chooseBestGtin([
          p.ean || "",
          // försök hitta GTIN i meta direkt (ovan LD/NEXT kan misslyckas på äldre sidor)
          (html.match(/<meta[^>]+name=["']ean(?:13)?["'][^>]+content=["'](\d{8,14})["']/i)?.[1] ||
            html.match(/<meta[^>]+property=["']ean(?:13)?["'][^>]+content=["'](\d{8,14})["']/i)?.[1] ||
            "") as string,
        ].filter(Boolean) as string[]);
        if (combined) p.ean = combined;
      }
      if (!p.name) p.name = lite.name ?? null;
      if (p.price == null) p.price = lite.price ?? null;
      if (!p.currency) p.currency = lite.currency ?? "SEK";
      if (!p.imageUrl) p.imageUrl = lite.imageUrl ?? null;
      if (!p.brand) p.brand = lite.brand ?? null;
      if (p.inStock == null && typeof lite.inStock === "boolean") p.inStock = lite.inStock;
    }

    return p;
  },

  // Browser-fallback finns kvar (används bara om ALLOW_BROWSER_FALLBACK=true)
  customExtract: async function (_page: Page, url: string): Promise<Product> {
    const page = _page;

    await page.route("**/*", (route: Route) => {
      const req: Request = route.request();
      const t = req.resourceType();
      const u = req.url();
      if (["image", "media", "font", "stylesheet"].includes(t)) return route.abort();
      if (/gtm|googletagmanager|doubleclick|facebook|pixel|hotjar|sentry|optimizely|fullstory|clarity/i.test(u))
        return route.abort();
      return route.continue();
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
    try { await this.consent?.(page); } catch {}

    // JSON-LD (standardvägen)
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

      // Försök extra GTIN djupt från LD även i browser-fallback
      const gtinDeep = (() => { const c: string[] = []; collectGtinsFromJsonLdNode(json, c); return chooseBestGtin(c); })();

      const product: Product = {
        name: prod.name ?? null,
        price,
        originalPrice: null,
        currency: currency || "SEK",
        imageUrl: abs(Array.isArray(prod.image) ? prod.image[0] : prod.image ?? null),
        ean: gtinDeep || prod.gtin13 || prod.gtin14 || prod.gtin12 || prod.gtin8 || prod.gtin || null,
        url,
        brand,
        inStock: availability ? /instock/i.test(availability) : null,
      };
      if (product.name && product.price !== null) return product;
    }

    // Next-data
    const nextData = await page
      .evaluate(() => {
        const el = document.querySelector('#__NEXT_DATA__') as HTMLScriptElement | null;
        return el?.textContent || null;
      })
      .catch(() => null);
    if (nextData) {
      try {
        const j = JSON.parse(nextData);
        const pd = j?.props?.pageProps?.product || j?.props?.pageProps?.data?.product || null;
        if (pd) {
          const priceNum = typeof pd.price === "number" ? pd.price : (pd?.pricing?.price ?? pd.currentPrice ?? null);
          const pool: string[] = [];
          for (const k of ["gtin13","gtin14","gtin12","gtin8","gtin","ean","ean13","eanCode","barcode","globalTradeItemNumber","upc"]) {
            const v = pd[k];
            if (typeof v === "string") pool.push(v);
            if (pd.identifiers && typeof pd.identifiers === "object") {
              const w = pd.identifiers[k];
              if (typeof w === "string") pool.push(w);
            }
          }
          const ean = chooseBestGtin(pool);
          const p: Product = {
            name: pd.name ?? pd.title ?? null,
            price: typeof priceNum === "number" ? priceNum : (priceNum ? Number(String(priceNum)) : null),
            originalPrice: null,
            currency: pd.currency || "SEK",
            imageUrl: abs(pd?.images?.[0]?.url || pd?.image || null),
            ean,
            url,
            brand: pd.brand?.name || pd.brand || null,
            inStock: typeof pd.inStock === "boolean" ? pd.inStock : null,
          };
          if (p.name && p.price !== null) return p;
        }
      } catch {}
    }

    // Minimal meta/og fallback
    const html = await page.content();
    const lite = extractLightFromHtml(html);
    const p: Product = {
      name: lite.name ?? null,
      price: lite.price ?? null,
      originalPrice: null,
      currency: lite.currency ?? "SEK",
      imageUrl: abs(lite.imageUrl || null),
      ean: extractGtinFromAllLd(html) || null, // sista chans via LD djupsök
      url,
      brand: lite.brand ?? null,
      inStock: typeof lite.inStock === "boolean" ? lite.inStock : null,
    };
    if (p.name && p.price !== null) return p;

    throw new Error("Not a PDP");
  },
};

export default adapter;
