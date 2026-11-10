// Mystic Arcanum (SRD 5.1, warlock 11, 13, 15, 17): "You can cast your
// arcanum spell once without expending a spell slot. You must finish a long
// rest before you can do so again." The warlock's pact slots stop at 5th
// level, so a 6th to 9th level spell they know had nothing to pay for it, and
// a use_resource spend of the arcanum moved its counter and cast nothing.
//
// The cast guard (src/lib/dm/cast-guard.ts) asks this before a slot: the
// arcanum's counter pays for a spell of its own level cast at that level,
// while its use is left.
//
// Pure.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { SpellFacts } from "@/lib/srd/spell-facts";

export function arcanumCounter(
  sheet: Pick<CharacterSheet, "resources">,
  facts: SpellFacts | null,
  named: number | undefined,
): string | null {
  if (!facts || facts.level < 6 || facts.level > 9 || (named !== undefined && named !== facts.level)) {
    return null;
  }
  const id = `mystic_arcanum_${facts.level}`;
  const state = sheet.resources?.[id];
  return state && state.used < state.max ? id : null;
}
