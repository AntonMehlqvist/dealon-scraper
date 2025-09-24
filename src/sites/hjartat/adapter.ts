import type { Page } from "playwright";
import type { SiteAdapter, Product } from "../../core/types";

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

// ---- parsers ----
function parsePrice(html: string): number | null {
  // meta price först
  const mMeta = /<meta[^>]+property="product:price:amount"[^>]+content="([^"]+)"/i.exec(html);
  if (mMeta) {
    const n = Number(mMeta[1].replace(/[^\d.,]/g, "").replace(",", "."));
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
  const m1 = /EAN[^0-9]{0,10}(\d{8,14})/i.exec(html);
  if (m1) return m1[1];
  const m2 = /(?:^|[^\d])(\d{8,14})(?!\d)/i.exec(html);
  return m2 ? m2[1] : null;
}
function parseTitle(html: string): string | null {
  return /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i.exec(html)?.[1] ??
         /<h1[^>]*>([^<]+)<\/h1>/i.exec(html)?.[1] ?? null;
}
function parseImage(html: string): string | null {
  return /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i.exec(html)?.[1] ?? null;
}
function parseBrand(html: string): string | null {
  // "Mer från <Brand>" eller breadcrumb/up-länk
  const m1 = /Mer från\s*([^<]{2,100})<\/a>/i.exec(html)?.[1];
  if (m1) return m1.trim();
  const m2 = /<nav[^>]*>\s*<a[^>]+rel="up"[^>]*>([^<]+)<\/a>/i.exec(html)?.[1];
  return m2 ? m2.trim() : null;
}
function parseInStock(html: string): boolean | null {
  const t = html.toLowerCase();
  if (/webblager|i lager|finns i webblager/.test(t)) return true;
  if (/slut|tillfälligt slut|ej i lager/.test(t)) return false;
  return null;
}

export const adapter: SiteAdapter = {
  key: "hjartat",
  displayName: "Apotek Hjärtat",
  baseHost: "www.apotekhjartat.se",

  discovery: {
    sitemapUrl: "https://www.apotekhjartat.se/api/sitemap/sitemapindex.xml",
    productUrlRegex:
      /^https?:\/\/(?:www\.)?apotekhjartat\.se\/varumarken\/[^/]+\/(?!kategori|kampanj|varumarken|barn-och-foralder|harvard|hudvard|munvard|kosttillskott|vard)[^?#]+$/i,
  },

  normalizeUrl: (raw) => {
    const u = new URL(raw);
    u.search = "";
    u.hash = "";
    if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  },

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
    errorRateWarn: 0.05,
    errorRateGood: 0.02,
    cooldownSeconds: 120,
  },

  fastpathAdjust: (_html, p) => {
    if (!p.currency) p.currency = "SEK";
    return p;
  },

  defaults: { currency: "SEK" },

  customExtract: async (page: Page, url: string): Promise<Product> => {
    // 1) HTML fastpath
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

    // 2) Fallback: Playwright men bara page.content() (ingen innerText)
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
