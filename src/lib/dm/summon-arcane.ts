// The creatures two arcane subclasses make, as allies with their stat blocks
// (spawnSummons, as the steel defender is, src/lib/dm/summon-defender.ts):
//
//   The Dancing Item (College of Creation 6, Animating Performance): "AC 16
//   and 10 + five times your bard level hit points, attacks with
//   Force-Empowered Slam (your spell attack modifier, reach 5 feet, 1d10 +
//   your proficiency bonus force damage)", for an hour, acting right after
//   the bard. One at a time: a new one replaces the old.
//
//   The Accursed Specter (Undead Warlock 10, here the Hexblade's): an SRD
//   specter "with temporary hit points equal to half your warlock level, adds
//   your Charisma modifier (minimum +0) to its attack rolls, and leaves at the
//   end of your next long rest".
//
// Before this both were counters with guidance: the use went and nothing
// stood on the board.

import { randomUUID } from "node:crypto";
import type { Campaign } from "@/lib/db/campaigns";
import { patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { findSummonForm, type SummonForm } from "@/lib/srd/summon-forms";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { summonRecord } from "@/lib/dm/summon-rules";
import { removeSummon, spawnSummons, summonsOf } from "@/lib/dm/summon-store";

export const DANCING_ITEM = "Dancing Item";
export const ACCURSED_SPECTER = "Accursed Specter";

// An hour, in rounds.
const HOUR = 600;

export function dancingItemForm(sheet: CharacterSheet, bardLevel: number): SummonForm {
  const derived = computeSheetDerived(sheet);
  const pb = derived.proficiencyBonus;
  return {
    name: DANCING_ITEM,
    type: "construct",
    size: "Medium",
    cr: 0,
    ac: 16,
    hp: 10 + 5 * bardLevel,
    speed: 30,
    fly: 30,
    abilities: { str: 18, dex: 14, con: 16, int: 4, wis: 10, cha: 6 },
    attacks: [{ name: "Force-Empowered Slam", toHit: derived.spellAttack ?? 2 + pb + derived.abilityMods.cha, damage: `1d10+${pb}`, type: "force" }],
    immune: "poison, psychic",
    conditionImmune: "charmed, exhaustion, poisoned, frightened",
    traits: "Immutable Form. Irrepressible Dance: a creature that starts its turn within 10 ft. of it has its speed raised or lowered by 10 ft. (the bard's choice) until the turn ends. It acts right after the bard and takes the Dodge action unless commanded (a bonus action).",
  };
}

function spawnOne(campaign: Campaign, sheet: CharacterSheet, form: SummonForm, rounds: number | null): CharacterSheet | null {
  const record = summonRecord(form, { spell: form.name, casterId: sheet.id, casterName: sheet.name, concentration: false, castId: randomUUID().slice(0, 8) });
  const [made] = spawnSummons(campaign, sheet, { form, count: 1, record, rounds, slotLevel: null, initiative: "caster", overrides: { level: sheet.level } });
  return made ?? null;
}

export function summonDancingItem(campaign: Campaign, sheet: CharacterSheet, bardLevel: number): { result: Record<string, unknown> } {
  const replaced = summonsOf(campaign.id, sheet.id, DANCING_ITEM);
  for (const old of replaced) {
    removeSummon(campaign, old);
  }
  const form = dancingItemForm(sheet, bardLevel);
  const made = spawnOne(campaign, sheet, form, HOUR);
  return {
    result: {
      summoned: made ? { characterId: made.id, name: made.name, hp: `${made.currentHp}/${made.maxHp}`, ac: made.ac } : null,
      creature: `${form.name}: ${form.hp} HP, AC 16, speed 30 ft., fly 30 ft., for an hour. Force-Empowered Slam +${form.attacks[0].toHit} (${form.attacks[0].damage} force).`,
      ...(replaced.length ? { replaced: "The item danced before is still again; one at a time." } : {}),
      note: "The Dancing Item is an ally on the board, acting right after its bard; it attacks with pc_attack under its own characterId.",
    },
  };
}

export function summonAccursedSpecter(campaign: Campaign, sheet: CharacterSheet, warlockLevel: number): { result: Record<string, unknown> } | { error: string; refused: "rules" } {
  const base = findSummonForm("Specter");
  if (!base) {
    return { error: "The SRD specter is not in the creature table, so Accursed Specter has nothing to raise. Nothing was spent.", refused: "rules" };
  }
  const cha = Math.max(0, computeSheetDerived(sheet).abilityMods.cha);
  const form: SummonForm = { ...base, name: ACCURSED_SPECTER, attacks: base.attacks.map((attack) => ({ ...attack, toHit: attack.toHit + cha })) };
  // "Leaves at the end of your next long rest": the summon's own rounds do
  // not run out; the long rest that ends it is the GM's (the record names it).
  const made = spawnOne(campaign, sheet, form, null);
  const temp = Math.floor(warlockLevel / 2);
  if (made && temp > 0) {
    const updated = patchSheet(made.id, { tempHp: temp });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  return {
    result: {
      summoned: made ? { characterId: made.id, name: made.name, hp: `${made.currentHp}/${made.maxHp}`, tempHp: temp, ac: made.ac } : null,
      creature: `The slain humanoid's spirit rises as a specter under ${sheet.name}'s command: ${temp} temporary hit points, +${cha} to its attack rolls. It leaves at the end of ${sheet.name}'s next long rest.`,
      note: "The specter is an ally on the board; it attacks with pc_attack under its own characterId.",
    },
  };
}
