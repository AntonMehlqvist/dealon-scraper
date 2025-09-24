/**
 * Browser optimization utilities
 */

import type { Page } from "playwright";

/**
 * Optimizes a page by blocking heavy resources (images, fonts, stylesheets)
 * to improve performance and reduce memory usage
 * @param page - Playwright page instance to optimize
 */
export async function optimizePage(page: Page): Promise<void> {
  // block heavy resources
  try {
    await page.route("**/*", (route) => {
      const t = route.request().resourceType();
      if (t === "image" || t === "font" || t === "stylesheet")
        return route.abort();
      route.continue();
    });
  } catch {}
}
