// Way of the Kensei's chosen weapons (wave 2, part mr). "Choose two kensei
// weapons ... and one more at 6th, 11th and 17th level; they count as monk
// weapons" (Path of the Kensei), and "Kensei weapons count as magical" (One
// with the Blade). The picks are the weapons chosen for the four features
// that grant one (src/lib/srd/subclass-training.ts), kept in the sheet's
// featChoices; nothing read them back, so a kensei's longsword swung as any
// fighter's and its blows stopped at resistance to nonmagical attacks.
//
// Pure. The attack profile (src/lib/dm/pc-attack-profile.ts) and the spends
// that ask for a kensei weapon (src/lib/dm/mt-mr-needs.ts) read it here.

import { textKey } from "@/lib/language/text-logic";
import { matchWeapon } from "@/lib/srd/weapons";
import { splitDamage } from "@/lib/dm/attack-logic";

// The features whose training grant picks a kensei weapon.
const KENSEI_GRANTS = ["path of the kensei", "one with the blade", "sharpen the blade", "unerring accuracy"];

type KenseiSheet = {
  featChoices?: Record<string, { weapons?: string[] } | undefined> | null;
  features?: ReadonlyArray<{ name: string }>;
  equipment?: ReadonlyArray<{ name: string; equipped?: boolean }>;
};

const holds = (sheet: KenseiSheet, feature: string) => (sheet.features ?? []).some((entry) => textKey(entry.name) === feature);

// The kensei weapons a sheet has chosen, as name keys. None for a sheet that
// does not hold Path of the Kensei.
export function kenseiWeapons(sheet: KenseiSheet): string[] {
  if (!holds(sheet, "path of the kensei")) {
    return [];
  }
  const out = new Set<string>();
  for (const [grant, picks] of Object.entries(sheet.featChoices ?? {})) {
    if (KENSEI_GRANTS.includes(textKey(grant))) {
      for (const weapon of picks?.weapons ?? []) {
        out.add(textKey(weapon));
      }
    }
  }
  return [...out];
}

// What the attack profile reads (attack-logic.ts AttackStance.kensei).
export function kenseiStance(sheet: KenseiSheet): { weapons: string[]; magical: boolean } | undefined {
  const weapons = kenseiWeapons(sheet);
  return weapons.length ? { weapons, magical: holds(sheet, "one with the blade") } : undefined;
}

// The kensei weapons in hand: the equipped items that are one of the picks,
// of a kind when one is asked ("a kensei melee weapon", Agile Parry).
export function kenseiHeld(sheet: KenseiSheet, kind?: "melee" | "ranged"): Array<{ name: string; damageType: string }> {
  const picks = kenseiWeapons(sheet);
  const out: Array<{ name: string; damageType: string }> = [];
  for (const item of sheet.equipment ?? []) {
    if (item.equipped === false) continue;
    // The weapon the item is, as the attack reads it (a "+1 Longsword" is a
    // longsword).
    const srd = matchWeapon(item);
    if (srd && picks.includes(textKey(srd.name)) && (!kind || srd.kind === kind)) {
      out.push({ name: item.name, damageType: splitDamage(srd.damage).type });
    }
  }
  return out;
}
