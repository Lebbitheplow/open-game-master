// The genre classes' companions as allies with their stat blocks (WAVE2 D5:
// a setting fact the app does not model, a drone, is built as the nearest SRD
// mechanic the text names, a summoned creature with the text's stats), made
// as the steel defender is (src/lib/dm/summon-defender.ts):
//   the rigger's drones: Drone Companion "AC 13, HP 5 + level, moves 30 ft,
//     acts on your command"; Combat Chassis "attacks for 1d8 + INT force";
//     Drone Swarm and Drone Legion a second and a third; Improved Chassis "AC
//     16 and HP 15 + twice your level"; Titan Frame "Primary drone doubles its
//     HP, deals +1d8 damage"; Twinned Strike "Two drones attack"; Overclocked
//     Servos "add your INT modifier to their damage" (the second drone's
//     strike, the primary's already carrying it);
//   the vermin lord's dire rat: Favored of the Swarm "AC 13, HP 3 x level,
//     bite 1d6 + DEX", Grey Tide Rising "HP 5 x level, bite 2d6 + DEX";
//   King Below the Streets: "four allied giant-rat-statted beasts serve for 10
//     minutes", the SRD giant rat.
// The DEX and INT the text names are the holder's: the companion fights with
// its maker's training, as the steel defender's rend carries the artificer's.
// A companion is built out of a fight and a new one replaces the old; the rat
// pack is called in one.
import { randomUUID } from "node:crypto";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { computeSheetDerived } from "@/lib/srd";
import { findSummonForm, type SummonForm } from "@/lib/srd/summon-forms";
import { holdsFeature } from "@/lib/srd/trait-rules";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { summonRecord } from "@/lib/dm/summon-rules";
import { removeSummon, spawnSummons, summonsOf } from "@/lib/dm/summon-store";
import type { ToolError } from "@/lib/dm/tool-errors";
import { WEAKENED } from "@/lib/srd/genre-cc-a-conditions";

export type GenreCompanion = "drones" | "dire_rat" | "rat_pack";

const DRONES = "Drone Companion";
const DIRE_RAT = "Favored of the Swarm";
const RAT_PACK = "King Below the Streets";

const ABILITIES = { str: 6, dex: 14, con: 10, int: 3, wis: 10, cha: 3 };

// The drones the rigger's features make, primary first.
export function droneForms(sheet: CharacterSheet, level: number): SummonForm[] {
  const derived = computeSheetDerived(sheet);
  const int = derived.abilityMods.int;
  const pb = derived.proficiencyBonus;
  const improved = holdsFeature(sheet, "Improved Chassis");
  const titan = holdsFeature(sheet, "Titan Frame");
  const ac = improved ? 16 : 13;
  const hp = Math.max(1, improved ? 15 + 2 * level : 5 + level);
  const strike = (dice: string) => ({ name: "Mounted Weapon", toHit: pb + int, damage: `${dice}+${int}`, type: "force" });
  const base = { type: "construct", size: "Tiny" as const, cr: 0, speed: 30, fly: 30, abilities: ABILITIES, immune: "poison, psychic", conditionImmune: "charmed, exhaustion, frightened, poisoned" };
  const primary: SummonForm = {
    ...base,
    name: "Drone",
    ac,
    hp: titan ? hp * 2 : hp,
    attacks: holdsFeature(sheet, "Combat Chassis") ? [strike(titan ? "2d8" : "1d8")] : [],
    traits: `Acts on the rigger's command.${holdsFeature(sheet, "Evasive Subroutines") ? " Evasive Subroutines: half damage from an area effect, none on a successful DEX save." : ""}${titan ? " Titan Frame: it can carry a rider." : ""}`,
  };
  const count = holdsFeature(sheet, "Drone Legion") ? 3 : holdsFeature(sheet, "Drone Swarm") ? 2 : 1;
  const second: SummonForm = {
    ...primary,
    name: "Drone",
    hp,
    attacks: holdsFeature(sheet, "Twinned Strike") ? [{ ...strike("1d8"), damage: `1d8${holdsFeature(sheet, "Overclocked Servos") ? `+${int}` : ""}` }] : [],
    traits: "Acts on the rigger's command.",
  };
  return [primary, ...Array.from({ length: count - 1 }, () => second)];
}

export function direRatForm(sheet: CharacterSheet, level: number): SummonForm {
  const derived = computeSheetDerived(sheet);
  const dex = derived.abilityMods.dex;
  const grown = holdsFeature(sheet, "Grey Tide Rising");
  return {
    name: "Dire Rat",
    type: "beast",
    size: grown ? "Medium" : "Small",
    cr: 0,
    ac: 13,
    hp: Math.max(1, (grown ? 5 : 3) * level),
    speed: 30,
    climb: 30,
    abilities: { str: 12, dex: 16, con: 12, int: 2, wis: 12, cha: 4 },
    // Grey Tide Rising: "its bite forces a CON save against a weakening bite
    // (disadvantage on STR checks 1 minute)", at the vermin lord's 8 +
    // proficiency + DEX, as the bite's other numbers are theirs.
    attacks: [{ name: "Bite", toHit: derived.proficiencyBonus + dex, damage: `${grown ? "2d6" : "1d6"}+${dex}`, type: "piercing", ...(grown ? { onHit: { save: "con" as const, dc: 8 + derived.proficiencyBonus + dex, condition: WEAKENED, rounds: 10 } } : {}) }],
    traits: "Obeys the vermin lord's commands.",
  };
}

const inFight = (campaignId: string) => {
  const encounter = getActiveEncounter(campaignId);
  return Boolean(encounter && encounter.status === "active" && (encounter.kind ?? "fight") === "fight");
};

export function summonGenreCompanion(
  campaign: Campaign,
  sheet: CharacterSheet,
  companion: GenreCompanion,
  level: number,
): ToolError | { result: Record<string, unknown> } {
  const spell = companion === "drones" ? DRONES : companion === "dire_rat" ? DIRE_RAT : RAT_PACK;
  if (companion !== "rat_pack" && inFight(campaign.id)) {
    return { error: `${sheet.name}'s ${companion === "drones" ? "drones are" : "dire rat is"} readied outside a fight, not in the middle of one. Nothing was spent.`, refused: "rules" };
  }
  const forms =
    companion === "drones" ? droneForms(sheet, level) : companion === "dire_rat" ? [direRatForm(sheet, level)] : Array.from({ length: 4 }, () => findSummonForm("Giant Rat")).filter((form): form is SummonForm => Boolean(form));
  if (!forms.length) {
    return { error: `The giant rat's stat block is missing from the bestiary, so ${spell} has nothing to call. Nothing was spent.`, refused: "rules" };
  }
  // One set at a time: a new one replaces the old.
  const replaced = summonsOf(campaign.id, sheet.id, spell);
  for (const old of replaced) {
    removeSummon(campaign, old);
  }
  const castId = randomUUID().slice(0, 8);
  const made: CharacterSheet[] = [];
  for (const form of forms) {
    const record = summonRecord(form, { spell, casterId: sheet.id, casterName: sheet.name, concentration: false, castId });
    made.push(...spawnSummons(campaign, sheet, { form, count: 1, record, rounds: companion === "rat_pack" ? 100 : null, slotLevel: null, initiative: "caster", overrides: { level: sheet.level } }));
  }
  return {
    result: {
      summoned: made.map((entry) => ({ characterId: entry.id, name: entry.name, hp: `${entry.currentHp}/${entry.maxHp}`, ac: entry.ac })),
      creature: forms.map((form) => `${form.name}: ${form.hp} HP, AC ${form.ac}${form.attacks[0] ? `, ${form.attacks[0].name} +${form.attacks[0].toHit} (${form.attacks[0].damage} ${form.attacks[0].type})` : ", no attack"}`).join("; "),
      ...(replaced.length ? { replaced: "The old ones are gone; one set at a time." } : {}),
      note: `Allies on the board acting right after ${sheet.name}; each attacks with pc_attack under its own characterId.${companion === "rat_pack" ? " They serve for 10 minutes." : ""}`,
    },
  };
}

// The rigger's drones on the board, primary first (Self-Repair Protocol and
// the other drone features, src/lib/dm/genre-a-cyberpunk-drones.ts).
export function riggerDrones(campaignId: string, riggerId: string): CharacterSheet[] {
  return summonsOf(campaignId, riggerId, DRONES);
}
