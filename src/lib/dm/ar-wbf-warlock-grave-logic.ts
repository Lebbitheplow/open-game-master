// Grave Touched (Undead patron 6): "Once on each of your turns, when you hit
// a creature with an attack roll and roll damage, you can make that damage
// necrotic, and while in Form of Dread you roll one additional damage die."
// Before this the row was narrated: the GM changed the type and added the die
// by hand, and pc_attack read damageType for a spell alone.
//
// Two halves, one once-a-turn mark ("rider:grave touched"):
// - the die: in Form of Dread the turn's first hit rolls one more of the
//   attack's own damage die. It is a damage rider like any other, so
//   attack-damage-riders.ts hands it to pc_attack and to the Hand's attack
//   card alike, and claimOncePerTurnRiders drops it from a second hit.
// - the type: the player's choice ("you can"), asked with pc_attack's
//   damageType "necrotic". The hit that carries the turn's mark deals its
//   weapon's or spell's own damage as necrotic; a second hit keeps its type.
//
// Pure: no database, so the Hand imports it.
import { claimOncePerTurn, type TurnBudget } from "@/lib/dm/action-budget";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import type { CombatRiders } from "@/lib/srd/feature-effects";
import { holdsFeature } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";

export const GRAVE_TOUCHED = "Grave Touched";
// The key claimOncePerTurnRiders writes for this rider (pc-attack-damage.ts).
const GRAVE_KEY = "rider:grave touched";
const DREAD = "form of dread";

type GraveSheet = { features?: ReadonlyArray<{ name: string }>; feats?: readonly string[]; conditions: string[] };

const inDread = (sheet: GraveSheet) => sheet.conditions.some((entry) => textKey(entry) === DREAD);

// The one additional damage die of a hit in Form of Dread: the attack's own
// die (a longsword's d8, Eldritch Blast's d10), of the hit's own type.
export function graveTouchedDie(sheet: GraveSheet, profile: Pick<AttackProfile, "damageExpression">): Array<CombatRiders["damageRiders"][number]> {
  if (!holdsFeature(sheet, GRAVE_TOUCHED) || !inDread(sheet)) {
    return [];
  }
  const die = /\d*d(\d+)/i.exec(profile.damageExpression);
  return die ? [{ feature: GRAVE_TOUCHED, dice: `1d${die[1]}`, type: "", when: "attack", oncePerTurn: true }] : [];
}

// The asked-for change of type, after the turn's once-a-turn riders were
// claimed (pc-attack-plan.ts). `budget` is null out of a fight, where no turn
// counts the hits.
export function graveTouchedType<P extends Pick<AttackProfile, "damageType">>(input: {
  sheet: GraveSheet;
  profile: P;
  asked: string | undefined;
  budget: TurnBudget | null;
  hitClaims: string[];
  notes: string[];
}): { profile: P; hitClaims: string[] } {
  const { sheet, profile, hitClaims, notes } = input;
  if (textKey(input.asked ?? "") !== "necrotic" || profile.damageType === "necrotic" || !holdsFeature(sheet, GRAVE_TOUCHED)) {
    return { profile, hitClaims };
  }
  const refused = () => {
    notes.push(`${GRAVE_TOUCHED} already used this turn: the damage keeps its type`);
    return { profile, hitClaims };
  };
  let claims = hitClaims;
  if (inDread(sheet)) {
    // The die's claim is the turn's mark: no die left, no change either.
    if (input.budget && !hitClaims.includes(GRAVE_KEY)) {
      return refused();
    }
  } else if (input.budget) {
    if (!claimOncePerTurn(input.budget, GRAVE_KEY)) {
      return refused();
    }
    claims = [...hitClaims, GRAVE_KEY];
  }
  notes.push(`${GRAVE_TOUCHED}: this hit's damage is necrotic`);
  return { profile: { ...profile, damageType: "necrotic" }, hitClaims: claims };
}
