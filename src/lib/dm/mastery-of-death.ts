// Mastery of Death (Way of the Long Death, 11th level): "Spend 1 ki to stay
// at 1 hit point instead of dropping to 0, as long as ki remains." It answers
// the drop itself, so it runs in the damage path (pc-damage.ts, beside
// Relentless Endurance) before the death engine sees it: spent afterwards the
// monk was already unconscious and prone, the drop's consequences landed.
// Like Relentless Endurance it holds against being reduced to 0, not against
// being killed outright, so massive damage passes it with the ki unspent.
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { holdsFeature } from "@/lib/srd/feature-names";

// The patch that holds the monk at 1 hit point, or null when the feature, the
// ki or the drop is missing.
export function masteryOfDeathHold(sheet: CharacterSheet, dropped: boolean, outright: boolean): FullPatchSheetInput | null {
  if (!dropped || outright || !holdsFeature(sheet, "Mastery of Death")) {
    return null;
  }
  const ki = sheet.resources?.ki;
  if (!ki || ki.used >= ki.max) {
    return null;
  }
  return { currentHp: 1, resources: { ...sheet.resources, ki: { max: ki.max, used: ki.used + 1 } } };
}
