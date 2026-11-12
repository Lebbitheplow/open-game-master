// Hit points a feature restores to a character, under the rules the heal tool
// keeps (src/lib/dm/mutations.ts "heal"): nobody dead, suffocating, gripped by
// Chill Touch or by negative energy regains any; a druid in a beast form heals
// the beast; exhaustion 4 and Pale Tincture lower the ceiling; and a dying
// character gets back up. Features that healed by writing currentHp straight
// (Turn the Tide, Balm of Peace, Preserve Life, Cauterizing Flames, a turn's
// own healing) skipped every one of these.

import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { healCeiling } from "@/lib/dm/afflictions";
import { healDeathHook } from "@/lib/dm/death";
import { healMath } from "@/lib/dm/mutation-math";
import { regainBlockedBy } from "@/lib/dm/vitals-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The hit points healing would raise: a beast form's while one holds.
export function healableHp(sheet: Pick<CharacterSheet, "currentHp" | "wildShape">, maxHp: number): { current: number; max: number } {
  return sheet.wildShape ? { current: sheet.wildShape.beastHp, max: sheet.wildShape.beastMaxHp } : { current: sheet.currentHp, max: maxHp };
}

// Whether the character can regain hit points at all right now.
export function canRegain(sheet: Pick<CharacterSheet, "conditions" | "currentHp" | "deathSaves">): boolean {
  return !sheet.deathSaves?.dead && regainBlockedBy(sheet) === null;
}

// The hit points regained (0 when blocked, dead or already full).
export function regainHitPoints(campaign: Campaign, turnId: string | null, target: CharacterSheet, amount: number, reason: string): number {
  const sheet = getSheetById(target.id) ?? target;
  if (amount <= 0 || !canRegain(sheet)) {
    return 0;
  }
  if (sheet.wildShape) {
    const shape = sheet.wildShape;
    const beast = healMath(shape.beastHp, shape.beastMaxHp, amount);
    const gained = beast.currentHp - shape.beastHp;
    if (gained > 0) {
      patchSheetAudited(campaign.id, sheet.id, { wildShape: { ...shape, beastHp: beast.currentHp } }, { kind: "heal", reason, delta: { amount: gained, form: shape.form, beastHp: beast.currentHp } });
    }
    return gained;
  }
  const ceiling = healCeiling(campaign.id, sheet);
  const math = healMath(Math.min(sheet.currentHp, ceiling), ceiling, amount);
  const gained = Math.max(0, math.currentHp - sheet.currentHp);
  if (gained <= 0) {
    return 0;
  }
  // Audited, so an undo of the turn takes the healing back with the use.
  patchSheetAudited(campaign.id, sheet.id, { currentHp: math.currentHp }, { kind: "heal", reason, delta: { amount: gained, newHp: math.currentHp } });
  healDeathHook(campaign, turnId, sheet);
  return gained;
}
