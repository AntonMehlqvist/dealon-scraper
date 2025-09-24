/**
 * Configuration-related types
 */

import type { Page } from "playwright";

/** Rampsteg för pacing */
export interface RampStep {
  t: number; // sekunder sedan start
  rps: number; // mål-RPS vid den tiden
}

/** Pacing/rate-limiting per sajt */
export interface PacingConfig {
  hostMaxNavRps?: number;
  ramp?: RampStep[];
  pdpConcurrency?: number;
  pdpTimeoutMs?: number;
  navWaitPdp?: "domcontentloaded" | "load" | "networkidle";
  gotoMinSpacingMs?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  fetchRetries?: number;
  fetchRetryBaseMs?: number;
  errorWindow?: number;
  errorRateWarn?: number;
  errorRateGood?: number;
  cooldownSeconds?: number;
}

/** Discovery (sitemap etc) */
export interface DiscoveryConfig {
  sitemapUrl?: string | string[]; // ← tillåt array
  productUrlRegex?: RegExp;
}

/** SiteAdapter – kontrakt för alla sajter */
export interface SiteAdapter {
  key: string;
  displayName: string;
  baseHost: string;

  discovery?: DiscoveryConfig;

  /** Normalisera URL (t.ex. ta bort query/hash/trailing slash) */
  normalizeUrl?: (raw: string) => string;

  pacing?: PacingConfig;

  /** Hantera cookie/consent innan extraktion */
  consent?: (page: Page) => Promise<void>;

  /** Fallback-selektorer när JSON-LD inte finns/är ofullständig */
  fallbackSelectors?: {
    title?: string[];
    price?: string[];
    original?: string[];
    brand?: string[];
    image?: string[];
  };

  /** Postprocess av fastpath-resultat (t.ex. sätt valuta) */
  fastpathAdjust?: (html: string, p: Product) => Product;

  /** Standardvärden per sajt */
  defaults?: { currency?: string };

  /**
   * (valfritt) Site-specifik PDP-extraktion.
   * Om den finns används den istället för standardrutinen i runnern.
   */
  customExtract?: (page: Page, url: string) => Promise<Product>;
}

// Re-export Product type for convenience
import type { Product } from "./product";
export type { Product };
