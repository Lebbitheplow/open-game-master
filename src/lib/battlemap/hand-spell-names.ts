// The spells a character can cast, by name: its class lists, a multiclass's
// other casters, the spells its race gives and a subclass counter's free
// spell. Apart from hand-spells.ts, which re-exports it, so the board's token
// menu (hand-hud.ts) asks "does this hero hold a spell" without loading every
// spell card builder: the table display page draws the board and deals no
// hand (scripts/test-hand-engine.mjs holds hand-spells.ts out of it).
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { innateSpellsFor } from "@/lib/srd/racial-grants";
import { counterCastsHeld } from "@/lib/srd/counter-casts";
import { allSpellNames } from "@/lib/srd/spell-lists";
import { textKey } from "@/lib/language/text-logic";

export function spellNames(sheet: CharacterSheet): string[] {
  const casting = sheet.spellcasting;
  // The spells the race and its chosen option give (issue #833): a
  // tiefling fighter's hellish rebuke, a Topaz ancestry's misty step. They
  // sit on no class list, and a character with no Spellcasting casts them
  // too.
  const racial = innateSpellsFor(sheet.race, sheet.level, undefined, { features: sheet.features }).map((spell) => spell.name);
  const all = [
    ...(casting ? allSpellNames(casting) : []),
    ...(casting?.casters ?? []).flatMap((caster) => allSpellNames(caster)),
    ...racial,
    // A subclass counter's free spell (Star Map's guiding bolt), on no list.
    ...counterCastsHeld(sheet.features).map((entry) => entry.spell),
  ];
  const seen = new Set<string>();
  return all.filter((name) => {
    const key = textKey(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
