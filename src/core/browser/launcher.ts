/**
 * Browser launching and configuration
 */

import { Browser, chromium } from "playwright";

/**
 * Launches a Chromium browser instance with optimized settings
 * @returns Promise resolving to the browser instance
 */
export async function launchBrowser(): Promise<Browser> {
  return await chromium.launch({
    headless: !/^false|0$/i.test(process.env.HEADLESS || "true"),
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
}
