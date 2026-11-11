// Thought Shield (The Great Old One 10): "You also have resistance to psychic
// damage, and whenever a creature deals psychic damage to you, that creature
// takes the same amount of damage that you do."
//
// The resistance is the authored row's. This is the other half: the psychic
// damage the warlock took, after their own defenses, lands on the creature
// that dealt it, at the two doors where a creature's damage reaches a
// character with its dealer known (enemy-attack.ts, a creature's blow, and
// cast-at-player.ts, a spell or ability a creature cast). A trap, a hazard or
// the GM's own apply_damage names no creature, so nothing goes back.
//
// Any new door that deals a creature's damage to a character calls
// thoughtShieldBack beside its applyPcDamage.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { applyEnemyDamage, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { blowDefenses, meetDefenses, type BlowFlags } from "@/lib/dm/pc-damage";
import { holdsFeature, isNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const PSYCHIC = "psychic";

// The psychic damage of a blow that gets through the character's defenses:
// the psychic part of a blow of several types, or the whole of a psychic one.
export function psychicTaken(campaignId: string, sheet: CharacterSheet, blow: { amount: number; type?: string; parts?: Array<{ amount: number; type: string }>; flags?: BlowFlags }): number {
  const { met, amount } = meetDefenses(blowDefenses(campaignId, sheet, blow.flags ?? {}), blow.amount, blow.type, blow.parts, 0);
  if (met) {
    return met.reduce((sum, part) => sum + (isNamed(part.type, PSYCHIC) ? part.amount : 0), 0);
  }
  return isNamed(blow.type ?? "", PSYCHIC) ? amount : 0;
}

// Deals back what the warlock took. `sheet` is the warlock as the blow met
// them (before it landed), and `enemyId` the creature that dealt it. Answers
// the line the call's result carries, or nothing.
export function thoughtShieldBack(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  enemyId: string | null | undefined,
  blow: Parameters<typeof psychicTaken>[2],
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): { thoughtShield?: string } {
  if (!enemyId || blow.amount <= 0 || !holdsFeature(sheet, "thought shield")) {
    return {};
  }
  const encounter = getActiveEncounter(campaign.id);
  const enemy = encounter ? resolveEnemyRef(encounter.id, enemyId) : null;
  const taken = encounter && enemy && enemy.currentHp > 0 ? psychicTaken(campaign.id, sheet, blow) : 0;
  if (!encounter || !enemy || taken <= 0) {
    return {};
  }
  // The same amount, of the same type: the creature's own defenses meet it.
  applyEnemyDamage(campaign, turn, encounter, enemy, taken, sheets, sheetsById, PSYCHIC, { magical: true, holdVictory: true });
  return { thoughtShield: `Thought Shield: ${enemy.displayName} takes the same ${taken} psychic damage ${sheet.name} took.` };
}
