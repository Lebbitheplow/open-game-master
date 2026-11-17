// The class resources' names and guidance in the reader's language. The map
// itself (class-resources-fr-data.ts, about 6 KiB gzip) is installed with the
// French catalog (src/lib/i18n/fr-tables.ts), so a page in English never
// loads it; until it is in, a French reader sees the stored English def.
import { frTables } from "@/lib/i18n/fr-tables";

type Locale = "en" | "fr";

// A resource's display name in the reader's language; null outside French or
// when the map does not carry the id, so the caller falls back to the def.
export function resourceDisplayName(id: string, locale: Locale): string | null {
  if (locale !== "fr") {
    return null;
  }
  return frTables()?.resources[id]?.name ?? null;
}

// A resource's guidance line in the reader's language, same fallback.
export function resourceGuidance(id: string, locale: Locale): string | null {
  if (locale !== "fr") {
    return null;
  }
  return frTables()?.resources[id]?.guidance ?? null;
}
