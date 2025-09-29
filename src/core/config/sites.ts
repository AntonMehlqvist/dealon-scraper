/**
 * Default site configuration
 *
 * This file contains the default list of sites that will be processed
 * when no specific sites are provided via command line or database configuration.
 *
 * To modify the default sites, simply update the DEFAULT_SITES array below.
 *
 * Usage:
 * - Command line: --sites apoteket,apotea
 * - Database config: Set 'sites' configuration in database
 * - Default fallback: Uses the sites defined in this file
 */

/**
 * Default sites to process when no specific sites are provided
 *
 * Available sites:
 * - apoteket: Apoteket.se
 * - apotea: Apotea.se
 * - kronans: Kronans Apotek
 * - apohem: Apohem.se
 * - hjartat: Hjärtat Apotek
 */
export const DEFAULT_SITES = [
  "apoteket",
  "apotea",
  "kronans",
  "apohem",
  "hjartat",
] as const;

/**
 * Type for valid site keys
 */
export type SiteKey = (typeof DEFAULT_SITES)[number];
