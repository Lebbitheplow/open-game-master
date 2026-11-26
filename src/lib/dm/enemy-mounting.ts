// An enemy gets on or off a mount in the middle of a fight (issue 1091).
//
// "Once during your move, you can mount a creature that is within 5 feet of
// you or dismount. Doing so costs an amount of movement equal to half your
// speed." "A willing creature that is at least one size larger than you and
// that has an appropriate anatomy can serve as a mount" (SRD 5.1, Mounting
// and Dismounting).
//
// A pair was made only as a fight opened (enemy-riders.ts) and parted only
// by force (enemy-rider-falls.ts). mount_up and dismount now take an enemy's
// id in characterId (mount-tools.ts) and come here. The rulings on 1091:
//
//   2. enemies mount enemies only: a riderless enemy of the same fight and
//      side, at least one size larger, within 5 feet of any square it fills,
//      not incapacitated, not prone;
//   3. half the rider's own speed, rounded up to the square, once a move, on
//      its own turn. Getting on ends the rider's own movement; getting down
//      leaves the other half to walk with. A rider at speed 0 does neither.
//      Off its turn it is refused for the GM's tools and free at the console;
//   4. movement belongs to a turn, so a pair made after the mount's turn has
//      nothing to move with until the mount's next one;
//   5. independent unless the call says controlled, and then "the initiative
//      of a controlled mount changes to match yours when you mount it" (SRD
//      5.1, Controlling a Mount): it gives up its own place in the order;
//   6. the pair stands in the mount's space on one token. A rider getting
//      down takes an open square beside the mount, and with none the
//      dismount is refused. Either way is a move, and leaving a reach on it
//      draws an opportunity attack unless the rider Disengaged.
//
// Must not be imported by enemy-riders or enemy-rider-falls: it calls them.

import { footprintDistance, footprintForSize, type Footprint } from "@/lib/battlemap/footprint";
import { forgetMoves } from "@/lib/battlemap/move-undo";
import { openSpace } from "@/lib/battlemap/tactics";
import type { BattleToken, XY } from "@/lib/battlemap/types";
import { footprintLookup, occupiedTiles } from "@/lib/battlemap/view";
import { getBattleMapForEncounter, handTokenTo, listHiddenRefIds, listTokens, moveToken, placeToken, removeTokenByRef, setTokenMovement, type BattleMap } from "@/lib/db/battle-maps";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, listEnemies, saveEncounter, setEnemyInitiative, setEnemyMount, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getMounts } from "@/lib/db/mounts";
import { canEnemyAct, markEnemyActed } from "@/lib/dm/can-act";
import { sideOf } from "@/lib/dm/combatant";
import { afterMoveLeashes } from "@/lib/dm/condition-leash";
import { releaseGrapplesOutOfReach } from "@/lib/dm/grapple";
import { incapacitatedBy } from "@/lib/dm/condition-logic";
import { pairLine } from "@/lib/dm/encounter-spawn";
import { publishEncounter, resolveEnemyRef, unknownEnemyRef } from "@/lib/dm/enemy-damage";
import { mountOf, mountSizeProblem, partPair, riderOf, spendLedMountTurn, unseatLedMounts } from "@/lib/dm/enemy-riders";
import { enemyMoveBudget, enemySpeedTiles } from "@/lib/dm/enemy-speed";
import { enemyTurnEntry, forgetEnemyTurns, recordEnemyTurn } from "@/lib/dm/enemy-turn-logic";
import { enemyTurnRefusal } from "@/lib/dm/enemy-turn-order";
import { ownTurnOf } from "@/lib/dm/held-turn";
import { isKnockedOut } from "@/lib/dm/knockout";
import { tableNoteSeq } from "@/lib/dm/narration-slot";
import { resolvePcOpportunityWalk } from "@/lib/dm/opportunity";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { publishEphemeral, publishWithSeq } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";

type Turn = Pick<DmTurn, "id" | "actor">;
type Fight = { encounter: Encounter; enemy: EncounterEnemy };

const RULE = "SRD 5.1, Mounting and Dismounting";
const isProne = (enemy: Pick<EncounterEnemy, "conditions">) => enemy.conditions.some((entry) => isConditionNamed(entry, "prone"));
const refuse = (error: string): ToolError => ({ error, refused: "rules" });

// The enemy of the running fight that mount_up or dismount named in
// characterId, when no character answers to it (mount-tools.ts).
export function enemyNamedAsRider(campaignId: string, ref: string): Fight | null {
  const encounter = getActiveEncounter(campaignId);
  const enemy = encounter ? resolveEnemyRef(encounter.id, ref) : null;
  return encounter && enemy ? { encounter, enemy } : null;
}

// Told to the table as a character's mounting is (mount-tools.ts): the
// call's result reaches only a model, and a person running the fight from
// the console would see two tokens become one with no word of why. Nothing
// is said of a creature the party cannot see.
function tableNote(campaign: Pick<Campaign, "id">, rider: EncounterEnemy, content: string) {
  const map = getBattleMapForEncounter(rider.encounterId);
  if (map && listHiddenRefIds(map.id).includes(rider.id)) {
    return;
  }
  const seq = tableNoteSeq(campaign.id);
  const message = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "system", glyph: "cue-travel", content });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

// Whether this enemy's turn has come this round, as move_token asks it of the
// AI (enemy-turn-order.ts), whoever is calling: the console is refused
// nothing, but is charged only on a turn that is running.
function turnHasCome(encounter: Encounter, enemy: EncounterEnemy, turn: Turn | undefined): boolean {
  // A creature the pointer rests on is on its turn (enemyFleeTurnRefusal).
  if (ownTurnOf(encounter, enemy.ledBy ?? enemy.id)) {
    return true;
  }
  return enemyTurnRefusal(encounter, enemy, { id: turn?.id ?? "", actor: "ai" }) === null;
}

// What holds a rider from getting on or off by choice, on any turn: it is the
// rider's move, so what stops a move stops it, and so does a speed of 0
// (ruling 3: "a rider whose speed is 0 can't mount or get down by choice, as
// for a character, though it can still be thrown").
function heldFromSaddle(encounter: Encounter, rider: EncounterEnemy, speedTiles: number, doing: "mount" | "get down"): ToolError | null {
  const able = canEnemyAct({ enemy: rider, encounter, kind: "move" });
  if (!able.ok) {
    return toolError(able);
  }
  if (speedTiles > 0) {
    return null;
  }
  const held = rider.conditions.find((entry) => isConditionNamed(entry, "grappled", "restrained"));
  return refuse(`${rider.displayName}'s speed is 0${held ? ` (${held})` : ""}: it cannot ${doing} by choice, which costs half its speed (${RULE}). Nothing was spent.`);
}

// Why this creature is no mount for an enemy, when the call named one that is
// not an enemy of the rider's side: a character's steed, a mount the party
// keeps on record, or a creature that fights beside the party. "Willing" is
// the whole test (ruling 2).
function unwilling(campaignId: string, rider: EncounterEnemy, ref: string, sheets: CharacterSheet[], sheetsById: Map<string, CharacterSheet>): ToolError | null {
  const wanted = textKey(ref);
  const kept = Object.entries(getMounts(campaignId)).find(([, mount]) => textKey(mount.name) === wanted || mount.sheetId === ref.trim());
  const sheet = resolveSheetRef(ref, sheets, sheetsById);
  const whose = kept ? (sheetsById.get(kept[0])?.name ?? null) : null;
  const name = kept ? kept[1].name : sheet?.name;
  if (!name) {
    return null;
  }
  return refuse(
    `${name} is ${whose ? `${whose}'s mount` : "on the party's side"} and will not carry ${rider.displayName}: only a willing creature serves as a mount (${RULE}). An enemy mounts a riderless enemy of its own side, named in mount by its enemyId. Nothing was spent.`,
  );
}

type MountArgs = { mount?: string; controlled?: boolean };

export function enemyMountsUp(
  campaign: Campaign,
  fight: Fight,
  args: MountArgs,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  turn?: Turn,
): ToolResult {
  const { encounter, enemy: rider } = fight;
  if (rider.status !== "alive" || isKnockedOut(rider)) {
    return refuse(`${rider.displayName} is ${rider.status === "alive" ? "knocked out" : rider.status} and mounts nothing.`);
  }
  const enemies = listEnemies(encounter.id);
  const riding = mountOf(enemies, rider);
  if (riding) {
    return refuse(`${rider.displayName} already rides ${riding.displayName}: it gets down first (dismount), during its own move.`);
  }
  const carrying = riderOf(enemies, rider.id);
  if (carrying) {
    return refuse(`${rider.displayName} carries ${carrying.displayName} and rides nothing while it does.`);
  }
  const ref = (args.mount ?? "").trim();
  if (!ref) {
    return { error: `mount_up for an enemy needs mount: the enemyId of a riderless enemy within 5 feet of ${rider.displayName}.`, retry: true };
  }
  const mount = resolveEnemyRef(encounter.id, ref);
  if (!mount) {
    return unwilling(campaign.id, rider, ref, sheets, sheetsById) ?? unknownEnemyRef(encounter.id, "mount", ref, "An enemy mounts another enemy of its fight, named by its enemyId.");
  }
  if (mount.id === rider.id) {
    return refuse(`${rider.displayName} cannot ride itself.`);
  }
  if (mount.status !== "alive") {
    return refuse(`${mount.displayName} is ${mount.status} and carries nobody.`);
  }
  if (sideOf(encounter, "enemy", mount.id, mount) !== sideOf(encounter, "enemy", rider.id, rider)) {
    return refuse(`${mount.displayName} fights on the other side and will not carry ${rider.displayName}: only a willing creature serves as a mount (${RULE}). Nothing was spent.`);
  }
  const mountRides = mountOf(enemies, mount);
  if (mountRides) {
    return refuse(`${mount.displayName} is a rider itself, on ${mountRides.displayName}, and carries nobody.`);
  }
  const carried = riderOf(enemies, mount.id);
  if (carried) {
    return refuse(`${mount.displayName} already carries ${carried.displayName}: a mount takes one rider. Nothing was spent.`);
  }
  const tooSmall = mountSizeProblem(
    { name: rider.displayName, stats: rider.stats },
    { name: mount.displayName, stats: mount.stats },
    "Nothing was spent.",
  );
  if (tooSmall) {
    return refuse(tooSmall);
  }
  // No table lets a goblin climb onto a stunned or sleeping wolf and ride it
  // off (ruling 2). A mount that is only grappled or restrained can be
  // mounted: it carries nobody anywhere until it is free.
  const out = isKnockedOut(mount) ? "unconscious" : incapacitatedBy(mount.conditions);
  if (out) {
    return refuse(`${mount.displayName} is ${out} and cannot serve as a mount until that ends. Nothing was spent.`);
  }
  if (isProne(mount)) {
    return refuse(`${mount.displayName} is prone: a mount that falls prone throws its rider (${RULE}), so nobody gets on until it stands. Nothing was spent.`);
  }
  if (isProne(rider)) {
    return refuse(`${rider.displayName} is prone and stands first, for half its speed, before it mounts: no creature climbs into a saddle from the ground. Nothing was spent.`);
  }
  const map = getBattleMapForEncounter(encounter.id);
  const tokens = map ? listTokens(map.id) : [];
  const riderToken = tokens.find((token) => token.refId === rider.id) ?? null;
  const mountToken = tokens.find((token) => token.refId === mount.id) ?? null;
  const budget = riderToken ? enemyMoveBudget(encounter, rider, riderToken) : null;
  const speedTiles = budget?.speedTiles ?? enemySpeedTiles(rider);
  const held = heldFromSaddle(encounter, rider, speedTiles, "mount");
  if (held) {
    return held;
  }
  const riderSize = footprintForSize(rider.stats.size);
  const mountSize = footprintForSize(mount.stats.size);
  // "Within 5 feet means within 5 feet of any square a Large or bigger mount
  // fills" (ruling 2).
  const apart = riderToken && mountToken ? footprintDistance(riderToken, riderSize, mountToken, mountSize) : 0;
  if (apart > 1) {
    return refuse(`${mount.displayName} is ${apart * 5} feet from ${rider.displayName}: a creature is mounted from within 5 feet of it (${RULE}). ${rider.displayName} moves beside it first. Nothing was spent.`);
  }
  // Its own move, on its own turn (ruling 3): refused off it for the GM's
  // tools, free and uncharged for a person at the console.
  const ownTurn = turnHasCome(encounter, rider, turn);
  if (!ownTurn && turn?.actor === "ai") {
    const early = enemyTurnRefusal(encounter, rider, turn);
    return early ? { ...early, error: `${rider.displayName} mounts during its own move only. ${early.error}` } : refuse(`${rider.displayName} mounts during its own move only.`);
  }
  const charged = ownTurn && encounter.orderReady && Boolean(riderToken);
  const half = Math.ceil(speedTiles / 2);
  if (charged) {
    if (enemyTurnEntry(encounter, rider.id).saddleMove) {
      return refuse(`${rider.displayName} already mounted or dismounted during this move: that is once a move (${RULE}). It mounts on its next turn.`);
    }
    if (budget && budget.tilesLeft < half) {
      return refuse(`${rider.displayName} has too little movement left this turn to mount: it costs half its speed, ${half * 5} ft, and it has ${budget.tilesLeft * 5} ft left.`);
    }
  }
  const controlled = args.controlled === true;
  const mountSlot = encounter.order.findIndex((entry) => entry.kind === "enemy" && entry.enemyId === mount.id);
  const riderSlot = encounter.order.findIndex((entry) => entry.kind === "enemy" && entry.enemyId === rider.id);
  // A mount whose own turn is running gives up no place in the order: the
  // pointer rests on it, and the turn has to end somewhere.
  if (controlled && encounter.orderReady && mountSlot >= 0 && mountSlot === encounter.turnIndex) {
    return refuse(`It is ${mount.displayName}'s own turn: ${rider.displayName} takes its reins once that turn has ended, or mounts it now with controlled left out. Nothing was spent.`);
  }
  // Nothing is refused past here. The cost is paid first: the swing an
  // opportunity attack makes is at a creature already spending its move.
  if (charged && riderToken) {
    const live = getActiveEncounter(campaign.id) ?? encounter;
    recordEnemyTurn(live, rider.id, { saddleMove: true });
    saveEncounter(live);
    moveToken(riderToken.id, riderToken.x, riderToken.y, riderToken.movedThisRound + half);
  }
  // Getting on is a move (ruling 6): out of its own square, into the mount's
  // space, and a foe whose reach that leaves may strike unless it Disengaged.
  const struck =
    map && riderToken && mountToken
      ? resolvePcOpportunityWalk(campaign, rider.id, { x: riderToken.x, y: riderToken.y }, { x: mountToken.x, y: mountToken.y }, undefined, budget?.disengaged === true, undefined, [riderSize, mountSize]).notes
      : [];
  const swings = struck.length
    ? { opportunityAttacks: struck, opportunityNote: "The server already rolled and applied these; narrate them, and do not call pc_attack for them." }
    : {};
  const spentWords = charged ? ` The attempt cost half its speed (${half * 5} ft).` : "";
  const after = getEnemy(rider.id) ?? rider;
  const steed = getEnemy(mount.id) ?? mount;
  if (after.status !== "alive" || isKnockedOut(after)) {
    publishEphemeral(campaign.id, "battle_map_updated", {});
    publishEncounter(campaign.id);
    return { ok: true, stopped: rider.displayName, note: `${rider.displayName} was struck down as it reached for ${mount.displayName}: it never got on.`, ...swings };
  }
  // Sentinel and Hold the Line leave a creature they hit with speed 0 for the
  // rest of the turn (opportunity-strike.ts): it stays on the ground.
  const liveEncounter = getActiveEncounter(campaign.id) ?? encounter;
  if (!canEnemyAct({ enemy: after, encounter: liveEncounter, kind: "move" }).ok || enemySpeedTiles(after) === 0 || steed.status !== "alive") {
    publishEphemeral(campaign.id, "battle_map_updated", {});
    publishEncounter(campaign.id);
    return { ok: true, stopped: rider.displayName, note: `${rider.displayName} was stopped as it reached for ${mount.displayName}: it is still on foot where it stood.${spentWords}`, ...swings };
  }
  // Ruling 4. "Movement belongs to a turn, and what a creature doesn't use
  // is gone when its turn ends": a mount whose turn this round is behind it
  // has nothing to carry the pair with, and one whose turn is still ahead of
  // the pointer brings its speed when that turn starts and refills the
  // token. Only a mount whose turn has come and stands after its rider's in
  // the order still has that turn to take, and keeps what it has left: so
  // does one mounted from the console off the rider's turn, which charges
  // nothing. A controlled mount's turn is its rider's from now on, so one
  // whose own turn had not begun this round begins it here, on fresh
  // movement, and one whose turn is behind it waits for its rider's next.
  const mountCame = mountSlot >= 0 && turnHasCome(liveEncounter, steed, turn);
  const over = mountCame && mountSlot < riderSlot;
  const spent = charged && (controlled ? over : !mountCame || over);
  const fresh = charged && controlled && !mountCame;
  const pairBudget = mountToken ? enemyMoveBudget(liveEncounter, steed, mountToken) : null;
  setEnemyMount(rider.id, mount.id, controlled);
  if (map && mountToken) {
    // One token for the pair, the rider's, in the mount's space (ruling 6):
    // the mount's own goes, and what it had walked, and whether it stood
    // aloft, pass to the pair's.
    forgetMoves(encounter.id);
    const count = fresh ? 0 : spent && pairBudget ? mountToken.movedThisRound + pairBudget.tilesLeft : mountToken.movedThisRound;
    if (riderToken) {
      removeTokenByRef(map.id, mount.id);
      moveToken(riderToken.id, mountToken.x, mountToken.y, count);
      if (riderToken.movement !== mountToken.movement) {
        setTokenMovement(riderToken.id, mountToken.movement);
      }
    } else {
      handTokenTo(map.id, mount.id, rider.id, rider.displayName);
      if (count !== mountToken.movedThisRound) {
        moveToken(mountToken.id, mountToken.x, mountToken.y, count);
      }
    }
  }
  if (controlled) {
    const order = getActiveEncounter(campaign.id) ?? liveEncounter;
    const place = order.order.find((entry) => entry.kind === "enemy" && entry.enemyId === rider.id);
    unseatLedMounts(order);
    // Nor is it waiting to be played as a turn of its own (enemies-due.ts,
    // the hand-over end_turn makes): its turn is its rider's.
    const waiting = order.legendary;
    if (waiting.due?.includes(mount.id)) {
      waiting.due = waiting.due.filter((id) => id !== mount.id);
    }
    if (waiting.handoff?.enemyIds.includes(mount.id)) {
      waiting.handoff = { ...waiting.handoff, enemyIds: waiting.handoff.enemyIds.filter((id) => id !== mount.id) };
    }
    if (over) {
      markEnemyActed(order, mount.id);
    }
    if (fresh) {
      forgetEnemyTurns(order, [mount.id]);
    }
    saveEncounter(order);
    const count = place?.initiative ?? rider.initiative;
    if (typeof count === "number") {
      setEnemyInitiative(mount.id, count);
    }
  }
  // A hold or a leash the move took out of reach lets go, as after any move.
  releaseGrapplesOutOfReach(campaign);
  const leashesEnded = afterMoveLeashes(campaign);
  publishEphemeral(campaign.id, "battle_map_updated", {});
  publishEncounter(campaign.id);
  tableNote(campaign, rider, `${rider.displayName} mounts ${mount.displayName}.`);
  const now = listEnemies(encounter.id);
  const pairToken = map ? (listTokens(map.id).find((token) => token.refId === rider.id) ?? null) : null;
  const left = pairToken ? enemyMoveBudget(getActiveEncounter(campaign.id) ?? liveEncounter, getEnemy(mount.id) ?? steed, pairToken).tilesLeft * 5 : null;
  const moves = controlled
    ? fresh
      ? `${mount.displayName} gives up its own place in the order and its turn is ${rider.displayName}'s from now on: it has not moved this round, so its move_token carries the pair on this turn${left === null ? "" : `, ${left} ft`}.`
      : over
        ? `${mount.displayName} gives up its own place in the order and its turn is ${rider.displayName}'s from now on. Its turn this round is over, so the pair moves from ${rider.displayName}'s next turn.`
        : `${mount.displayName} gives up its own place in the order and its turn is ${rider.displayName}'s from now on${left === null ? "" : `: the pair has ${left} ft left this turn`}.`
    : spent
      ? `Movement belongs to a turn: the pair has none until ${mount.displayName}'s next turn starts, which brings ${mount.displayName}'s speed.`
      : `The pair moves on ${mount.displayName}'s turn${left === null ? "" : `, with the ${left} ft ${mount.displayName} has left this turn`}.`;
  return {
    ok: true,
    mounted: mount.displayName,
    rider: rider.displayName,
    ...pairLine(now, now.find((entry) => entry.id === rider.id) ?? rider),
    ...(pairToken ? { at: `(${pairToken.x},${pairToken.y})` } : {}),
    ...(charged ? { movementSpent: half * 5 } : {}),
    ...swings,
    ...(leashesEnded.length ? { released: leashesEnded.join(" ") } : {}),
    note: `${rider.displayName} is on ${mount.displayName}, in its space, on one token. ${charged ? `Mounting cost half its speed (${half * 5} ft) and ends its own movement for the turn; it may still act from the saddle.` : "No movement was charged: no turn of its own is running."} ${moves}`,
  };
}

// The squares beside the pair a rider of this size may come to stand on: all
// of its space open (no wall, and "no creature ends its move in another's
// space", ruling 6) and touching the mount's. Nearest `near` first.
function landingsBeside(map: BattleMap, tokens: BattleToken[], enemies: EncounterEnemy[], pair: BattleToken, pairSize: Footprint, riderSize: Footprint, near: XY): XY[] {
  const occupied = occupiedTiles(map, tokens, null, footprintLookup(new Map(enemies.map((enemy) => [enemy.id, enemy]))));
  const open: XY[] = [];
  for (let y = pair.y - riderSize; y <= pair.y + pairSize; y += 1) {
    for (let x = pair.x - riderSize; x <= pair.x + pairSize; x += 1) {
      if (footprintDistance({ x, y }, riderSize, pair, pairSize) === 1 && openSpace(map.terrain, map.width, map.height, occupied, x, y, riderSize)) {
        open.push({ x, y });
      }
    }
  }
  const far = (at: XY) => (at.x - near.x) ** 2 + (at.y - near.y) ** 2;
  return open.sort((a, b) => far(a) - far(b));
}

type DismountArgs = { cause?: string; x?: number; y?: number };

export function enemyGetsDown(campaign: Campaign, fight: Fight, args: DismountArgs, turn?: Turn): ToolResult {
  const { encounter, enemy: rider } = fight;
  const enemies = listEnemies(encounter.id);
  const mount = mountOf(enemies, rider);
  if (!mount) {
    return refuse(`${rider.displayName} is not mounted.`);
  }
  if (args.cause && args.cause !== "voluntary") {
    return refuse(`The server settles an enemy rider's fall itself, as the call that pushed it, knocked it prone or felled its mount finishes: send nothing for it. dismount takes an enemy only for getting down by choice, with no cause.`);
  }
  if (rider.status !== "alive" || isKnockedOut(rider)) {
    return refuse(`${rider.displayName} is ${rider.status === "alive" ? "knocked out" : rider.status} and does not get down by choice.`);
  }
  // Read from its stat block's walking speed: it has no movement of its own
  // in the saddle (ruling 3).
  const speedTiles = enemySpeedTiles(rider);
  const held = heldFromSaddle(encounter, rider, speedTiles, "get down");
  if (held) {
    return held;
  }
  const ownTurn = turnHasCome(encounter, rider, turn);
  if (!ownTurn && turn?.actor === "ai") {
    const early = enemyTurnRefusal(encounter, rider, turn);
    return early ? { ...early, error: `${rider.displayName} dismounts during its own move only. ${early.error}` } : refuse(`${rider.displayName} dismounts during its own move only.`);
  }
  const map = getBattleMapForEncounter(encounter.id);
  const tokens = map ? listTokens(map.id) : [];
  const pair = tokens.find((token) => token.refId === rider.id) ?? null;
  const charged = ownTurn && encounter.orderReady && Boolean(pair);
  if (charged && enemyTurnEntry(encounter, rider.id).saddleMove) {
    return refuse(`${rider.displayName} already mounted or dismounted during this move: that is once a move (${RULE}). It dismounts on its next turn.`);
  }
  const pairSize = footprintForSize(mount.stats.size);
  const riderSize = footprintForSize(rider.stats.size);
  const named = typeof args.x === "number" && typeof args.y === "number" ? { x: args.x, y: args.y } : null;
  const [spot] = map && pair ? landingsBeside(map, tokens, enemies, pair, pairSize, riderSize, named ?? { x: pair.x, y: pair.y }) : [];
  if (map && pair && !spot) {
    return refuse(`${rider.displayName} has no open square within 5 feet of ${mount.displayName} to get down into: every one is a wall or another creature's space, and no creature ends its move in another's space. It stays mounted. Nothing was spent.`);
  }
  const half = Math.ceil(speedTiles / 2);
  if (charged) {
    const live = getActiveEncounter(campaign.id) ?? encounter;
    recordEnemyTurn(live, rider.id, { saddleMove: true });
    saveEncounter(live);
  }
  // Getting down is a move (ruling 6): from the pair's space to the square
  // it lands on, and a foe whose reach that leaves may strike unless it
  // Disengaged.
  const struck =
    map && pair && spot
      ? resolvePcOpportunityWalk(campaign, rider.id, { x: pair.x, y: pair.y }, spot, undefined, enemyTurnEntry(encounter, rider.id).disengaged === true, undefined, [pairSize, riderSize]).notes
      : [];
  const swings = struck.length
    ? { opportunityAttacks: struck, opportunityNote: "The server already rolled and applied these; narrate them, and do not call pc_attack for them." }
    : {};
  const after = getEnemy(rider.id) ?? rider;
  const liveEncounter = getActiveEncounter(campaign.id) ?? encounter;
  if (after.status !== "alive" || isKnockedOut(after)) {
    publishEphemeral(campaign.id, "battle_map_updated", {});
    publishEncounter(campaign.id);
    return { ok: true, stopped: rider.displayName, note: `${rider.displayName} was struck down as it swung out of the saddle.`, ...swings };
  }
  if (!after.ridesEnemyId) {
    // Something the swing did took it off already (its mount felled under it).
    publishEphemeral(campaign.id, "battle_map_updated", {});
    publishEncounter(campaign.id);
    return { ok: true, dismounted: mount.displayName, note: `${rider.displayName} is off ${mount.displayName} already.`, ...swings };
  }
  if (!canEnemyAct({ enemy: after, encounter: liveEncounter, kind: "move" }).ok || enemySpeedTiles(after) === 0) {
    publishEphemeral(campaign.id, "battle_map_updated", {});
    publishEncounter(campaign.id);
    return { ok: true, stopped: rider.displayName, note: `${rider.displayName} was stopped as it swung out of the saddle: its speed is 0 for the rest of the turn, and it is still on ${mount.displayName}.`, ...swings };
  }
  const steered = mount.ledBy === rider.id;
  forgetMoves(encounter.id);
  partPair(campaign, after, false, spot);
  const landed = map ? (listTokens(map.id).find((token) => token.refId === rider.id) ?? null) : null;
  if (landed && spot) {
    if (landed.x !== spot.x || landed.y !== spot.y) {
      placeToken(landed.id, spot.x, spot.y);
    }
    // The other half of its speed is left to walk with (ruling 3).
    if (charged) {
      moveToken(landed.id, spot.x, spot.y, half);
    }
  }
  // Its turn this round was its rider's, which is running (enemy-riders.ts).
  const spentTurn = steered && charged && spendLedMountTurn(mount);
  releaseGrapplesOutOfReach(campaign);
  const leashesEnded = afterMoveLeashes(campaign);
  publishEphemeral(campaign.id, "battle_map_updated", {});
  publishEncounter(campaign.id);
  tableNote(campaign, rider, `${rider.displayName} gets down from ${mount.displayName}.`);
  const left = landed && charged ? enemyMoveBudget(getActiveEncounter(campaign.id) ?? liveEncounter, getEnemy(rider.id) ?? after, { ...landed, movedThisRound: half }).tilesLeft * 5 : null;
  const ownTurnWords = `takes a turn of its own from now on, on ${rider.displayName}'s place in the order`;
  const turnWords = !steered ? "keeps its turn" : spentTurn ? `${ownTurnWords}, from next round: its turn this round was ${rider.displayName}'s` : `${ownTurnWords}, with all its actions`;
  return {
    ok: true,
    dismounted: mount.displayName,
    rider: rider.displayName,
    ...(spot ? { at: `(${spot.x},${spot.y})` } : {}),
    ...(charged ? { movementSpent: half * 5 } : {}),
    ...swings,
    ...(leashesEnded.length ? { released: leashesEnded.join(" ") } : {}),
    note: `${rider.displayName} is on foot${spot ? ` at (${spot.x},${spot.y})` : ""}, no longer mounted. ${charged ? `Getting down cost half its speed (${half * 5} ft)${left === null ? "" : `, and it has ${left} ft of its own movement left this turn`}.` : "No movement was charged: no turn of its own is running."} ${mount.displayName} is riderless: it stands where the pair stood, on a token of its own, and ${turnWords}. It does as it wishes; you play it.`,
  };
}
