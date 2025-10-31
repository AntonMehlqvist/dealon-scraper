// src/sites/power/adapter.ts
import type { Page, Request, Route } from "playwright";
import type { Product, SiteAdapter } from "../../../core/types/index";

const ORIGIN = "https://www.power.se";
const abs = (u: string | null) =>
  !u
    ? null
    : u.startsWith("//")
    ? "https:" + u
    : u.startsWith("/")
    ? ORIGIN + u
    : u;

function parsePriceLike(input?: string | number | null): number | null {
  if (input == null) return null;
  const s = String(input)
    .replace(/\u00a0/g, " ")
    .replace(/[A-Za-zkrKR]/g, "")
    .replace(/[^\d.,-]/g, "")
    .trim();
  if (!s) return null;
  let t = s;
  if (t.includes(",") && t.includes("."))
    t = t.replace(/\./g, "").replace(",", ".");
  else if (t.includes(",")) t = t.replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function tryPickProductLD(node: any): any | null {
  const hasType = (t: any, re: RegExp) =>
    (typeof t === "string" && re.test(t)) ||
    (Array.isArray(t) && t.some((x) => typeof x === "string" && re.test(x)));
  const pick = (n: any): any => {
    if (!n) return null;
    if (hasType(n?.["@type"], /^(Product|ProductModel|ProductGroup)$/i))
      return n;
    if (hasType(n?.["@type"], /^WebPage$/i) && n?.mainEntity)
      return pick(n.mainEntity);
    if (n?.["@graph"]) return pick(n["@graph"]);
    if (Array.isArray(n))
      for (const el of n) {
        const p = pick(el);
        if (p) return p;
      }
    return null;
  };
  return pick(node);
}

function parseOffers(offers: any) {
  let priceRaw: any = null,
    curr: string | null = null,
    avail: string | null = null;
  const norm = (v: any) => parsePriceLike(v);
  if (!offers) return { price: null, currency: null, availability: null };
  const many = Array.isArray(offers) ? offers : [offers];
  for (const o of many) {
    if (priceRaw == null)
      priceRaw = o?.price ?? o?.lowPrice ?? o?.highPrice ?? null;
    if (!curr && typeof o?.priceCurrency === "string") curr = o.priceCurrency;
    if (!avail && typeof o?.availability === "string") avail = o.availability;
  }
  return { price: norm(priceRaw), currency: curr, availability: avail };
}

async function clickConsent(page: Page) {
  const sels = [
    'button:has-text("Acceptera")',
    'button:has-text("Acceptera alla")',
    'button:has-text("Godkänn")',
    '[aria-label*="acceptera" i]',
    '[data-testid*="accept" i]',
  ];
  for (const s of sels) {
    try {
      const btn = page.locator(s).first();
      if (await btn.isVisible({ timeout: 1200 }).catch(() => false)) {
        await btn.click({ timeout: 1500 }).catch(() => {});
        break;
      }
    } catch {}
  }
}

export const adapter: SiteAdapter = {
  key: "power",
  displayName: "POWER",
  baseHost: "www.power.se",

  // Viktigt: filtrera så vi bara tar SLUGGADE PDP:er (uteslut root /p-1234567)
  discovery: {
    // Endast URL:er som har kategoridel(ar) före "/p-<id>"
    // Exempel OK:   https://www.power.se/koksapparater/.../sodastream-terra.../p-1337462
    // Exempel NEJ:  https://www.power.se/p-1337462
    productUrlRegex:
      /^https?:\/\/www\.power\.se\/(?:[^\/]+\/)+p-\d+(?:[/?#]|$)/i,
  },

  normalizeUrl: (raw) => {
    const u = new URL(raw, ORIGIN);
    u.search = "";
    u.hash = "";
    if (u.pathname !== "/" && u.pathname.endsWith("/"))
      u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  },

  pacing: {
    pdpConcurrency: 8,
    pdpTimeoutMs: 25_000,
    navWaitPdp: "domcontentloaded",
    gotoMinSpacingMs: 300,
    minDelayMs: 30,
    maxDelayMs: 120,
  },

  defaults: { currency: "SEK" },

  consent: async (page: Page) => {
    await clickConsent(page);
  },

  fastpathAdjust: (_html, p) => {
    if (!p.currency) p.currency = "SEK";
    p.imageUrl = abs(p.imageUrl);
    return p;
  },

  customExtract: async function (_page: Page, url: string): Promise<Product> {
    const page = _page;

    // Blockera tunga/oväsentliga resurser
    await page.route("**/*", (route: Route) => {
      const r: Request = route.request();
      const t = r.resourceType();
      const u = r.url();
      if (["image", "media", "font", "stylesheet"].includes(t))
        return route.abort();
      if (
        /gtm|googletagmanager|doubleclick|facebook|pixel|hotjar|sentry|optimizely|fullstory|clarity|newrelic/i.test(
          u,
        )
      )
        return route.abort();
      return route.continue();
    });

    await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 })
      .catch(() => {});
    await this.consent?.(page);

    // ---- JSON-LD fast path ----
    const ldNodes = await page
      .locator('script[type="application/ld+json"]')
      .all();
    for (const s of ldNodes) {
      const txt = await s.innerText().catch(() => "");
      if (!txt) continue;
      let json: any;
      try {
        json = JSON.parse(txt);
      } catch {
        continue;
      }
      const prod = tryPickProductLD(json);
      if (!prod) continue;

      const { price, currency, availability } = parseOffers(prod.offers);
      const brand =
        (typeof prod.brand === "string" ? prod.brand : prod.brand?.name) ??
        null;
      const eanFromLd =
        prod.gtin13 ||
        prod.gtin14 ||
        prod.gtin12 ||
        prod.gtin8 ||
        prod.gtin ||
        null;

      const pLd: Product = {
        name: prod.name ?? null,
        price,
        originalPrice: null,
        currency: currency || "SEK",
        imageUrl: abs(
          Array.isArray(prod.image) ? prod.image[0] : prod.image ?? null,
        ),
        ean: eanFromLd ?? null,
        url,
        brand,
        inStock: availability ? /instock/i.test(availability) : null,
      };
      if (pLd.name && pLd.price !== null) return pLd;
    }

    // ---- DOM fallback (titel/og/meta/price/spec) ----
    const getText = async (sels: string[]) => {
      for (const s of sels) {
        try {
          const txt = await page
            .locator(s)
            .first()
            .innerText({ timeout: 1200 });
          if (txt?.trim()) return txt.trim();
        } catch {}
      }
      return null;
    };
    const getAttr = async (sels: string[]) => {
      for (const s of sels) {
        const [css, attr] = s.split("@");
        try {
          const v = await page
            .locator(css)
            .first()
            .getAttribute(attr || "content", { timeout: 1200 });
          if (v?.trim()) return v.trim();
        } catch {}
      }
      return null;
    };

    const title = await getText([
      "h1",
      "h1 span",
      "h1 .ng-star-inserted",
      "meta[property='og:title']@content",
    ]);
    const priceStr =
      (await getAttr([
        "meta[itemprop='price']@content",
        "meta[property='product:price:amount']@content",
      ])) ??
      (await getText([
        "[itemprop='price']",
        "[data-testid='price']",
        "[class*='price' i]",
      ]));
    const brand =
      (await getText(["[itemprop='brand']", ".brand a", ".brand"])) ??
      (await getAttr(["meta[name='og:brand']@content"]));
    const image = await getAttr([
      "meta[property='og:image']@content",
      "meta[name='twitter:image']@content",
      "img[alt][src]@src",
    ]);

    // EAN via specifikation / sida
    let ean: string | null = null;
    const tryBlock = async (locatorCss: string) => {
      const html = await page
        .locator(locatorCss)
        .first()
        .innerHTML()
        .catch(() => null);
      if (!html) return;
      const m =
        html.match(/\b(?:EAN|GTIN)\s*[:：]?\s*([0-9]{8,14})\b/i) ||
        html.match(/([0-9]{8,14})\s*(?:\(?(?:EAN|GTIN)\)?)/i);
      if (m?.[1]) ean = m[1];
    };
    await tryBlock("table");
    if (!ean) await tryBlock("dl");
    if (!ean) {
      const full = await page.content();
      const near =
        full.match(/(?:EAN|GTIN)[^0-9]{0,12}([0-9]{8,14})/i)?.[1] ?? null;
      if (near) ean = near;
    }

    const price = parsePriceLike(priceStr);
    const pDom: Product = {
      name: title || null,
      price,
      originalPrice: null,
      currency: "SEK",
      imageUrl: abs(image || null),
      ean,
      url,
      brand: brand || null,
      inStock: null,
    };

    if (!pDom.name || pDom.price == null) {
      throw new Error("Not a PDP or missing critical fields");
    }
    return pDom;
  },
};

export default adapter;
