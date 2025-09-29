/**
 * Product validation utilities
 */

import type { Product, ProductRecord } from "../types";

export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Validates a product object
 * @param product - The product to validate
 * @returns The validated product
 * @throws ValidationError if the product is invalid
 */
export function validateProduct(product: unknown): Product {
  if (!product || typeof product !== "object") {
    throw new ValidationError("Product must be an object");
  }

  const p = product as Record<string, any>;

  // Validate required fields
  if (!p.url || typeof p.url !== "string") {
    throw new ValidationError(
      "Product URL is required and must be a string",
      "url",
    );
  }

  // Validate URL format
  try {
    new URL(p.url);
  } catch {
    throw new ValidationError("Product URL must be a valid URL", "url");
  }

  // Validate optional fields
  if (p.name !== null && p.name !== undefined && typeof p.name !== "string") {
    throw new ValidationError("Product name must be a string or null", "name");
  }

  if (
    p.price !== null &&
    p.price !== undefined &&
    (typeof p.price !== "number" || !Number.isFinite(p.price))
  ) {
    throw new ValidationError(
      "Product price must be a finite number or null",
      "price",
    );
  }

  if (
    p.originalPrice !== null &&
    p.originalPrice !== undefined &&
    (typeof p.originalPrice !== "number" || !Number.isFinite(p.originalPrice))
  ) {
    throw new ValidationError(
      "Product originalPrice must be a finite number or null",
      "originalPrice",
    );
  }

  if (
    p.currency !== null &&
    p.currency !== undefined &&
    typeof p.currency !== "string"
  ) {
    throw new ValidationError(
      "Product currency must be a string or null",
      "currency",
    );
  }

  if (
    p.imageUrl !== null &&
    p.imageUrl !== undefined &&
    typeof p.imageUrl !== "string"
  ) {
    throw new ValidationError(
      "Product imageUrl must be a string or null",
      "imageUrl",
    );
  }

  if (p.ean !== null && p.ean !== undefined && typeof p.ean !== "string") {
    throw new ValidationError("Product EAN must be a string or null", "ean");
  }

  if (
    p.brand !== null &&
    p.brand !== undefined &&
    typeof p.brand !== "string"
  ) {
    throw new ValidationError(
      "Product brand must be a string or null",
      "brand",
    );
  }

  if (
    p.inStock !== null &&
    p.inStock !== undefined &&
    typeof p.inStock !== "boolean"
  ) {
    throw new ValidationError(
      "Product inStock must be a boolean or null",
      "inStock",
    );
  }

  return {
    name: p.name ?? null,
    price: p.price ?? null,
    originalPrice: p.originalPrice ?? null,
    currency: p.currency ?? null,
    imageUrl: p.imageUrl ?? null,
    ean: p.ean ?? null,
    url: p.url,
    brand: p.brand ?? null,
    inStock: p.inStock ?? null,
  };
}

/**
 * Validates a product record
 * @param record - The product record to validate
 * @returns The validated product record
 * @throws ValidationError if the record is invalid
 */
export function validateProductRecord(record: unknown): ProductRecord {
  if (!record || typeof record !== "object") {
    throw new ValidationError("ProductRecord must be an object");
  }

  const r = record as Record<string, any>;

  // Validate base product first
  const product = validateProduct(record);

  // Validate ProductRecord specific fields
  if (!r.id || typeof r.id !== "string") {
    throw new ValidationError(
      "ProductRecord ID is required and must be a string",
      "id",
    );
  }

  if (!r.firstSeen || typeof r.firstSeen !== "string") {
    throw new ValidationError(
      "ProductRecord firstSeen is required and must be a string",
      "firstSeen",
    );
  }

  if (!r.lastUpdated || typeof r.lastUpdated !== "string") {
    throw new ValidationError(
      "ProductRecord lastUpdated is required and must be a string",
      "lastUpdated",
    );
  }

  if (
    r.lastCrawled !== null &&
    r.lastCrawled !== undefined &&
    typeof r.lastCrawled !== "string"
  ) {
    throw new ValidationError(
      "ProductRecord lastCrawled must be a string or null",
      "lastCrawled",
    );
  }

  if (
    r.lastmodByUrl !== null &&
    r.lastmodByUrl !== undefined &&
    (typeof r.lastmodByUrl !== "object" || Array.isArray(r.lastmodByUrl))
  ) {
    throw new ValidationError(
      "ProductRecord lastmodByUrl must be an object or null",
      "lastmodByUrl",
    );
  }

  return {
    ...product,
    id: r.id,
    firstSeen: r.firstSeen,
    lastUpdated: r.lastUpdated,
    lastCrawled: r.lastCrawled ?? null,
    lastmodByUrl: r.lastmodByUrl ?? null,
  };
}

/**
 * Sanitizes a URL string
 * @param url - The URL to sanitize
 * @returns The sanitized URL or null if invalid
 */
export function sanitizeUrl(url: string): string | null {
  if (!url || typeof url !== "string") {
    return null;
  }

  try {
    const parsed = new URL(url);
    // Only allow http and https protocols
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Validates a site host string
 * @param host - The host to validate
 * @returns The validated host or null if invalid
 */
export function validateSiteHost(host: string): string | null {
  if (!host || typeof host !== "string") {
    return null;
  }

  // Basic host validation (no protocol, no path)
  if (host.includes("/") || host.includes(":")) {
    return null;
  }

  // Must contain at least one dot
  if (!host.includes(".")) {
    return null;
  }

  return host;
}
