// Spreading Spores (the Circle of Spores at 10th level): "While Symbiotic
// Entity is active, a bonus action hurls spores into a 10-foot cube within 30
// feet for a minute, until you use it again or until the entity ends. A
// creature that moves into the cube or starts its turn there makes a
// Constitution save against your spell save DC or takes your Halo of Spores
// damage, at most once per turn, and you can't use Halo of Spores' reaction
// while the cube lasts."
//
// The cube is a board area (the "spreading spores" row of
// src/lib/battlemap/zones-spells.ts), laid at the square named and struck by
// the zone triggers like any spell area; it holds while the druid carries the
// "spreading spores" condition, which the spend lays for the minute and which
// Halo of Spores' gate reads. Before this the feature was narrated: no spend,
// no cube, and the Halo stayed open.

import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getActiveBoard, getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { chebyshev, type XY } from "@/lib/battlemap/types";
import { placeSpellZone } from "@/lib/dm/zone-cast";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { computeSheetDerived } from "@/lib/srd";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

export const SPORES = "spreading spores";
const SPORES_AREA = "Spreading Spores";

function nearestFoeToken(encounterId: string, mapId: string, self: XY, rangeFt: number): XY | null {
  const spots = listEnemies(encounterId)
    .filter((enemy) => enemy.status === "alive")
    .map((enemy) => getTokenByRef(mapId, enemy.id))
    .filter((token): token is NonNullable<typeof token> => Boolean(token))
    .map((token) => ({ x: token.x, y: token.y, feet: chebyshev(self.x, self.y, token.x, token.y) * 5 }))
    .filter((spot) => spot.feet <= rangeFt)
    .sort((a, b) => a.feet - b.feet);
  return spots[0] ? { x: spots[0].x, y: spots[0].y } : null;
}

export function hurlSpores(
  campaign: Campaign,
  druid: CharacterSheet,
  call: { at?: XY; targetEnemyId?: string; rangeFt: number; rounds: number },
): ToolError | { result: Record<string, unknown> } {
  const board = getActiveBoard(campaign.id);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  const self = map ? getTokenByRef(map.id, druid.id) : null;
  // The square named, else the square of the creature named, else the
  // nearest foe's within reach (a card played with no square to pick).
  const aimed = !call.at && call.targetEnemyId && map ? getTokenByRef(map.id, call.targetEnemyId.trim()) : null;
  const nearest = !call.at && !aimed && map && self && board ? nearestFoeToken(board.id, map.id, self, call.rangeFt) : null;
  const at = call.at ?? (aimed ? { x: aimed.x, y: aimed.y } : nearest);
  if (map && !at) {
    return { error: `No creature of the fight stands within ${call.rangeFt} feet of ${druid.name} to hurl the spores at: pass x and y for the cube's square. Nothing was spent.`, refused: "rules" };
  }
  if (map && at) {
    if (at.x < 0 || at.y < 0 || at.x >= map.width || at.y >= map.height) {
      return { error: `(${at.x},${at.y}) is off the ${map.width}x${map.height} map. Nothing was spent.`, retry: true };
    }
    const feet = self ? chebyshev(self.x, self.y, at.x, at.y) * 5 : 0;
    if (feet > call.rangeFt) {
      return { error: `The spores are hurled within ${call.rangeFt} feet, and (${at.x},${at.y}) is ${feet} feet from ${druid.name}. Name a nearer square. Nothing was spent.`, retry: true };
    }
  }
  // "Until you use it again": the earlier cube's condition goes, and its area
  // with the new one laid (zone-cast.ts moves the same caster's area).
  const fresh = getSheetById(druid.id) ?? druid;
  const kept = removeConditions(fresh.conditions, fresh.conditionMeta as ConditionMetaMap, fresh.conditions.filter((entry) => textKey(entry) === textKey(SPORES)));
  const patch: FullPatchSheetInput = {
    conditions: [...kept.conditions, SPORES],
    conditionMeta: { ...(kept.meta as FullPatchSheetInput["conditionMeta"]), [SPORES]: { rounds: call.rounds } } as FullPatchSheetInput["conditionMeta"],
  };
  const updated = patchSheet(druid.id, patch);
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  const lines = [`${druid.name} hurls spores${at ? ` into the 10-foot cube at (${at.x},${at.y})` : ""} for a minute; Halo of Spores' reaction rests while it lasts.`];
  if (map && at && getActiveEncounter(campaign.id)) {
    const dc = computeSheetDerived(updated ?? fresh).spellSaveDc ?? undefined;
    const laid = placeSpellZone(campaign, { spell: SPORES_AREA, caster: { kind: "pc", id: druid.id, name: druid.name }, at, named: true, ...(dc ? { dc } : {}) });
    if (laid) {
      lines.push(laid);
    }
  }
  return { result: { applied: lines } };
}
