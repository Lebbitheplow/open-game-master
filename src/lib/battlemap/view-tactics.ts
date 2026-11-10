// What the board says about each enemy from where this player's character
// stands: cover (+2, +5, or no line at all), whether an ally flanks with
// them (when the table plays the Flanking variant), whether they stand
// beside it, how far it is, whether a hostile creature at their elbow puts
// their ranged attacks at disadvantage, and what sight does to the roll.
// Every answer is the engine's own reading (src/lib/dm/attack-spatial.ts and
// src/lib/dm/attack-sight.ts, the functions pc_attack asks), so the Hand's
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
import { attackSightVerdict } from "@/lib/dm/attack-sight";
import { unseenBecause } from "@/lib/dm/authored-saves";
import type { PastSight } from "@/lib/dm/condition-logic";
import { hideRefusal } from "@/lib/dm/hide-traits";
import { silenceAround } from "@/lib/dm/zone-rules";
import { getCampaignById } from "@/lib/db/campaigns";
import { getEnemy, type Encounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import type { HandBoardFacts } from "@/lib/battlemap/hand-core";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type TargetEdge = {
  cover: 0 | 2 | 5;
  flanking: boolean;
  adjacent: boolean;
  blocked: boolean;
  hostileBeside: boolean;
  // How far apart, in feet, as pc_attack measures it: the preview puts a
  // shot past a weapon's normal range at disadvantage. Absent from an older
  // host.
  feet?: number;
  // Blindsight or truesight past an invisible or blinded side, each way, as
  // pc_attack reads it (attack-light.ts attackSenses); absent when neither
  // side's reaches.
  senses?: { attacker: PastSight; target: PastSight };
};

// Sight as the roll reads it against one creature (attack-sight.ts): the
// light's advantage and disadvantage, and each side's conditions as rolled
// (Feral Senses drops the target's invisible, a fear out of sight drops
// frightened). Sent for every creature with a token, the ones the viewer
// cannot see too (in magical darkness the foes are not shown, and that is
// when sight matters), never a token the GM keeps hidden, and nothing of
// where they stand.
//
// `unseen` and `unseenBy` are the engine's own gate for a feature that takes
// "a creature you can see" (authored-saves.ts unseenBecause, the call
// use_resource makes for Nature's Wrath, Hexblade's Curse, Champion
// Challenge and the rest): why the viewer cannot see the creature, and why
// the creature cannot see the viewer ("seesHolder"). The Hand reads them to
// withhold that creature's chip from a sight-bound card (hand-play.ts
// aimUnseen), so the card and the engine cannot disagree. Absent when seen,
// and from an older host, where the chip is offered as before.
export type TargetSight = { light: Array<"advantage" | "disadvantage">; attacker: string[]; target: string[]; targetSees: boolean; unseen?: string; unseenBy?: string };

export function targetEdges(input: {
  campaignId: string;
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
      feet: tiles * 5,
    };
    const enemy = getEnemy(enemyId);
    const senses = sheet && enemy ? attackSenses(encounterId, { refId: characterId, senses: characterSenses(sheet) }, { refId: enemyId, senses: enemySenses(enemy) }) : null;
    if (senses && [senses.attackerSenses, senses.targetSenses].some((side) => side.blindsight || side.truesight)) {
      edges[enemyId].senses = { attacker: senses.attackerSenses, target: senses.targetSenses };
    }
  }
  return edges;
}

// The sight verdict from the viewer's own character to each enemy, by id.
export function targetSight(input: { campaignId: string; encounterId: string; characterId: string; enemyIds: string[] }): Record<string, TargetSight> {
  const sheet = getSheetById(input.characterId);
  const out: Record<string, TargetSight> = {};
  for (const enemyId of input.enemyIds) {
    const enemy = getEnemy(enemyId);
    if (!sheet || !enemy) {
      continue;
    }
    const seen = attackSightVerdict({ campaignId: input.campaignId, encounterId: input.encounterId, sheet, enemy });
    const unseen = unseenBecause(input.encounterId, sheet, enemy);
    const unseenBy = unseenBecause(input.encounterId, enemy, sheet);
    out[enemyId] = {
      light: seen.light,
      attacker: seen.attackerConditions,
      target: seen.targetConditions,
      targetSees: seen.sight?.targetSees !== false,
      ...(unseen ? { unseen } : {}),
      ...(unseenBy ? { unseenBy } : {}),
    };
  }
  return out;
}

// The engine's verdicts on the viewer's own square (hand-core.ts
// HandBoardFacts): a Hide take_action would refuse there, in a fight, and
// the Silence they stand in.
export function ownSquareFacts(campaignId: string, encounter: Pick<Encounter, "id" | "kind">, sheet: CharacterSheet): HandBoardFacts {
  const out: HandBoardFacts = {};
  const campaign = encounter.kind === "fight" ? getCampaignById(campaignId) : null;
  const hide = campaign ? hideRefusal(campaign, encounter.id, sheet) : null;
  if (hide) out.hide = hide.error;
  const silence = silenceAround(campaignId, sheet.id);
  if (silence !== null) out.silence = { by: silence };
  return out;
}
