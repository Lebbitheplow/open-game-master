// What a character holds before anyone has said. A sheet that marks nothing
// was read as holding every weapon it carries (src/lib/srd/armor.ts
// wearingIsExplicit), so the Hand offered each one as drawn, GAME STATE had
// no "in hand" line, and a storyteller asked to swing a quarterstaff decided
// for itself that a sling was out and put it away for the player. Every
// sheet now says: the armor and the shield the armor class counted and the
// worn rows whose magic counted stay on, as the first wear toggle keeps them
// (usage-rules.ts implicitlyWorn), and one weapon is in hand: the first the
// character is trained with that fits beside the shield (leaving a caster a
// hand free), and a second light blade beside a light main weapon, so a
// two-weapon fighter keeps both. A companion the storyteller plays is left
// as it was: it has no Hand, and its moves are the storyteller's to make.
// Everything else is packed, and drawing it is the turn's free object
// interaction (gear-hands.ts).
//
// Pure: no database. createSheet gives a new sheet these marks, and a fight
// starting gives them to a sheet saved before (db/encounters.ts).
import { gearKindOf, handsFor, weaponRowOf } from "@/lib/dm/gear-hands";
import { implicitlyWorn } from "@/lib/dm/usage-rules";
import type { EquipmentItem } from "@/lib/schemas/sheet";
import { wearingIsExplicit } from "@/lib/srd/armor";
import { isWeaponProficient } from "@/lib/srd/weapons";

// The pack with every row marked worn or not, or null when it already says
// (or carries nothing to say about).
export function defaultHeld(
  equipment: readonly EquipmentItem[],
  armor: { armorName: string | null; shieldName: string | null },
  weaponProfs: readonly string[],
  // A caster keeps a hand free for a spell's gestures (SRD 5.1, Somatic):
  // with a shield on the arm their weapon stays packed until they draw it.
  caster = false,
): EquipmentItem[] | null {
  if (!equipment.length || wearingIsExplicit(equipment)) {
    return null;
  }
  const worn = implicitlyWorn(equipment, armor);
  const shieldHand = [...worn].some((item) => gearKindOf(item) === "shield") ? 1 : 0;
  const room = caster ? 1 : 2;
  const trained = (item: EquipmentItem) => {
    const srd = weaponRowOf(item);
    return srd ? isWeaponProficient([...weaponProfs], srd) : false;
  };
  // Only a weapon they are trained with is taken up: one they are not stays
  // packed, as nothing says they would reach for it.
  const weapons = equipment.filter((item) => gearKindOf(item) === "weapon" && handsFor(item) + shieldHand <= room && trained(item));
  const [main = null] = weapons;
  const lightMelee = (item: EquipmentItem) => {
    const srd = weaponRowOf(item);
    return srd?.kind === "melee" && new Set(srd.properties ?? []).has("light");
  };
  const second = main && !shieldHand && !caster && lightMelee(main) ? (weapons.find((item) => item !== main && lightMelee(item)) ?? null) : null;
  return equipment.map((item) => ({ ...item, equipped: worn.has(item) || item === main || item === second }));
}
