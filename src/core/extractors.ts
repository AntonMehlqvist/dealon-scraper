// src/core/extractors.ts
import type { Product } from "./types";

export function parseJsonLdScripts(html: string): any[] {
  const scripts = html.match(
    /<script[^>]*type=["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  const out: any[] = [];
  if (!scripts) return out;
  for (const raw of scripts) {
    try {
      const jsonTxt = raw.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
      const parsed = JSON.parse(jsonTxt);
      if (Array.isArray(parsed)) out.push(...parsed);
      else if (parsed && typeof parsed === "object" && Array.isArray(parsed["@graph"]))
        out.push(...(parsed["@graph"] as any[]));
      else out.push(parsed);
    } catch {}
  }
  return out;
}

export const parseNum = (txt?: string | null) => {
  if (!txt) return null;
  const m = txt.replace(/\s/g, "").match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const v = parseFloat(m[1].replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

export function extractOriginalFromHtml(html: string): number | null {
  const candidates: (string | null)[] = [];
  const del = html.match(/<del[^>]*>([\s\S]*?)<\/del>/i);
  if (del) candidates.push(del[1]);

  const oldCls = html.match(
    /<[^>]+class=["'][^"']*(old|strike|was|previous|before|compare|former|original)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
  );
  if (oldCls) candidates.push(oldCls[2]);

  const labels = [
    /Ord\.?\s*pris[:\s]*([0-9\s.,]+)/i,
    /Ordinarie\s*pris[:\s]*([0-9\s.,]+)/i,
    /Rek\.?\s*pris[:\s]*([0-9\s.,]+)/i,
    /Tidigare\s*pris[:\s]*([0-9\s.,]+)/i,
  ];
  for (const re of labels) {
    const m = html.match(re);
    if (m) candidates.push(m[1]);
  }

  for (const c of candidates) {
    if (!c) continue;
    const n = parseNum(c);
    if (n != null && isFinite(n)) return n;
  }
  return null;
}

export function extractNostoPricesFromHtml(html: string) {
  const blockMatch = html.match(
    /<div[^>]+class=["'][^"']*nosto_product[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  );
  if (!blockMatch)
    return {} as { price?: number | null; listPrice?: number | null; currency?: string | null };
  const block = blockMatch[1];

  const read = (cls: string) => {
    const m = block.match(
      new RegExp(`<span[^>]+class=["'][^"']*${cls}[^"']*["'][^>]*>([\\s\\S]*?)<\\/span>`, "i")
    );
    return m ? m[1].trim() : null;
  };

  const price = parseNum(read("price"));
  const listPrice = parseNum(read("list_price"));
  const currency = (read("price_currency_code") || "SEK").toUpperCase();
  return { price, listPrice, currency };
}

export function extractGtinFromText(text: string): string | null {
  const candidates = Array.from(text.matchAll(/\b\d{8,14}\b/g)).map((m) => m[0]);
  candidates.sort((a, b) => b.length - a.length);
  for (const c of candidates) if (isValidGtin(c)) return c;
  return null;
}

export function isValidGtin(n: string): boolean {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(n)) return false;
  const body = n.slice(0, -1);
  const cd = parseInt(n.slice(-1), 10);
  return calcGtinCheckDigit(body) === cd;
}
function calcGtinCheckDigit(numWithoutCheck: string) {
  const d = numWithoutCheck.split("").map((x) => +x);
  let sum = 0;
  for (let i = d.length - 1, pos = 1; i >= 0; i--, pos++) {
    sum += d[i] * (pos % 2 === 1 ? 3 : 1);
  }
  const mod = sum % 10;
  return mod === 0 ? 0 : 10 - mod;
}

export function extractGtinFromHtml(html: string) {
  const m =
    html.match(/"gtin14"\s*:\s*"(\d{14})"/i) ||
    html.match(/"gtin13"\s*:\s*"(\d{13})"/i) ||
    html.match(/"gtin12"\s*:\s*"(\d{12})"/i) ||
    html.match(/"gtin8"\s*:\s*"(\d{8})"/i);
  if (m && isValidGtin(m[1])) return m[1];
  return extractGtinFromText(html.replace(/\s+/g, " "));
}
