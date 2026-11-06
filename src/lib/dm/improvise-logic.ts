// An improvised action's rules that need no database (improvise.ts holds the
// rest). Pure, so scripts/test-enforce-turn-actions.mjs reads it directly.
//
// Whether the scene holds what the action uses (SRD 5.1, Actions in Combat:
// the GM tells the player whether the action is possible). The model called
// take_action improvise on a player's word before it weighed the scene, and
// dropped a tent on a goblin standing on a bare riverbank; so the model names
// what the action uses in the narration's own words, and each of those words,
// stop words aside, must be a word of the scene's narration. Compared by stem
// in the table's language (src/lib/language/language.ts), so "rope" finds
// "ropes" at every table.

import { stems } from "../language/language.ts";
import type { TableLanguage } from "../schemas/game-settings-options.ts";

// The words of `quoted` the scene's narration never says, as written; empty
// when the scene holds them all. A quote of stop words only names nothing,
// and is returned whole.
export function unshownWords(quoted: string, narration: readonly string[], language: TableLanguage): string[] {
  const said = new Set(narration.flatMap((text) => stems(text, language)));
  const asked = quoted.split(/\s+/).filter((word) => stems(word, language).length > 0);
  if (asked.length === 0) {
    return [quoted.trim()];
  }
  return asked.filter((word) => !stems(word, language).every((stem) => said.has(stem)));
}

// What an improvised action may do to the creature it wins against, and how
// long it lasts. Knocked down: prone, until the creature stands. Tangled:
// restrained as the SRD's Net holds, until it is freed (an action and a DC 10
// Strength check), laid as pc_attack's net lays it. Dazzled, deafened or
// scared: until the end of the creature's next turn.
export const IMPROVISED_CONDITIONS = ["prone", "restrained", "blinded", "deafened", "frightened"] as const;
export type ImprovisedCondition = (typeof IMPROVISED_CONDITIONS)[number];

export function improvisedHold(
  condition: ImprovisedCondition,
  creatureId: string,
  actorId: string,
): { untilTurnEndOf?: string; source?: string } | undefined {
  switch (condition) {
    case "prone":
    case "restrained":
      return undefined;
    case "blinded":
    case "deafened":
      return { untilTurnEndOf: creatureId };
    case "frightened":
      // Frightened of the one who scared it (the move it cannot make toward
      // them reads the source).
      return { untilTurnEndOf: creatureId, source: actorId };
  }
}

// A laid condition and how long it holds, as the result says it: the
// tool's schema names the conditions alone, and the model narrates the
// duration from here. A restraint's freeing is the result's own sentence.
export function improvisedLasts(condition: ImprovisedCondition, actorName: string): string {
  switch (condition) {
    case "prone":
      return "prone until it stands";
    case "restrained":
      return "restrained";
    case "frightened":
      return `frightened of ${actorName} until the end of its next turn`;
    default:
      return `${condition} until the end of its next turn`;
  }
}

// The largest creature a condition takes, where what it copies has one: a
// net holds a creature Large or smaller (SRD 5.1, Net: "A net has no effect
// on creatures that are formless, or creatures that are Huge or larger"), as
// pc_attack's net lays it (attack-swing.ts).
export function improvisedMaxSize(condition: ImprovisedCondition): string | undefined {
  return condition === "restrained" ? "Large" : undefined;
}

// Improvised damage by the situation, after the DMG's Improvising Damage
// table: 1d10 a falling bookcase or burning coals, 2d10 a fire pit, 4d10 a
// collapsing tunnel's rubble, 10d10 compacting walls, 18d10 a lava bath,
// 24d10 a godlike creature's jaws. The steps are the SRD's Damage Severity by
// Level values; the actor's level picks none of them (that table measures
// how dangerous damage is for the one who takes it).
export const IMPROVISED_DAMAGE = ["1d10", "2d10", "4d10", "10d10", "18d10", "24d10"] as const;
export type ImprovisedDamage = (typeof IMPROVISED_DAMAGE)[number];
