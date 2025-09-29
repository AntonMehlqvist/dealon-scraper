import type { Page, Route, Request } from "playwright";
import type { SiteAdapter, Product } from "../../../core/types";

const ORIGIN = "https://www.apohem.se";
const absUrl = (u: string | null) => {
  if (!u) return null;
  if (u.startsWith("//")) return "https:" + u;
  if (u.startsWith("/")) return ORIGIN + u;
  return u;
};

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-encoding": "gzip, deflate, br",
        referer: "https://www.google.com/",
      },
    });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const td = new TextDecoder("utf-8", { fatal: false });
    return td.decode(buf);
  } catch {
    return null;
  }
}

// ---- snabba parsers (HTML -> fält) ----
function parsePrice(html: string): number | null {
  const metas =
    html.match(/<meta[^>]+(?:itemprop="price"|property="(?:product:price:amount|og:price:amount)")\s+content="([^"]+)"/gi) || [];
  for (const m of metas) {
    const v = /content="([^"]+)"/i.exec(m)?.[1] || "";
    const n = Number(v.replace(/[^\d.,]/g, "").replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  // fallback: första "<tal> kr"
  const m = /\b(\d[\d\s]*)(?:,(\d{2}))?\s*kr\b/i.exec(html.replace(/\u00a0/g, " "));
  if (m) {
    const whole = m[1].replace(/\s/g, "");
    const dec = m[2] ? "." + m[2] : "";
    const n = Number(whole + dec);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function parseEan(html: string): string | null {
  // primärt: data-product-id
  const m1 = /data-product-id="(\d{8,14})"/i.exec(html);
  if (m1) return m1[1];
  // snäv fallback nära produkt-block
  const m2 = /(?:EAN[^0-9]{0,10})?(\d{8,14})(?!\d)/i.exec(html);
  return m2 ? m2[1] : null;
}
function parseTitle(html: string): string | null {
  return /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i.exec(html)?.[1] ??
         /<h1[^>]*>([^<]+)<\/h1>/i.exec(html)?.[1] ?? null;
}
function parseImage(html: string): string | null {
  const og = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i.exec(html)?.[1] ?? null;
  return absUrl(og);
}
function parseBrand(html: string): string | null {
  // enkel heuristik: varumärken-länk
  return /<a[^>]+href="\/varumarken\/[^"]+"[^>]*>([^<]{2,100})<\/a>/i.exec(html)?.[1]?.trim() ?? null;
}
function parseInStock(html: string): boolean | null {
  const t = html.toLowerCase();
  if (/i lager|finns i webblager/.test(t)) return true;
  if (/ej i lager|slut i lager|tillfälligt slut/.test(t)) return false;
  return null;
}

export const adapter: SiteAdapter = {
  key: "apohem",
  displayName: "Apohem",
  baseHost: "www.apohem.se",

  discovery: {
    // kör batch-sitemaps direkt
    sitemapUrl: [
      "https://www.apohem.se/sitemap.xml?batch=0&language=sv-se",
      "https://www.apohem.se/sitemap.xml?batch=1&language=sv-se",
      "https://www.apohem.se/sitemap.xml?batch=2&language=sv-se",
    ] as any,
  },

  normalizeUrl: (raw) => {
    const u = new URL(raw);
    u.search = "";
    u.hash = "";
    if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  },

  // fartprofil (samma som innan)
  pacing: {
    hostMaxNavRps: 3.0,
    ramp: [
      { t: 0, rps: 2.0 },
      { t: 180, rps: 2.5 },
      { t: 900, rps: 3.0 },
    ],
    pdpConcurrency: 6,
    pdpTimeoutMs: 20000,
    navWaitPdp: "domcontentloaded",
    gotoMinSpacingMs: 1500,
    minDelayMs: 80,
    maxDelayMs: 200,
    fetchRetries: 5,
    fetchRetryBaseMs: 800,
    errorWindow: 900,
    errorRateWarn: 0.06,
    errorRateGood: 0.02,
    cooldownSeconds: 120,
  },

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
        if (await btn.isVisible({ timeout: 600 }).catch(() => false)) {
          await btn.click({ timeout: 1200 }).catch(() => {});
          break;
        }
      } catch {}
    }
  },

  fastpathAdjust: (_html, p) => {
    if (!p.currency) p.currency = "SEK";
    p.imageUrl = absUrl(p.imageUrl);
    return p;
  },

  defaults: { currency: "SEK" },

  customExtract: async (page: Page, url: string): Promise<Product> => {
    // 1) HTML fastpath (ingen Playwright-DOM om vi får allt här)
    const html = await fetchHtml(url);
    if (html) {
      const ean = parseEan(html);
      const price = parsePrice(html);
      const name = parseTitle(html);
      const imageUrl = parseImage(html);
      const brand = parseBrand(html);
      const inStock = parseInStock(html);
      if (ean && price !== null) {
        return {
          name: name ?? null,
          price,
          originalPrice: null,
          currency: "SEK",
          imageUrl,
          ean,
          url,
          brand,
          inStock,
        };
      }
    }

    // 2) Fallback: lätt Playwright + page.content() (fortfarande ingen innerText)
    await page.route("**/*", (route: Route) => {
      const req: Request = route.request();
      const type = req.resourceType();
      const u = req.url();
      if (["image", "media", "font", "stylesheet"].includes(type)) return route.abort();
      if (/analytics|gtm|googletagmanager|doubleclick|hotjar|segment|optimizely|facebook|pixel|sentry|fullstory/i.test(u))
        return route.abort();
      return route.continue();
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    const html2 = (await page.content().catch(() => "")) || html || "";

    const ean = parseEan(html2);
    const price = parsePrice(html2);
    const name = parseTitle(html2);
    const imageUrl = parseImage(html2);
    const brand = parseBrand(html2);
    const inStock = parseInStock(html2);

    return {
      name: name ?? null,
      price,
      originalPrice: null,
      currency: "SEK",
      imageUrl,
      ean,
      url,
      brand,
      inStock,
    };
  },
};

export default adapter;
