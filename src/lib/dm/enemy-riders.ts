// An enemy that rides another enemy (issue 1055): a goblin on a wolf.
//
// Mounted combat was the party's alone: a mount is a record on a character
// (db/mounts.ts), so a goblin and its wolf were two strangers on two squares
// with two tokens, and nothing the wolf did carried the goblin.
//
// A pair is two enemy rows, each with its own stat block, Armor Class, hit
// points and conditions, and the rider's row names its mount
// (EncounterEnemy.ridesEnemyId). The rulings the pair follows (issue 1055):
//
//   1. one token, the rider's, in the mount's space: the mount has none while
//      it is ridden, and is found where its rider stands
//      (db/battle-maps.ts getTokenByRef);
//   2. an enemy's mount is independent by default: it keeps its own turn,
//      and its move carries the pair. Its rider has no movement of its own.
//      A controlled one (`controlled: true` on the entry, a knight's trained
//      warhorse) is steered by its rider: it has no turn and no place in the
//      order, moves on its rider's turn, and "has only three action options:
//      Dash, Disengage, and Dodge" (SRD 5.1, Controlling a Mount);
//   4. when the two part, the mount stands in the space the pair held, with a
//      token of its own, and whoever runs the table plays it. A controlled
//      mount takes a turn of its own from then on, where its rider's was,
//      with all its actions.
//
// Must not import map-tools, encounter-tools or enemy-damage: they call in.

import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, handTokenTo, insertToken, listTokens, moveToken } from "@/lib/db/battle-maps";
import { enemyMoveBudget } from "@/lib/dm/enemy-speed";
import { getEncounter, getEnemy, listEnemies, saveEncounter, setEnemyMount, setEnemySlotOwed, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { enemyActedThisRound, markEnemyActed } from "@/lib/dm/can-act";
import { spliceIntoOrder } from "@/lib/dm/encounter-logic";
import type { EnemyStats } from "@/lib/bestiary/statblock";
import { sizeRank } from "@/lib/bestiary/enemy-numbers";
import { findSpawnTiles } from "@/lib/battlemap/tactics";
import { footprintLookup, occupiedTiles } from "@/lib/battlemap/view";
import { isDefeated } from "@/lib/dm/knockout";

type Linked = Pick<EncounterEnemy, "id" | "ridesEnemyId">;

// The mount this enemy rides, or null on foot.
export function mountOf<T extends Linked>(enemies: readonly T[], rider: Linked): T | null {
  return rider.ridesEnemyId ? (enemies.find((enemy) => enemy.id === rider.ridesEnemyId) ?? null) : null;
}

// Who rides this enemy, or null when it carries nobody.
export function riderOf<T extends Linked>(enemies: readonly T[], mountId: string): T | null {
  return enemies.find((enemy) => enemy.ridesEnemyId === mountId) ?? null;
}

// The enemies that take a turn of their own: everyone but a controlled
// mount, which acts on its rider's turn and holds no place in the order.
export function takingOwnTurn<T extends Pick<EncounterEnemy, "ledBy">>(enemies: readonly T[]): T[] {
  return enemies.filter((enemy) => !enemy.ledBy);
}

// Why a controlled mount does not do this, or null for anyone else. `what`
// finishes "it makes no ...": "attack", "use of a spell or ability".
export function controlledMountRefusal(enemy: Pick<EncounterEnemy, "id" | "displayName" | "encounterId" | "ledBy">, what: string): string | null {
  const rider = enemy.ledBy ? getEnemy(enemy.ledBy) : null;
  return rider
    ? `${enemy.displayName} is a controlled mount under ${rider.displayName}: it can take only the Dash, Disengage and Dodge actions (SRD 5.1, Controlling a Mount), on ${rider.displayName}'s turn, so it makes no ${what}. Nothing was spent.`
    : null;
}

// The enemies that stand on a token of their own: everyone but a mount with
// a rider on it, which shares its rider's (ruling 1).
export function onOwnToken<T extends Linked>(enemies: readonly T[]): T[] {
  const ridden = new Set(enemies.flatMap((enemy) => (enemy.ridesEnemyId ? [enemy.ridesEnemyId] : [])));
  return ridden.size ? enemies.filter((enemy) => !ridden.has(enemy.id)) : [...enemies];
}

// "A willing creature that is at least one size larger than you and that has
// an appropriate anatomy can serve as a mount" (SRD 5.1, Mounting and
// Dismounting). Why this creature cannot carry that one, or null. A block
// with no size on it (an invented foe) is Medium, as everywhere else.
export function mountSizeProblem(
  rider: { name: string; stats: Pick<EnemyStats, "size"> },
  mount: { name: string; stats: Pick<EnemyStats, "size"> },
  // What to do about it, for a pair refused in the middle of a fight
  // (enemy-mounting.ts); the default is for one being fielded.
  advice = "Name a larger mount, or leave mount out and field them on foot.",
): string | null {
  if (sizeRank(mount.stats.size) > sizeRank(rider.stats.size)) {
    return null;
  }
  const size = (stats: Pick<EnemyStats, "size">) => stats.size ?? "Medium";
  return `${mount.name} (${size(mount.stats)}) cannot carry ${rider.name} (${size(rider.stats)}): a mount is at least one size larger than its rider (SRD 5.1, Mounting and Dismounting). ${advice}`;
}

// A mount its rider steers has no place of its own in the order (ruling 2):
// "the initiative of a controlled mount changes to match yours when you
// mount it" (SRD 5.1, Controlling a Mount). One steered from the middle of a
// fight (issue 1091, enemy-mounting.ts) held a place until then, which goes
// here: where the pair is made, and again on the walk of the order, whose
// copy of the fight is the one saved. Changes `encounter` and returns whether
// its order changed; the caller saves.
export function unseatLedMounts(encounter: Encounter): boolean {
  const led = new Set(listEnemies(encounter.id).flatMap((enemy) => (enemy.ledBy ? [enemy.id] : [])));
  const slots = encounter.order.flatMap((entry, index) => (entry.kind === "enemy" && led.has(entry.enemyId) ? [index] : []));
  if (!slots.length) {
    return false;
  }
  const before = slots.filter((slot) => slot <= encounter.turnIndex).length;
  encounter.order = encounter.order.filter((_, index) => !slots.includes(index));
  encounter.turnIndex = Math.max(0, encounter.turnIndex - before);
  return true;
}

// Puts each rider on its mount as the rows are made. `carries[i]` is the
// index of the row that row i carries, or undefined. Returns the rows as they
// now stand. A foe back from an earlier fight still lying knocked out
// (foe-return.ts) is not put in the saddle: its mount comes in riderless, on
// a token of its own, as ruling 4 leaves one whose rider is knocked out.
// `led[i]`: row i is a controlled mount, steered by the rider it carries.
export function linkPairs(inserted: readonly EncounterEnemy[], carries: ReadonlyArray<number | undefined>, led: ReadonlyArray<boolean | undefined> = []): EncounterEnemy[] {
  let linked = false;
  carries.forEach((riderAt, mountAt) => {
    const rider = riderAt === undefined ? null : inserted[riderAt];
    const mount = inserted[mountAt];
    if (rider && mount && !isDefeated(rider)) {
      setEnemyMount(rider.id, mount.id, led[mountAt] === true);
      linked = true;
    }
  });
  return linked ? inserted.map((enemy) => getEnemy(enemy.id) ?? enemy) : [...inserted];
}

// The pair this enemy is half of comes apart: it died, fled, was sent to
// another plane, or was knocked out. Called before the caller takes the
// enemy's own token away (`leaves`), or leaves it lying where it fell.
//
// The mount stands in the space the pair held, on a token of its own (ruling
// 4), and keeps its turn. A rider who stays on the board (knocked out) lies
// in the nearest open square beside it. Returns what became of the one left,
// for the result of the call that parted them, or null when `enemy` was half
// of no pair. `near` is where a rider who stays on the board was sent (a push
// out of the saddle, enemy-rider-falls.ts): they land there, or in the open
// square nearest it when the mount or anyone else holds it.
export function partPair(campaign: Pick<Campaign, "id">, enemy: EncounterEnemy, leaves: boolean, near?: { x: number; y: number }): string | null {
  const enemies = listEnemies(enemy.encounterId);
  const rider = enemy.ridesEnemyId ? enemy : riderOf(enemies, enemy.id);
  const mount = rider ? mountOf(enemies, rider) : null;
  if (!rider || !mount) {
    return null;
  }
  setEnemyMount(rider.id, null);
  // A controlled mount takes a turn of its own from now on, where its
  // rider's was, with all its actions (ruling 4).
  const steered = mount.ledBy === rider.id;
  if (steered && !(enemy.id === mount.id && leaves)) {
    freeMount(rider, mount);
  }
  const turnWords = steered ? `takes a turn of its own from now on, on ${rider.displayName}'s place in the order, with all its actions` : "keeps its turn";
  const riderless = `${mount.displayName} is riderless: it stands where the pair stood, on a token of its own, and ${turnWords}. It does as it wishes; you play it.`;
  const onFoot = `${rider.displayName} is on foot where the pair stood, with their own movement again.`;
  const map = getBattleMapForEncounter(enemy.encounterId);
  const shared = map ? listTokens(map.id).find((token) => token.refId === rider.id) : null;
  // The mount is the one going, and takes no token with it: its rider keeps
  // the one they stood on.
  if (enemy.id === mount.id && leaves) {
    return onFoot;
  }
  if (!map || !shared) {
    return enemy.id === rider.id ? riderless : onFoot;
  }
  handTokenTo(map.id, rider.id, mount.id, mount.displayName);
  // The rider is the one going: nothing of theirs is left on the board.
  if (enemy.id === rider.id && leaves) {
    return riderless;
  }
  // Both stay: the rider beside the mount, in the nearest open square.
  const unlinked = listEnemies(enemy.encounterId);
  const tokens = listTokens(map.id);
  const footprints = footprintLookup(new Map(unlinked.map((entry) => [entry.id, entry])));
  const [spot] = findSpawnTiles(map.terrain, map.width, map.height, occupiedTiles(map, tokens, null, footprints), 1, [near ?? { x: shared.x, y: shared.y }], []);
  if (spot) {
    insertToken({ mapId: map.id, campaignId: campaign.id, kind: "enemy", refId: rider.id, name: rider.displayName, x: spot.x, y: spot.y });
  }
  return enemy.id === rider.id
    ? `${rider.displayName} lies beside ${mount.displayName}, which is riderless: it stands where the pair stood, on a token of its own, and ${turnWords}. It does as it wishes; you play it.`
    : `${mount.displayName} lies where the pair stood, and ${rider.displayName} is on foot beside it, with their own movement again.`;
}

// A controlled mount's rider is off it. Its row is marked as owed a place in
// the order, which the next walk of the order makes sure of
// (seatFreedMounts): the call that parted them may hold an older copy of the
// fight and save it over this one. The place is made now too, so the tracker
// and GAME STATE list the mount at once. It moved with its rider this round
// when that rider has acted, so its own first turn is next round's.
function freeMount(rider: EncounterEnemy, mount: EncounterEnemy) {
  setEnemySlotOwed(mount.id, true);
  const encounter = getEncounter(rider.encounterId);
  if (!encounter?.orderReady) {
    return;
  }
  const seated = seatFreedMounts(encounter, { settle: false, after: rider.id });
  const spent = enemyActedThisRound(encounter, rider.id) && !enemyActedThisRound(encounter, mount.id);
  if (spent) {
    markEnemyActed(encounter, mount.id);
  }
  if (seated || spent) {
    saveEncounter(encounter);
  }
}

// A steered mount whose rider got down by choice on the rider's own turn:
// its turn this round was that one (SRD 5.1, Controlling a Mount), so it
// neither acts nor walks on before the next round. freeMount marks it so only
// when the rider has acted, and a rider who gets down first has not. Returns
// true, for the caller's words.
export function spendLedMountTurn(mount: EncounterEnemy): true {
  const encounter = getEncounter(mount.encounterId);
  if (encounter?.orderReady && !enemyActedThisRound(encounter, mount.id)) {
    markEnemyActed(encounter, mount.id);
    saveEncounter(encounter);
  }
  const map = getBattleMapForEncounter(mount.encounterId);
  const token = map ? listTokens(map.id).find((entry) => entry.refId === mount.id) : undefined;
  const rest = token ? enemyMoveBudget(encounter, getEnemy(mount.id) ?? mount, token).tilesLeft : 0;
  if (token && rest > 0) {
    moveToken(token.id, token.x, token.y, token.movedThisRound + rest);
  }
  return true;
}

// Gives each freed mount its place in a locked order: its rider's count,
// directly after its rider's slot (`after`) when that is known, else where
// the count falls. `settle` (the walk of the order, whose copy of the fight
// is the one saved) takes the mark off. Changes `encounter` and returns
// whether its order changed; the caller saves.
export function seatFreedMounts(encounter: Encounter, options: { settle: boolean; after?: string }): boolean {
  if (!encounter.orderReady) {
    return false;
  }
  let changed = false;
  for (const mount of listEnemies(encounter.id)) {
    if (!mount.slotOwed) {
      continue;
    }
    if (mount.status === "alive" && !encounter.order.some((entry) => entry.kind === "enemy" && entry.enemyId === mount.id)) {
      const slot = options.after ? encounter.order.findIndex((entry) => entry.kind === "enemy" && entry.enemyId === options.after) : -1;
      const entry = { kind: "enemy" as const, enemyId: mount.id, name: mount.displayName, initiative: slot >= 0 ? encounter.order[slot].initiative : (mount.initiative ?? 0) };
      if (slot >= 0) {
        encounter.order = [...encounter.order.slice(0, slot + 1), entry, ...encounter.order.slice(slot + 1)];
        encounter.turnIndex += slot < encounter.turnIndex ? 1 : 0;
      } else {
        const spliced = spliceIntoOrder(encounter.order, encounter.turnIndex, [entry]);
        encounter.order = spliced.order;
        encounter.turnIndex = spliced.turnIndex;
      }
      changed = true;
    }
    if (options.settle) {
      setEnemySlotOwed(mount.id, false);
    }
  }
  return changed;
}
