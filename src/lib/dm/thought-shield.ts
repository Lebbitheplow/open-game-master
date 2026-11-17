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
import { getActiveEncounter, getEnemy } from "@/lib/db/encounters";
import { applyEnemyDamage, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { meetEnemyPart } from "@/lib/dm/enemy-defenses";
import { blowDefenses, meetDefenses, type BlowFlags } from "@/lib/dm/pc-damage";
import type { Retort, WaitingAnswer } from "@/lib/dm/retort-logic";
import { giveShareBack, wouldDrop } from "@/lib/dm/spell-retort";
import { holdsFeature, isNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const PSYCHIC = "psychic";
// The answer's name on what it set off (retort-logic.ts Retort.by).
export const THOUGHT_SHIELD = "Thought Shield";

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
  // A reaction could still turn this swing into a miss (retort-wait.ts):
  // psychic that would slay the creature waits on it.
  waits = false,
): { thoughtShield?: string; waiting?: WaitingAnswer } {
  if (!enemyId || blow.amount <= 0 || !holdsFeature(sheet, "thought shield")) {
    return {};
  }
  const encounter = getActiveEncounter(campaign.id);
  const enemy = encounter ? resolveEnemyRef(encounter.id, enemyId) : null;
  const taken = encounter && enemy && enemy.currentHp > 0 ? psychicTaken(campaign.id, sheet, blow) : 0;
  if (!encounter || !enemy || taken <= 0) {
    return {};
  }
  if (waits && wouldDrop(campaign.id, enemy, taken, PSYCHIC, false)) {
    return {
      thoughtShield: `${sheet.name}'s ${THOUGHT_SHIELD} would slay ${enemy.displayName} with the same ${taken} psychic damage: it lands once the hit stands, and never if a reaction turns the hit into a miss.`,
      waiting: { by: THOUGHT_SHIELD, enemyId: enemy.id, holderId: sheet.id, amount: taken, type: PSYCHIC, spell: false },
    };
  }
  // The same amount, of the same type: the creature's own defenses meet it.
  applyEnemyDamage(campaign, turn, encounter, enemy, taken, sheets, sheetsById, PSYCHIC, { magical: true, holdVictory: true });
  return { thoughtShield: `Thought Shield: ${enemy.displayName} takes the same ${taken} psychic damage ${sheet.name} took.` };
}

// A Thought Shield answer still waiting on a reaction (retort-wait.ts) deals
// what the warlock takes of the blow as a reaction has now lessened it; none
// left, it is gone.
export function lessenWaitingPsychic(campaignId: string, held: CharacterSheet, waiting: WaitingAnswer[], now: Parameters<typeof psychicTaken>[2]): WaitingAnswer[] {
  const taken = psychicTaken(campaignId, held, now);
  return waiting.map((answer) => (answer.by === THOUGHT_SHIELD ? { ...answer, amount: Math.min(answer.amount, taken) } : answer)).filter((answer) => answer.amount > 0);
}

// A swing that still hits after a reaction lessened it (Uncanny Dodge's
// half, Cutting Words off the damage): the warlock took less psychic, so the
// creature takes less back. `was` and `now` are the blow before and after the
// reaction, `held` the warlock as the blow met them. Returns the answer as it
// now stands and the line for the reaction's result; null when Thought Shield
// gave nothing back or the psychic did not change.
export function thoughtShieldLessened(
  campaign: Campaign,
  held: CharacterSheet,
  retort: Retort,
  was: Parameters<typeof psychicTaken>[2],
  now: Parameters<typeof psychicTaken>[2],
): { retort: Retort | null; line: string | null } | null {
  const answered = retort.share?.[THOUGHT_SHIELD] ?? 0;
  const before = psychicTaken(campaign.id, held, was);
  const after = psychicTaken(campaign.id, held, now);
  const enemy = getEnemy(retort.enemyId);
  if (answered <= 0 || after >= before || !enemy) {
    return null;
  }
  // What the creature's defenses leave of the smaller amount, as they met the
  // first (meetEnemyPart, the part's own reading of its resistances).
  const owed = after > 0 ? Math.min(answered, meetEnemyPart(campaign.id, enemy, after, PSYCHIC, { magical: true }).amount) : 0;
  return giveShareBack(campaign, retort, THOUGHT_SHIELD, answered - owed, `${THOUGHT_SHIELD}: ${held.name} took ${after} psychic damage, not ${before}, so ${enemy.displayName} takes ${owed}`);
}
