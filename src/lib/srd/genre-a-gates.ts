// The gates the cyberpunk, dark fantasy and horror classes' passive rows add
// to the authored layer's (authored-effects.ts gateHolds calls this for every
// row, so a gate is never read at one door and not another):
//   belowQuarter: Ecstatic Fury's "while below one quarter HP";
//   dualWield: Twin Chrome's "+1 AC while dual-wielding", two weapons in hand.
// Pure: the sheet alone.
import type { Gate } from "@/lib/srd/authored-effects-types";
import { matchWeapon } from "@/lib/srd/weapons";
import type { RowItem } from "@/lib/srd/item-row";

type GateSheet = {
  currentHp?: number | null;
  maxHp?: number | null;
  equipment?: ReadonlyArray<RowItem & { equipped?: boolean; qty?: number }> | null;
};

// Weapons in hand: equipped items that are weapons, each of a pair counted.
export function weaponsInHand(sheet: GateSheet): number {
  let held = 0;
  for (const item of sheet.equipment ?? []) {
    if (item.equipped && matchWeapon(item)) {
      held += Math.max(1, Math.min(2, item.qty ?? 1));
    }
  }
  return held;
}

export function genreGateHolds(gate: Gate, sheet: GateSheet): boolean {
  if (gate.belowQuarter && !((sheet.currentHp ?? 0) < (sheet.maxHp ?? 0) / 4)) {
    return false;
  }
  if (gate.dualWield && weaponsInHand(sheet) < 2) {
    return false;
  }
  return true;
}
