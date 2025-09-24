/**
 * URL manipulation utilities
 */

/**
 * Normalizes a URL by removing query parameters and hash fragments
 * @param raw - Raw URL string to normalize
 * @returns Normalized URL string
 */
export const normalizeUrlKey = (raw: string): string => {
  const u = new URL(raw);
  u.hash = "";
  u.search = "";
  return u.toString();
};

/**
 * Resolves a relative or absolute location URL against a base URL
 * @param baseUrl - Base URL to resolve against
 * @param loc - Location to resolve (can be relative or absolute)
 * @param _baseHost - Base host for validation (currently unused)
 * @returns Resolved absolute URL or null if invalid
 */
export function resolveLocation(
  baseUrl: string,
  loc: string,
  _baseHost: string,
): string | null {
  try {
    if (/^https?:/i.test(loc)) return new URL(loc).toString();
    if (loc.startsWith("//")) return new URL(`https:${loc}`).toString();
    if (loc.startsWith("/")) return new URL(loc, new URL(baseUrl)).toString();
    return new URL(loc, baseUrl).toString();
  } catch {
    return null;
  }
}
