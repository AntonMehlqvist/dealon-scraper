// src/sites/kronans/adapter.ts
import type { Page, Route, Request, Response } from "playwright";
import type { SiteAdapter, Product } from "../../../core/types/index";

const ORIGIN = "https://www.kronansapotek.se";
const abs = (u: string | null) =>
  !u ? null : u.startsWith("//") ? "https:" + u : u.startsWith("/") ? ORIGIN + u : u;

function pickFirst<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v.length ? (v[0] as T) : null) : (v as T);
}

const gtinKeys = ["gtin", "gtin8", "gtin12", "gtin13", "gtin14", "ean", "ean13", "barcode"];

/** Djup sök efter GTIN/EAN i ett JSON-objekt */
function deepFindGtin(node: any): string | null {
  try {
    const seen = new Set<any>();
    const stack = [node];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
      seen.add(cur);

      // propertyValue-format (additionalProperty)
      if (Array.isArray(cur)) {
        for (const el of cur) stack.push(el);
      } else {
        for (const k of Object.keys(cur)) {
          const v = (cur as any)[k];
          if (v && typeof v === "object") stack.push(v);

          const key = k.toLowerCase();
          if (gtinKeys.includes(key) && v != null) {
            const s = String(v);
            const m = s.match(/(^|[^\d])(\d{8}|\d{12,14})(?!\d)/);
            if (m) return m[2];
          }

          // propertyValue nodes: {name: "EAN"/"GTIN", value: "xxxxx"}
          if (
            (key === "name" || key === "propertyid") &&
            typeof v === "string" &&
            /(ean|gtin)/i.test(v) &&
            typeof (cur as any).value !== "undefined"
          ) {
            const s = String((cur as any).value);
            const m = s.match(/(^|[^\d])(\d{8}|\d{12,14})(?!\d)/);
            if (m) return m[2];
          }
        }
      }
    }
  } catch {}
  return null;
}

/** Hämta GTIN från fri text (HTML/JSON-strängar) nära EAN/GTIN-stämning */
function extractGtinFromText(txt: string): string | null {
  if (!txt) return null;
  // Försök först hitta label + siffror
  const labelRe = /(ean|gtin|streckkod|barcode)\D{0,40}(\d{8}|\d{12,14})/i;
  const m1 = labelRe.exec(txt);
  if (m1) return m1[2];

  // Annars, plocka första GTIN-lik sekvens (kan ge falsk positiv → används sist)
  const m2 = /(^|[^\d])(\d{8}|\d{12,14})(?!\d)/.exec(txt);
  return m2 ? m2[2] : null;
}

/** Robust JSON.parse som tål skräp */
function tryParseJSON(t: string): any | null {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export const adapter: SiteAdapter = {
  key: "kronans",
  displayName: "Kronans Apotek",
  baseHost: "www.kronansapotek.se",

  discovery: {
    // Vi litar mest på robots.txt + runnern, men filtrerar produktlänkar:
    productUrlRegex: /\/p\/\d+\/?/i,
  },

  // Rimlig pacing – Kronans brukar vara snabb och stabil
  pacing: {
    pdpConcurrency: 1,
    pdpTimeoutMs: 30000,
    navWaitPdp: "domcontentloaded",
    minDelayMs: 100,
    maxDelayMs: 300,
  },

  defaults: { currency: "SEK" },

  consent: async (page: Page) => {
    const btns = [
      'button:has-text("Acceptera")',
      'button:has-text("Acceptera alla")',
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

  customExtract: async (page: Page, url: string): Promise<Product> => {
    // Blockera tunga resurser och spårning för fart/stabilitet
    await page.route("**/*", (route: Route) => {
      const req: Request = route.request();
      const type = req.resourceType();
      const u = req.url();
      if (["image", "media", "font", "stylesheet"].includes(type)) return route.abort();
      if (
        /analytics|gtm|googletagmanager|doubleclick|hotjar|segment|optimizely|facebook|pixel|sentry|fullstory/i.test(
          u
        )
      )
        return route.abort();
      if (/\.(mp4|webm|avi|mov)(\?|$)/i.test(u)) return route.abort();
      return route.continue();
    });

    // Sniffa nätverk för EAN i JSON/XHR/GraphQL
    let netGtin: string | null = null;
    const sniff = async (resp: Response) => {
      try {
        const ct = resp.headers()["content-type"] || "";
        if (!/json|ld\+json|javascript/i.test(ct)) return;

        // Försök .json(), annars .text() → parse
        let data: any = null;
        try {
          data = await resp.json();
        } catch {
          const t = await resp.text();
          data = tryParseJSON(t) ?? t;
        }

        if (typeof data === "string") {
          netGtin = netGtin || extractGtinFromText(data);
          return;
        }
        if (data && typeof data === "object") {
          const found = deepFindGtin(data);
          if (found) netGtin = netGtin || found;
        }
      } catch {}
    };
    page.on("response", sniff);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});

    // Consent
    try {
      await adapter.consent?.(page);
    } catch {}

    // --- JSON-LD (robust) ---
    try {
      const scripts = await page.locator('script[type="application/ld+json"]').all();
      for (const s of scripts) {
        const raw = await s.innerText().catch(() => "");
        if (!raw) continue;

        const json = tryParseJSON(raw);
        if (!json) continue;

        // Plocka ut ett "product-likt" objekt ur @graph/WebPage/mainEntity/array
        const pickProductLike = (node: any): any => {
          const hasType = (t: any, re: RegExp) =>
            (typeof t === "string" && re.test(t)) ||
            (Array.isArray(t) && t.some((x) => typeof x === "string" && re.test(x)));
          if (!node) return null;
          if (hasType(node?.["@type"], /^(Product|ProductModel|ProductGroup)$/i)) return node;
          if (hasType(node?.["@type"], /^WebPage$/i) && node?.mainEntity) return pickProductLike(node.mainEntity);
          if (node?.["@graph"]) return pickProductLike(node["@graph"]);
          if (Array.isArray(node)) {
            for (const el of node) {
              const p = pickProductLike(el);
              if (p) return p;
            }
          }
          return null;
        };

        const prod = pickProductLike(json);
        if (prod) {
          // Offers → pris, valuta, lager
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
                if (priceRaw == null) priceRaw = o?.price ?? o?.lowPrice ?? o?.highPrice ?? null;
                if (curr == null && typeof o?.priceCurrency === "string") curr = o.priceCurrency;
                if (avail == null && typeof o?.availability === "string") avail = o.availability;
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
            avail = typeof offers?.availability === "string" ? offers.availability : null;
            return { price: norm(priceRaw), currency: curr, availability: avail };
          };

          const { price, currency, availability } = parseOffers(prod.offers);
          // GTIN/EAN – direkt fält, additionalProperty, eller från nätverkssniff
          let ean: string | null =
            prod.gtin13 || prod.gtin14 || prod.gtin12 || prod.gtin8 || prod.gtin || prod.ean || null;
          if (!ean && prod.additionalProperty) ean = deepFindGtin(prod.additionalProperty);
          if (!ean) ean = netGtin;

          const brandName =
            (typeof prod.brand === "string" ? prod.brand : prod.brand?.name) ??
            (typeof prod.manufacturer === "string" ? prod.manufacturer : prod.manufacturer?.name) ??
            null;

          const p: Product = {
            name: prod.name ?? null,
            price,
            originalPrice: null,
            currency: currency || "SEK",
            imageUrl: abs(pickFirst<string>(prod.image) ?? prod.image ?? null),
            ean,
            url,
            brand: brandName,
            inStock: availability ? /instock/i.test(availability) : null,
          };
          if (p.name && p.price !== null) return p;
        }
      }
    } catch {}

    // --- Script-JSON fallback (t.ex. inlined state) ---
    try {
      const scripts = await page.locator('script[type="application/json"]').all();
      for (const s of scripts) {
        const raw = await s.innerText().catch(() => "");
        if (!raw) continue;
        const data = tryParseJSON(raw);
        if (!data) continue;
        const found = deepFindGtin(data) || extractGtinFromText(raw);
        if (found) netGtin = netGtin || found;
      }
    } catch {}

    // --- Snabb DOM-fallback ---
    const getAttr = async (sel: string) =>
      page.locator(sel).first().getAttribute("content").catch(() => null);
    const getText = async (sel: string) =>
      page.locator(sel).first().innerText().then((t) => t?.trim() ?? null).catch(() => null);

    const title = (await getText("h1")) ?? (await getAttr('meta[property="og:title"]'));
    // Pris via meta eller text
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

    // Lagerstatus (heuristik)
    const stockTxt =
      (await page.locator('#stock-status, [class*="stock" i]').first().innerText().catch(() => "")) ||
      "";
    let inStock: boolean | null = null;
    if (/i lager|webblager|finns i lager/i.test(stockTxt)) inStock = true;
    else if (/slut|tillfälligt slut|ej i lager/i.test(stockTxt)) inStock = false;

    // Varumärke – försök via länk/label om det finns
    const brand =
      (await page.locator("a[href*='/varumarken/']").first().innerText().catch(() => null)) ?? null;

    // EAN/GTIN från HTML om allt annat fallerat
    let ean: string | null = netGtin;
    if (!ean) {
      try {
        const html = await page.content();
        ean = extractGtinFromText(html);
      } catch {}
    }

    if (!title && price === null) throw new Error("Not a PDP");

    return {
      name: title ?? null,
      price,
      originalPrice: null,
      currency: "SEK",
      imageUrl,
      ean: ean ?? null,
      url,
      brand,
      inStock,
    };
  },

  fastpathAdjust: (_html, prod) => {
    if (!prod.currency) prod.currency = "SEK";
    prod.imageUrl = abs(prod.imageUrl);
    return prod;
  },

  // Minimal fallbackprofil om customExtract skulle skip:as
  fallbackSelectors: {
    title: ["h1", 'meta[property="og:title"]@content'],
    price: ['meta[itemprop="price"]@content', "[class*='price' i]"],
    brand: ['[itemprop="brand"]', ".brand"],
    image: ['meta[property="og:image"]@content', "img[alt][src]@src"],
  },
};

export default adapter;
