// The lineages' own choices on a d20 already seen, offered on the card the
// roll waits on (after-roll-logic.ts), each a row of after-roll-table.ts:
//
//   Saving Face (hobgoblin, src/lib/srd/races.json): "once a short rest,
//   after a miss or a failed check or save, +1 to the roll for each ally you
//   see within 30 feet, up to +5". Chosen knowing the roll fell short, so it
//   is offered only where the bonus carries it.
//
// Pure: the sheet, the roll and the allies the board shows in, the options
// out. The spending and the count of allies are lineage-after-roll.ts.

import type { AfterRollId, AfterRollOption } from "@/lib/dm/after-roll-logic";
import { rowWords } from "@/lib/dm/after-roll-table";
import { holdsFeature } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const SAVING_FACE = "race_saving_face";
export const SAVING_FACE_FEET = 30;
export const SAVING_FACE_MOST = 5;

export const LINEAGE_AFTER_ROLL: readonly AfterRollId[] = ["saving_face"];
export const isLineageAfterRoll = (id: AfterRollId) => LINEAGE_AFTER_ROLL.includes(id);

const usesLeft = (sheet: Pick<CharacterSheet, "resources">, id: string) => {
  const state = sheet.resources?.[id];
  return state ? Math.max(0, state.max - state.used) : 0;
};

// Saving Face's bonus for this many allies in sight.
export const savingFaceBonus = (allies: number) => Math.min(SAVING_FACE_MOST, Math.max(0, Math.floor(allies)));

export type LineageRoll = {
  // The stored roll's kind: "attack", "saving_throw", "skill_check"...
  kind: string;
  total: number;
  natural?: number;
  // What it must reach: a check's or save's DC (null when none is known), or
  // an attack's AC.
  target: { dc: number | null } | { ac: number; critRange: number };
  taken: ReadonlySet<string>;
  // The roller's allies in sight within 30 feet (lineage-after-roll.ts).
  allies: number;
};

// Whether a number added carries the roll as it stands: a missed attack (a
// natural 1 misses whatever is added), a failed check or save, or one with
// no known DC.
function carriedBy(roll: LineageRoll, most: number): boolean {
  if ("ac" in roll.target) {
    const misses = roll.natural === 1 || (roll.natural !== undefined && roll.natural < roll.target.critRange && roll.total < roll.target.ac);
    return misses && roll.natural !== 1 && roll.total + most >= roll.target.ac;
  }
  const dc = roll.target.dc;
  return dc === null || (roll.total < dc && roll.total + most >= dc);
}

export function lineageOffers(sheet: CharacterSheet, roll: LineageRoll): AfterRollOption[] {
  const options: AfterRollOption[] = [];
  // Initiative fails nothing, so it is not "a failed check".
  const answers = roll.kind === "attack" || roll.kind === "saving_throw" || roll.kind === "skill_check" || roll.kind === "ability_check";
  const bonus = savingFaceBonus(roll.allies);
  if (answers && bonus > 0 && !roll.taken.has("saving_face") && usesLeft(sheet, SAVING_FACE) > 0 && holdsFeature(sheet, "Saving Face") && carriedBy(roll, bonus)) {
    options.push({ id: "saving_face", ...rowWords("saving_face", { kind: roll.kind, amount: `+${bonus}` }) });
  }
  return options;
}
