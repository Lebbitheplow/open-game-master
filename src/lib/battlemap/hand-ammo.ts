// The Hand's pick of magic ammunition on a weapon's card (SRD 5.1,
// Ammunition, +1, +2, or +3: "You have a bonus to attack and damage rolls
// made with this piece of magic ammunition"). A shot fires ordinary
// ammunition unless it names the magic line (pc_attack `ammo`,
// src/lib/srd/ammunition.ts namedAmmo), so the card asks only when the hero
// carries magic ammunition the weapon can fire, ordinary first. The pick
// rides the intent's `item`, which the attack card sends as `ammo`
// (src/lib/dm/intent-logic.ts).
//
// Pure, so the Hand and the test scripts read the same pick.

import type { HandChoice } from "@/lib/battlemap/hand-core";
import { AMMO_LABELS, ammoKindForWeapon, magicAmmoFor } from "@/lib/srd/ammunition";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function ammoChoice(equipment: CharacterSheet["equipment"], weaponBase: string | undefined): HandChoice | null {
  const kind = ammoKindForWeapon(weaponBase);
  const magic = magicAmmoFor(equipment, weaponBase);
  if (!kind || !magic.length) {
    return null;
  }
  return {
    arg: "item",
    label: "Ammunition",
    options: [
      { value: "", label: `Ordinary ${AMMO_LABELS[kind]}`, note: `Fire ordinary ${AMMO_LABELS[kind]}.` },
      ...magic.map((line) => ({ value: line.name, label: `${line.name} (${line.count})`, note: `+${line.bonus} to hit and damage on this shot. One is spent.` })),
    ],
    fallback: "",
  };
}
