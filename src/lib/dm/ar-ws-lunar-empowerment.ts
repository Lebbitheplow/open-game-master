// Lunar Empowerment (Lunar Sorcery 14), the two halves no engine held:
//
// "Full Moon: a bonus action sheds bright light in 10 feet and dim light 10
// feet beyond (or douses it)". The row's note left the light to the GM and no
// light stood on the board. use_resource "Lunar Empowerment" (a bonus action
// in a fight, Full Moon phase only) now lights it: the sorcerer's sheet
// carries "moonlight" and their token the light the board's sight, fog of war
// and attack rolls already read (the token's own light, as a torch's or the
// Light cantrip's, so it moves with them). The same call douses it. A torch
// they carry outshines it and is left alone. Leaving the Full Moon phase ends
// it (moonlightEnds, called where a phase is chosen).
//
// "New Moon: ... attack rolls against you have disadvantage while you are
// entirely in darkness". Ruling: a creature is entirely in darkness when its
// own square is dark on the board (the ambient light there or magical
// darkness, with no light reaching it: attack-light.ts standsInDarkness),
// whatever the attacker's own senses; with no board, when the place is dark
// (place-light.ts offBoardAmbient) and the sorcerer carries no light.
// darkVeil is read by authored-hooks.ts authoredIncomingAttack, where every
// feature of a character answers an attack roll made against them.

import { getBattleMapForEncounter, getTokenByRef, setTokenLight } from "@/lib/db/battle-maps";
import { getActiveBoard } from "@/lib/db/encounters";
import { carriedDimRadius } from "@/lib/battlemap/types";
import { lightTiles, MOONLIGHT, shedsMoonlight } from "@/lib/dm/ar-ws-moonlight-logic";
import { standsInDarkness } from "@/lib/dm/attack-light";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { carriedLight } from "@/lib/dm/light-timers";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { offBoardAmbient } from "@/lib/dm/place-light";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { activeAuthored } from "@/lib/srd/authored-effects";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { isConditionNamed } from "@/lib/srd/feature-names";

type Does = Extract<SpendDoes, { kind: "light" }>;
type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };

function tokenOf(campaignId: string, sheetId: string) {
  const board = getActiveBoard(campaignId);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  return map ? getTokenByRef(map.id, sheetId) : null;
}

// The sheet without the light's condition.
function unlit(sheet: CharacterSheet, condition: string): FullPatchSheetInput {
  const meta = { ...(sheet.conditionMeta as ConditionMetaMap) };
  delete meta[condition];
  return { conditions: sheet.conditions.filter((entry) => !isConditionNamed(entry, condition)), conditionMeta: meta };
}

// Puts out the token's light when it is this feature's own (a torch's, brighter, is left burning).
function douseToken(campaignId: string, sheetId: string, tiles: { radius: number; dim: number }) {
  const token = tokenOf(campaignId, sheetId);
  if (token && token.lightRadius === tiles.radius && carriedDimRadius(token) === tiles.dim && !token.burnsUntil) {
    setTokenLight(token.id, 0);
    publishBattleMapUpdate(campaignId);
  }
}

// The spend: lit when dark, doused when lit.
export function toggleLight(ctx: SpendContext, does: Does): Resolution {
  const { sheet, campaign } = ctx;
  const tiles = lightTiles(does.brightFt, does.dimFt);
  if (sheet.conditions.some((entry) => isConditionNamed(entry, does.condition))) {
    douseToken(campaign.id, sheet.id, tiles);
    return { patch: unlit(sheet, does.condition), result: { applied: `${sheet.name} douses the light of ${ctx.spend.name}.` } };
  }
  const token = tokenOf(campaign.id, sheet.id);
  if (token && token.lightRadius < tiles.radius) {
    setTokenLight(token.id, tiles.radius, 0, 0, tiles.dim);
    publishBattleMapUpdate(campaign.id);
  }
  return {
    patch: { conditions: [...sheet.conditions, does.condition] },
    result: {
      applied: `${sheet.name} sheds bright light for ${does.brightFt} feet and dim light for ${does.dimFt} feet beyond${token ? "; the board's light and sight read it, and it moves with them" : ""}. The same call douses it.`,
    },
  };
}

// A phase was chosen for `feature`: outside the Full Moon no moonlight is
// shed, so the light and its condition end. What it adds to the choice's patch.
export function moonlightEnds(ctx: SpendContext, feature: string, option: string): FullPatchSheetInput {
  if (textKey(feature) !== "lunar embodiment" || textKey(option) === "full moon" || !shedsMoonlight(ctx.sheet)) {
    return {};
  }
  douseToken(ctx.campaign.id, ctx.sheet.id, lightTiles(10, 10));
  return unlit(ctx.sheet, MOONLIGHT);
}

// The note of an attack roll against `target` that has disadvantage because
// they stand entirely in darkness (New Moon), or null.
export function darkVeil(campaignId: string, encounterId: string, target: CharacterSheet): string | null {
  const row = activeAuthored(target, "attacked_disadv_dark")[0];
  if (!row) {
    return null;
  }
  const onBoard = standsInDarkness(campaignId, encounterId, target.id);
  const dark = onBoard ?? (offBoardAmbient(campaignId) === "dark" && carriedLight(target).radius <= 0);
  return dark ? `${row.held.feature}: ${target.name} is entirely in darkness, so attack rolls against them have disadvantage` : null;
}
