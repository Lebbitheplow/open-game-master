// The pure half of the party's charges (party-charge.ts plays them): the
// block a sheet or pet fights as, the turn's marks, the bonus attack a pounce
// opened, and the blow with a charge's extra dice. No database, so the
// bonus-attack check (feature-bonus-attacks.ts) asks it in its refusal pass.

import type { TurnBudget } from "@/lib/dm/action-budget";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import { chargeBonusOf, type ChargeTrait } from "@/lib/dm/charge-logic";
import { pickNaturalAttack } from "@/lib/dm/natural-attack";
import { textKey } from "@/lib/language/text-logic";
import { findBeastForm, findShapeForm } from "@/lib/srd/beast-forms";
import type { CreatureAttack } from "@/lib/srd/creature-attacks";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";

export type Traits = { fullTraits: string[] };

// The turn's marks, on the owner's turn budget: the charge spent, and the
// creature a pounce left prone. `who` names the creature that charged: the
// sheet's own name, or the pet's.
export const chargeSpentKey = (who: string) => `party-charge:${textKey(who)}`;
export const pouncedKey = (who: string, enemyId: string) => `party-pounced:${textKey(who)}:${enemyId}`;
// A pet's pounce bite, its own bonus action (a sheet's is the bonus action
// its turn budget keeps).
export const petPounceKey = (pet: string) => `party-pounce-bonus:${textKey(pet)}`;

function blockNamed(name: string | undefined): Traits | null {
  const form = name ? findShapeForm(name) : null;
  return form?.traitLines.length ? { fullTraits: form.traitLines } : null;
}

// The block a sheet fights as: the form it wears, else the creature a spell
// made it (pc-attack-profile.ts reads its attacks in the same order).
export function sheetBlock(sheet: Pick<CharacterSheet, "wildShape" | "summon">): Traits | null {
  return blockNamed(sheet.wildShape?.form ?? sheet.summon?.form);
}

export function petBlock(pet: Pick<SheetPet, "form">): Traits | null {
  return blockNamed(pet.form);
}

// The natural attack's own name ("Claw") a call names on the sheet's form or
// creature, which the trait names; null for any other attack.
export function sheetNaturalName(sheet: Pick<CharacterSheet, "wildShape" | "summon">, weapon: string | undefined): string | null {
  const attacks: Array<{ name: string }> = sheet.wildShape ? (sheet.wildShape.attacks ?? findBeastForm(sheet.wildShape.form)?.attacks ?? []) : (sheet.summon?.attacks ?? []);
  return pickNaturalAttack(attacks, weapon)?.name ?? null;
}

// The pounce's bonus attack this call is, or null: the trait names the
// attack, and its charge left this creature prone this turn.
export function pounceOpen(budget: TurnBudget | null, block: Traits | null, attack: string | null, who: string, enemy: { id: string; conditions: string[] } | null): ChargeTrait | null {
  if (!budget || !block || !attack || !enemy || !budget.oncePerTurn.includes(pouncedKey(who, enemy.id)) || !enemy.conditions.includes("prone")) {
    return null;
  }
  return chargeBonusOf(block, attack);
}

// The blow with the charge's extra dice: of the attack's own type (or none
// named) they fold into its dice, doubled on a critical like the rest;
// another type rides as its own part, meeting its own resistance.
export function withChargeProfile(profile: AttackProfile, trait: ChargeTrait): AttackProfile {
  if (!trait.extra) {
    return profile;
  }
  const { dice, type } = trait.extra;
  const damageExpression = `${profile.damageExpression}+${dice}`;
  return !type || type === textKey(profile.damageType)
    ? { ...profile, damageExpression }
    : { ...profile, damageExpression, gearTyped: [...(profile.gearTyped ?? []), { dice, type }] };
}

export function withChargeAttack<A extends Pick<CreatureAttack, "damage" | "type" | "riders">>(attack: A, trait: ChargeTrait): A {
  if (!trait.extra) {
    return attack;
  }
  const { dice, type } = trait.extra;
  return !type || type === textKey(attack.type) ? { ...attack, damage: `${attack.damage}+${dice}` } : { ...attack, riders: [...(attack.riders ?? []), { dice, type }] };
}
