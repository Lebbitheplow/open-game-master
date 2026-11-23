import gearDescJson from "@/lib/content/item-descriptions-fr.json";
import { textKey } from "@/lib/language/text-logic";
import { rulebookPage } from "@/lib/rulebook/book";
import { rulebookPageIdFor } from "@/lib/rulebook/catalog-rows";

// French descriptions for SRD 5.1 equipment, adventuring gear, tools, and
// mounts (used on the server when /api/content/items answers in French).
// Magic items fall through to the official French SRD 5.1 rulebook pages
// in src/lib/rulebook/srd-5.1-fr.json.

const GEAR_DESC_FR: Record<string, string> = gearDescJson;

function stripLeadingMeta(md: string): string {
  for (let i = 0; i < md.length - 1; i += 1) {
    if (md[i] === "\n" && md[i + 1] === "\n") {
      return md.slice(i + 2).trim();
    }
  }
  return md;
}

export function frenchItemDescription(name: string): string | null {
  const pageId = rulebookPageIdFor("item", name);
  if (pageId) {
    const fr = rulebookPage(pageId, "fr");
    if (fr?.page.md) {
      return stripLeadingMeta(fr.page.md);
    }
  }
  const id = textKey(name.replace(/['‘’ʼ´]/g, ""));
  return GEAR_DESC_FR[id] ?? null;
}

export function localizeItemEntryFr<T extends { name: string; source?: "open5e" | "srd" | "homebrew"; data?: unknown }>(entry: T): T {
  if (entry.source === "homebrew" || !entry.data || typeof entry.data !== "object") {
    return entry;
  }
  const desc = frenchItemDescription(entry.name);
  if (!desc) {
    return entry;
  }
  return {
    ...entry,
    data: { ...(entry.data as Record<string, unknown>), desc },
  };
}
