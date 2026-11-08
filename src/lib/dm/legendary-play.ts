// A legendary action played whole in one call (issue 685 audit, 4.G): the
// GM's monsters' Hand card, and the console's legendary_action form with its
// targets or its square filled in. The spend and what it buys are one step:
// everything the follow-up needs is checked before the action is spent, and
// a follow-up the engine still refuses gives the action back
// (legendary-purchase.ts refundLegendaryPurchase), so a swing out of reach, a
// save on nobody or a walk into a wall costs nothing.
//
// Each way to play an option (legendary-route-logic.ts) is made with the
// engine's own tools: enemy_attack, cast_at_player and aoe_damage with the
// block's ability or a spell from its list, move_token and teleport_token,
// set_effect and set_condition, apply_damage. A check, hit points regained
// and a cloud are made by the spend itself (handleLegendaryAction).
//
// Called from the console's dispatch (src/lib/dm/invoke-dispatch.ts) with
// its own dispatcher, which this module must not import.

import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, patchEnemyHp, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef, listTokens, placeToken } from "@/lib/db/battle-maps";
import { getSheetById } from "@/lib/db/sheets";
import { tieToTurn } from "@/lib/dm/turn-tie";
import { resolveEnemyRef, unknownEnemyRef } from "@/lib/dm/enemy-damage";
import { conditionEffectsFor } from "@/lib/srd/condition-effects";
import { textKey } from "@/lib/language/text-logic";
import { resolveCombatant } from "@/lib/dm/combatant";
import { enemyHpCap, findMonsterSpell } from "@/lib/dm/monster-abilities";
import { legendaryProfile } from "@/lib/dm/legendary-logic";
import { legendaryRoutes, routeNamed, routeNeeds, type LegendaryRoute, type LegendaryStep } from "@/lib/dm/legendary-route-logic";
import { legendaryMoveFor } from "@/lib/dm/legendary-move";
import { closeLegendaryPurchase, refundLegendaryPurchase } from "@/lib/dm/legendary-purchase";
import { charmedBy } from "@/lib/dm/enemy-profile";
import { sizeRank } from "@/lib/bestiary/enemy-numbers";
import { sizeForRace } from "@/lib/srd";
import { NEGATIVE_ENERGY, regainBlockedBy } from "@/lib/dm/vitals-logic";
import { dmRoll } from "@/lib/dm/roll-card";
import { blocksMove, inBounds, tileAt } from "@/lib/battlemap/types";
import { isNamed } from "@/lib/srd/feature-names";
import { handleMoveToken, publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { spellMechanicsFor } from "@/lib/content";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { badArguments, type ToolResult } from "@/lib/dm/tool-errors";
import { swallowCover } from "@/lib/dm/swallow";

export type Dispatch = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;

// Squares a side, by size (SRD 5.1, Size Categories).
const FOOTPRINT: Record<string, number> = { large: 2, huge: 3, gargantuan: 4 };

const playSchema = z.object({
  enemyId: z.string().min(1),
  action: z.string().trim().min(1).max(80),
  use: z.string().trim().max(80).optional(),
  targetCharacterId: z.string().trim().max(80).optional(),
  characterIds: z.array(z.string().trim().max(80)).max(20).optional(),
  enemyIds: z.array(z.string().trim().max(80)).max(20).optional(),
  x: z.coerce.number().int().min(0).max(200).optional(),
  y: z.coerce.number().int().min(0).max(200).optional(),
  spell: z.string().trim().max(80).optional(),
  advantage: z.enum(["none", "advantage", "disadvantage"]).optional(),
});

type PlayArgs = z.infer<typeof playSchema>;

// Whether the call names what the follow-up needs: then it is played whole
// here. Without, legendary_action spends and the next call makes the rest.
export function playsWhole(rawArguments: string): boolean {
  try {
    const args = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
    return ["targetCharacterId", "characterIds", "enemyIds", "x", "y", "spell"].some((field) => {
      const value = args[field];
      return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";
    });
  } catch {
    return false;
  }
}

type Target = { kind: "sheet"; sheet: CharacterSheet } | { kind: "enemy"; enemy: EncounterEnemy };

function targetsOf(encounter: Encounter, args: PlayArgs): Target[] | string {
  const refs = [...new Set([args.targetCharacterId, ...(args.characterIds ?? []), ...(args.enemyIds ?? [])].filter((ref): ref is string => Boolean(ref)))];
  const out: Target[] = [];
  for (const ref of refs) {
    // The one resolver every target reads through: an id or a name, a hero on
    // either side or a foe, as the other acts in a fight read theirs.
    const target = resolveCombatant(encounter.campaignId, encounter, ref);
    if (!target) {
      return `No creature in this fight is "${ref}".`;
    }
    out.push(target.kind === "sheet" ? { kind: "sheet", sheet: target.sheet } : { kind: "enemy", enemy: target.enemy });
  }
  return out;
}

const nameOf = (target: Target) => (target.kind === "sheet" ? target.sheet.name : target.enemy.displayName);
const idOf = (target: Target) => (target.kind === "sheet" ? target.sheet.id : target.enemy.id);
const conditionsOf = (target: Target) => (target.kind === "sheet" ? target.sheet.conditions : target.enemy.conditions);
const metaOf = (target: Target) =>
  (target.kind === "sheet" ? target.sheet.conditionMeta : target.enemy.conditionMeta) as Record<string, { source?: string } | undefined>;
const sizeOf = (target: Target) => (target.kind === "sheet" ? sizeForRace(target.sheet.race) : (target.enemy.stats.size ?? "Medium"));

function grappledBy(target: Target, holderId: string): boolean {
  const meta = metaOf(target);
  return conditionsOf(target).some((name) => name.trim().toLowerCase() === "grappled" && meta?.[name]?.source === holderId);
}

// Feet between two creatures on the board, or null off it.
function feetBetween(encounter: Encounter, a: string, b: string): number | null {
  const map = getBattleMapForEncounter(encounter.id);
  const from = map ? getTokenByRef(map.id, a) : null;
  const to = map ? getTokenByRef(map.id, b) : null;
  return from && to ? Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y)) * 5 : null;
}

// What must hold before the action is spent, in the words a refusal uses;
// null when the call may go on.
function refusalBefore(encounter: Encounter, enemy: EncounterEnemy, option: string, route: LegendaryRoute, targets: Target[], args: PlayArgs): string | null {
  const needs = routeNeeds(route);
  if (needs.target === "one" && targets.length !== 1) {
    return `${option} is aimed at one creature: name it.`;
  }
  if (needs.target === "many" && !targets.length) {
    return `${option} needs the creatures it reaches: name them.`;
  }
  if (needs.square === "required" && (args.x === undefined || args.y === undefined)) {
    return `${option} needs the square it goes to: name its column and row.`;
  }
  if (needs.spell && !args.spell) {
    return `${option} casts a spell from ${enemy.displayName}'s list: name it.`;
  }
  // A creature inside a swallower, or a swallower's creature reaching out,
  // is refused before the action is spent (swallow.ts): the steps that
  // dispatch to enemy_attack refused only after it, and a ward, a drain or
  // a fling none at all.
  for (const target of targets) {
    const inside = idOf(target) === enemy.id ? null : swallowCover({ kind: "enemy", id: enemy.id }, { kind: target.kind, id: idOf(target) });
    if (inside) {
      return inside;
    }
  }
  for (const step of route.steps) {
    if (step.kind === "save" && step.most !== null && targets.length > step.most) {
      return `${step.ability} reaches at most ${step.most} creature${step.most === 1 ? "" : "s"}.`;
    }
    if (step.kind === "spell" && args.spell) {
      const listed = findMonsterSpell(enemy.stats.spellcasting, args.spell);
      if (step.cantrip && listed && listed.level !== 0) {
        return `${option} casts a cantrip, and ${listed.name} is a level ${listed.level} spell.`;
      }
    }
    if ((step.kind === "swallow" || step.kind === "fling") && targets[0]) {
      if (!grappledBy(targets[0], enemy.id)) {
        return `${nameOf(targets[0])} is not grappled by ${enemy.displayName}; ${option} takes a creature it holds.`;
      }
      if (step.maxSize && sizeRank(sizeOf(targets[0])) > sizeRank(step.maxSize)) {
        return `${nameOf(targets[0])} is too big: ${option} takes a ${step.maxSize} or smaller creature.`;
      }
    }
    if (step.kind === "drain" && targets[0] && (targets[0].kind !== "sheet" || !charmedBy(conditionsOf(targets[0]), metaOf(targets[0]), enemy.id))) {
      return `${option} reaches only a creature ${enemy.displayName} has charmed, and ${nameOf(targets[0])} is not.`;
    }
    if ((step.kind === "ward" || step.kind === "noRegain") && step.feet) {
      const far = targets.find((target) => idOf(target) !== enemy.id && (feetBetween(encounter, enemy.id, idOf(target)) ?? 0) > step.feet);
      if (far) {
        return `${nameOf(far)} is beyond the ${step.feet} feet ${option} reaches.`;
      }
    }
  }
  return null;
}

// The ids a tool's lists take: characters, then enemy rows.
function split(targets: Target[]): { characterIds: string[]; enemyIds: string[] } {
  return {
    characterIds: targets.filter((target) => target.kind === "sheet").map(idOf),
    enemyIds: targets.filter((target) => target.kind === "enemy").map(idOf),
  };
}

const onTarget = (target: Target) => (target.kind === "sheet" ? { characterId: target.sheet.id } : { enemyId: target.enemy.id });

// A save or a spell on its creatures: cast_at_player on one character,
// aoe_damage on several or on a creature's row.
async function castOn(dispatch: Dispatch, enemy: EncounterEnemy, targets: Target[], named: { enemyAbility: string } | { spell: string }): Promise<ToolResult> {
  const lists = split(targets);
  if (targets.length === 1 && targets[0].kind === "sheet") {
    return dispatch("cast_at_player", { characterId: targets[0].sheet.id, casterEnemyId: enemy.id, ...named });
  }
  return dispatch("aoe_damage", {
    casterEnemyId: enemy.id,
    ...named,
    ...(lists.characterIds.length ? { characterIds: lists.characterIds } : {}),
    ...(lists.enemyIds.length ? { enemyIds: lists.enemyIds } : {}),
  });
}

// The kraken's Fling: a creature it grapples thrown in a random direction
// (a d8 the server rolls), up to the line's feet, and knocked prone. A wall,
// the board's edge or a creature in the way stops it: it takes the line's
// dice for every 10 feet it flew, and a creature it was thrown at saves or
// takes the same and falls prone too (SRD 5.1).
async function fling(
  campaign: Campaign,
  turn: DmTurn,
  dispatch: Dispatch,
  enemy: EncounterEnemy,
  target: Target,
  step: Extract<LegendaryStep, { kind: "fling" }>,
): Promise<ToolResult> {
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, idOf(target)) : null;
  if (!map || !token) {
    return { error: `${nameOf(target)} is on no battle map to be thrown across.`, retry: true };
  }
  const DIRECTIONS = [
    [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
  ] as const;
  const face = dmRoll(campaign.id, turn, "custom", `${enemy.displayName}: Fling's direction`, "1d8").total;
  const [dx, dy] = DIRECTIONS[(Math.max(1, Math.min(8, face)) - 1) % 8];
  // The thrower's own squares are where the throw starts from, not a
  // creature it strikes or a place it lands.
  const thrower = getTokenByRef(map.id, enemy.id);
  const reach = FOOTPRINT[String(enemy.stats.size ?? "Medium").toLowerCase()] ?? 1;
  const underThrower = (x: number, y: number) => Boolean(thrower && x >= thrower.x && x < thrower.x + reach && y >= thrower.y && y < thrower.y + reach);
  const tokens = listTokens(map.id).filter((entry) => entry.id !== token.id && entry.id !== thrower?.id);
  let at = { x: token.x, y: token.y };
  let landed = at;
  let struck: { kind: "surface" } | { kind: "creature"; refId: string; tokenKind: string } | null = null;
  for (let steps = 0; steps < Math.floor(step.feet / 5); steps += 1) {
    const next = { x: at.x + dx, y: at.y + dy };
    if (!inBounds(map.width, map.height, next.x, next.y) || blocksMove(tileAt(map.terrain, map.width, next.x, next.y))) {
      struck = { kind: "surface" };
      break;
    }
    const other = tokens.find((entry) => entry.x === next.x && entry.y === next.y && (entry.kind === "pc" || entry.kind === "enemy"));
    if (other) {
      struck = { kind: "creature", refId: other.refId, tokenKind: other.kind };
      break;
    }
    at = next;
    if (!underThrower(at.x, at.y)) {
      landed = at;
    }
  }
  at = landed;
  const flownFeet = Math.max(Math.abs(at.x - token.x), Math.abs(at.y - token.y)) * 5;
  if (at.x !== token.x || at.y !== token.y) {
    placeToken(token.id, at.x, at.y);
    publishBattleMapUpdate(campaign.id);
  }
  const out: Record<string, unknown> = { flung: `${nameOf(target)} is thrown ${flownFeet} feet to (${at.x},${at.y}) and lands prone.` };
  await dispatch("clear_condition", { ...onTarget(target), condition: "grappled" });
  await dispatch("set_condition", { ...onTarget(target), condition: "prone", sourceEnemyId: enemy.id });
  const count = Math.floor(flownFeet / 10);
  const dice = count > 0 ? step.dice.replace(/^1d/, `${count}d`) : null;
  if (struck && dice) {
    const amount = dmRoll(campaign.id, turn, "custom", `${nameOf(target)}: thrown into ${struck.kind === "surface" ? "a solid surface" : "a creature"}`, dice).total;
    const hurt = await dispatch("apply_damage", { ...onTarget(target), amount: Math.max(1, amount), type: "bludgeoning", reason: `thrown by ${enemy.displayName}` });
    out.thrownDamage = typeof hurt.error === "string" ? hurt.error : `${nameOf(target)} strikes ${struck.kind === "surface" ? "a solid surface" : "a creature"} and takes ${amount} bludgeoning damage.`;
    if (struck.kind === "creature" && step.dc) {
      const caught = await dispatch("aoe_damage", {
        dc: step.dc,
        saveAbility: "dex",
        damage: dice,
        type: "bludgeoning",
        halfOnSave: false,
        condition: "prone",
        ...(struck.tokenKind === "pc" ? { characterIds: [struck.refId] } : { enemyIds: [struck.refId] }),
        reason: `${nameOf(target)} thrown into them`,
      });
      out.struckCreature = caught;
    }
  }
  return { ok: true, ...out };
}

// What a legendary action lays "until the end of the <creature>'s next turn"
// (SRD 5.1: Channel Negative Energy, Shimmering Shield) is tied to that turn
// (src/lib/dm/turn-end.ts untilTurnEndOf), not counted in rounds. A round
// counted ended it at the next round's start, before that turn when the
// creature acts later in the order than whoever took the shield or the
// curse, and after it when the creature acts earlier.
function untilItsTurnEnds(campaign: Campaign, target: Target, condition: string, enemy: EncounterEnemy) {
  tieToTurn(
    campaign,
    target.kind === "sheet" ? { kind: "sheet", id: target.sheet.id } : { kind: "enemy", id: target.enemy.id },
    condition,
    enemy.id,
    { edge: "end", turnOf: enemy.id },
    `${condition} lasts until the end of ${enemy.displayName}'s next turn`,
  );
}

// A condition from the creature on a character or on a creature's row. The
// dispatcher takes the engine's own tools, which keep a row's conditions
// apart: set_condition with an enemyId refused "Unknown characterId".
function layCondition(dispatch: Dispatch, target: Target, condition: string, enemy: EncounterEnemy): Promise<ToolResult> {
  return target.kind === "sheet"
    ? dispatch("set_condition", { characterId: target.sheet.id, condition, sourceEnemyId: enemy.id })
    : dispatch("set_enemy_condition", { enemyId: target.enemy.id, condition, sourceEnemyId: enemy.id });
}

// A mummy lord's Channel Negative Energy: no creature it reaches regains hit
// points until the end of its next turn.
async function denyHealing(campaign: Campaign, dispatch: Dispatch, enemy: EncounterEnemy, targets: Target[]): Promise<ToolResult> {
  const laid: string[] = [];
  for (const target of targets) {
    const out = await layCondition(dispatch, target, NEGATIVE_ENERGY, enemy);
    if (typeof out.error === "string") {
      return laid.length ? { ok: true, noHealing: laid, refusedFor: `${nameOf(target)}: ${out.error}` } : out;
    }
    untilItsTurnEnds(campaign, target, NEGATIVE_ENERGY, enemy);
    laid.push(nameOf(target));
  }
  return { ok: true, noHealing: `${laid.join(", ")} cannot regain hit points until the end of ${enemy.displayName}'s next turn.` };
}

// A unicorn's Shimmering Shield: the AC bonus on itself or a creature it
// sees until the end of its next turn. The SRD's one ward is a condition
// with its bonus (src/lib/srd/condition-effects.ts), so the turn it ends
// with can hold it; an option the conditions do not carry at that bonus (a
// pack's own) keeps the effect counted in rounds, the one way an effect
// ends.
async function ward(campaign: Campaign, dispatch: Dispatch, enemy: EncounterEnemy, target: Target, option: string, ac: number): Promise<ToolResult> {
  if (conditionEffectsFor(option)?.acBonus === ac) {
    const out = await layCondition(dispatch, target, textKey(option), enemy);
    if (typeof out.error === "string") {
      return out;
    }
    untilItsTurnEnds(campaign, target, option, enemy);
    return { ok: true, ward: `${nameOf(target)} gains +${ac} to AC until the end of ${enemy.displayName}'s next turn.` };
  }
  return dispatch("set_effect", {
    ...onTarget(target),
    name: option,
    source: enemy.displayName,
    modifiers: [{ field: "ac", mode: "add", value: ac }],
    duration: "rounds",
    remaining: 1,
    visible: true,
  });
}

// An aboleth's Psychic Drain: the damage a creature it charms takes, and the
// hit points it regains by as much.
async function drain(campaign: Campaign, turn: DmTurn, dispatch: Dispatch, enemy: EncounterEnemy, target: Target, step: Extract<LegendaryStep, { kind: "drain" }>, option: string): Promise<ToolResult> {
  if (target.kind !== "sheet") {
    return { error: `${option} reaches a character ${enemy.displayName} has charmed.`, retry: true };
  }
  const before = getSheetById(target.sheet.id) ?? target.sheet;
  const amount = dmRoll(campaign.id, turn, "custom", `${enemy.displayName}: ${option}`, step.dice).total;
  const hurt = await dispatch("apply_damage", { characterId: before.id, amount: Math.max(1, amount), type: step.type || undefined, magical: true, reason: option });
  if (typeof hurt.error === "string") {
    return hurt;
  }
  const after = getSheetById(before.id) ?? before;
  const taken = Math.max(0, before.currentHp - after.currentHp) + Math.max(0, (before.tempHp ?? 0) - (after.tempHp ?? 0));
  const self = getEnemy(enemy.id) ?? enemy;
  const blocked = regainBlockedBy({ conditions: self.conditions, currentHp: self.currentHp });
  const healed = blocked ? self.currentHp : Math.min(enemyHpCap(self), self.currentHp + taken);
  if (healed > self.currentHp) {
    patchEnemyHp(self.id, healed, "alive");
  }
  return { ...hurt, drained: blocked ? `${enemy.displayName} cannot regain hit points while ${blocked} holds it.` : `${enemy.displayName} regains ${healed - self.currentHp} hit points.` };
}

async function playStep(
  campaign: Campaign,
  turn: DmTurn,
  dispatch: Dispatch,
  enemy: EncounterEnemy,
  option: string,
  step: LegendaryStep,
  targets: Target[],
  args: PlayArgs,
): Promise<ToolResult | null> {
  switch (step.kind) {
    case "attack":
      return dispatch("enemy_attack", {
        enemyId: enemy.id,
        targetCharacterId: idOf(targets[0]),
        attack: step.attack,
        ...(args.advantage && args.advantage !== "none" ? { advantage: args.advantage } : {}),
      });
    case "swallow":
      // The creature's own Swallow, as its action plays it (enemy_attack
      // naming the entry, src/lib/dm/swallow.ts): the bite, and on a hit the
      // swallow with the block's acid, cover, regurgitation and corpse.
      return dispatch("enemy_attack", { enemyId: enemy.id, targetCharacterId: idOf(targets[0]), attack: step.entry });
    case "save":
      return castOn(dispatch, enemy, targets, { enemyAbility: step.ability });
    case "spell": {
      // An attack-roll spell is enemy_attack's to roll; a save spell the
      // save tools'.
      const spell = args.spell ?? "";
      if (spellMechanicsFor({ spell, userIds: spellAuthorsFor(campaign) })?.mech.attack) {
        return targets.length === 1
          ? dispatch("enemy_attack", { enemyId: enemy.id, targetCharacterId: idOf(targets[0]), spell })
          : { error: `${spell} is cast with an attack roll at one creature: name one.`, retry: true };
      }
      return castOn(dispatch, enemy, targets, { spell });
    }
    case "move":
      if (args.x === undefined || args.y === undefined) {
        return null;
      }
      return handleMoveToken(campaign, JSON.stringify({ token: enemy.id, x: args.x, y: args.y }), [], new Map(), turn, legendaryMoveFor(enemy, step));
    case "teleport":
      return dispatch("teleport_token", { token: enemy.id, x: args.x, y: args.y });
    case "ward":
      return ward(campaign, dispatch, enemy, targets[0], option, step.ac);
    case "noRegain":
      return denyHealing(campaign, dispatch, enemy, targets);
    case "drain":
      return drain(campaign, turn, dispatch, enemy, targets[0], step, option);
    case "fling":
      return fling(campaign, turn, dispatch, enemy, targets[0], step);
    default:
      // A check, hit points regained, a cloud: the spend made them.
      return null;
  }
}

export async function playLegendaryAction(campaign: Campaign, turn: DmTurn, rawArguments: string, dispatch: Dispatch): Promise<ToolResult> {
  let args: PlayArgs;
  try {
    args = playSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: legendary_action needs enemyId and action, and its targets as ids.", error, rawArguments);
  }
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter: legendary actions are taken only in a fight.", retry: true };
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return unknownEnemyRef(encounter.id, "enemyId", args.enemyId);
  }
  const option = legendaryProfile(enemy.stats)?.actions.find((entry) => isNamed(args.action, entry.name));
  // The spend refuses an option the block does not list, with the ones it does.
  const routes = option ? legendaryRoutes(enemy.stats, option) : [];
  const route = option ? routeNamed(routes, args.use) : null;
  if (option && route) {
    const needs = routeNeeds(route);
    if (
      turn.actor === "ai" &&
      ((needs.square === "required" && (args.x === undefined || args.y === undefined)) || (needs.spell && !args.spell))
    ) {
      // The model's legendary_action names a target only: a move, a jump or
      // a spell is spent here and made by the call its result's next names.
      return dispatch("legendary_action", { enemyId: enemy.id, action: option.name, ...(args.use ? { use: route.use } : {}) });
    }
    const targets = targetsOf(encounter, args);
    if (typeof targets === "string") {
      return { error: `${targets} Nothing was spent.`, retry: true };
    }
    const before = refusalBefore(encounter, enemy, option.name, route, targets, args);
    if (before) {
      return { error: `${before} Nothing was spent.`, retry: true };
    }
    const spent = await dispatch("legendary_action", { enemyId: enemy.id, action: option.name, ...(args.use ? { use: route.use } : {}) });
    if (typeof spent.error === "string") {
      return spent;
    }
    const results: ToolResult[] = [];
    for (const [index, step] of route.steps.entries()) {
      const out = await playStep(campaign, turn, dispatch, enemy, option.name, step, targets, args);
      if (!out) {
        continue;
      }
      if (typeof out.error === "string") {
        if (index === 0 || !(step.kind === "move" && step.optional)) {
          // The engine's own reason, and the action given back (a follow-up
          // the console dispatch saw refused gave it back already).
          const kept = refundLegendaryPurchase(campaign, enemy.id);
          return { ...out, error: kept && !out.error.includes(kept) ? `${out.error} ${kept}` : out.error };
        }
        // Wing Attack's flight after the save that landed: the save stands.
        results.push({ flightRefused: out.error });
        continue;
      }
      results.push(out);
    }
    closeLegendaryPurchase(campaign, enemy.id);
    // What the spend hands on is done here, not a step left to take.
    const spend: ToolResult = { ...spent };
    delete spend.next;
    return Object.assign({}, spend, ...results);
  }
  // An option the block does not list, or one the server cannot read: the
  // spend alone, which refuses the first and says the second is the GM's.
  return dispatch("legendary_action", { enemyId: args.enemyId, action: args.action, ...(args.use ? { use: args.use } : {}) });
}
