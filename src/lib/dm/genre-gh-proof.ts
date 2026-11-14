// Proof (parapsychologist 20): "1/long rest, your next apparatus spell is
// cast at maximum effect and cannot be resisted by legendary resistance"
// (cc1113 genre-c pass). The spend lays the mark for the turn
// (src/lib/srd/authored-effects-genre-gh.ts); while it holds, the spell's
// damage is its maximum (src/lib/dm/genre-a-casts.ts genreCastsAtMaximum,
// read by cast-at-enemy.ts, aoe-spell.ts and pc-attack-plan.ts), and a
// legendary creature spends no resistance on its save (cast-at-enemy.ts,
// aoe-damage.ts ask proofUnresisted). The Rite Completed is below. Pure.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";

export const PROOF = "proof";

export function proofHeld(sheet: Pick<CharacterSheet, "conditions"> | null | undefined): boolean {
  return Boolean(sheet?.conditions.some((entry) => isConditionNamed(entry, PROOF)));
}

// Whether a legendary creature may spend a resistance on this caster's spell.
export function proofUnresisted(resist: boolean, caster: Pick<CharacterSheet, "conditions"> | null | undefined): boolean {
  return resist && !proofHeld(caster);
}

// The Rite Completed (apostate 14): "1/long rest, for 1 minute your
// stigmata cost no verbal or somatic components and cannot be
// counterspelled": while the minute's mark holds, a silence or bound hands
// stop none of the apostate's spells (src/lib/dm/cast-guard.ts), and no
// enemy's Counterspell is tried on them (src/lib/dm/enemy-reactions.ts
// enemyCounterspell). A material component is still the material plan's.
export const RITE_COMPLETED = "the rite completed";

export function riteCompleted(sheet: { conditions: readonly string[] } | null | undefined): boolean {
  return Boolean(sheet?.conditions.some((entry) => isConditionNamed(entry, RITE_COMPLETED)));
}
