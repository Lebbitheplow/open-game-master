// The feats that move the armor class while something is held, read by the
// one armor class computation (src/lib/srd/index.ts acBreakdownFor), so the
// sheet, the builder and every attack see the same number.
//
// Pure.
import { holdsFeat } from "@/lib/srd/feat-effects";
import { matchWeapon } from "@/lib/srd/weapons";

type Held = { name: string; equipped?: boolean; qty?: number };

// Dual Wielder: "You gain +1 AC while wielding a separate melee weapon in
// each hand." Two melee weapons held (equipped), neither two-handed: two of
// one row with a quantity of two count as a pair.
export function dualWielderAcBonus(source: { feats?: string[]; features?: Array<{ name: string }>; equipment: Held[] }): number {
  if (!holdsFeat(source, "Dual Wielder")) {
    return 0;
  }
  let hands = 0;
  for (const item of source.equipment) {
    if (!item.equipped) continue;
    const weapon = matchWeapon(item);
    if (weapon?.kind === "melee" && !(weapon.properties ?? []).includes("two-handed")) {
      hands += Math.max(1, item.qty ?? 1);
    }
  }
  return hands >= 2 ? 1 : 0;
}
