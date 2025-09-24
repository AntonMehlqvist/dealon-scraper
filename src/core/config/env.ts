/**
 * Environment variable utilities
 */

/**
 * Gets an environment variable as a string with a default value
 * @param k - Environment variable key
 * @param d - Default value if variable is not set
 * @returns Environment variable value or default
 */
export const envStr = (k: string, d: string): string =>
  (process.env[k] ?? d) as string;

/**
 * Gets an environment variable as an integer with a default value
 * @param k - Environment variable key
 * @param d - Default value if variable is not set or invalid
 * @returns Parsed integer value or default
 */
export const envInt = (k: string, d: number): number => {
  const v = process.env[k];
  if (!v) return d;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

/**
 * Gets an environment variable as a boolean with a default value
 * @param k - Environment variable key
 * @param d - Default value if variable is not set
 * @returns Boolean value (true for "1", "true", "yes", "on", false otherwise)
 */
export const envBool = (k: string, d: boolean): boolean =>
  /^(1|true|yes|on)$/i.test(process.env[k] ?? String(d));
