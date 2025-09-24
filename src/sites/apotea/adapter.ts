// src/sites/apotea/adapter.ts
import type { SiteAdapter } from "../../core/types";

/**
 * Apotea.se – sitemap-driven adapter
 * - Discovery: sitemap
 * - Produkt-URL heuristik: minst en siffra i path (ml, g, pack etc)
 * - Tillåter både apotea.se och www.apotea.se + trailing slash + djupare paths
 * - FASTPATH: JSON-LD Product (+ Nosto/heuristik i core)
 * - FALLBACK: selektorer (titel, pris, originalpris, brand, bild)
 */
export const adapter: SiteAdapter = {
  key: "apotea",
  displayName: "Apotea",
  baseHost: "www.apotea.se",

  discovery: {
    sitemapUrl: "https://www.apotea.se/Sitemap/SMPViewAACC",
    /**
     * Tillåt host med/utan www och godkänn valfritt path-djup.
     * Kräv minst en siffra i pathen (för att filtrera bort listor/kategorier).
     * Undanta uppenbara listor.
     */
    productUrlRegex: /^https?:\/\/(?:www\.)?apotea\.se\/(?!kategori\/|varumarken\/|kampanj\/|brand\/|search\/)[^?#]*\d[^?#]*\/?$/i,
  },

  // Normalisera URL: ta bort query/hash + trailing slash
  normalizeUrl: (raw) => {
    const u = new URL(raw);
    u.search = "";
    u.hash = "";
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.toString();
  },

  // Pacing (lite snabbare – skruva upp/ner efter behov)
  pacing: {
    hostMaxNavRps: 2.4,
    ramp: [
      { t: 0, rps: 1.4 },
      { t: 180, rps: 1.9 },
      { t: 900, rps: 2.4 },
    ],
    pdpConcurrency: 2,
    pdpTimeoutMs: 25_000,
    navWaitPdp: "domcontentloaded",
    gotoMinSpacingMs: 5000,
    minDelayMs: 150,
    maxDelayMs: 400,
    fetchRetries: 6,
    fetchRetryBaseMs: 900,
    errorWindow: 900,
    errorRateWarn: 0.05,
    errorRateGood: 0.02,
    cooldownSeconds: 120,
  },

  // Fallback-selectors (DOM) när FASTPATH saknas
  fallbackSelectors: {
    title: ["h1", '[data-testid*="title" i]', 'meta[property="og:title"]@content'],
    price: [
      '[data-testid*="price" i]',
      ".price",
      "[class*='price']",
      'meta[itemprop="price"]@content',
    ],
    original: ["del", "[class*='strike' i]", "[class*='old' i]", "[class*='was' i]", "[class*='compare' i]"],
    brand: ['[itemprop="brand"]', ".brand"],
    image: ['meta[property="og:image"]@content', 'img[alt][src]@src'],
  },

  fastpathAdjust: (_html, p) => {
    if (!p.currency) p.currency = "SEK";
    return p;
  },

  consent: async (page) => {
    const candidates = [
      'button:has-text("Acceptera")',
      'button:has-text("Godkänn")',
      '[data-testid*="accept" i]',
      'button[aria-label*="accept" i]',
    ];
    for (const sel of candidates) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 1500 }).catch(() => {});
        break;
      }
    }
  },

  defaults: { currency: "SEK" },
};

export default adapter;
