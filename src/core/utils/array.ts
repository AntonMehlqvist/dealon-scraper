/**
 * Array utilities
 */

/**
 * Removes duplicate elements from an array
 * @param arr - Array to deduplicate
 * @returns New array with unique elements only
 */
export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
