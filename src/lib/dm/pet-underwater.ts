// Underwater combat (SRD 5.1, Combat: Underwater Combat) for the creatures
// that stand in a character's square: a pet (ruling D2, pet-place.ts) and a
// mount. The rule itself is underwater.ts's; this answers the two questions
// a pet's doors could not ask, having no token: whether the pet is in the
// water (its owner's square is), and whether it has a swimming speed (its
// block's). Before this a mastiff bit at full odds from the bottom of a
// pool, a creature's club at a pet or a mount swung at full odds from the
// water, and a familiar in the water took a fire bolt whole, while the
// hero beside them was held to all three.

import { findTableMonster } from "@/lib/bestiary/homebrew-monsters";
import type { EnemyAttack } from "@/lib/bestiary/statblock";
import { swimsFrom } from "@/lib/battlemap/types";
import type { Campaign } from "@/lib/db/campaigns";
import type { EncounterEnemy } from "@/lib/db/encounters";
import type { SheetPet } from "@/lib/schemas/sheet";
import { findShapeForm } from "@/lib/srd/beast-forms";
import { weaponNamed } from "@/lib/srd/weapons";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { immersedResistance, isImmersed, underwaterSwing, type UnderwaterSwing } from "@/lib/dm/underwater";
import { petPlaceOf } from "@/lib/dm/pet-place";

// A pet's swimming speed, "either natural or granted by magic": its block's
// (a familiar's octopus, a companion's giant poisonous snake, a story pet
// the workshop made with one). A drake has none (Drake Companion).
export function petSwims(campaign: Campaign, pet: SheetPet): boolean {
  if (pet.kind === "drake") {
    return false;
  }
  const table = pet.kind === "other" ? findTableMonster(spellAuthorsFor(campaign), pet.form) : null;
  if (table) {
    return swimsFrom(table.draft.stats.speed);
  }
  return Boolean(findShapeForm(pet.form)?.speeds.swim);
}

// The pet's own attack from its owner's square: null on dry ground.
export function petUnderwaterSwing(
  campaign: Campaign,
  ownerId: string,
  pet: SheetPet,
  swing: { attack: string; ranged: boolean; beyondNormal: boolean },
): UnderwaterSwing | null {
  if (!isImmersed(campaign.id, petPlaceOf({ id: ownerId }))) {
    return null;
  }
  return underwaterSwing({ weapon: swing.attack, base: weaponNamed(swing.attack)?.name, melee: !swing.ranged, swims: petSwims(campaign, pet), beyondNormal: swing.beyondNormal });
}

// A creature's swing from the water at a pet or a mount, as enemy_attack's
// own swing at a character reads it (enemy-attack.ts): null on dry ground.
export function creatureUnderwaterSwing(
  campaignId: string,
  enemy: Pick<EncounterEnemy, "id" | "stats">,
  attack: Pick<EnemyAttack, "name" | "spellAttack">,
  mode: { ranged: boolean; longRange: boolean },
): UnderwaterSwing | null {
  if (!isImmersed(campaignId, enemy.id)) {
    return null;
  }
  return underwaterSwing({ weapon: attack.name, base: weaponNamed(attack.name)?.name, melee: !mode.ranged, swims: swimsFrom(enemy.stats.speed), beyondNormal: mode.longRange, spell: attack.spellAttack });
}

// The pet's resistance line with immersion's fire added, as a character's
// and a creature's damage doors add it (pc-damage.ts, enemy-defenses.ts).
export function petResistLine(campaignId: string, ownerId: string, pet: Pick<SheetPet, "resist">): string {
  return [pet.resist ?? "", immersedResistance(campaignId, petPlaceOf({ id: ownerId }))].filter(Boolean).join("; ");
}
