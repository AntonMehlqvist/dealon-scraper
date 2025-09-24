/**
 * Browser launching and configuration
 */

import { Browser, chromium } from "playwright";

export async function launchBrowser(): Promise<Browser> {
  return await chromium.launch({
    headless: !/^false|0$/i.test(process.env.HEADLESS || "true"),
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
}
