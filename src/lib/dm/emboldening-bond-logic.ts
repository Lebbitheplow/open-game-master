// Emboldening Bond (Peace Domain 1): "While bonded, a creature within 30 feet
// of another bonded creature can add a d4 to an attack roll, ability check or
// saving throw it makes, once per turn" (60 feet once the cleric holds
// Expansive Bond, 17th level). The die rides the roll as Bless's does; the
// turn it was spent in is kept on the bond itself (its meta's usedTurn), so a
// second roll of the same turn goes without it.
//
// Pure: the save and check door (src/lib/dm/forced-save.ts rollExtrasFor), the
// attack door (src/lib/dm/attack-roll-extras.ts) and their tests read it; the
// board is read in src/lib/dm/emboldening-bond.ts.
import type { ConditionMetaMap } from "@/lib/schemas/condition-meta";
import { isConditionNamed } from "@/lib/srd/feature-names";

export const BOND = "emboldening bond";
export const BOND_DIE = "1d4";
// The carrier a roll names in what it spent (rolls.ts spendInspiration):
// spending it stamps the turn on the bond, and takes no condition away.
export const BOND_SPEND = "emboldening bond:used";
export const BOND_FEET = 30;
export const EXPANSIVE_BOND_FEET = 60;

export type BondRider = { dice: string; note: string; spend: string };

type BondSheet = { conditions: string[]; conditionMeta?: ConditionMetaMap };

// The condition's name as the sheet writes it ("emboldening bond").
export function bondCondition(sheet: BondSheet): string | null {
  return sheet.conditions.find((entry) => isConditionNamed(entry, BOND)) ?? null;
}

// The die this roll may add: the roller is bonded, another bonded creature is
// within reach (`near`, read by the caller), and no roll of this turn
// (`turnKey`, null out of a fight, where no turns are counted) spent it yet.
export function bondRiderFor(sheet: BondSheet, near: boolean, turnKey: string | null): BondRider | null {
  const held = bondCondition(sheet);
  if (!held || !near) {
    return null;
  }
  if (turnKey && sheet.conditionMeta?.[held]?.usedTurn === turnKey) {
    return null;
  }
  return { dice: BOND_DIE, note: `Emboldening Bond: +${BOND_DIE}, once this turn`, spend: BOND_SPEND };
}

// The bond's meta once a roll of `turnKey` spent the die.
export function bondSpentMeta(sheet: BondSheet, turnKey: string | null): ConditionMetaMap | null {
  const held = bondCondition(sheet);
  if (!held || !turnKey) {
    return null;
  }
  const meta = sheet.conditionMeta ?? {};
  return { ...meta, [held]: { ...(meta[held] ?? {}), usedTurn: turnKey } };
}
