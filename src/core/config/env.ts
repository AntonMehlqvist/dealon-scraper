/**
 * Environment variable utilities
 */

export const envStr = (k: string, d: string): string =>
  (process.env[k] ?? d) as string;

export const envInt = (k: string, d: number): number => {
  const v = process.env[k];
  if (!v) return d;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

export const envBool = (k: string, d: boolean): boolean =>
  /^(1|true|yes|on)$/i.test(process.env[k] ?? String(d));
