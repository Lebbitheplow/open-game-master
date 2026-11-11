// The two infusions that act on the board (src/lib/srd/infusions.ts):
//
//   - Homunculus Servant: the gem laid with it becomes the heart of a Tiny
//     construct, an ally that acts right after the artificer and takes the
//     Dodge action unless commanded with a bonus action. Its numbers, written
//     into the infusion's text: AC 13, 1 + the artificer's Intelligence
//     modifier + artificer level hit points, 20 feet walking and 30 flying,
//     Force Strike at the artificer's spell attack bonus, 30 feet, 1d4 + the
//     proficiency bonus force. It stays while the infusion does; one at a time.
//     Spawned like the Dancing Item (src/lib/dm/summon-arcane.ts).
//   - Boots of the Winding Path: a bonus action teleports the wearer up to 15
//     feet to an open square they stood in this turn (the squares moveToken
//     keeps, src/lib/db/battle-maps.ts squaresStoodIn), through the feature
//     move door (src/lib/dm/feature-move.ts). With no square named, the one
//     the turn began in.
import { randomUUID } from "node:crypto";
import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, squaresStoodIn } from "@/lib/db/battle-maps";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { priceTheAction } from "@/lib/dm/combat-features";
import { planFeatureMove } from "@/lib/dm/feature-move";
import { summonRecord } from "@/lib/dm/summon-rules";
import { removeSummon, spawnSummons, summonsOf } from "@/lib/dm/summon-store";
import type { ToolResult } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { infusionOf, infusionWorn } from "@/lib/srd/infusions";
import type { SummonForm } from "@/lib/srd/summon-forms";
import { classLevelOf } from "@/lib/srd/trait-rules";

export const HOMUNCULUS = "Homunculus Servant";

export function homunculusForm(artificer: CharacterSheet): SummonForm {
  const derived = computeSheetDerived(artificer);
  const pb = derived.proficiencyBonus;
  return {
    name: HOMUNCULUS,
    type: "construct",
    size: "Tiny",
    cr: 0,
    ac: 13,
    hp: Math.max(1, 1 + derived.abilityMods.int + classLevelOf(artificer, "artificer")),
    speed: 20,
    fly: 30,
    abilities: { str: 4, dex: 15, con: 12, int: 10, wis: 10, cha: 7 },
    attacks: [{ name: "Force Strike", toHit: derived.spellAttack ?? pb + derived.abilityMods.int, damage: `1d4+${pb}`, type: "force", range: 30 }],
    immune: "poison",
    conditionImmune: "exhaustion, poisoned",
    traits: "Evasion. Channel Magic: with its reaction it delivers a touch spell its artificer casts, within 120 ft. of them. It acts right after the artificer and takes the Dodge action unless commanded (a bonus action).",
  };
}

// Whether the artificer's Homunculus Servant is laid in a gem anywhere.
function heartLaid(campaignId: string, artificerId: string): boolean {
  return listSheets(campaignId).some((sheet) => sheet.equipment.some((row) => row.infusion?.by === artificerId && infusionOf(row)?.def.name === HOMUNCULUS));
}

// The homunculus its gem's infusion has just made: the one before goes.
export function formHomunculus(campaign: Campaign, artificerId: string): string | null {
  const artificer = getSheetById(artificerId);
  if (!artificer) {
    return null;
  }
  for (const old of summonsOf(campaign.id, artificer.id, HOMUNCULUS)) {
    removeSummon(campaign, old);
  }
  const form = homunculusForm(artificer);
  const record = summonRecord(form, { spell: HOMUNCULUS, casterId: artificer.id, casterName: artificer.name, concentration: false, castId: randomUUID().slice(0, 8) });
  const [made] = spawnSummons(campaign, artificer, { form, count: 1, record, rounds: null, slotLevel: null, initiative: "caster", overrides: { level: artificer.level } });
  return made ? `${form.name} forms around the gem: ${made.currentHp} HP, AC 13, speed 20 ft., fly 30 ft.; Force Strike +${form.attacks[0].toHit} (${form.attacks[0].damage} force, 30 ft.). It acts right after ${artificer.name} and attacks with pc_attack under its own characterId.` : null;
}

// A homunculus whose gem no longer bears the infusion is gone with it.
export function dismissStrayHomunculi(campaign: Campaign): void {
  for (const sheet of listSheets(campaign.id)) {
    if (sheet.summon?.spell !== HOMUNCULUS || heartLaid(campaign.id, sheet.summon.casterId)) {
      continue;
    }
    removeSummon(campaign, sheet);
  }
}

export function windingPath(campaign: Campaign, stale: CharacterSheet, square: { x?: number; y?: number }): ToolResult {
  const sheet = getSheetById(stale.id) ?? stale;
  const boots = infusionWorn(sheet.equipment, "Boots of the Winding Path");
  if (!boots) {
    return { error: `${sheet.name} wears no Boots of the Winding Path (an artificer's infusion, worn and attuned). Nothing was spent.`, refused: "rules" };
  }
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, sheet.id) : null;
  const stood = token ? squaresStoodIn(token.id) : [];
  if (!token || !stood.length) {
    return { error: `Boots of the Winding Path take ${sheet.name} back to a square they stood in this turn, and they have not moved from where it began. Nothing was spent.`, refused: "rules" };
  }
  const named = typeof square.x === "number" && typeof square.y === "number" ? { x: square.x, y: square.y } : null;
  const target = named ?? stood[0];
  if (!stood.some((at) => at.x === target.x && at.y === target.y)) {
    return { error: `(${target.x},${target.y}) is not a square ${sheet.name} stood in this turn: ${stood.map((at) => `(${at.x},${at.y})`).join(", ")}. Nothing was spent.`, retry: true };
  }
  const move = planFeatureMove(campaign, { refId: sheet.id, square: target, feet: 15, what: "Boots of the Winding Path", teleport: true });
  if ("error" in move) {
    return move;
  }
  const priced = priceTheAction(sheet, encounter, "Boots of the Winding Path", "bonus");
  if ("error" in priced) {
    return priced;
  }
  priced.commit();
  return { ok: true, resource: "Boots of the Winding Path", item: boots.name, moved: move.go() };
}
