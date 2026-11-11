// The Bladesong's hold on a spell (wizard, Bladesinging 2): "your Intelligence
// modifier (at least +1) on Constitution saves to keep concentration", while
// the song runs (src/lib/srd/subclasses.json, wizard::Bladesong).
//
// The stored text once said only "a concentration-save bonus" and the engine
// added nothing: a bladesinger hit while holding Haste rolled the save as any
// wizard does. The number is the rule the text condenses: the Intelligence
// modifier, never less than +1, on the Constitution save damage forces to keep
// a spell, and on no other save.
//
// Called where that save is rolled (src/lib/dm/concentration.ts
// concentrationDamageHook), which adds it to the roll and names it in the
// result. The song's AC and speed are the condition's own row
// (src/lib/srd/condition-effects.ts), its Acrobatics the authored row's.
//
// Pure.
import { computeSheetDerived } from "@/lib/srd";
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const BLADESONG = "bladesong";

// What the running Bladesong adds to a save to keep concentration: 0 when the
// song is not running.
export function bladesongConcentrationBonus(sheet: CharacterSheet): number {
  if (!sheet.conditions.some((entry) => isConditionNamed(entry, BLADESONG))) {
    return 0;
  }
  return Math.max(1, computeSheetDerived(sheet).abilityMods.int);
}
