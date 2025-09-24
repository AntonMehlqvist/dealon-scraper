/**
 * URL manipulation utilities
 */

export const normalizeUrlKey = (raw: string): string => {
  const u = new URL(raw);
  u.hash = "";
  u.search = "";
  return u.toString();
};

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
