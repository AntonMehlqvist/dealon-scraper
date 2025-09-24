/**
 * Date formatting utilities
 */

/** Format ISO med tidszon (Europe/Stockholm), ex: 2025-09-02T10:42:05+02:00 */
export function formatZonedISO(
  date: Date,
  timeZone = "Europe/Stockholm",
): string {
  const dtf = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value || "00";
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const hh = get("hour");
  const mm = get("minute");
  const ss = get("second");

  const utc = Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss);
  const asIfZoned = new Date(dtf.format(date));
  const localTs = isNaN(asIfZoned.getTime())
    ? date.getTime()
    : asIfZoned.getTime();
  const offsetMin = Math.round((localTs - utc) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const offH = String(Math.floor(abs / 60)).padStart(2, "0");
  const offM = String(abs % 60).padStart(2, "0");

  return `${y}-${m}-${d}T${hh}:${mm}:${ss}${sign}${offH}:${offM}`;
}

/**
 * Formats a duration in seconds to a human-readable string
 * @param sec - Duration in seconds
 * @returns Formatted duration string (e.g., "1h30m45s")
 */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return (h ? `${h}h` : "") + (h || m ? `${m}m` : "") + `${ss}s`;
}
