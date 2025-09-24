/**
 * Pacing configuration utilities
 */

import type { PacingConfig, RampStep } from "../types";

/** Säkra defaults så vi aldrig triggar TS18048 eller 2345 */
const DEFAULTS = {
  hostMaxNavRps: 1.0,
  ramp: [] as RampStep[],
  pdpConcurrency: 1,
  pdpTimeoutMs: 30_000,
  navWaitPdp: "domcontentloaded" as const,
  gotoMinSpacingMs: 0,
  minDelayMs: 0,
  maxDelayMs: 0,
  fetchRetries: 3,
  fetchRetryBaseMs: 800,
  errorWindow: 600, // sek
  errorRateWarn: 0.05, // 5%
  errorRateGood: 0.02, // 2%
  cooldownSeconds: 120, // sek
};

export function withDefaults(cfg?: PacingConfig): Required<PacingConfig> {
  const c = cfg ?? {};
  return {
    hostMaxNavRps: c.hostMaxNavRps ?? DEFAULTS.hostMaxNavRps,
    ramp: c.ramp ?? DEFAULTS.ramp,
    pdpConcurrency: c.pdpConcurrency ?? DEFAULTS.pdpConcurrency,
    pdpTimeoutMs: c.pdpTimeoutMs ?? DEFAULTS.pdpTimeoutMs,
    navWaitPdp: c.navWaitPdp ?? DEFAULTS.navWaitPdp,
    gotoMinSpacingMs: c.gotoMinSpacingMs ?? DEFAULTS.gotoMinSpacingMs,
    minDelayMs: c.minDelayMs ?? DEFAULTS.minDelayMs,
    maxDelayMs: c.maxDelayMs ?? DEFAULTS.maxDelayMs,
    fetchRetries: c.fetchRetries ?? DEFAULTS.fetchRetries,
    fetchRetryBaseMs: c.fetchRetryBaseMs ?? DEFAULTS.fetchRetryBaseMs,
    errorWindow: c.errorWindow ?? DEFAULTS.errorWindow,
    errorRateWarn: c.errorRateWarn ?? DEFAULTS.errorRateWarn,
    errorRateGood: c.errorRateGood ?? DEFAULTS.errorRateGood,
    cooldownSeconds: c.cooldownSeconds ?? DEFAULTS.cooldownSeconds,
  };
}

/** Beräkna mål-RPS utifrån ramp, clamp:ad mot hostMaxNavRps */
export function targetRps(
  cfg: PacingConfig | undefined,
  sinceStartSec: number,
): number {
  const c = withDefaults(cfg);
  const ramp = c.ramp;
  if (!ramp || ramp.length === 0) return c.hostMaxNavRps;

  let r = ramp[0]?.rps ?? c.hostMaxNavRps;
  for (const step of ramp) {
    if (sinceStartSec >= (step?.t ?? 0)) r = step?.rps ?? r;
    else break;
  }
  return Math.min(r, c.hostMaxNavRps);
}

/** Minsta spacing mellan goto:navigationer (ms) */
export function gotoMinSpacingMs(cfg?: PacingConfig): number {
  return withDefaults(cfg).gotoMinSpacingMs;
}

/** Slumpmässig liten jitter-delay mellan steg (ms) */
export function jitterDelayMs(cfg?: PacingConfig): number {
  const c = withDefaults(cfg);
  const min = c.minDelayMs;
  const max = Math.max(c.maxDelayMs, min);
  if (max <= 0) return 0;
  if (max === min) return min;
  return Math.floor(min + Math.random() * (max - min + 1));
}

/** Felhanteringsparametrar som säkra tal */
export function errorBudget(cfg?: PacingConfig) {
  const c = withDefaults(cfg);
  return {
    windowSec: c.errorWindow,
    warn: c.errorRateWarn,
    good: c.errorRateGood,
    cooldownSec: c.cooldownSeconds,
  };
}

/** Fetch-retry parametrar (heltal) */
export function retryParams(cfg?: PacingConfig) {
  const c = withDefaults(cfg);
  return {
    retries: Math.max(0, c.fetchRetries | 0),
    baseMs: Math.max(0, c.fetchRetryBaseMs | 0),
  };
}

/** PDP-parametrar */
export function pdpParams(cfg?: PacingConfig) {
  const c = withDefaults(cfg);
  return {
    concurrency: Math.max(1, c.pdpConcurrency | 0),
    timeoutMs: Math.max(1, c.pdpTimeoutMs | 0),
    waitUntil: c.navWaitPdp,
  } as const;
}

/** Hjälpare för enkel pacing-loop (frivillig att använda) */
export function nextNavigationDelayMs(
  cfg: PacingConfig | undefined,
  sinceStartSec: number,
): number {
  const rps = targetRps(cfg, sinceStartSec);
  const base = rps > 0 ? 1000 / rps : 1000; // ms per request
  const spacing = gotoMinSpacingMs(cfg);
  const jitter = jitterDelayMs(cfg);
  return Math.max(base, spacing) + jitter;
}
