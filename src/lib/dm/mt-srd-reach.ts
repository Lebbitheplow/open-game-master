// How far a counter reaches the creature it is spent on, and what that
// creature must be able to do, where the feature's own text says so
// (SRD 5.1):
//
//   Lay on Hands: "As an action, you can touch a creature"; "This feature has
//     no effect on undead and constructs."
//   Preserve Life: "You can't use this feature on an undead or a construct."
//   Turn Undead, Intimidating Presence: a creature "that can see or hear
//     you": seesOrHears, asked by every turning (feature-spends.ts) and by
//     the menace (combat-features.ts).
//   Cleansing Touch: "one willing creature that you touch".
//   Bardic Inspiration: "one creature other than yourself within 60 feet of
//     you who can hear you".
//
// use_resource asks targetReachProblem once, after the counter's own gate and
// before anything is spent (resource-tools.ts), and the features resolved
// outside that path ask it themselves (mt-srd-paladin.ts). A counter whose
// text names a reach for its target gets a row here, not a check of its own.

import { getActiveBoard } from "@/lib/db/encounters";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { unseenBecause } from "@/lib/dm/authored-saves";
import { sheetCreatureType } from "@/lib/dm/summon-rules";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";

type Reach = { feet: number; touch?: true; hears?: true; living?: true };

const REACH: Record<string, Reach> = {
  lay_on_hands: { feet: 5, touch: true, living: true },
  cleansing_touch: { feet: 5, touch: true },
  bardic_inspiration: { feet: 60, hears: true },
};

// An undead or a construct, as a sheet says what it is: a summoned creature's
// record, a form worn (summon-rules.ts sheetCreatureType).
export function undeadOrConstruct(sheet: Parameters<typeof sheetCreatureType>[0]): boolean {
  return /undead|construct/i.test(sheetCreatureType(sheet));
}

// Whether a creature can see or hear the one calling on it: blind to them
// and deafened, it does neither. Hiding does not count: the call is loud.
export function seesOrHears(encounterId: string, creature: Parameters<typeof unseenBecause>[1], caller: Parameters<typeof unseenBecause>[2]): boolean {
  return !(unseenBecause(encounterId, creature, caller, { hidden: false }) && deafened(creature));
}

const deafened = (sheet: Pick<CharacterSheet, "conditions">) => sheet.conditions.some((entry) => isConditionNamed(entry, "deafened"));

// Why this counter cannot be spent on this creature, or null. Off the board
// nobody's place is known and the distance is the GM's.
export function targetReachProblem(
  campaignId: string,
  counter: { id: string; displayName: string },
  sheet: Pick<CharacterSheet, "id" | "name">,
  target: Pick<CharacterSheet, "id" | "name" | "conditions" | "summon" | "wildShape">,
): string | null {
  const reach = REACH[counter.id];
  if (reach?.living && undeadOrConstruct(target)) {
    return `${target.name} is ${sheetCreatureType(target)}, and ${counter.displayName} has no effect on undead and constructs.`;
  }
  if (!reach || target.id === sheet.id) {
    return null;
  }
  if (reach.hears && deafened(target)) {
    return `${target.name} is deafened and cannot hear ${sheet.name}, and ${counter.displayName} reaches a creature who can hear them.`;
  }
  const board = getActiveBoard(campaignId);
  const apart = board ? tilesBetween(board.id, sheet.id, target.id) : null;
  if (apart !== null && apart * 5 > reach.feet) {
    return reach.touch
      ? `${target.name} is ${apart * 5} feet from ${sheet.name}, and ${counter.displayName} is a touch: they must stand within 5 feet.`
      : `${target.name} is ${apart * 5} feet from ${sheet.name}, and ${counter.displayName} reaches a creature within ${reach.feet} feet.`;
  }
  return null;
}

// Why Cutting Words does nothing to a creature, or null: "The creature is
// immune if it can't hear you or if it's immune to being charmed."
export function cuttingWordsImmunity(foe: { conditions: string[]; stats: { conditionImmune?: unknown } } | null): string | null {
  if (!foe) {
    return null;
  }
  if (deafened(foe)) {
    return "is deafened and cannot hear the bard";
  }
  return /\bcharmed\b/i.test(String(foe.stats.conditionImmune ?? "")) ? "cannot be charmed" : null;
}
