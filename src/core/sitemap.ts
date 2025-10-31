// src/core/sitemap.ts
import { SitemapEntry } from "./types/index";

/**
 * Hämta och parsa en sitemap eller sitemap-index.
 * Returnerar alla entries { loc, lastmod } och kan filtrera med RegExp.
 */
export async function fetchSitemapEntries(
  sitemapUrl: string,
  filter?: RegExp
): Promise<SitemapEntry[]> {
  const seen = new Set<string>();
  const out: SitemapEntry[] = [];

  async function fetchXml(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) {
        console.warn(`[warn] sitemap fetch fail ${url}: ${res.status}`);
        return null;
      }
      return await res.text();
    } catch (err: any) {
      console.warn(`[warn] sitemap fetch error ${url}: ${err?.message || err}`);
      return null;
    }
  }

  async function parseSitemap(url: string) {
    const xml = await fetchXml(url);
    if (!xml) return;

    // Index?
    if (/sitemapindex/i.test(xml)) {
      const re = /<loc>([^<]+)<\/loc>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml))) {
        const childUrl = m[1].trim();
        if (!seen.has(childUrl)) {
          seen.add(childUrl);
          await parseSitemap(childUrl);
        }
      }
      return;
    }

    // urlset
    const urlRe =
      /<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/gi;
    let m: RegExpExecArray | null;
    while ((m = urlRe.exec(xml))) {
      const loc = m[1].trim();
      const lastmod = m[2]?.trim();
      if (filter && !filter.test(loc)) continue;
      if (!seen.has(loc)) {
        seen.add(loc);
        out.push({ loc, lastmod });
      }
    }
  }

  await parseSitemap(sitemapUrl);
  return out;
}
