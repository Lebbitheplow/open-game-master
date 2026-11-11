// A Pact of the Blade warlock's pact weapon, and the invocations that ride it
// (issue #570, the SRD text audit, CLS-12 to CLS-14). SRD 5.1, warlock:
//
// - Pact of the Blade: "You can use your action to create a pact weapon in
//   your empty hand. You can choose the form that this melee weapon takes
//   each time you create it. You are proficient with it while you wield it.
//   This weapon counts as magical for the purpose of overcoming resistance
//   and immunity to nonmagical attacks and damage."
// - Thirsting Blade: "You can attack with your pact weapon twice, instead of
//   once, whenever you take the Attack action on your turn."
// - Lifedrinker: "When you hit a creature with your pact weapon, the
//   creature takes extra necrotic damage equal to your Charisma modifier
//   (minimum 1)."
//
// Which weapon is the pact weapon: the equipment row the feature marked
// (`pact`: the weapon it conjured, or a magic weapon its ritual bonded; a
// bonded weapon dismissed to its extradimensional space is "stowed" and in
// nobody's hand). Creating, dismissing and bonding are use_resource "Pact of
// the Blade" (src/lib/dm/mt-srd-warlock.ts). A sheet that carries no marked
// row at all is read as it was before the mark existed (issue #570, CLS-12 to
// CLS-14): the warlock's melee weapon is the pact weapon, so a table's blade
// from before keeps its magic and its second attack. Pure, for the attack
// engines and the turn budget.
import { chosenOptions } from "@/lib/srd/options";
import { matchWeapon } from "@/lib/srd/weapons";
import { textKey } from "@/lib/language/text-logic";
import type { EquipmentItem } from "@/lib/schemas/sheet";

type Features = { features: ReadonlyArray<{ name: string }> };

function holdsOption(sheet: Features, kind: "pact_boon" | "invocation", name: string): boolean {
  const wanted = textKey(name);
  return chosenOptions([...sheet.features], kind).some((option) => textKey(option) === wanted);
}

export function holdsPactOfTheBlade(sheet: Features): boolean {
  return holdsOption(sheet, "pact_boon", "Pact of the Blade");
}

type Wielder = Features & { equipment: ReadonlyArray<EquipmentItem> };

// The marks the feature leaves on a weapon's row (src/lib/schemas/sheet.ts).
const isWeaponMark = (mark: string | undefined) => mark === "bonded" || mark === "stowed" || (mark ?? "").startsWith("conjured:");

// Whether the weapon carried under this name is the warlock's pact weapon.
// `melee`: what a sheet with no marked row is held to (the reading above); a
// bonded magic weapon is the pact weapon whatever its kind.
export function isPactWeapon(sheet: Wielder, weaponName: string, melee: boolean): boolean {
  if (!holdsPactOfTheBlade(sheet)) {
    return false;
  }
  const marked = sheet.equipment.filter((item) => isWeaponMark(item.pact));
  if (!marked.length) {
    return melee;
  }
  return marked.some((item) => item.pact !== "stowed" && textKey(item.name) === textKey(weaponName));
}

// Whether a weapon attack is made with the pact weapon: a melee weapon (not
// an unarmed strike or an improvised one) in a Pact of the Blade warlock's
// hand.
export function pactWeaponAttack(
  sheet: Wielder,
  kind: "weapon" | "spell" | "natural" | "granted",
  profile: { weapon: string; ranged: boolean; unarmed?: boolean; improvised: boolean },
): boolean {
  return kind === "weapon" && !profile.unarmed && !profile.improvised && isPactWeapon(sheet, profile.weapon, !profile.ranged);
}

// Thirsting Blade's second attack: the warlock holds the invocation and a
// melee weapon to make it with. Extra Attack features do not add together,
// so the caller takes the larger.
export function thirstingBladeAttacks(sheet: Features & { equipment: ReadonlyArray<EquipmentItem> }): number {
  if (!holdsOption(sheet, "invocation", "Thirsting Blade") || !holdsPactOfTheBlade(sheet)) {
    return 0;
  }
  return sheet.equipment.some((item) => item.equipped === true && isPactWeapon(sheet, item.name, matchWeapon(item)?.kind === "melee") && Boolean(matchWeapon(item))) ? 1 : 0;
}

// Lifedrinker's necrotic rider on a pact weapon hit: the Charisma modifier,
// at least 1. Null without the invocation.
export function lifedrinkerDamage(sheet: Features & { abilities: { cha: number } }): number | null {
  if (!holdsOption(sheet, "invocation", "Lifedrinker")) {
    return null;
  }
  return Math.max(1, Math.floor((sheet.abilities.cha - 10) / 2));
}
