// Lunar Phenomenon (Lunar Sorcery 18), the halves its saves left to the GM:
//
// "Full Moon: ... and one creature of your choice there regains 3d8 hit
// points." "New Moon: ... and has speed 0 until the end of its next turn, and
// you are invisible until the end of your next turn or until you attack or
// cast a spell." "Crescent Moon: you teleport up to 60 feet with one willing
// creature within 5 feet of you, and each of you resists all damage until the
// start of your next turn."
//
// The row built the saves and the teleport and nothing else: the healing was
// never rolled, the sorcerer never turned invisible, the companion stayed
// behind and nobody resisted anything. These are fields any save_area or
// teleport spend can carry (authored-effects-types.ts heals, veils,
// companionFt, ward), read at the two doors in authored-spend-effects.ts:
// each refusal is asked before anything is written, so a refused use costs
// nothing.
//
// The New Moon's speed 0 is a condition of the registry (authored-conditions.ts
// "new moon's stillness"), the Crescent Moon's resistance another ("crescent
// moon's ward"). The invisibility is the plain "invisible" that an attack or
// a cast already ends (attack-marks.ts withoutActionInvisibility).

import { getBattleMapForEncounter, getTokenByRef, placeToken } from "@/lib/db/battle-maps";
import { getActiveBoard } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { TILE_FEET } from "@/lib/battlemap/types";
import { withinFeet } from "@/lib/dm/authored-saves";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { addConditionInstance, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { creditFeatureTeleport } from "@/lib/dm/feature-teleport";
import { publishBattleMapUpdate, teleportSquareRefusal } from "@/lib/dm/map-tools";
import { canRegain, regainHitPoints } from "@/lib/dm/regain";
import { diceFor, rollOwnDice } from "@/lib/dm/character-roll";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { resolveFormula } from "@/lib/srd/authored-effects";
import type { Formula } from "@/lib/srd/authored-effects-types";

type Heals = { formula: Formula; rangeFt: number };

// The one creature the healing goes to: the character the call names in
// targetCharacterId, else the holder.
function healTarget(ctx: SpendContext): CharacterSheet | null {
  return ctx.args.targetCharacterId ? getSheetById(ctx.args.targetCharacterId) : ctx.sheet;
}

// Asked before the save is rolled or the use paid: the named creature is at
// the table, alive, within reach of the holder and able to regain hit points.
export function healRefusal(ctx: SpendContext, heals: Heals): ToolError | null {
  const target = healTarget(ctx);
  const name = ctx.spend.name;
  if (!target || target.campaignId !== ctx.campaign.id || target.deathSaves?.dead) {
    return { error: `${name} heals a living creature at the table: pass its targetCharacterId, or none for ${ctx.sheet.name}. Nothing was spent.`, retry: true };
  }
  if (target.id !== ctx.sheet.id && ctx.encounter && !withinFeet(ctx.encounter.id, ctx.sheet.id, target.id, heals.rangeFt)) {
    return { error: `${target.name} is beyond ${heals.rangeFt} feet of ${ctx.sheet.name}; ${name} heals a creature there. Nothing was spent.`, refused: "rules" };
  }
  if (ctx.args.targetCharacterId && !canRegain(target)) {
    return { error: `${target.name} cannot regain hit points right now, so ${name} would heal nothing. Nothing was spent.`, refused: "rules" };
  }
  return null;
}

// The healing rolled and given: what the table is told.
export function healOne(ctx: SpendContext, heals: Heals): string {
  const target = healTarget(ctx) ?? ctx.sheet;
  if (!canRegain(target)) {
    return `${target.name} cannot regain hit points right now, so ${ctx.spend.name} heals nobody.`;
  }
  const dice = resolveFormula(heals.formula, ctx.held.level, ctx.mods);
  // The holder's own dice (character-roll.ts rollOwnDice), whoever is healed.
  const rolled = rollOwnDice(ctx.campaign, ctx.sheet, diceFor(`${ctx.spend.name}: healing`, ctx.sheet, target), dice, { turn: ctx.turn }).total;
  const gained = regainHitPoints(ctx.campaign, ctx.turnId, target, rolled, `${ctx.spend.name} (${ctx.sheet.name})`);
  return `${target.name} regains ${gained} hit points (${dice}: ${rolled}).`;
}

// One condition laid on a sheet, its own instance beside any other.
function withCondition(sheet: CharacterSheet, name: string, meta: ConditionMeta): FullPatchSheetInput {
  const laid = addConditionInstance(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, name, meta);
  return { conditions: laid.conditions, conditionMeta: laid.meta as FullPatchSheetInput["conditionMeta"] };
}

// The holder turns invisible until the end of their next turn; their next
// attack or spell ends it sooner. Out of a fight no turn runs to end it, so
// the GM tells it in the story.
export function veil(ctx: SpendContext): { patch?: FullPatchSheetInput; line: string } {
  if (!ctx.encounter) {
    return { line: `${ctx.sheet.name} is invisible for a moment (until the end of their next turn, or until they attack or cast a spell); with no fight on, the GM tells it in the story.` };
  }
  return {
    patch: withCondition(ctx.sheet, "invisible", { source: ctx.spend.name, untilTurnEndOf: ctx.sheet.id }),
    line: `${ctx.sheet.name} is invisible until the end of their next turn, or until they attack or cast a spell.`,
  };
}

// The willing creature who goes with the holder: the character named in
// targetCharacterId, within `feet` of them. None named, the holder goes alone.
export function companionOf(ctx: SpendContext, feet: number): ToolError | { sheet: CharacterSheet | null } {
  const id = ctx.args.targetCharacterId;
  if (!id || id === ctx.sheet.id) {
    return { sheet: null };
  }
  const other = getSheetById(id);
  if (!other || other.campaignId !== ctx.campaign.id || other.deathSaves?.dead) {
    return { error: `${ctx.spend.name} takes one willing creature at the table: pass its targetCharacterId, or none to go alone. Nothing was spent.`, retry: true };
  }
  if (ctx.encounter && !withinFeet(ctx.encounter.id, ctx.sheet.id, other.id, feet)) {
    return { error: `${other.name} is beyond ${feet} feet of ${ctx.sheet.name}; ${ctx.spend.name} takes a creature within ${feet} feet. Nothing was spent.`, refused: "rules" };
  }
  return { sheet: other };
}

// The companion arrives beside the holder. When the holder's token has moved
// (the call named its square), the companion's goes to the first open square
// within `feet` of it; otherwise both wait for move_token, the companion with
// the same credit the holder has.
export function companionGoes(ctx: SpendContext, companion: CharacterSheet, feet: number, range: number): string {
  const board = getActiveBoard(ctx.campaign.id);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  const mine = map ? getTokenByRef(map.id, ctx.sheet.id) : null;
  const theirs = map ? getTokenByRef(map.id, companion.id) : null;
  const moved = ctx.args.x !== undefined && ctx.args.y !== undefined && mine && mine.x === ctx.args.x && mine.y === ctx.args.y;
  if (map && mine && theirs && moved) {
    const reach = Math.max(1, Math.floor(feet / TILE_FEET));
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const [x, y] = [mine.x + dx, mine.y + dy];
        if ((dx || dy) && !teleportSquareRefusal(map, theirs, x, y, null)) {
          placeToken(theirs.id, x, y);
          publishBattleMapUpdate(ctx.campaign.id);
          return `${companion.name} goes with them, to (${x},${y}).`;
        }
      }
    }
  }
  creditFeatureTeleport(companion.id, ctx.spend.name, range + feet);
  return `${companion.name} goes with them: if a battle map is live, move their token beside ${ctx.sheet.name}'s with move_token, teleport true, spell "${ctx.spend.name}" and casterCharacterId ${ctx.sheet.id}.`;
}

// The ward on the holder and the companion until the start of the holder's
// next turn. The holder's comes back as the spend's patch; the companion's is
// written here. Out of a fight no turn starts to end it, so the GM tells it.
export function layLunarWard(ctx: SpendContext, ward: string, companion: CharacterSheet | null): { patch?: FullPatchSheetInput; line: string } {
  const who = [ctx.sheet.name, ...(companion ? [companion.name] : [])].join(" and ");
  if (!ctx.encounter) {
    return { line: `${who} resist all damage until the start of ${ctx.sheet.name}'s next turn; with no fight on, the GM tells it in the story.` };
  }
  const meta: ConditionMeta = { source: ctx.sheet.id, untilTurnOf: ctx.sheet.id };
  if (companion) {
    const fresh = getSheetById(companion.id) ?? companion;
    const updated = patchSheet(fresh.id, withCondition(fresh, ward, meta));
    if (updated) {
      publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  return { patch: withCondition(ctx.sheet, ward, meta), line: `${who} resist all damage until the start of ${ctx.sheet.name}'s next turn.` };
}
