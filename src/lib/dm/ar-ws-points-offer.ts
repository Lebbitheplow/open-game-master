// What a casting may be paid with in sorcery points: the pure half of
// ar-ws-points-cast.ts (read its header for the two features and the rule).
// Kept apart so the Hand's spell card (src/lib/battlemap/hand-spells.ts) asks
// the same offer the cast guard does without importing the database modules
// the guard's side needs.
//
// Pure.

import { hasName, namesOf } from "@/lib/dm/cast-rules";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature } from "@/lib/srd/feature-names";
import { subclassSpellsFor } from "@/lib/srd/features";
import { classLevelFor } from "@/lib/srd/multiclass";
import type { SpellFacts } from "@/lib/srd/spell-facts";

export const POOL = "sorcery_points";

export type PointsOffer = {
  feature: string;
  points: number;
  // The level the spell is cast at: its own.
  level: number;
  // Cast with no verbal, somatic or material component (Psionic Sorcery).
  bare: boolean;
  // Its caster sees through the area it lays (Eyes of the Dark).
  seesThrough: boolean;
  // The points pay even while a slot could (see the header).
  first: boolean;
};

export function pointsLeft(sheet: Pick<CharacterSheet, "resources">): number {
  const state = sheet.resources?.[POOL];
  return state ? state.max - state.used : 0;
}

// What a casting of this spell may be paid with in points, or null: the
// caster holds no such feature, the spell is not the feature's, or a higher
// slot level was named (the points cast it at its own level).
export function pointsOfferFor(sheet: CharacterSheet, engine: string, facts: SpellFacts | null, named: number | undefined): PointsOffer | null {
  if (!facts || facts.level < 1 || !sheet.resources?.[POOL]) {
    return null;
  }
  if (named !== undefined && named > 0 && named !== facts.level) {
    return null;
  }
  const level = classLevelFor(sheet, "sorcerer") || sheet.level;
  if (textKey(engine) === "darkness" && level >= 3 && holdsFeature(sheet, "Eyes of the Dark")) {
    return { feature: "Eyes of the Dark", points: 2, level: facts.level, bare: false, seesThrough: true, first: named === undefined };
  }
  if (holdsFeature(sheet, "Psionic Sorcery")) {
    // The table writes a spell under the name its book gives ("Evard's Black
    // Tentacles"), the content under the SRD's ("Black Tentacles"): any of the
    // spell's names answers.
    // With the sheet's features: a psionic spell replaced at a level-up gives
    // way to the one swapped in (ar-ws-spell-swap-record.ts).
    if (hasName(subclassSpellsFor("sorcerer", "Aberrant Mind", level, undefined, sheet.features), namesOf(engine, facts))) {
      return { feature: "Psionic Sorcery", points: facts.level, level: facts.level, bare: true, seesThrough: false, first: false };
    }
  }
  return null;
}

// The spell with no component to make: nothing to say, no gesture, no
// material to hold or pay for.
export function bareFacts(facts: SpellFacts | null): SpellFacts | null {
  return facts ? { ...facts, verbal: false, somatic: false, material: false, materialCostGp: null, materialConsumed: false, materialText: "" } : facts;
}

// The Hand's reading of the rule the cast guard keeps (cast-guard.ts
// castSpell): the offer that pays for this card's casting, or null when a slot
// does. The points pay when the caster cannot make the spell's components and
// the offer casts it bare (`components`: a hand, a voice in a Silence or a
// material is missing), or when no slot can pay (`slot`), and only while the
// points are there. A card the points pay for is shut by none of those.
export function pointsForCard(
  sheet: CharacterSheet,
  engine: string,
  facts: SpellFacts | null,
  named: number | undefined,
  missing: { components: boolean; slot: boolean },
): PointsOffer | null {
  const offer = pointsOfferFor(sheet, engine, facts, named);
  if (!offer || pointsLeft(sheet) < offer.points) {
    return null;
  }
  return (offer.bare && missing.components) || missing.slot ? offer : null;
}
