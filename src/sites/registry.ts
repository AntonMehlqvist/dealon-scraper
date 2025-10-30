// Centralized site registry and categories

// Pharmacy Adapters
import { adapter as apohem } from "./pharmacy/apohem/adapter";
import { adapter as apotea } from "./pharmacy/apotea/adapter";
import { adapter as apoteket } from "./pharmacy/apoteket/adapter";
import { adapter as hjartat } from "./pharmacy/hjartat/adapter";
import { adapter as kronans } from "./pharmacy/kronans/adapter";

// Electronics Adapters
import { adapter as elgiganten } from "./electronics/elgiganten/adapter";
import { adapter as inet } from "./electronics/inet/adapter";
import { adapter as kjell } from "./electronics/kjell/adapter";
import { adapter as netonnet } from "./electronics/netonnet/adapter";
import { adapter as power } from "./electronics/power/adapter";
import { adapter as webhallen } from "./electronics/webhallen/adapter";

// Template
import { adapter as template } from "./_template/adapter";

// 1) Adapters dictionary (single source of truth for site keys)
const adapters = {
  // Pharmacy
  apoteket,
  apotea,
  kronans,
  apohem,
  hjartat,
  // Electronics
  elgiganten,
  webhallen,
  netonnet,
  power,
  kjell,
  inet,
  // Template
  _template: template,
} as const;

export type RegistryKey = keyof typeof adapters;

// 2) Base categories without "all"; reference adapter keys, not duplicated arrays elsewhere
const BASE_CATEGORIES = {
  pharmacy: {
    name: "Pharmacy",
    sites: ["apoteket", "apotea", "kronans", "apohem", "hjartat"] as const,
    description: "Swedish pharmacy websites",
  },
  electronics: {
    name: "Electronics",
    sites: [
      "elgiganten",
      "webhallen",
      "netonnet",
      "power",
      "kjell",
      "inet",
    ] as const,
    description: "Electronics and technology retailers",
  },
  template: {
    name: "Template",
    sites: ["_template"] as const,
    description: "Template for new adapters",
  },
} as const;

// 3) Compute "all" as the union of non-template categories
const ALL_SITES = Array.from(
  new Set(
    Object.entries(BASE_CATEGORIES)
      .filter(([key]) => key !== "template")
      .flatMap(([, cat]) => cat.sites as readonly string[]),
  ),
);

export const SITE_CATEGORIES = {
  ...BASE_CATEGORIES,
  all: {
    name: "All",
    sites: ALL_SITES as readonly string[],
    description: "All supported sites",
  },
} as const;

// 4) Defaults derived from a category (single place to change)
export const DEFAULT_SITES = SITE_CATEGORIES.pharmacy
  .sites as readonly string[];

// 5) Registry map derived from adapters dictionary
export const registry = new Map<string, any>(Object.entries(adapters));
