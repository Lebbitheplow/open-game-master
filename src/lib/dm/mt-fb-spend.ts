// What the fighter and barbarian spends ask of the creature they are aimed at,
// beyond the reach and the save every save_effect and enemy buff already holds
// (src/lib/dm/authored-spend-effects.ts calls each of these):
//
//   sizeRefusal      "a Large or smaller creature" (Elk Trample, Wolf
//                    Takedown), "Medium or smaller" growing with the level
//                    (Mighty Impel). Before this a Huge creature was trampled
//                    prone and thrown.
//   meleeHitRefusal  "when you hit it with a melee weapon attack": the turn's
//                    own record of the hit (attack-swing.ts WEAPON_HIT) and of
//                    the melee attack (mt-fb-charge.ts), on that creature.
//   throwFoe         Mighty Impel's throw: "move it to an unoccupied space you
//                    can see within 30 feet of you. A creature left in the air
//                    falls and lands prone." It was a line asking the GM to
//                    move the token.
import { getBattleMapForEncounter, getTokenByRef, listTokens, moveToken } from "@/lib/db/battle-maps";
import { getActiveEncounter, getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import { publishEphemeral } from "@/lib/events";
import { blocksMove, tileAt, tileIndex } from "@/lib/battlemap/types";
import { occupiedTiles } from "@/lib/battlemap/view";
import { sizeRank } from "@/lib/bestiary/enemy-numbers";
import { WEAPON_HIT } from "@/lib/dm/action-budget";
import { damageDice, damageEnemy, enemyCondition, type SpendContext } from "@/lib/dm/authored-spend-effects";
import { tilesApart } from "@/lib/dm/board-reach";
import type { ToolError } from "@/lib/dm/tool-errors";
import { resolveFormula } from "@/lib/srd/authored-effects";
import { isConditionNamed, isNamed } from "@/lib/srd/feature-names";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { CHARGED } from "@/lib/srd/mt-fb-run";

// The largest size a spend takes: one size, or a ladder by the level of the
// class that granted the feature.
export type MaxSize = string | Array<[number, string]>;

export function sizeRefusal(label: string, enemy: EncounterEnemy, maxSize: MaxSize, level: number): ToolError | null {
  const most = Array.isArray(maxSize) ? resolveFormula(maxSize, level) : maxSize;
  if (sizeRank(enemy.stats.size) <= sizeRank(most)) {
    return null;
  }
  return { error: `${enemy.displayName} is ${enemy.stats.size}, and ${label} takes a ${most} or smaller creature. Nothing was spent.`, refused: "rules" };
}

export function meleeHitRefusal(ctx: SpendContext, enemy: EncounterEnemy): ToolError | null {
  const encounter = getActiveEncounter(ctx.campaign.id);
  const budget = encounter?.turnBudget && encounter.turnBudget.ownerId === ctx.sheet.id ? encounter.turnBudget : null;
  const marks = budget?.oncePerTurn ?? [];
  if (marks.includes(`${WEAPON_HIT}${enemy.id}`) && marks.some((mark) => mark.startsWith(`${CHARGED}${enemy.id}:`))) {
    return null;
  }
  return { error: `${ctx.spend.name} follows a melee weapon hit on the creature, and ${ctx.sheet.name} has landed none on ${enemy.displayName} this turn: pc_attack first. Nothing was spent.`, refused: "rules" };
}

// The creature failed its save and is thrown. Variant "up": straight into the
// air above where it stood, as high as the throw reaches; it falls (SRD 5.1,
// Falling: 1d6 bludgeoning for every 10 feet, landing prone) unless it flies.
// Otherwise it lands on the open square farthest from the holder along the
// line from them through it, within the throw of the holder; another
// unoccupied square in that reach is the GM's move_token (forced).
export function throwFoe(ctx: SpendContext, enemy: EncounterEnemy, feet: number): Record<string, unknown> {
  const name = enemy.displayName;
  if (isNamed(ctx.args.variant ?? "", "up")) {
    if (/\bfly\b/i.test(JSON.stringify(enemy.stats.speed ?? ""))) {
      return { thrown: `${name} is thrown ${feet} feet into the air and, a creature that flies, holds itself there.` };
    }
    const dice = `${Math.max(1, Math.floor(feet / 10))}d6`;
    const rolled = damageDice(ctx, enemy, dice);
    const hurt = damageEnemy(ctx, getEnemy(enemy.id) ?? enemy, rolled, "bludgeoning");
    const fresh = getEnemy(enemy.id);
    const prone = fresh && fresh.status === "alive" ? enemyCondition(ctx, fresh, "prone", {}) : false;
    return { thrown: `${name} is thrown ${feet} feet into the air and falls: ${dice} bludgeoning (${rolled})${prone ? ", and it lands prone" : ""}.`, fall: hurt };
  }
  const encounter = getActiveEncounter(ctx.campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const holder = map ? getTokenByRef(map.id, ctx.sheet.id) : null;
  const token = map ? getTokenByRef(map.id, enemy.id) : null;
  if (!map || !holder || !token) {
    return { thrown: `${name} is thrown to an unoccupied space within ${feet} feet of ${ctx.sheet.name} (no board to move it on).` };
  }
  const dx = Math.sign(token.x - holder.x);
  const dy = Math.sign(token.y - holder.y);
  const taken = occupiedTiles(map, listTokens(map.id), token);
  const start = tilesApart(holder, token);
  for (let step = Math.floor(feet / 5) - start; step >= 1; step -= 1) {
    const at = { x: token.x + (dx || (dy ? 0 : 1)) * step, y: token.y + dy * step };
    if (at.x < 0 || at.y < 0 || at.x >= map.width || at.y >= map.height) continue;
    if (blocksMove(tileAt(map.terrain, map.width, at.x, at.y)) || taken.has(tileIndex(map.width, at.x, at.y))) continue;
    if (tilesApart(holder, { ...token, x: at.x, y: at.y }) * 5 > feet) continue;
    moveToken(token.id, at.x, at.y, token.movedThisRound);
    publishEphemeral(ctx.campaign.id, "battle_map_updated", {});
    return { thrown: `${name} is thrown to (${at.x},${at.y}), ${tilesApart(holder, { ...token, x: at.x, y: at.y }) * 5} feet from ${ctx.sheet.name}. Another unoccupied space within ${feet} feet of them is a move_token (forced); variant "up" throws it into the air to fall.` };
  }
  return { thrown: `${name} has no open square to be thrown to along that line and stays where it is; another unoccupied space within ${feet} feet of ${ctx.sheet.name} is a move_token (forced).` };
}

// A failed save pushes the creature straight away from the holder, up to
// `feet`, stopping at a wall, the board's edge or another creature
// (Telekinetic Thrust: "or pushed 10 feet").
export function pushFoe(ctx: SpendContext, enemy: EncounterEnemy, feet: number): Record<string, unknown> {
  const name = enemy.displayName;
  const encounter = getActiveEncounter(ctx.campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const holder = map ? getTokenByRef(map.id, ctx.sheet.id) : null;
  const token = map ? getTokenByRef(map.id, enemy.id) : null;
  if (!map || !holder || !token) {
    return { pushed: `${name} is pushed ${feet} feet away from ${ctx.sheet.name} (no board to move it on).` };
  }
  const dx = Math.sign(token.x - holder.x);
  const dy = Math.sign(token.y - holder.y);
  const taken = occupiedTiles(map, listTokens(map.id), token);
  let at = { x: token.x, y: token.y };
  for (let step = 0; step < Math.floor(feet / 5); step += 1) {
    const next = { x: at.x + (dx || (dy ? 0 : 1)), y: at.y + dy };
    if (next.x < 0 || next.y < 0 || next.x >= map.width || next.y >= map.height) break;
    if (blocksMove(tileAt(map.terrain, map.width, next.x, next.y)) || taken.has(tileIndex(map.width, next.x, next.y))) break;
    at = next;
  }
  if (at.x === token.x && at.y === token.y) {
    return { pushed: `${name} has no open square behind it and stays where it is.` };
  }
  moveToken(token.id, at.x, at.y, token.movedThisRound);
  publishEphemeral(ctx.campaign.id, "battle_map_updated", {});
  return { pushed: `${name} is pushed ${Math.max(Math.abs(at.x - token.x), Math.abs(at.y - token.y)) * 5} feet, to (${at.x},${at.y}).` };
}

// Ends the named conditions on the holder (Guarded Mind: "a reaction-free end
// to being charmed or frightened by spending a die"); with neither on them,
// nothing is spent.
export function cleanse(ctx: SpendContext, conditions: string[]): ToolError | { patch: { conditions: string[]; conditionMeta: ConditionMetaMap }; result: Record<string, unknown> } {
  const held = ctx.sheet.conditions.filter((entry) => conditions.some((name) => isConditionNamed(entry, name)));
  if (!held.length) {
    return { error: `${ctx.sheet.name} is neither ${conditions.join(" nor ")}; ${ctx.spend.name} has nothing to end. Nothing was spent.`, refused: "rules" };
  }
  const cleared = removeConditions(ctx.sheet.conditions, ctx.sheet.conditionMeta as ConditionMetaMap, held);
  return { patch: { conditions: cleared.conditions, conditionMeta: cleared.meta }, result: { ended: `${ctx.sheet.name} is no longer ${held.join(" or ")}.` } };
}
