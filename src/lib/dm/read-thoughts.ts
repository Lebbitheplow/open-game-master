// Read Thoughts (Knowledge Domain 6): "Read a creature's surface thoughts for
// a minute and cast suggestion on it without a slot." The creature that
// failed its save carries READ_THOUGHTS (the cleric as its source) for a
// minute, and the cleric READING_THOUGHTS with the creature as its quarry.
// While both hold, the cleric's Suggestion costs no slot (cast-guard.ts) and
// the creature read does not save against it (cast-at-enemy.ts): "you can
// use your action to end the effect and cast suggestion on the creature
// without expending a spell slot. The target automatically fails its saving
// throw against the spell." Casting it ends the reading.
//
// Pure: the readers pass the sheet and the creature.
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { ConditionMetaMap } from "@/lib/schemas/condition-meta";
import { textKey } from "@/lib/language/text-logic";

export const READ_THOUGHTS = "read thoughts";
export const READING_THOUGHTS = "reading thoughts";

type Carrier = { conditions: string[]; conditionMeta?: ConditionMetaMap };

const held = (carrier: Carrier, name: string) => carrier.conditions.find((entry) => isConditionNamed(entry, name)) ?? null;

export const isSuggestion = (spell: string) => textKey(spell) === "suggestion";

// The cleric is reading a creature's thoughts: their Suggestion is free.
export function readsThoughts(caster: Carrier): boolean {
  return held(caster, READING_THOUGHTS) !== null;
}

// This creature is the one the caster reads: it fails the save outright.
export function thoughtsReadBy(creature: Carrier, casterId: string): boolean {
  const name = held(creature, READ_THOUGHTS);
  return name !== null && creature.conditionMeta?.[name]?.source === casterId;
}
