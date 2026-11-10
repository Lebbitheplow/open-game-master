// What a caster's own features add to a spell's damage (SRD 5.1):
//
//   Empowered Evocation (wizard, School of Evocation 10): the Intelligence
//     modifier is added to one damage roll of a wizard evocation spell.
//   Elemental Affinity (sorcerer, Draconic Bloodline 6): the Charisma
//     modifier is added to one damage roll of a spell dealing the damage type
//     of the sorcerer's dragon ancestor, or of the element a workshop
//     subclass's choice names (src/lib/srd/chosen-element.ts).
//   Potent Cantrip (wizard, School of Evocation 6): a creature that succeeds
//     on its save against the wizard's cantrip still takes half its damage.
//
// Pure: the sheet and what the spell is come in as values, so the cast tools
// (cast_at_enemy, aoe_damage) and pc_attack share one answer.

import { authoredSpellDice } from "@/lib/srd/authored-effects-more";
import { holdsFeature } from "@/lib/srd/feature-names";
import { chosenElementType } from "@/lib/srd/dragon-ancestor";

type Caster = {
  class: string;
  level: number;
  classes?: Array<{ id: string; level: number }>;
  features: Array<{ name: string; classId?: string }>;
  abilities: Record<"str" | "dex" | "con" | "int" | "wis" | "cha", number>;
  // For the subclass features that read them (Enhanced Bond's spirit, Arcane
  // Firearm's wand): src/lib/srd/authored-effects-more.ts.
  conditions?: string[];
  equipment?: Array<{ name: string; equipped?: boolean }>;
};

const mod = (score: number) => Math.floor((score - 10) / 2);

// The sorcerer's dragon, read in one place (src/lib/srd/dragon-ancestor.ts).
export { dragonAncestorType } from "@/lib/srd/dragon-ancestor";

export type SpellDamageRiders = {
  // Added once to the spell's damage total.
  flat: number;
  // Added once as well, to a two-type spell's second type, so it meets that
  // type's resistance (Elemental Affinity's cold on Ice Storm).
  flatSecond: number;
  // Dice added to the spell's damage roll (Enhanced Bond, Arcane Firearm).
  dice: string[];
  // Dice only a two-type spell's second type earned (Enhanced Bond on a
  // spell whose fire is its second type): they deal that type.
  diceSecond: string[];
  // The part of `flat` / `flatSecond` that lands on one target only (Radiant
  // Soul): an area spell gives it to its first creature alone (aoe-spell.ts).
  oneTarget: { first: number; second: number };
  // A successful save against this cantrip still takes half.
  potentCantrip: boolean;
  notes: string[];
};

export function spellDamageRiders(
  sheet: Caster,
  spell: {
    school?: string | null;
    damageType?: string | null;
    // The second type of a spell that deals two at once.
    secondType?: string | null;
    level: number;
    // The classes whose lists carry the spell, lowercased.
    classes?: string[];
  },
): SpellDamageRiders {
  const riders: SpellDamageRiders = { flat: 0, flatSecond: 0, dice: [], diceSecond: [], oneTarget: { first: 0, second: 0 }, potentCantrip: false, notes: [] };
  const school = (spell.school ?? "").toLowerCase();
  const wizardSpell = !spell.classes?.length || spell.classes.includes("wizard");
  if (school === "evocation" && wizardSpell && holdsFeature(sheet, "empowered evocation")) {
    const bonus = mod(sheet.abilities.int);
    if (bonus > 0) {
      riders.flat += bonus;
      riders.notes.push(`Empowered Evocation: +${bonus} (Intelligence)`);
    }
  }
  // The dragon's damage type, or a workshop bloodline's chosen element
  // (issue #833: a "Storm" option dealing lightning).
  const ancestor = chosenElementType(sheet);
  const isAncestor = (type: string | null | undefined) => Boolean(ancestor && type && type.toLowerCase() === ancestor);
  const firstMatches = isAncestor(spell.damageType);
  if ((firstMatches || isAncestor(spell.secondType)) && holdsFeature(sheet, "elemental affinity")) {
    const bonus = mod(sheet.abilities.cha);
    if (bonus > 0) {
      // A spell that deals the type as its second counts (a cold dragon's Ice
      // Storm): it read the first type alone and added nothing.
      if (firstMatches) {
        riders.flat += bonus;
      } else {
        riders.flatSecond += bonus;
      }
      riders.notes.push(`Elemental Affinity: +${bonus} ${ancestor} (Charisma)`);
    }
  }
  if (spell.level === 0 && holdsFeature(sheet, "potent cantrip")) {
    riders.potentCantrip = true;
  }
  // The subclass features that add a die to the spell's damage.
  const mods = Object.fromEntries(Object.entries(sheet.abilities).map(([key, score]) => [key, mod(score)]));
  const authored = authoredSpellDice(sheet, { damageType: spell.damageType, secondType: spell.secondType, level: spell.level }, mods);
  riders.dice.push(...authored.dice);
  riders.diceSecond.push(...authored.diceSecond);
  for (const one of authored.oneTarget) {
    riders.oneTarget[one.second ? "second" : "first"] += one.amount;
    riders[one.second ? "flatSecond" : "flat"] += one.amount;
  }
  riders.notes.push(...authored.notes);
  return riders;
}
