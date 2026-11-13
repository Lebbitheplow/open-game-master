// Who cannot be surprised: the one rule both surprise doors read, a side named
// surprised at start_encounter (src/lib/dm/encounter-tools.ts) and an ambush's
// Stealth against passive Perception (src/lib/dm/encounter-open.ts
// decideAmbush). Before this each door kept its own copy of the Alert check,
// and the features that say "you cannot be surprised" (the authored
// no_surprise effect: Hypervigilant, Unblinking Study, Hunted Instincts) were
// read by neither. A new way to escape surprise goes here, never at one door.
//
// Pure.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeat } from "@/lib/srd/feat-effects";
import { holdsFeature } from "@/lib/srd/feature-names";
import { optionFeatureName } from "@/lib/srd/options";
import { infusionWorn } from "@/lib/srd/infusions";
import { activeAuthored } from "@/lib/srd/authored-effects";
import { creatureTypeOf } from "@/lib/bestiary/creature-type";
import { textKey } from "@/lib/language/text-logic";

export type LyingInWait = { slug?: string; stats?: { type?: string } };

// Conscious, and holding Alert or a no_surprise effect that answers every
// creature lying in wait (a foe of a type the effect does not name still
// catches them unawares).
export function cannotBeSurprised(sheet: CharacterSheet, foes: readonly LyingInWait[]): boolean {
  if (sheet.currentHp <= 0) {
    return false;
  }
  // The Alert feat, a Rune Knight carrying the Storm Rune, an artificer's
  // Helm of Awareness worn ("can't be surprised, provided it isn't
  // incapacitated": src/lib/srd/infusions.ts).
  if (holdsFeat(sheet, "Alert") || holdsFeature(sheet, optionFeatureName("rune", "Storm Rune")) || infusionWorn(sheet.equipment ?? [], "Helm of Awareness")) {
    return true;
  }
  return activeAuthored(sheet, "no_surprise").some(({ effect }) => {
    if (!effect.types && !effect.slugs) {
      return true;
    }
    return foes.length > 0 && foes.every((foe) =>
      Boolean(effect.types?.includes(creatureTypeOf(foe.stats ?? {})) || effect.slugs?.includes(textKey(foe.slug ?? ""))),
    );
  });
}
