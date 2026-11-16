// What the board says about a pet's own attack (pet_attack, pet-tools.ts),
// read from its owner's square (ruling D2, pet-place.ts) as the hero's own
// attack from that square reads it (pc-attack-situation.ts): the light and
// the pet's own senses (SRD 5.1, Unseen Attackers and Targets: "When you
// attack a target that you can't see, you have disadvantage on the attack
// roll ... When a creature can't see you, you have advantage on attack rolls
// against it"), the target's cover ("Half cover: +2 bonus to AC";
// three-quarters +5), and a ranged attack's range ("Attacking at long range
// imposes disadvantage") and close quarters ("disadvantage on a ranged
// attack roll if you are within 5 feet of a hostile creature who can see
// you and who isn't incapacitated"). The pet's attack read its conditions
// and its target's alone: a wolf bit a darkvision orc in pitch dark at full
// odds, and a sprite's arrow ignored the low wall its target crouched
// behind, while the hero beside them was held to all of it.

import { findTableMonster } from "@/lib/bestiary/homebrew-monsters";
import type { Campaign } from "@/lib/db/campaigns";
import { patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import type { SheetPet } from "@/lib/schemas/sheet";
import type { SummonAttack } from "@/lib/schemas/summon";
import { findShapeForm } from "@/lib/srd/beast-forms";
import { sensesFromBlock, type Senses } from "@/lib/srd/senses";
import { attackSight, enemySenses, lightOnAttack, sensesReaching } from "@/lib/dm/attack-light";
import { characterShootsInMelee, coverFor } from "@/lib/dm/attack-spatial";
import { removeConditions, type AdvantageState, type PastSight } from "@/lib/dm/condition-logic";
import { petPlaceOf } from "@/lib/dm/pet-place";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { getFoe } from "@/lib/dm/sheet-foe";
import { conditionsSpentAgainst } from "@/lib/srd/condition-effect-queries";

// The darkvision a Drake Companion's block gives it.
const DRAKE_SENSES = { darkvision: 60 };

// A pet's own senses, from its block: a familiar's or a companion's form, a
// story pet's (the workshop's monster first), a drake's.
export function petSenses(campaign: Campaign, pet: SheetPet): Senses {
  if (pet.kind === "drake") {
    return sensesFromBlock(DRAKE_SENSES);
  }
  const table = pet.kind === "other" ? findTableMonster(spellAuthorsFor(campaign), pet.form) : null;
  return sensesFromBlock(table ? table.draft.stats.senses : findShapeForm(pet.form)?.senses);
}

export type PetAttackBoard = {
  sources: AdvantageState[];
  notes: string[];
  // Added to the target's AC.
  cover: 0 | 2 | 5;
  attackerSenses: PastSight | undefined;
  targetSeesAttacker: boolean;
};

export function petAttackBoard(input: {
  campaign: Campaign;
  encounterId: string;
  ownerId: string;
  pet: SheetPet;
  enemy: EncounterEnemy;
  attack: Pick<SummonAttack, "range">;
  ranged: boolean;
  // Feet from the pet's square to the target, null off the board.
  feetTo: number | null;
}): PetAttackBoard {
  const { campaign, encounterId, pet, enemy } = input;
  const place = petPlaceOf({ id: input.ownerId });
  const senses = petSenses(campaign, pet);
  const sight = attackSight({ campaignId: campaign.id, encounterId, attacker: { refId: place, senses }, target: { refId: enemy.id, senses: enemySenses(enemy) } });
  const light = lightOnAttack(sight, { attacker: pet.name, target: enemy.displayName });
  const cover = coverFor(encounterId, place, enemy.id);
  const longRange = input.ranged && input.feetTo !== null && input.attack.range !== undefined && input.feetTo > input.attack.range;
  const crowded = input.ranged && characterShootsInMelee(encounterId, place, pet.conditions ?? []);
  return {
    sources: [...light.sources, ...(longRange || crowded ? ["disadvantage" as const] : [])],
    notes: [
      ...light.notes,
      ...(cover ? [`${enemy.displayName} has ${cover === 2 ? "half" : "three-quarters"} cover: +${cover} AC`] : []),
      ...(longRange ? ["beyond normal range: disadvantage"] : []),
      ...(crowded ? ["a hostile creature is within 5 feet: disadvantage on ranged attacks"] : []),
    ],
    cover,
    attackerSenses: sensesReaching(encounterId, { refId: place, senses }, { refId: enemy.id }),
    targetSeesAttacker: sight?.targetSees !== false,
  };
}

// The target's one-shot marks the pet's roll used (Guiding Bolt: "the next
// attack roll made against this target before the end of your next turn has
// advantage"), spent as pc_attack spends them (pc-attack.ts targetSpent).
// The pet's bite took the advantage and left the glimmer, so the hero's
// swing after it had advantage from the same bolt.
export function spendMarksAgainst(enemy: Pick<EncounterEnemy, "id" | "conditions">): void {
  const spent = conditionsSpentAgainst(enemy.conditions);
  const live = spent.length ? getFoe(enemy.id) : null;
  if (!live) {
    return;
  }
  const cleared = removeConditions(live.conditions, live.conditionMeta, spent);
  patchEnemyConditions(live.id, cleared.conditions, cleared.meta);
}
