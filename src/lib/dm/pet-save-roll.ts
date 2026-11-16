// A pet's own saving throw, rolled and shown as a dice card: the block it
// saves from and the roll. Split from pet-save.ts so the clock that ends a
// pet's conditions (pet-conditions.ts, called from condition-tick.ts) can
// roll the save that ends one without importing the pet's damage doors
// (pet-tools.ts, which reach enemy-damage.ts and close the cycle
// condition-tick.ts warns about).

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { insertRoll } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import { saveModFor } from "@/lib/bestiary/enemy-numbers";
import { findTableMonster } from "@/lib/bestiary/homebrew-monsters";
import { proficiencyBonus } from "@/lib/srd";
import { findShapeForm } from "@/lib/srd/beast-forms";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";
import { saveAuraBeside } from "@/lib/dm/aura";
import type { ForcedSave } from "@/lib/dm/forced-save";
import { blockSaveMods, drakeSaveMods, hasEvasion, petSaveShape, PET_SAVE_ABILITIES, PLAIN_SAVE_MODS, type PetSaveBlock, type PetSaveMods } from "@/lib/dm/pet-save-logic";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";

// The block a pet saves from. A drake's is its own (pet-save-logic.ts); a
// story pet the table built in the workshop is that monster, as summon_pet
// reads it (pet-build.ts storyPetBlock); every other pet is its form in the
// SRD creature table (a familiar's owl or imp, a companion's wolf). A Beast
// Master's beast adds the ranger's proficiency bonus to its proficient saves
// (Ranger's Companion), kept on its record since summon_pet built it; one
// stored before that adds it here.
export function petSaveBlockFor(campaign: Campaign, owner: CharacterSheet, pet: SheetPet): PetSaveBlock {
  const pb = proficiencyBonus(owner.level);
  if (pet.kind === "drake") {
    return { saveMods: drakeSaveMods(pb), traits: [], from: "its drake block" };
  }
  const table = pet.kind === "other" ? findTableMonster(spellAuthorsFor(campaign), pet.form) : null;
  const form = table ? null : findShapeForm(pet.form);
  const traits = table?.draft.stats.traits ?? form?.traitLines ?? [];
  const own: PetSaveMods = table
    ? (Object.fromEntries(PET_SAVE_ABILITIES.map((ability) => [ability, saveModFor(table.draft.stats, ability)])) as PetSaveMods)
    : form
      ? blockSaveMods(form)
      : PLAIN_SAVE_MODS;
  const from = table || form ? `the ${table?.draft.name ?? form?.name ?? pet.form} block` : "no block (+0)";
  const conditionImmune = table?.draft.stats.conditionImmune || form?.conditionImmune || undefined;
  if (pet.kind === "beast_companion") {
    const raised = pet.saves ?? Object.fromEntries(PET_SAVE_ABILITIES.map((ability) => [ability, own[ability] + (form?.saves?.includes(ability) ? pb : 0)]));
    return { saveMods: { ...own, ...raised }, traits, from, conditionImmune };
  }
  return { saveMods: own, traits, from, conditionImmune };
}

export type PetSave = ForcedSave & { evasion: boolean };

// The pet's save, rolled and shown as a dice card. The pet stands in its
// owner's square, so a paladin's aura that reaches the owner, or the owner's
// own, covers it (aura.ts saveAuraBeside).
export function rollPetSave(
  campaign: Campaign,
  turn: DmTurn | null,
  owner: CharacterSheet,
  pet: SheetPet,
  // `detail`: the dice card's words when they are not "save vs the source"
  // (a save to end a condition). `advantage`: the effect's own (Hideous
  // Laughter's save when the creature is hurt).
  input: { ability: SaveAbility; dc: number; magical: boolean; source: string; detail?: string; advantage?: boolean },
): PetSave {
  const block = petSaveBlockFor(campaign, owner, pet);
  const evasion = hasEvasion(block.traits);
  const shape = petSaveShape({ block, conditions: pet.conditions ?? [], ability: input.ability, magical: input.magical, advantage: input.advantage });
  if (shape.autoFail) {
    return { success: false, total: null, autoFailed: true, notes: shape.notes, evasion };
  }
  const aura = saveAuraBeside(campaign.id, getSheetById(owner.id) ?? owner);
  const expression = `${d20Expression(shape.bonus + (aura?.bonus ?? 0), shape.advantage)}${shape.diceSuffix}`;
  // Tagged as an ally's save, as the pet's attack is tagged as an ally's
  // attack (pet-tools.ts), for what a watcher sets on the party's rolls.
  const outcome = rollExpression(expression, undefined, { purpose: { roller: "hero", kind: "save", who: pet.name } });
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: null,
    requestedBy: "dm",
    kind: "saving_throw",
    detail: (input.detail ?? `${pet.name}: ${input.ability.toUpperCase()} save vs ${input.source}`).slice(0, 200),
    dc: input.dc,
    ...(shape.advantage === "none" ? {} : { advantage: shape.advantage }),
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  turn?.rollIds.push(roll.id);
  return {
    success: outcome.total >= input.dc,
    total: outcome.total,
    autoFailed: false,
    ...(outcome.natural !== undefined ? { natural: outcome.natural } : {}),
    result: outcome,
    notes: [...shape.notes, ...(aura ? [aura.note] : []), `its save from ${block.from}`],
    evasion,
  };
}
