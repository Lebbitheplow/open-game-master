// The lineages' own choices on a d20 already seen, offered on the card the
// roll waits on (after-roll-logic.ts), each a row of after-roll-table.ts:
//
//   Saving Face (hobgoblin, src/lib/srd/races.json): "once a short rest,
//   after a miss or a failed check or save, +1 to the roll for each ally you
//   see within 30 feet, up to +5". Chosen knowing the roll fell short, so it
//   is offered only where the bonus carries it.
//   Lucky Footwork (rabbitfolk): "on a failed Dexterity save, use your
//   reaction to add 1d4; not while prone or at speed 0". Offered where a 4
//   could carry the save.
//
// Pure: the sheet, the roll and the allies the board shows in, the options
// out. The spending and the count of allies are lineage-after-roll.ts.

import type { AfterRollId, AfterRollOption } from "@/lib/dm/after-roll-logic";
import { rowWords } from "@/lib/dm/after-roll-table";
import { holdsFeature } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const SAVING_FACE = "race_saving_face";
export const SAVING_FACE_FEET = 30;
export const SAVING_FACE_MOST = 5;
export const LUCKY_FOOTWORK_DIE = 4;

export const LINEAGE_AFTER_ROLL: readonly AfterRollId[] = ["saving_face", "lucky_footwork"];
export const isLineageAfterRoll = (id: AfterRollId) => LINEAGE_AFTER_ROLL.includes(id);

const ABILITY_WORDS: Record<string, string> = {
  str: "str", strength: "str", dex: "dex", dexterity: "dex", con: "con", constitution: "con",
  int: "int", intelligence: "int", wis: "wis", wisdom: "wis", cha: "cha", charisma: "cha",
};

// The ability of a save as its record names it: the bare ability a request
// names ("dex"), or a forced save's words ("DEX save against Fireball",
// "Dexterity save"). Null when the record does not say.
export function saveAbilityIn(detail: string | null | undefined): string | null {
  const words = textKey(detail ?? "");
  if (ABILITY_WORDS[words]) {
    return ABILITY_WORDS[words];
  }
  const named = /\b(str|dex|con|int|wis|cha|strength|dexterity|constitution|intelligence|wisdom|charisma)\b(?:\s+saving)?\s+(?:save|throw)/i.exec(detail ?? "");
  return named ? ABILITY_WORDS[named[1].toLowerCase()] : null;
}

// Lucky Footwork's bar: prone, or a condition that sets the speed to 0.
const GROUNDED = ["prone", "grappled", "restrained", "paralyzed", "petrified", "stunned", "unconscious"];
export const footworkGrounded = (sheet: Pick<CharacterSheet, "conditions">) =>
  (sheet.conditions ?? []).some((entry) => GROUNDED.includes(textKey(entry).replace(/\s*\(.*$/, "")));

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
  reactionFree: boolean;
  // The roller's allies in sight within 30 feet (lineage-after-roll.ts).
  allies: number;
  // The roll's record, which names a save's ability.
  detail?: string | null;
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
  if (
    roll.kind === "saving_throw" &&
    saveAbilityIn(roll.detail) === "dex" &&
    roll.reactionFree &&
    !roll.taken.has("lucky_footwork") &&
    !footworkGrounded(sheet) &&
    holdsFeature(sheet, "Lucky Footwork") &&
    carriedBy(roll, LUCKY_FOOTWORK_DIE)
  ) {
    options.push({ id: "lucky_footwork", ...rowWords("lucky_footwork", { kind: roll.kind }) });
  }
  return options;
}
