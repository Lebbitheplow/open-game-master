// A pet's saving throw, the pure half: the bonuses its block gives each save,
// what its state and traits do to the roll, and the share of the damage the
// save leaves. src/lib/dm/pet-save.ts reads the block, rolls the save and
// lands the damage.
//
// SRD 5.1, Saving Throws: every creature an effect forces to save makes its
// own, from its own statistics. Find Familiar: the familiar "has the
// statistics of the chosen form". Before this a pet made no save at all.

import type { SaveAbility } from "@/lib/bestiary/statblock";
import { mergeAdvantage, rollDerivation, type AdvantageState } from "@/lib/dm/condition-logic";
import { proficiencyBonus } from "@/lib/srd";
import { conditionRollRiders } from "@/lib/srd/condition-effects";

export const PET_SAVE_ABILITIES: readonly SaveAbility[] = ["str", "dex", "con", "int", "wis", "cha"];

export type PetSaveMods = Record<SaveAbility, number>;

// What a pet's save is made from: a bonus for each ability, and the lines of
// its block a save reads (Magic Resistance, Evasion). With them the
// conditions the block shrugs off ("poisoned" for an imp), which keep a
// failed save's condition off it (pet-conditions.ts).
export type PetSaveBlock = { saveMods: PetSaveMods; traits: readonly string[]; from: string; conditionImmune?: string };

const modifier = (score: number | undefined) => Math.floor(((score ?? 10) - 10) / 2);

// A block's save bonuses: each ability's modifier, and the creature's own
// proficiency bonus (by its challenge rating, as the SRD table's reader
// counts it: src/lib/bestiary/index.ts) on the saves the block lists.
export function blockSaveMods(form: { abilities: Partial<Record<SaveAbility, number>>; saves?: readonly SaveAbility[]; cr: number }): PetSaveMods {
  const pb = proficiencyBonus(Math.max(1, form.cr));
  return Object.fromEntries(
    PET_SAVE_ABILITIES.map((ability) => [ability, modifier(form.abilities[ability]) + (form.saves?.includes(ability) ? pb : 0)]),
  ) as PetSaveMods;
}

// Drake Companion's block: STR 16, DEX 12, CON 15, INT 8, WIS 14, CHA 8, its
// Dexterity and Wisdom saves "plus PB", the ranger's proficiency bonus. The
// drake's record keeps no ability scores (pet-build.ts), so they live here.
const DRAKE_SCORES: Record<SaveAbility, number> = { str: 16, dex: 12, con: 15, int: 8, wis: 14, cha: 8 };

export function drakeSaveMods(pb: number): PetSaveMods {
  return Object.fromEntries(
    PET_SAVE_ABILITIES.map((ability) => [ability, modifier(DRAKE_SCORES[ability]) + (ability === "dex" || ability === "wis" ? pb : 0)]),
  ) as PetSaveMods;
}

// Every save at +0: a story pet given only hit points and an Armor Class has
// no block to read, so it saves as a creature of 10s.
export const PLAIN_SAVE_MODS: PetSaveMods = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };

const traitNamed = (traits: readonly string[], name: RegExp) => traits.some((line) => name.test(line.trim()));

// Magic Resistance: "advantage on saving throws against spells and other
// magical effects" (an imp, a quasit, a pseudodragon).
export const hasMagicResistance = (traits: readonly string[]) => traitNamed(traits, /^magic resistance\b/i);

// Evasion on a block: no damage on a made Dexterity save for half, half on a
// failed one.
export const hasEvasion = (traits: readonly string[]) => traitNamed(traits, /^evasion\b/i);

// The save as the pet's block and state shape it: its conditions decide it
// outright (a paralyzed or unconscious pet fails Strength and Dexterity saves)
// or lean it (restrained on Dexterity; the Dodge an uncommanded companion
// takes, "advantage on Dexterity saving throws"), a spell it carries adds its
// die (a Bless the ranger's Share Spells gave it), and Magic Resistance leans
// a save against magic. One merge, so any advantage and any disadvantage
// cancel whatever their counts.
export function petSaveShape(input: { block: PetSaveBlock; conditions: readonly string[]; ability: SaveAbility; magical: boolean; advantage?: boolean }): {
  autoFail: boolean;
  bonus: number;
  advantage: AdvantageState;
  diceSuffix: string;
  notes: string[];
} {
  const conditions = [...input.conditions];
  const derivation = rollDerivation(conditions, "saving_throw", input.ability);
  if (derivation.autoFail) {
    return { autoFail: true, bonus: 0, advantage: "none", diceSuffix: "", notes: derivation.notes };
  }
  const riders = conditionRollRiders(conditions, "save", input.ability);
  const resists = input.magical && hasMagicResistance(input.block.traits);
  return {
    autoFail: false,
    bonus: input.block.saveMods[input.ability] ?? 0,
    advantage: mergeAdvantage([...derivation.sources, ...riders.advantageSources, ...(resists || input.advantage ? ["advantage" as const] : [])]),
    diceSuffix: riders.diceSuffix,
    notes: [...derivation.notes, ...riders.notes, ...(resists ? ["Magic Resistance: advantage against magic"] : [])],
  };
}

// What a pet takes of an effect's damage: all of it on a failed save, half on
// a made one where the effect halves, none where it does not. Evasion moves a
// Dexterity save for half one step down: none on a success, half on a failure.
export function petDamageShare(input: { saved: boolean; halfOnSave: boolean; ability: SaveAbility; evasion: boolean }): "full" | "half" | "none" {
  if (input.evasion && input.ability === "dex" && input.halfOnSave) {
    return input.saved ? "none" : "half";
  }
  if (input.saved) {
    return input.halfOnSave ? "half" : "none";
  }
  return "full";
}
