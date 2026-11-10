// The fighting style slots a character's classes open, counted per class.
//
// A sheet lists "Fighting Style" once by name, however many classes give it,
// so a count read off the sheet's features finds one slot where a fighter 1 /
// paladin 2 has two, and the paladin's level offered no style at all while
// the owed picks then said one was owed. Every door that counts style slots
// goes through here: the level-up's offer (level-up-options.ts), the level-up
// itself (level-up.ts), the save's check (sheet-legality.ts) and the owed
// picks (owed-picks-logic.ts). Each class's features at its own level, tagged
// with the class, so a slot offers that class's own list (SRD 5.1: a
// paladin's Fighting Style is not a ranger's). Pure.
import { textKey } from "@/lib/language/text-logic";
import {
  FIGHTING_STYLES,
  chosenFightingStyles,
  fightingStyleChoices,
  fightingStyleSlots,
  newStyleFits,
} from "@/lib/srd/feature-effects";
import { classFeaturesFor } from "@/lib/srd/features";
import type { SubclassExtras } from "@/lib/srd/subclass-tables";

export type StyleClassRow = { id: string; subclass?: string | null; level: number };

// Each class's features at its level, tagged with the class they come from.
export function styleSlotFeatures(
  classes: ReadonlyArray<StyleClassRow>,
  extras?: SubclassExtras,
): Array<{ name: string; classId: string }> {
  return classes.flatMap((entry) =>
    classFeaturesFor(entry.id, entry.subclass ?? "", entry.level, extras).map((feature) => ({ ...feature, classId: entry.id })),
  );
}

export type OpenStyleSlots = {
  // Slots earned and not yet filled.
  count: number;
  // The styles a new pick may be: on a slot's own list, not held, and fitting
  // a slot the held styles leave free (newStyleFits).
  choices: typeof FIGHTING_STYLES;
  // Every slot the classes open, filled or not.
  slots: number;
};

// The styles still to pick, given the features the sheet holds.
export function openStyleSlots(
  classes: ReadonlyArray<StyleClassRow>,
  heldFeatures: ReadonlyArray<{ name: string }>,
  extras?: SubclassExtras,
): OpenStyleSlots {
  const slotFeatures = styleSlotFeatures(classes, extras);
  const slots = fightingStyleSlots(slotFeatures);
  const held = chosenFightingStyles([...heldFeatures]);
  const heldKeys = held.map(textKey);
  const choices = fightingStyleChoices(slotFeatures).filter(
    (style) => !heldKeys.includes(textKey(style.name)) && newStyleFits(held, style.name, slotFeatures),
  );
  const count = choices.length ? Math.max(0, slots - held.length) : 0;
  return { count, choices, slots };
}
