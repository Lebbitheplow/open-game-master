// A roll by its parts (issue #1064).
//
// A roll's `detail` is a sentence a site writes for the table to read
// ("Longsword vs Goblin", "CON save to keep concentration (Bless)"). Rules
// read that sentence back: which weapon a character last swung, whether a
// failed save was the one that keeps concentration, which ability a save
// used. So rewording a card could quietly break a rule, and a reader found
// its fact only while the words stayed English.
//
// What a rule reads back is now stored beside the sentence, as fields
// (`rolls.parts_json`). This module is the only place that reads them, and
// the only place that still reads a sentence. A roll that has parts is read
// by its fields alone, and the door writes them for every roll it stores,
// '{}' where a roll names nothing. A roll with none is read by its words:
// one stored before the column, and the roll of a card dealt before cards
// kept their parts (src/lib/db/dm-turns.ts PendingRoll), landing after.
// scripts/test-text-comparisons.mjs lists every file that reads a stored
// roll's `detail`, and fails on one that tests it outside this module.
//
// Step 1 of the issue stores what code reads back. The sentence is still
// written by its site; whom a roll is against, how it is aimed and its note
// join the parts with the families that move their words onto them.
//
// Pure: no database.

import type { StoredRoll } from "@/lib/db/rolls";
import { textKey } from "@/lib/language/text-logic";
import { rollAgainst } from "@/lib/roll-labels";
import { findSkill, SRD_SKILLS } from "@/lib/srd";
import type { Ability } from "@/lib/srd/authored-effects-types";
import { ABILITY_NAMES } from "@/lib/srd/legality/types";

// What was used, by its content key where it has one. A creature's own
// action ("Bite") has a kind of its own and no key: its names have no table
// yet, and the rows already say what they are on the day they get one.
export type RollUsed = {
  kind: "weapon" | "spell" | "feature" | "item" | "trap" | "skill" | "ability" | "tool" | "action";
  key?: string;
  name: string;
};

// What a rule later asks of a roll. A closed list, of one so far.
export type RollPurpose = "concentration";

export type RollParts = {
  used?: RollUsed;
  purpose?: RollPurpose;
  // What a save resists, one of the engine's own values ("poison",
  // "frightened": src/lib/dm/roll-about.ts SAVE_AGAINST) as the resolver was
  // told it, for a feature that rolls the save again with what rode it the
  // first time.
  resists?: string;
  // The dice were the player's own, rolled at the table.
  physical?: true;
};

// A stored roll, as its readers here take it.
type Recorded = Pick<StoredRoll, "parts" | "detail">;

export const ABILITIES: readonly Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

// ---- What a site says as it records a roll ----

// A check by its skill, or by its ability where it names no skill.
export function checkParts(check: { skill?: string | null; ability?: Ability | null }): RollParts {
  if (check.skill) {
    return { used: { kind: "skill", key: check.skill, name: findSkill(check.skill)?.name ?? check.skill } };
  }
  return check.ability ? saveParts(check.ability) : {};
}

// A saving throw by its ability, and what it is rolled for when a rule asks.
export function saveParts(ability: Ability, purpose?: RollPurpose): RollParts {
  return { used: { kind: "ability", key: ability, name: ABILITY_NAMES[ability] ?? ability }, ...(purpose ? { purpose } : {}) };
}

// An attack by what it is made with: the name it is carried under, and the
// content row it is (a "Longsword +1" is a longsword). `base` is absent for
// an unarmed strike, a natural weapon or an improvised one.
export function attackParts(attack: { name: string; base?: string | null; spell?: boolean }): RollParts {
  return { used: { kind: attack.spell ? "spell" : "weapon", ...(attack.base ? { key: textKey(attack.base) } : {}), name: attack.name } };
}

// ---- What a rule reads back ----

// The skill a check was made with, when it is one of these; with no list,
// whichever skill it was.
export function rollSkill(roll: Recorded, among?: readonly string[]): string | null {
  if (roll.parts) {
    const used = roll.parts.used;
    return used?.kind === "skill" && used.key && (!among || among.includes(used.key)) ? used.key : null;
  }
  return sentenceSkill(roll.detail, among ?? SRD_SKILLS.map((skill) => skill.id));
}

// The ability a save or a bare ability check was made with.
export function rollAbility(roll: Recorded, among: readonly Ability[] = ABILITIES): Ability | null {
  if (roll.parts) {
    const used = roll.parts.used;
    return used?.kind === "ability" && among.includes(used.key as Ability) ? (used.key as Ability) : null;
  }
  return sentenceAbility(roll.detail, among);
}

// What a save was against, for the traits keyed to it, when it was told.
export function rollResists(roll: Recorded): string | undefined {
  return roll.parts ? roll.parts.resists : VERSUS.exec(roll.detail)?.[1];
}

// Whether a save was the one a concentrating caster makes to keep the spell.
export function rollKeepsConcentration(roll: Recorded): boolean {
  return roll.parts ? roll.parts.purpose === "concentration" : roll.detail.includes(KEEPS_CONCENTRATION);
}

// The carried row an attack roll was made with, when it is still carried. A
// pack's rows have no ids, so the row is found by the name it is carried
// under, which the roll stored whole.
export function rollWeaponRow<Row extends { name: string }>(roll: Recorded, carried: readonly Row[]): Row | null {
  if (roll.parts) {
    const used = roll.parts.used;
    return used?.kind === "weapon" ? (carried.find((row) => row.name === used.name) ?? null) : null;
  }
  return carried.find((row) => roll.detail.startsWith(rollAgainst(row.name, ""))) ?? null;
}

// Whether the dice were the player's own.
export function rollPhysical(roll: Recorded): boolean {
  return roll.parts ? roll.parts.physical === true : roll.detail.endsWith(PHYSICAL);
}

// ---- A roll stored before its parts: the sentence, as it was read ----

// What the door writes after the words of dice rolled at the table
// (src/lib/dm/roll-record.ts), in every row, old and new.
export const PHYSICAL = "(physical)";

// The words every site that rolls this save wrote into it.
const KEEPS_CONCENTRATION = "to keep concentration";

// What follows "vs" to the end of a save's words ("DEX save vs. frightened").
const VERSUS = /\bvs\.? (.+)$/i;

// A skill by its id or its name in the words ("Grapple: athletics",
// "Sleight of Hand to palm the key").
function sentenceSkill(detail: string, among: readonly string[]): string | null {
  const words = textKey(detail);
  return among.find((id) => words.includes(id) || words.includes(textKey(findSkill(id)?.name ?? id))) ?? null;
}

// An ability by its code or its name in the words ("DEX save vs. Fireball",
// a request's bare "dex", "Strength check").
const ABILITY_WORD = new RegExp(`\\b(?:${[...ABILITIES, ...ABILITIES.map((id) => ABILITY_NAMES[id])].join("|")})\\b`, "gi");
function sentenceAbility(detail: string, among: readonly Ability[]): Ability | null {
  for (const [word] of detail.matchAll(ABILITY_WORD)) {
    const key = word.toLowerCase();
    const ability = ABILITIES.find((id) => id === key || ABILITY_NAMES[id].toLowerCase() === key);
    if (ability && among.includes(ability)) {
      return ability;
    }
  }
  return null;
}
