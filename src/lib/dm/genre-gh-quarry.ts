// Improved Quarry (slayer 11): "marking is free when a creature harms an
// ally". The Quarry spend on a creature that, this round, attacked one of the
// slayer's allies and dealt them damage costs no bonus action (asked by
// src/lib/dm/authored-spends.ts with the steampunk free spends). What it
// reads: the round's attack lines (encounters.targets, written by every
// enemy attack) for "this round", and the damage rolls the creature made
// against that ally for "harms".
import type { Encounter } from "@/lib/db/encounters";
import { listRecentRolls } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isNamed, holdsFeature } from "@/lib/srd/feature-names";

export const FREE_QUARRY_MARK = "horror:improved quarry";

export function improvedQuarryFree(campaignId: string, sheet: CharacterSheet, spendName: string, enemyId: string | undefined, encounter: Encounter | null): string | null {
  if (!enemyId || !encounter || !isNamed(spendName, "Quarry") || !holdsFeature(sheet, "Improved Quarry")) {
    return null;
  }
  const struck = encounter.targets.round === encounter.round ? (encounter.targets.pairs[enemyId] ?? []).filter((ref) => ref !== sheet.id) : [];
  if (!struck.length) {
    return null;
  }
  const harmed = listRecentRolls(campaignId, 40).some((roll) => roll.kind === "damage" && roll.attacker?.kind === "enemy" && roll.attacker.id === enemyId && roll.characterId !== null && struck.includes(roll.characterId) && roll.total > 0);
  return harmed ? FREE_QUARRY_MARK : null;
}
