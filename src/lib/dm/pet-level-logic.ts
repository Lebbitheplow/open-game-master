// A bonded creature's numbers that follow its owner's level, kept up at each
// level-up (src/lib/srd/level-up.ts buildLevelUp). Ranger's Companion: "Add
// your proficiency bonus to the beast's AC, attack rolls, and damage rolls,
// as well as to any saving throws and skills it is proficient in. Its hit
// point maximum equals its normal maximum or four times your ranger level,
// whichever is higher." Drake Companion: its hit points are 5 + five times
// the ranger's level, its bite's bonus the ranger's proficiency bonus, and
// its wings and its bite's extra dice come with the ranger's 7th and 15th
// levels. summon_pet wrote those numbers once, so a 3rd-level ranger's wolf
// kept 12 hit points and its +2 to the end of the campaign. Pure.

import { buildPet } from "@/lib/dm/pet-build";
import { proficiencyBonusOf } from "@/lib/srd/proficiency";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";

// What a level-up does to the owner's companion and drake: the numbers the
// bond reads from the owner's level built again, the creature itself (its
// name, its wounds, its conditions) kept. A raised hit point maximum raises
// its current hit points by as much, as a character's own level does; one
// at 0 stays down. The same list back when nothing follows the level.
export function petsAtLevel(before: CharacterSheet, after: CharacterSheet): SheetPet[] {
  if (!before.pets?.length) {
    return before.pets;
  }
  const lift = proficiencyBonusOf(after) - proficiencyBonusOf(before);
  let changed = false;
  const pets = before.pets.map((pet) => {
    if (pet.kind !== "beast_companion" && pet.kind !== "drake") {
      return pet;
    }
    const fresh = buildPet(after, { kind: pet.kind, form: pet.form, name: pet.name, ...(pet.immune ? { essence: pet.immune } : {}) });
    if ("error" in fresh) {
      return pet;
    }
    const gained = fresh.maxHp - pet.maxHp;
    const next: SheetPet = {
      ...fresh,
      ...(pet.creatureType ? { creatureType: pet.creatureType } : {}),
      hp: pet.hp > 0 ? Math.max(1, Math.min(fresh.maxHp, pet.hp + gained)) : 0,
      // Its skills came from its published block (summon_pet's blockSkills),
      // each with the bonus added: they rise with the bonus.
      ...(pet.skills ? { skills: Object.fromEntries(Object.entries(pet.skills).map(([skill, bonus]) => [skill, bonus + lift])) } : {}),
      // What it is doing and what holds it are its own, not the bond's.
      ...(pet.conditions ? { conditions: pet.conditions } : {}),
      ...(pet.conditionMeta ? { conditionMeta: pet.conditionMeta } : {}),
    };
    if (!pet.conditions) {
      delete next.conditions;
    }
    if (JSON.stringify(next) === JSON.stringify(pet)) {
      return pet;
    }
    changed = true;
    return next;
  });
  return changed ? pets : before.pets;
}
