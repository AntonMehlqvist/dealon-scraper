/**
 * Ramp schedule parsing utilities
 */

import type { RampStep } from "../types/index";

export function parseRampSchedule(s: string): RampStep[] {
  const steps = s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [t, r] = p.split(":");
      return { t: Math.max(0, +t), rps: Math.max(0.1, +r) };
    })
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.rps))
    .sort((a, b) => a.t - b.t);
  return steps.length ? steps : [{ t: 0, rps: 1.0 }];
}
