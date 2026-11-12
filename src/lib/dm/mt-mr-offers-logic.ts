// The after-the-roll choices of the monk and rogue subclasses (wave 2, part
// mr), offered on the card a thrown d20 waits on (after-roll-logic.ts):
//
//   Unerring Accuracy (Kensei 17): "Reroll a missed monk-weapon attack once
//   per turn."
//   Homing Strikes (Soulknife 9, Soul Blades): "adds a die to a missed
//   Psychic Blades attack"; the Psionic Energy die is spent only if it turns
//   the miss into a hit.
//   Psi-Bolstered Knack (Soulknife 3): "Spend a die to turn a failed check
//   with a proficient skill or tool into a success if the die closes the
//   gap"; the die is spent only if it does.
//   Draconic Presence (Ascendant Dragon 3, Draconic Disciple): "when you fail
//   a Charisma (Intimidation or Persuasion) check, a reaction rerolls it, and
//   once this turns a failure into a success you can't do so again until a
//   long rest."
//
// All four were narrated ("the GM rolls it"): a reroll or a die added after
// the roll had already landed changed nothing. Each is a roll, so each is
// offered where the roll waits, as Master Duelist and Lucky are.
//
// Pure: the sheet and the roll in, the options out. What they spend is
// src/lib/dm/mt-mr-offers.ts; their words are their rows in
// src/lib/dm/after-roll-table.ts.

import type { AfterRollId, AfterRollOption } from "@/lib/dm/after-roll-logic";
import { rowWords } from "@/lib/dm/after-roll-table";
import { holdsRow } from "@/lib/dm/mt-mr-turn";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const PSIONIC_ENERGY = "sub_psionic_energy";
export const DRACONIC_PRESENCE = "sub_draconic_presence";
// Unerring Accuracy's once a turn, in the turn's once-per-turn marks.
export const ACCURACY_MARK = "mr:unerring-accuracy";

export const MR_AFTER_ROLL: readonly AfterRollId[] = ["unerring_accuracy", "homing_strikes", "psi_knack", "draconic_presence"];
export const isMrAfterRoll = (id: AfterRollId) => MR_AFTER_ROLL.includes(id);

// A Psionic Energy die by the level of the class that holds it: "d6s, d8s
// from 5th level, d10s from 11th, d12s from 17th".
export const psionicEnergyDie = (level: number) => (level >= 17 ? "d12" : level >= 11 ? "d10" : level >= 5 ? "d8" : "d6");
const sides = (die: string) => Number(die.slice(1));

const left = (sheet: Pick<CharacterSheet, "resources">, id: string) => {
  const state = sheet.resources?.[id];
  return state ? Math.max(0, state.max - state.used) : 0;
};

// What the offers read of the attack being rolled, from its record and the
// turn it is made in (mt-mr-offers.ts swingFacts).
export type MrSwing = {
  // A monk weapon (a kensei weapon among them), not the unarmed strike.
  monkWeapon: boolean;
  psychicBlade: boolean;
  // Made on the attacker's own turn, and whether Unerring Accuracy has
  // already rerolled one this turn.
  ownTurn: boolean;
  accuracyUsed: boolean;
};

// A missed attack. `natural` is the kept d20, `total` the roll as it stands.
export function mrAttackOffers(sheet: CharacterSheet, roll: { total: number; natural: number; ac: number; taken: ReadonlySet<AfterRollId> }, swing: MrSwing | undefined): AfterRollOption[] {
  if (!swing) {
    return [];
  }
  const options: AfterRollOption[] = [];
  // A fresh d20 can always save a miss: a natural 20 hits.
  if (swing.monkWeapon && swing.ownTurn && !swing.accuracyUsed && !roll.taken.has("unerring_accuracy") && holdsRow(sheet, "monk::Unerring Accuracy")) {
    options.push({ id: "unerring_accuracy", ...rowWords("unerring_accuracy", {}) });
  }
  const blades = swing.psychicBlade ? holdsRow(sheet, "rogue::Soul Blades") : null;
  if (blades && !roll.taken.has("homing_strikes") && left(sheet, PSIONIC_ENERGY) > 0) {
    const die = psionicEnergyDie(blades.level);
    // A natural 1 misses whatever is added, and a die too small is not offered.
    if (roll.natural !== 1 && roll.total + sides(die) >= roll.ac) {
      options.push({ id: "homing_strikes", ...rowWords("homing_strikes", { amount: die }) });
    }
  }
  return options;
}

// The check being made: its skill, or the tool it is made with.
export type MrCheck = { skill?: string | null; tool?: string | null };

const PRESENCE_SKILLS = ["intimidation", "persuasion"];

function proficientIn(sheet: CharacterSheet, check: MrCheck): boolean {
  const skill = textKey(check.skill ?? "");
  if (skill && [...sheet.proficiencies.skills, ...(sheet.proficiencies.expertise ?? [])].some((entry) => textKey(entry) === skill)) {
    return true;
  }
  const tool = textKey(check.tool ?? "");
  return Boolean(tool) && sheet.proficiencies.tools.some((entry) => textKey(entry) === tool);
}

// A failed check against a known Difficulty Class (a check with none cannot
// be told from a success, so nothing is offered on it).
export function mrCheckOffers(
  sheet: CharacterSheet,
  roll: { kind: string; total: number; natural: number | undefined; dc: number | null; taken: ReadonlySet<AfterRollId>; reactionFree: boolean; check?: MrCheck },
): AfterRollOption[] {
  const { dc, check } = roll;
  if (dc === null || roll.total >= dc || !check || (roll.kind !== "skill_check" && roll.kind !== "ability_check")) {
    return [];
  }
  const options: AfterRollOption[] = [];
  const knack = holdsRow(sheet, "rogue::Psi-Bolstered Knack");
  if (knack && !roll.taken.has("psi_knack") && left(sheet, PSIONIC_ENERGY) > 0 && proficientIn(sheet, check)) {
    const die = psionicEnergyDie(knack.level);
    if (roll.total + sides(die) >= dc) {
      options.push({ id: "psi_knack", ...rowWords("psi_knack", { amount: die }) });
    }
  }
  const skill = textKey(check.skill ?? "");
  const reaches = roll.natural === undefined || roll.total - roll.natural + 20 >= dc;
  if (PRESENCE_SKILLS.includes(skill) && reaches && roll.reactionFree && !roll.taken.has("draconic_presence") && left(sheet, DRACONIC_PRESENCE) > 0 && holdsRow(sheet, "monk::Draconic Disciple")) {
    options.push({ id: "draconic_presence", ...rowWords("draconic_presence", {}) });
  }
  return options;
}
