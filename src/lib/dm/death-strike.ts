// Death Strike (Assassin, 17th level): "When you hit a surprised creature, it
// makes a Constitution save against 8 + Dexterity + proficiency or takes
// double damage." Asked once the hit is sure and before its damage lands, so
// the doubling meets the creature's resistances with the rest of the blow
// (pc-attack-damage.ts landBlow `doubled`). Both dice paths reach it through
// attack-blow.ts landSwingBlow.
import type { DmTurn } from "@/lib/db/dm-turns";
import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { computeSheetDerived } from "@/lib/srd";
import { holdsFeature } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function deathStrikeDoubles(input: {
  campaignId: string;
  turn: DmTurn | null;
  encounter: Encounter;
  sheet: CharacterSheet;
  enemy: EncounterEnemy;
  notes: string[];
}): boolean {
  const { sheet, enemy, encounter } = input;
  if (!encounter.surprisedIds.includes(enemy.id) || !holdsFeature(sheet, "Death Strike")) {
    return false;
  }
  const derived = computeSheetDerived(sheet);
  const dc = 8 + derived.abilityMods.dex + derived.proficiencyBonus;
  const save = rollEnemySave(input.campaignId, enemy, "con", dc, { record: { ...(input.turn ? { turn: input.turn } : {}), detail: `${enemy.displayName}: CON save against Death Strike` } });
  input.notes.push(save.success ? `Death Strike: ${enemy.displayName} made the DC ${dc} Constitution save` : `Death Strike: ${enemy.displayName} failed the DC ${dc} Constitution save and takes double damage`);
  return !save.success;
}
