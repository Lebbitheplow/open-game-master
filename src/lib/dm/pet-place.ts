// Where a pet stands on the board. Maintainer ruling (gap study wave 2, D2):
// a pet has no token of its own; it stands with its owner. So a range
// between a pet and its owner always holds (Perfected Bond's "while you are
// within 30 feet of each other", Reflexive Resistance for the drake), and a
// range from the pet (its bite's reach, its ranged attack) is measured from
// the owner's place on the board.
//
// What measures from a pet goes through here: pet_attack (pet-tools.ts) and
// the reactions a bond gives (authored-reactions.ts resist_instance).
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { SummonAttack } from "@/lib/schemas/summon";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { tilesApart } from "@/lib/dm/board-reach";
import type { ToolError } from "@/lib/dm/tool-errors";

// The board ref a range from the pet is measured from: its owner's.
export const petPlaceOf = (owner: Pick<CharacterSheet, "id">): string => owner.id;

// The farthest a pet's attack reaches: a ranged one's long range, a melee
// one's reach (5 feet when the block names none).
export function petAttackFeet(attack: Pick<SummonAttack, "reach" | "range" | "longRange">): number {
  return attack.range ? (attack.longRange ?? attack.range) : (attack.reach ?? 5);
}

// The refusal for a pet's attack at a creature beyond its reach from where
// it stands (its owner's place), or null. With no board, or a creature with
// no token, nothing is measured and the GM judges it.
export function petReachProblem(encounterId: string, owner: Pick<CharacterSheet, "id" | "name">, petName: string, attack: Pick<SummonAttack, "name" | "reach" | "range" | "longRange">, target: { id: string; name: string }): ToolError | null {
  const map = getBattleMapForEncounter(encounterId);
  const from = map ? getTokenByRef(map.id, petPlaceOf(owner)) : null;
  const to = map ? getTokenByRef(map.id, target.id) : null;
  if (!from || !to) {
    return null;
  }
  const feet = petAttackFeet(attack);
  const apart = tilesApart(from, to) * 5;
  if (apart <= feet) {
    return null;
  }
  return {
    error: `${target.name} is ${apart} feet from ${owner.name}, and ${petName} stands with ${owner.name} (a pet has no square of its own): its ${attack.name} reaches ${feet} feet. Move ${owner.name} closer first. Nothing was spent.`,
    refused: "rules",
  };
}
