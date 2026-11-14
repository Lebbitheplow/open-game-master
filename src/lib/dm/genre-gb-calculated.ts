// Difference Engine Mind (machinist 17): "1/rest, take the calculated answer:
// treat one INT-based check as a natural 20". The spend lays CALCULATED_ANSWER
// (src/lib/srd/authored-effects-genre-gb.ts); the holder's next Intelligence
// check, or skill check made with Intelligence, rolls its d20 floored at 20
// and spends the mark as a one-shot carrier (src/lib/dm/rolls.ts), as
// Guidance's die is spent.
import { isConditionNamed } from "@/lib/srd/feature-names";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const CALCULATED_ANSWER = "calculated answer";

export function calculatedAnswer(sheet: CharacterSheet, kind: string, ability: string | undefined): boolean {
  return (
    (kind === "ability_check" || kind === "skill_check") &&
    ability === "int" &&
    sheet.conditions.some((entry) => isConditionNamed(entry, CALCULATED_ANSWER)) &&
    holdsGenreFeature(sheet, "machinist", "Difference Engine Mind")
  );
}
