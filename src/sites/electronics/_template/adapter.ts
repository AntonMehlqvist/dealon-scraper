import { SiteAdapter } from "../../../core/types/index";

export const adapter: SiteAdapter = {
  key: "_template",
  displayName: "Template",
  baseHost: "example.com",
  discovery: {
    sitemapUrl: "https://example.com/sitemap.xml",
    productUrlRegex: /\/product\//i,
  },
  pacing: {
    hostMaxNavRps: 1.6,
    ramp: [
      { t: 0, rps: 1.0 },
      { t: 900, rps: 1.3 },
      { t: 3600, rps: 1.6 },
    ],
    gotoMinSpacingMs: 9000,
    minDelayMs: 300,
    maxDelayMs: 800,
    pdpConcurrency: 1,
    pdpTimeoutMs: 30000,
    navWaitPdp: "domcontentloaded",
    fetchRetries: 6,
    fetchRetryBaseMs: 1000,
    errorWindow: 900,
    errorRateWarn: 0.04,
    errorRateGood: 0.015,
    cooldownSeconds: 150,
  },
  defaults: { currency: "SEK" },
  consent: async (page) => {
    // Cookie‑banner klick – fyll på med sajtens knappar
    const sels = [
      "#onetrust-accept-btn-handler",
      'button[aria-label*="Accept"]',
      'button:has-text("Acceptera alla")',
    ];
    for (const s of sels) {
      const el = page.locator(s).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click().catch(() => {});
        break;
      }
    }
  },
  normalizeUrl: (u) => {
    const url = new URL(u);
    url.hash = "";
    url.search = "";
    return url.toString();
  },
  fastpathAdjust: (html, prod) => prod, // valfritt
  fallbackSelectors: {
    title: ["h1", '[data-testid*="title" i]'],
    price: [".price", '[data-testid*="price" i]'],
    original: ["del", ".old-price", ".strike", ".compare-at"],
    brand: ['[itemprop="brand"]', ".brand"],
    image: [
      'meta[property="og:image"]@content',
      'img[data-testid*="image" i]@src',
    ],
  },
};
