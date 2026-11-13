// A spell's glyph by its name, for the pages that draw a spell outside the
// Hand (the spellbook, the party panel's concentration chip, the workshop),
// so they show the same glyph as the spell's card (issue 845). The Hand works
// a glyph out from the mechanics row it casts by (spell-glyph-logic.ts); this
// reads the answers it gives with no content pack, written out by
// scripts/build-spell-glyph-table.mjs, so a page does not load every row to
// draw one icon. A workshop spell is read by the published spell it runs as;
// a name in neither wears the unknown glyph. Pure.

import table from "@/lib/battlemap/spell-glyph-table.json";
import { textKey } from "@/lib/language/text-logic";
import type { SpellGlyph } from "@/lib/battlemap/spell-glyph-logic";
import type { IconRef } from "@/lib/icons";

const GLYPH_OF = new Map<string, SpellGlyph>(
  Object.entries(table.glyphs as Record<string, string[]>).flatMap(([glyph, names]) => names.map((name) => [textKey(name), glyph as SpellGlyph] as const)),
);

export function listedSpellGlyph(name: string, runsAs?: string | null): SpellGlyph {
  return GLYPH_OF.get(textKey(name)) ?? (runsAs ? GLYPH_OF.get(textKey(runsAs)) : undefined) ?? "unknown";
}

// The icon GameIcon draws for it.
export function spellGlyphIcon(name: string, runsAs?: string | null): IconRef {
  return { kind: "glyph", key: `spell-${listedSpellGlyph(name, runsAs)}` };
}
