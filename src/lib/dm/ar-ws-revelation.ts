// Revelation in Flesh (Aberrant Mind sorcerer, 14th level), the two benefits
// that are read where something else is decided:
//
//   "you see any invisible creature within 60 feet that isn't behind total
//    cover" (the condition "revelation in flesh (see)")
//   "you can squeeze through a space as narrow as an inch and spend 5 feet of
//    movement to escape nonmagical restraints or a grapple" (the condition
//    "revelation in flesh (squeeze)")
//
// The flying and swimming speeds are authored effects
// (src/lib/srd/authored-effects-data4.ts). Here: the reach of the sight, as a
// sense the one sight rule reads (attack-light.ts characterSenses and
// sensesReaching, which every attack roll, "a creature you can see" and
// opportunity attack asks), and what the slip would end on a sheet
// (ar-ws-squeeze.ts ends it at take_action escape; the Hand's Escape card
// reads the same answer, src/lib/battlemap/hand.ts).
//
// Pure: no database, so the Hand may read it.
import { instancesOf, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";

export const REVELATION_SEE = "revelation in flesh (see)";
export const REVELATION_SQUEEZE = "revelation in flesh (squeeze)";
// "within 60 feet", in squares.
const SEE_TILES = 12;
// "spend 5 feet of movement", in squares.
export const SQUEEZE_TILES = 1;

// A sense that shows the invisible and nothing more, in squares: it lights no
// darkness and reads no illusion, so it is no truesight.
export type UnveilingSense = { unveils?: number };

export function revelationSightTiles(conditions: readonly string[] | undefined): number {
  return (conditions ?? []).some((entry) => isConditionNamed(entry, REVELATION_SEE)) ? SEE_TILES : 0;
}

// Whether the sense shows an invisible creature `apart` squares off: within
// its reach, and with a clear line (no line is total cover, SRD 5.1, Cover).
// Off a board (`apart` null) nothing is measured and the sense holds.
export function unveilsAt(tiles: number, apart: number | null, clearLine: boolean): boolean {
  return tiles > 0 && (apart === null || (apart <= tiles && clearLine));
}

export type SqueezeHold =
  // A grapple, whoever holds it.
  | { kind: "grapple"; condition: string }
  // A restraint no spell laid: a net, a trap's, a creature's own coils or web.
  | { kind: "restraint"; condition: string }
  // Held by a spell's restraint alone: the slip does not end it.
  | { kind: "spell"; condition: string; spell: string };

type Held = { conditions: string[]; conditionMeta?: unknown };

// A restraint is a spell's when its instance names the spell that laid it
// (set-condition.ts and the cast tools write `spell`); every other restraint
// is taken as nonmagical, which is what a net, a trap or a creature's grip is.
export const spellRestraint = (entry: { spell?: string }): boolean => Boolean(entry.spell?.trim());

// What a sorcerer in the squeezing form could slip now, or null when they do
// not hold the form or nothing holds them: the grapple first, then a
// nonmagical restraint; a spell's restraint is named so the caller can say
// why the slip did not answer.
export function squeezeHoldOf(sheet: Held): SqueezeHold | null {
  if (!sheet.conditions.some((entry) => isConditionNamed(entry, REVELATION_SQUEEZE))) {
    return null;
  }
  const grappled = sheet.conditions.find((entry) => isConditionNamed(entry, "grappled"));
  if (grappled) {
    return { kind: "grapple", condition: grappled };
  }
  const restrained = sheet.conditions.find((entry) => isConditionNamed(entry, "restrained"));
  if (!restrained) {
    return null;
  }
  const held = instancesOf((sheet.conditionMeta as ConditionMetaMap | undefined)?.[restrained]);
  if (held.some((entry) => !spellRestraint(entry))) {
    return { kind: "restraint", condition: restrained };
  }
  return { kind: "spell", condition: restrained, spell: held.find(spellRestraint)?.spell ?? "a spell" };
}

// The slip the Hand's Escape card and take_action escape both offer: a hold
// the form ends for 5 feet of movement, with no action and no check.
export function squeezeSlips(sheet: Held): Extract<SqueezeHold, { kind: "grapple" | "restraint" }> | null {
  const hold = squeezeHoldOf(sheet);
  return hold && hold.kind !== "spell" ? hold : null;
}
