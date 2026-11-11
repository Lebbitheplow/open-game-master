// An Echo Knight's echo on the board (Manifest Echo, Unleash Incarnation,
// Legion of One). The echo was a mark on the knight and nothing else, so its
// square, the 30 feet it may stray, the swap and the attacks "from its space"
// were the GM's to imagine. It is a token now: a prop (no stat block, so no
// condition and no targeted effect can land on it: "immunity to all
// conditions"), kept beside the mark ECHO_OUT, which stays what the other
// features ask (Shadow Martyr, Unleash Incarnation) and what holds with no
// board. Everything that places, moves, reads or removes an echo goes through
// here:
//   - use_resource Manifest Echo (authored-spend-effects.ts) manifests it, and
//     its variants swap places with it or dismiss it;
//   - move_token moves it (map-tools.ts handleMoveToken), 30 feet a turn;
//   - a melee attack is made from its square when that is the nearer one
//     (map-tools.ts checkPcAttackRange and pcAttackSpatials);
//   - Unleash Incarnation asks for a creature in reach of it;
//   - the settle points (rage-bound.ts) and the turn's end (turn-end.ts)
//     destroy it.

import { getBattleMapForEncounter, getTokenByRef, insertToken, listTokens, moveToken, removeTokenByRef, type BattleMap } from "@/lib/db/battle-maps";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, listEnemies, saveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { publishEphemeral } from "@/lib/events";
import { blocksMove, tileAt, tileIndex, type BattleToken } from "@/lib/battlemap/types";
import { footprintLookup, occupiedTiles, pcMoveBudget } from "@/lib/battlemap/view";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { tilesApart } from "@/lib/dm/board-reach";
import { isIncapacitated, removeConditions } from "@/lib/dm/condition-logic";
import { spendEnemyAction } from "@/lib/dm/enemy-approach";
import { attackNamed } from "@/lib/dm/enemy-profile";
import { ownTurnOf } from "@/lib/dm/held-turn";
import { recordTrigger } from "@/lib/dm/last-save";
import { enemyAttacker, rollCard } from "@/lib/dm/roll-card";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { noneNamed, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import type { Ability, CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { ECHO_OUT } from "@/lib/srd/authored-effects-data-b";
import { holdsFeature, isConditionNamed, isNamed } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";

const FEET = 5;
// "In an unoccupied space within 15 feet", "move up to 30 feet", "destroyed if
// it ends your turn more than 30 feet from you", "for 15 feet of your movement".
const MANIFEST_TILES = 15 / FEET;
const STRAY_TILES = 30 / FEET;
const SWAP_TILES = 15 / FEET;
const ECHO_REFS = ["echo:", "echo2:"] as const;

type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };
type Square = { x: number; y: number };

const refuse = (text: string): ToolError => ({ error: `${text} Nothing was spent.`, refused: "rules" });
const apart = (a: Square, b: Square) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const published = (campaignId: string) => publishEphemeral(campaignId, "battle_map_updated", {});

// Whose echo a token is, or null for any other token.
export function echoOwnerOf(token: Pick<BattleToken, "kind" | "refId">): string | null {
  const prefix = token.kind === "prop" ? ECHO_REFS.find((ref) => token.refId.startsWith(ref)) : undefined;
  return prefix ? token.refId.slice(prefix.length) : null;
}

// A knight's echoes on a board: one, or two with Legion of One, the older first.
export function echoTokens(mapId: string, sheetId: string): BattleToken[] {
  return ECHO_REFS.map((ref) => getTokenByRef(mapId, `${ref}${sheetId}`)).filter((token): token is BattleToken => token !== null);
}

function boardOf(campaignId: string): { encounter: Encounter; map: BattleMap } | null {
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  return encounter && map ? { encounter, map } : null;
}

function openAt(encounterId: string, map: BattleMap, at: Square, mover: BattleToken | null): boolean {
  if (at.x < 0 || at.y < 0 || at.x >= map.width || at.y >= map.height || blocksMove(tileAt(map.terrain, map.width, at.x, at.y))) {
    return false;
  }
  const enemiesById = new Map(listEnemies(encounterId).map((enemy) => [enemy.id, enemy]));
  return !occupiedTiles(map, listTokens(map.id), mover, footprintLookup(enemiesById)).has(tileIndex(map.width, at.x, at.y));
}

// The open square within 15 feet of the knight nearest `toward` (a creature
// the echo is sent at), else nearest the knight.
function manifestSquare(encounterId: string, map: BattleMap, knight: BattleToken, toward: BattleToken | null): Square | null {
  let best: { at: Square; score: number } | null = null;
  for (let x = knight.x - MANIFEST_TILES; x <= knight.x + MANIFEST_TILES; x += 1) {
    for (let y = knight.y - MANIFEST_TILES; y <= knight.y + MANIFEST_TILES; y += 1) {
      const at = { x, y };
      if (!openAt(encounterId, map, at, null)) continue;
      const score = toward ? tilesApart({ ...knight, x, y }, toward) * 100 + apart(at, knight) : apart(at, knight);
      if (!best || score < best.score) best = { at, score };
    }
  }
  return best?.at ?? null;
}

// Takes the echoes off the board and the mark off the knight. Returns the
// table line, or null when there was nothing to end.
export function endEcho(campaignId: string, sheetId: string, why: string): string | null {
  const board = boardOf(campaignId);
  const tokens = board ? echoTokens(board.map.id, sheetId) : [];
  for (const token of tokens) removeTokenByRef(board!.map.id, token.refId);
  const sheet = getSheetById(sheetId);
  const marks = sheet ? sheet.conditions.filter((entry) => isConditionNamed(entry, ECHO_OUT)) : [];
  if (sheet && marks.length) {
    const cleared = removeConditions(sheet.conditions, sheet.conditionMeta as Parameters<typeof removeConditions>[1], marks);
    patchSheetAudited(campaignId, sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta }, { kind: "condition_clock", reason: `their echo is gone: ${why}`, delta: { ended: marks } });
  }
  if (tokens.length) published(campaignId);
  return sheet && (tokens.length || marks.length) ? `${sheet.name}'s echo is gone: ${why}.` : null;
}

// One echo destroyed (1 hit point: a hit, or damage an area deals it): the
// one `pick` names by its token, else the one nearest the creature `pick`
// names (Shadow Martyr's ally), else the older. With Legion of One the other
// stays out, and the knight's mark goes only with the last. Every door that
// destroys an echo goes through here; endEcho is for all of them at once.
export function destroyEcho(campaignId: string, sheetId: string, pick: { refId?: string; nearRef?: string }, why: string): string | null {
  const board = boardOf(campaignId);
  const tokens = board ? echoTokens(board.map.id, sheetId) : [];
  if (tokens.length <= 1) {
    return endEcho(campaignId, sheetId, why);
  }
  const near = pick.nearRef && board ? getTokenByRef(board.map.id, pick.nearRef) : null;
  const named = pick.refId ? tokens.find((token) => token.refId === pick.refId) : undefined;
  const gone = named ?? (near ? [...tokens].sort((a, b) => apart(a, near) - apart(b, near))[0] : tokens[0]);
  removeTokenByRef(board!.map.id, gone.refId);
  published(campaignId);
  const sheet = getSheetById(sheetId);
  return `${sheet?.name ?? "The knight"}'s echo at (${gone.x},${gone.y}) is destroyed (${why}); the other stays.`;
}

// An area's save asked of an echo standing in it (aoe-damage.ts, for each echo
// the blast's squares hold: aoe-shape.ts creaturesInBlast): "If it has to make
// a saving throw, it uses your saving throw bonus for the roll." With 1 hit
// point any damage destroys it: a failed save, or a made one that still
// halves the damage. It is immune to every condition, so an area that only
// lays one leaves it standing.
export function echoAreaSave(
  campaign: Campaign,
  turn: DmTurn | null,
  refId: string,
  input: { ability: Ability; dc: number; damage: number; halfOnSave: boolean; label: string },
): Record<string, unknown> | null {
  const owner = echoOwnerOf({ kind: "prop", refId });
  const sheet = owner ? getSheetById(owner) : null;
  if (!sheet) {
    return null;
  }
  const mod = computeSheetDerived(sheet).saves[input.ability];
  const roll = rollCard(campaign, turn, sheet.id, "custom", `${sheet.name}'s echo: ${input.ability.toUpperCase()} save against ${input.label}`, `1d20${mod >= 0 ? "+" : ""}${mod}`, null);
  const saved = roll.total >= input.dc;
  const destroyed = input.damage > 0 && (!saved || input.halfOnSave);
  const line = destroyed ? destroyEcho(campaign.id, sheet.id, { refId }, `${input.label} caught it`) : null;
  return { target: `${sheet.name}'s echo`, save: roll.total, dc: input.dc, saved, destroyed, ...(line ? { note: line } : {}) };
}

// The settle points' sweep (rage-bound.ts endRageBound's callers: a turn's
// tick and end, an attack either way). "Lasting until it is destroyed, you
// dismiss it, you manifest another or you are incapacitated": a knight who is
// incapacitated or at 0 hit points loses the echo, and an echo whose mark has
// gone (the GM took the condition off, or it ran out) leaves the board.
export function endLostEchoes(campaignId: string): string[] {
  const lines: string[] = [];
  const board = boardOf(campaignId);
  const owners = new Set(board ? listTokens(board.map.id).map(echoOwnerOf) : []);
  for (const stale of listSheets(campaignId)) {
    // Read fresh only for a knight with an echo to lose: this runs at every
    // settle point, for every table.
    if (!owners.has(stale.id) && !stale.conditions.some((entry) => isConditionNamed(entry, ECHO_OUT))) continue;
    const sheet = getSheetById(stale.id) ?? stale;
    const marked = sheet.conditions.some((entry) => isConditionNamed(entry, ECHO_OUT));
    const onBoard = board ? echoTokens(board.map.id, sheet.id).length > 0 : false;
    if (!marked && !onBoard) continue;
    const line = !marked
      ? endEcho(campaignId, sheet.id, "it was destroyed or dismissed")
      : sheet.currentHp <= 0 || isIncapacitated(sheet.conditions)
        ? endEcho(campaignId, sheet.id, `${sheet.name} is incapacitated`)
        : null;
    if (line) lines.push(line);
  }
  return lines;
}

// As a knight's turn ends: an echo more than 30 feet from them is destroyed.
// With two out (Legion of One) each is measured on its own.
export function echoTurnEnd(campaign: Campaign, combatantIds: string[]): string[] {
  const lines: string[] = [];
  const board = boardOf(campaign.id);
  if (!board) return lines;
  for (const id of combatantIds) {
    const knight = getTokenByRef(board.map.id, id);
    const echoes = knight ? echoTokens(board.map.id, id) : [];
    const far = echoes.filter((echo) => apart(echo, knight!) > STRAY_TILES);
    if (!far.length) continue;
    const name = getSheetById(id)?.name ?? knight!.name;
    if (far.length === echoes.length) {
      const line = endEcho(campaign.id, id, `it ended ${name}'s turn more than 30 feet from them`);
      if (line) lines.push(line);
      continue;
    }
    for (const echo of far) removeTokenByRef(board.map.id, echo.refId);
    published(campaign.id);
    lines.push(`One of ${name}'s echoes is gone: it ended their turn more than 30 feet from them.`);
  }
  return lines;
}

function manifest(ctx: SpendContext): Resolution {
  const { sheet, campaign } = ctx;
  const meta = { ...(sheet.conditionMeta ?? {}), [ECHO_OUT]: { rounds: 600 } };
  const patch: FullPatchSheetInput = { conditions: [...new Set([...sheet.conditions, ECHO_OUT])], conditionMeta: meta as FullPatchSheetInput["conditionMeta"] };
  const board = boardOf(campaign.id);
  const knight = board ? getTokenByRef(board.map.id, sheet.id) : null;
  if (!board || !knight) {
    return { patch, result: { applied: `${sheet.name}'s echo stands within 15 feet of them (no board to place it on): AC ${14 + proficiency(sheet)}, 1 hit point.` } };
  }
  const { encounter, map } = board;
  const toward = ctx.args.targetEnemyId ? resolveTargetFoe(campaign.id, encounter, ctx.args.targetEnemyId) : null;
  const at = manifestSquare(encounter.id, map, knight, toward ? getTokenByRef(map.id, toward.id) : null);
  if (!at) {
    return refuse(`There is no unoccupied space within 15 feet of ${sheet.name} for the echo.`);
  }
  // "You manifest another": the new echo takes the place of the one out. With
  // Legion of One two stand at once, and a third replaces the older.
  const out = echoTokens(map.id, sheet.id);
  const both = holdsFeature(sheet, "Legion of One");
  const ref = both && out.length === 1 ? ECHO_REFS.find((prefix) => !out[0].refId.startsWith(prefix))! : (out[0]?.refId.slice(0, out[0].refId.indexOf(":") + 1) ?? ECHO_REFS[0]);
  removeTokenByRef(map.id, `${ref}${sheet.id}`);
  insertToken({ mapId: map.id, campaignId: campaign.id, kind: "prop", refId: `${ref}${sheet.id}`, name: `${sheet.name}'s echo`, x: at.x, y: at.y });
  published(campaign.id);
  const count = echoTokens(map.id, sheet.id).length;
  return {
    patch,
    result: {
      applied: `${sheet.name}'s echo stands at (${at.x},${at.y}), ${apart(at, knight) * FEET} feet from them${count > 1 ? " (two echoes out, Legion of One)" : ""}: AC ${14 + proficiency(sheet)}, 1 hit point. On their turn move_token "${sheet.name}'s echo" moves it up to 30 feet for no action, variant "swap" trades places with it (a bonus action and 15 feet of movement), and a melee attack reaches from its square. It is destroyed if it ends their turn more than 30 feet from them.`,
      echoAt: at,
    },
  };
}

function proficiency(sheet: CharacterSheet): number {
  return computeSheetDerived(sheet).proficiencyBonus;
}

function swap(ctx: SpendContext): Resolution {
  const { sheet, campaign } = ctx;
  const board = boardOf(campaign.id);
  const knight = board ? getTokenByRef(board.map.id, sheet.id) : null;
  const echoes = board ? echoTokens(board.map.id, sheet.id) : [];
  if (!board || !knight || !echoes.length) {
    return refuse(`${sheet.name} has no echo on the board to swap places with: use_resource Manifest Echo first.`);
  }
  // The farther echo when two are out: the swap is for the distance.
  const echo = [...echoes].sort((a, b) => apart(b, knight) - apart(a, knight))[0];
  const left = pcMoveBudget(campaign.id, board.encounter, board.map, sheet, knight).tiles;
  if (left < SWAP_TILES) {
    return refuse(`Swapping places with the echo costs 15 feet of movement, and ${sheet.name} has ${left * FEET} feet left this turn.`);
  }
  const from = { x: knight.x, y: knight.y };
  // A teleport: nothing is walked, so nothing along the way is provoked.
  moveToken(knight.id, echo.x, echo.y, knight.movedThisRound + SWAP_TILES);
  moveToken(echo.id, from.x, from.y, echo.movedThisRound);
  published(campaign.id);
  return { result: { applied: `${sheet.name} and their echo trade places: ${sheet.name} at (${echo.x},${echo.y}), the echo at (${from.x},${from.y}). 15 feet of movement spent, ${(left - SWAP_TILES) * FEET} feet left.` } };
}

// use_resource Manifest Echo: the echo manifested (no variant), or one of the
// things its bonus action does instead.
export function echoSpend(ctx: SpendContext): Resolution {
  const variant = ctx.args.variant ?? "";
  if (isNamed(variant, "swap", "swap places")) {
    return swap(ctx);
  }
  if (isNamed(variant, "dismiss")) {
    const line = endEcho(ctx.campaign.id, ctx.sheet.id, "dismissed");
    return line ? { result: { applied: line } } : refuse(`${ctx.sheet.name} has no echo out to dismiss.`);
  }
  if (variant && !isNamed(variant, "manifest")) {
    return { error: `${ctx.spend.name} takes no variant to manifest the echo, or "swap" or "dismiss". Nothing was spent.`, retry: true };
  }
  return manifest(ctx);
}

// move_token on an echo: null when the token named is no echo, so the door's
// own resolution runs. "On your turn you can command it to move up to 30
// feet in any direction (no action required)": any open square, 30 feet a
// turn in all, on the knight's own turn. `forced` is the table's own hand
// (a person GM setting it right), which counts no feet.
export function moveEcho(campaign: Campaign, encounter: Encounter, map: BattleMap, args: { token: string; x: number; y: number; forced?: boolean }): ToolResult | null {
  const wanted = args.token.trim();
  const echo = listTokens(map.id).find((token) => echoOwnerOf(token) !== null && (token.id === wanted || token.refId === wanted || textKey(token.name) === textKey(wanted)));
  const ownerId = echo ? echoOwnerOf(echo) : null;
  if (!echo || !ownerId) {
    return null;
  }
  if (!openAt(encounter.id, map, args, echo)) {
    return { error: `(${args.x},${args.y}) is no open square on the ${map.width}x${map.height} map: the echo moves to an unoccupied space. Nothing was moved.`, retry: true };
  }
  const tiles = apart(echo, args);
  if (!args.forced) {
    if (!ownTurnOf(encounter, ownerId)) {
      return { error: `${echo.name} moves on its knight's own turn only. Nothing was moved.`, refused: "rules" };
    }
    if (echo.movedThisRound + tiles > STRAY_TILES) {
      return { error: `${echo.name} moves up to 30 feet a turn: it has ${(STRAY_TILES - echo.movedThisRound) * FEET} feet left and (${args.x},${args.y}) is ${tiles * FEET} feet off. Nothing was moved.`, retry: true };
    }
  }
  moveToken(echo.id, args.x, args.y, args.forced ? echo.movedThisRound : echo.movedThisRound + tiles);
  published(campaign.id);
  const knight = getTokenByRef(map.id, ownerId);
  const far = knight ? apart(args, knight) : 0;
  return {
    moved: `${echo.name} is at (${args.x},${args.y})${knight ? `, ${far * FEET} feet from its knight` : ""}.${far > STRAY_TILES ? " More than 30 feet: it is destroyed if the knight's turn ends with it there." : ""}`,
  };
}

// The square a melee attack is made from when the echo's is the one to use:
// "make any attack of the Attack action from its space". The nearest of the
// knight and their echoes to the creature attacked, the knight on a tie, so
// an attack the knight reaches on their own is the knight's. A ranged attack
// stays the knight's: which eye it is loosed from is not the engine's to
// choose. Null when the knight's own square is the one.
export function echoStrikeFrom(mapId: string, characterId: string, target: BattleToken): Square | null {
  const own = getTokenByRef(mapId, characterId);
  if (!own) return null;
  let best: { at: Square; tiles: number } | null = null;
  for (const echo of echoTokens(mapId, characterId)) {
    const tiles = tilesApart({ ...own, x: echo.x, y: echo.y }, target);
    if (tiles < tilesApart(own, target) && (!best || tiles < best.tiles)) best = { at: { x: echo.x, y: echo.y }, tiles };
  }
  return best?.at ?? null;
}

// Unleash Incarnation: "make one extra melee attack from your echo's space".
// With the echo on a board, a creature must stand within the reach of it (10
// feet, the longest a weapon in hand gives) for the attack to have anyone to
// land on; otherwise the use would be spent on nothing.
export function unleashRefusal(ctx: SpendContext): ToolError | null {
  const board = boardOf(ctx.campaign.id);
  const echoes = board ? echoTokens(board.map.id, ctx.sheet.id) : [];
  if (!board || !echoes.length) {
    return null;
  }
  const foes = listEnemies(board.encounter.id)
    .filter((enemy) => enemy.status === "alive")
    .map((enemy) => getTokenByRef(board.map.id, enemy.id))
    .filter((token): token is BattleToken => token !== null);
  const reached = echoes.some((echo) => foes.some((foe) => tilesApart(echo, foe) <= 2));
  return reached ? null : refuse(`${ctx.spend.name}'s attack is made from the echo's space, and no creature stands within reach of ${echoes[0].name} at (${echoes[0].x},${echoes[0].y}): move_token the echo beside one first.`);
}

// enemy_attack aimed at an echo by the name the board gives it: null for any
// other target. "It has AC 14 + your proficiency bonus, 1 hit point": the
// creature's attack is rolled against that armor class and a hit destroys the
// echo, whatever the damage. The swing is the creature's action as any other
// is. Destroyed by damage, so Reclaim Potential may answer (trigger-table.ts
// own_echo_destroyed).
export function enemyStrikesEcho(
  campaign: Campaign,
  turn: DmTurn | null,
  encounter: Encounter,
  enemy: EncounterEnemy,
  targetRef: string,
  attackName: string | undefined,
): ToolResult | null {
  const map = getBattleMapForEncounter(encounter.id);
  const wanted = targetRef.trim();
  const echo = map ? listTokens(map.id).find((token) => echoOwnerOf(token) !== null && (token.id === wanted || token.refId === wanted || textKey(token.name) === textKey(wanted))) : null;
  const knight = echo ? getSheetById(echoOwnerOf(echo)!) : null;
  if (!map || !echo || !knight) {
    return null;
  }
  const named = attackName ? attackNamed(enemy.stats.attacks, attackName) : null;
  if (attackName && !named) {
    return noneNamed(`${enemy.displayName} has no attack called`, attackName, enemy.stats.attacks.map((entry) => entry.name));
  }
  // The call named none: its first, as the creature's turn picks one.
  const attack = named ?? enemy.stats.attacks[0];
  if (!attack) {
    return { error: `${enemy.displayName} has no attack on its block to make at ${echo.name}.`, retry: true };
  }
  const ac = 14 + proficiency(knight);
  const rolled = rollCard(campaign, turn, null, "attack", `${enemy.displayName}: ${attack.name} at ${echo.name} (AC ${ac})`, `1d20${attack.toHit >= 0 ? "+" : ""}${attack.toHit}`, enemyAttacker(enemy));
  const natural = rolled.terms.find((term) => term.kind === "dice")?.dice?.[0]?.value ?? 0;
  const hit = natural === 20 || (natural !== 1 && rolled.total >= ac);
  const live = getActiveEncounter(campaign.id) ?? encounter;
  spendEnemyAction(live, enemy.id);
  saveEncounter(live);
  if (!hit) {
    return { hit: false, toHit: rolled.total, applied: `${enemy.displayName}'s ${attack.name} (${rolled.total}) misses ${echo.name} (AC ${ac}).` };
  }
  // One echo of two falls on its own; the last takes the mark with it.
  if (echoTokens(map.id, knight.id).length > 1) {
    removeTokenByRef(map.id, echo.refId);
    published(campaign.id);
  } else {
    endEcho(campaign.id, knight.id, `${enemy.displayName}'s ${attack.name} destroyed it`);
  }
  recordTrigger(campaign.id, { kind: "echo_destroyed", characterId: knight.id, forcer: { id: enemy.id, name: enemy.displayName } });
  return { hit: true, toHit: rolled.total, applied: `${enemy.displayName}'s ${attack.name} (${rolled.total}) hits ${echo.name} (AC ${ac}, 1 hit point) and destroys it.` };
}
