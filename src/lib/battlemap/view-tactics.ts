// What the board says about each enemy from where this player's character
// stands: cover (+2, +5, or no line at all), whether an ally flanks with
// them (when the table plays the Flanking variant), whether they stand
// beside it, and whether a hostile creature at their elbow puts their ranged
// attacks at disadvantage. Every answer is the engine's own reading
// (src/lib/dm/attack-spatial.ts, the functions pc_attack asks), so the Hand's
// hit preview and the token plate say what the roll will meet.
//
// Server side: the spatial readers query the live board. Called by view.ts
// for the viewer's own token only.
import {
  characterFlanks,
  characterShootsInMelee,
  coverFor,
  tilesBetween,
  wallBetween,
} from "@/lib/dm/attack-spatial";
import { attackSenses, characterSenses, enemySenses } from "@/lib/dm/attack-light";
import type { PastSight } from "@/lib/dm/condition-logic";
import { getEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";

export type TargetEdge = {
  cover: 0 | 2 | 5;
  flanking: boolean;
  adjacent: boolean;
  blocked: boolean;
  hostileBeside: boolean;
  // Blindsight or truesight past an invisible or blinded side, each way, as
  // pc_attack reads it (attack-light.ts attackSenses); absent when neither
  // side's reaches.
  senses?: { attacker: PastSight; target: PastSight };
};

export function targetEdges(input: {
  encounterId: string;
  characterId: string;
  characterConditions: string[];
  enemyIds: string[];
  flankingRule: boolean;
}): Record<string, TargetEdge> {
  const { encounterId, characterId } = input;
  const hostileBeside = characterShootsInMelee(encounterId, characterId, input.characterConditions);
  const edges: Record<string, TargetEdge> = {};
  const sheet = getSheetById(characterId);
  for (const enemyId of input.enemyIds) {
    const tiles = tilesBetween(encounterId, characterId, enemyId);
    if (tiles === null) {
      continue;
    }
    const adjacent = tiles <= 1;
    edges[enemyId] = {
      cover: coverFor(encounterId, characterId, enemyId),
      flanking: input.flankingRule && adjacent && characterFlanks(encounterId, characterId, enemyId),
      adjacent,
      blocked: wallBetween(encounterId, characterId, enemyId),
      hostileBeside,
    };
    const enemy = getEnemy(enemyId);
    const senses = sheet && enemy ? attackSenses(encounterId, { refId: characterId, senses: characterSenses(sheet) }, { refId: enemyId, senses: enemySenses(enemy) }) : null;
    if (senses && [senses.attackerSenses, senses.targetSenses].some((side) => side.blindsight || side.truesight)) {
      edges[enemyId].senses = { attacker: senses.attackerSenses, target: senses.targetSenses };
    }
  }
  return edges;
}
