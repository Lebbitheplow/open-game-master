// A spell's glyph by its name, for the pages that draw a spell outside the
// Hand (the spellbook, the party panel's concentration chip, the workshop),
// so they show the same glyph as the spell's card (issue 845). The Hand works
// a glyph out from the mechanics row it casts by (spell-glyph-logic.ts); this
// reads the answers it gives with no content pack, written out by
// scripts/build-spell-glyph-table.mjs, so a page does not load every row to
// draw one icon. A workshop spell is read by its own mechanics block, else
// the published spell it runs as; a name in neither wears the unknown glyph.
// Pure.

import table from "@/lib/battlemap/spell-glyph-table.json";
import { textKey } from "@/lib/language/text-logic";
import { glyphFromMech, type SpellGlyph } from "@/lib/battlemap/spell-glyph-logic";
import type { IconRef } from "@/lib/icons";
import type { SpellMech } from "@/lib/srd/spell-mech-types";

const GLYPH_OF = new Map<string, SpellGlyph>(
  Object.entries(table.glyphs as Record<string, string[]>).flatMap(([glyph, names]) => names.map((name) => [textKey(name), glyph as SpellGlyph] as const)),
);

// A workshop spell's own mechanics block (its stored `mech`), read as the
// Hand reads it (spellGlyph's ownBlock): the server casts by that block, so a
// copy of Fireball rewritten to deal cold wears cold here as on its card, and
// its own name is not looked up. A block is one the Hand would cast by only
// with its resolution (spell-mech-schema.ts requires it); past that, only the
// fields glyphFromMech reads are checked, as a stored block was validated
// when it was written.
function ownBlockGlyph(mech: unknown): SpellGlyph | null | undefined {
  if (!mech || typeof mech !== "object") return undefined;
  const block = mech as Record<string, unknown>;
  if (typeof block.resolution !== "string") return undefined;
  if (block.damageType !== undefined && typeof block.damageType !== "string") return undefined;
  return glyphFromMech(block as SpellMech);
}

export function listedSpellGlyph(name: string, runsAs?: string | null, mech?: unknown): SpellGlyph {
  const own = ownBlockGlyph(mech);
  const published = runsAs ? GLYPH_OF.get(textKey(runsAs)) : undefined;
  if (own !== undefined) return own ?? published ?? "unknown";
  return GLYPH_OF.get(textKey(name)) ?? published ?? "unknown";
}

// The icon GameIcon draws for it.
export function spellGlyphIcon(name: string, runsAs?: string | null, mech?: unknown): IconRef {
  return { kind: "glyph", key: `spell-${listedSpellGlyph(name, runsAs, mech)}` };
}
