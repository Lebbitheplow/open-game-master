// The weapon a character swings as an opportunity attack (opportunity.ts
// resolvePcOpportunityWalk), and the grip it is swung in
// (opportunity-strike.ts). The reaction is "one melee attack against the
// provoking creature" (SRD 5.1, Opportunity Attacks): the best melee weapon
// the hands can use, as the turn's swing picks one with no weapon named
// (attack-logic.ts resolveAttackWeapon), else an unarmed strike, which is a
// melee attack too.

import { resolveAttackWeapon, weaponOf, type ResolvedWeapon } from "@/lib/dm/attack-logic";
import { magicWeaponOfRow } from "@/lib/dm/gear-attack";
import { matchWeapon } from "@/lib/srd/weapons";
import { acBreakdownFor } from "@/lib/srd";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const UNARMED: ResolvedWeapon = { displayName: "Unarmed strike", srd: null, unarmed: true, carried: true };

// The best melee weapon carried, one-handed beside a shield; a magic weapon
// is its base weapon (a Flame Tongue is a longsword, gear-attack.ts). A
// character carrying only a bow strikes unarmed: SRD 5.1, Unarmed Strike,
// "1 + your Strength modifier". It made no opportunity attack at all, though
// one carrying nothing struck unarmed.
export function opportunityWeaponFor(sheet: CharacterSheet): ResolvedWeapon {
  const melee = sheet.equipment.filter((item) => {
    const weapon = magicWeaponOfRow(item).srd ?? weaponOf(item) ?? matchWeapon(item);
    return weapon !== null && weapon.kind === "melee";
  });
  if (!melee.length) {
    return UNARMED;
  }
  return resolveAttackWeapon(melee, sheet.proficiencies.weapons, undefined, {
    shieldOnArm: acBreakdownFor(sheet).shieldName !== null,
  });
}
