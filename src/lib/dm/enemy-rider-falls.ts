// How an enemy rider loses its seat (issue 1055, ruling 6 and the rules as
// written).
//
// "If an effect moves your mount against its will while you're on it, you
// must succeed on a DC 10 Dexterity saving throw or fall off the mount,
// landing prone in a space within 5 feet of it. If you're knocked prone while
// mounted, you must make the same saving throw. If your mount is knocked
// prone, you can use your reaction to dismount it as it falls and land on
// your feet. Otherwise, you are dismounted and fall prone in a space within
// 5 feet it" (SRD 5.1, Mounting and Dismounting).
//
// A pair made in the first piece (enemy-riders.ts) only came apart when one
// of the two left the fight: a goblin knocked prone on its wolf stayed in the
// saddle with no roll, a wolf shoved across the board took its goblin along
// for nothing, and a shove at the goblin moved the wolf too, a creature the
// shove never touched.
//
// Four ways off, each asked once:
//   - the rider is pushed, pulled or carried off by an effect that named it:
//     it ends where the push ends and lands prone, with no save of its own
//     (it already resisted the push), and the mount stays (ruling 6);
//   - the mount is moved against its will: the rider saves as the call
//     finishes, since a push goes a square at a time and one call may push
//     several times (the doors only mark the mount, as mount-moved.ts does
//     for a character);
//   - the rider is knocked prone: the same save, asked where the call
//     finishes, since prone reaches an enemy from many doors (mount-thrown.ts
//     does the same for a character);
//   - the mount is knocked prone or drops to 0: no save. The rider's reaction
//     lands it on its feet; with none to take it falls prone.
//
// The save is the rider's own, from its stat block (forced-save.ts), so an
// unconscious, paralyzed, stunned or petrified rider fails with no die
// rolled.
//
// Must not import map-tools, encounter-tools or enemy-damage: they call in.

import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, listHiddenRefIds, listTokens, moveToken } from "@/lib/db/battle-maps";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, listEnemies, saveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { insertCampaignMessage } from "@/lib/db/messages";
import { publishWithSeq } from "@/lib/events";
import { reactionFree } from "@/lib/dm/enemy-reactions";
import { mountOf, partPair, riderOf } from "@/lib/dm/enemy-riders";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { currentTurnId } from "@/lib/dm/job-control";
import { tableNoteSeq } from "@/lib/dm/narration-slot";
import { laySpellConditionsOnEnemy } from "@/lib/dm/spell-effects";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { DISMOUNT_SAVE_DC } from "@/lib/srd/mounts";

type XY = { x: number; y: number };

const isProne = (enemy: Pick<EncounterEnemy, "conditions">) => enemy.conditions.some((entry) => isConditionNamed(entry, "prone"));

// Where this enemy's own token stands, as words for a result.
function spotOf(enemy: EncounterEnemy): string {
  const map = getBattleMapForEncounter(enemy.encounterId);
  const token = map ? listTokens(map.id).find((entry) => entry.refId === enemy.id) : null;
  return token ? ` at (${token.x},${token.y})` : "";
}

// A rider coming off is told to the table, as a character's fall is
// (mount-thrown.ts): the result of the call reaches only a model, and a
// person running the fight from the console would see a token split with no
// word of why. Nothing is said of a pair the party cannot see.
function tableNote(campaign: Pick<Campaign, "id">, rider: EncounterEnemy, content: string) {
  const map = getBattleMapForEncounter(rider.encounterId);
  if (map && listHiddenRefIds(map.id).includes(rider.id)) {
    return;
  }
  const seq = tableNoteSeq(campaign.id);
  const message = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "system", glyph: "cue-travel", content });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

// The mounts a call has moved against their will, their riders not yet asked.
const moved = new Map<string, Set<string>>();

// What a door deep in a call did to a rider, told where the call finishes
// (settleEnemyRiders): a shove's own result says only where its target went.
const told = new Map<string, string[]>();
const tell = (campaignId: string, line: string) => told.set(campaignId, [...(told.get(campaignId) ?? []), line]);

// Called by whatever moves an enemy without it choosing to: marks it when it
// carries a rider.
export function enemyMountMoved(campaignId: string, enemyId: string) {
  const enemy = getEnemy(enemyId);
  if (!enemy || !riderOf(listEnemies(enemy.encounterId), enemy.id)) {
    return;
  }
  const mounts = moved.get(campaignId) ?? new Set<string>();
  mounts.add(enemyId);
  moved.set(campaignId, mounts);
}

// Whether this call has already moved the mount this rider sits on: a push
// that then names the rider too has pushed both together, and the pair has
// gone as one (ruling 6: "the pair moves and the rider saves once").
export function movedWithMount(campaignId: string, rider: Pick<EncounterEnemy, "ridesEnemyId">): boolean {
  return Boolean(rider.ridesEnemyId && moved.get(campaignId)?.has(rider.ridesEnemyId));
}

// Ruling 6: an effect that named the rider takes it out of the saddle. It
// ends at `at`, or in the open square nearest it when the mount's own space
// or anyone else holds that square, and lands prone. The mount stays where
// the pair stood, on a token of its own. Returns where the rider landed, or
// null when this enemy rides nothing; the GM is told as the call finishes.
export function shovedFromSaddle(campaign: Pick<Campaign, "id">, rider: EncounterEnemy, at: XY): { at: XY } | null {
  const mount = mountOf(listEnemies(rider.encounterId), rider);
  if (!mount || partPair(campaign, rider, false, at) === null) {
    return null;
  }
  laySpellConditionsOnEnemy(rider.id, ["prone"], {});
  tableNote(campaign, rider, `${rider.displayName} is knocked out of the saddle; ${mount.displayName} stays.`);
  const map = getBattleMapForEncounter(rider.encounterId);
  const token = map ? listTokens(map.id).find((entry) => entry.refId === rider.id) : null;
  const landed = token ? { x: token.x, y: token.y } : at;
  tell(
    campaign.id,
    `${rider.displayName} is taken out of the saddle and lands prone${token ? ` at (${landed.x},${landed.y})` : ""}, no longer mounted, with no save to stay on: the effect named the rider, who already resisted it. ${mount.displayName} stays where the pair stood, riderless, on a token of its own, and keeps its turn.`,
  );
  return { at: landed };
}

// A grappler drags the rider it holds (drag-move.ts): out of the saddle as a
// push that named it takes it, but a drag knocks nobody prone, so it stands
// where it is set down, still held. The mount stays where the pair stood, on
// a token of its own, and no save is asked: it was not moved.
export function draggedFromSaddle(campaign: Pick<Campaign, "id">, rider: EncounterEnemy, at: XY, by: string): { at: XY } | null {
  const mount = mountOf(listEnemies(rider.encounterId), rider);
  if (!mount || partPair(campaign, rider, false, at) === null) {
    return null;
  }
  tableNote(campaign, rider, `${by} drags ${rider.displayName} out of the saddle; ${mount.displayName} stays.`);
  const map = getBattleMapForEncounter(rider.encounterId);
  const token = map ? listTokens(map.id).find((entry) => entry.refId === rider.id) : null;
  const landed = token ? { x: token.x, y: token.y } : at;
  tell(
    campaign.id,
    `${by} drags ${rider.displayName} out of the saddle: it stands${token ? ` at (${landed.x},${landed.y})` : ""}, still grappled, no longer mounted, with no save to stay on, as the grapple holds the rider and the mount was not moved. ${mount.displayName} stays where the pair stood, riderless, on a token of its own, and keeps its turn.`,
  );
  return { at: landed };
}

// A push, a pull or a forced move that names one enemy and ends at `at`.
// The rider goes alone, out of the saddle; a mount goes with its rider on it,
// who is asked the save as the call finishes; anyone else is only moved.
// Returns where the named creature ended, or null when it has no token to
// move.
export function forcedEnemyMove(campaign: Pick<Campaign, "id">, mapId: string, enemy: EncounterEnemy, at: XY): { at: XY } | null {
  const token = getTokenByRef(mapId, enemy.id);
  if (!token) {
    return null;
  }
  if (enemy.ridesEnemyId) {
    if (movedWithMount(campaign.id, enemy)) {
      return { at: { x: token.x, y: token.y } };
    }
    const thrown = shovedFromSaddle(campaign, enemy, at);
    if (thrown) {
      return thrown;
    }
  }
  moveToken(token.id, at.x, at.y, token.movedThisRound);
  enemyMountMoved(campaign.id, enemy.id);
  return { at };
}

// The DC 10 Dexterity save to stay mounted, from the rider's own block. A
// failure takes the rider off: it lies prone in the open square nearest the
// mount, which keeps the space the pair held.
function saddleSave(campaign: Campaign, rider: EncounterEnemy, mount: EncounterEnemy, why: "knocked prone" | "mount moved"): { kept: boolean; line: string } {
  const turnId = currentTurnId();
  const turn = turnId ? getDmTurn(turnId) : null;
  const save = rollEnemySave(campaign.id, rider, "dex", DISMOUNT_SAVE_DC, {
    record: { ...(turn ? { turn } : {}), detail: `${rider.displayName}: DEX save to stay on ${mount.displayName}` },
  });
  const how = why === "knocked prone" ? `was knocked prone while riding ${mount.displayName}` : `was on ${mount.displayName} as it was moved against its will`;
  const rolled = save.autoFailed || save.total === null
    ? "the DEX save fails with no roll, as it cannot act"
    : `DEX save ${save.total} against DC ${DISMOUNT_SAVE_DC}`;
  if (save.success) {
    return { kept: true, line: `${rider.displayName} ${how} and kept its seat (${rolled}): still mounted${why === "knocked prone" ? ", still prone" : ""}.` };
  }
  partPair(campaign, rider, false);
  laySpellConditionsOnEnemy(rider.id, ["prone"], {});
  tableNote(campaign, rider, why === "knocked prone" ? `${rider.displayName} is knocked prone and falls from ${mount.displayName}.` : `${rider.displayName} is thrown from ${mount.displayName}.`);
  return {
    kept: false,
    line: `${rider.displayName} ${how} and fell off (${rolled}): no longer mounted, prone${spotOf(rider)}. ${mount.displayName} stands where the pair stood, riderless, on a token of its own, and keeps its turn.`,
  };
}

// The mount has gone down under its rider, who is on foot already: its
// reaction lands it on its feet, and with none to take it falls prone. The
// reaction is the creature's one a round, spent on the encounter the caller
// holds so a later save of that encounter keeps it.
function landsOrFalls(campaign: Pick<Campaign, "id">, encounter: Encounter, rider: EncounterEnemy, mountName: string): string {
  const live = getEnemy(rider.id) ?? rider;
  if (live.status !== "alive") {
    return "";
  }
  // A rider already lying in the saddle (the same blast threw both down)
  // has no feet to land on: it comes down prone and keeps its reaction.
  if (!isProne(live) && reactionFree(encounter, live)) {
    encounter.reactionsUsed = [...encounter.reactionsUsed, live.id];
    saveEncounter(encounter);
    tableNote(campaign, live, `${mountName} goes down; ${live.displayName} jumps clear and lands on its feet.`);
    return `${live.displayName} spends its reaction to dismount as its mount falls and lands on its feet${spotOf(live)}.`;
  }
  laySpellConditionsOnEnemy(live.id, ["prone"], {});
  tableNote(campaign, live, `${mountName} goes down and ${live.displayName} falls with it.`);
  return isProne(live)
    ? `${live.displayName} was already prone, so it comes down prone${spotOf(live)} and keeps its reaction.`
    : `${live.displayName} has no reaction to take, so it falls prone${spotOf(live)}.`;
}

// The pair this enemy is half of comes apart as it drops to 0 (enemy-damage.ts):
// what partPair does, and for a mount that went down, what became of the
// rider it carried.
export function pairWhenDown(campaign: Pick<Campaign, "id">, encounter: Encounter, enemy: EncounterEnemy, leaves: boolean): string | null {
  const rider = riderOf(listEnemies(enemy.encounterId), enemy.id);
  const parted = partPair(campaign, enemy, leaves);
  if (!parted || !rider) {
    return parted;
  }
  return `${parted} ${landsOrFalls(campaign, encounter, rider, enemy.displayName)}`.trim();
}

// The enemies in a pair that are prone as an engine call begins
// (encounter-tools.ts turnHolder): the call did not knock them prone, so it
// asks nothing of them. A rider who kept its seat while prone is here on the
// next call, which is what makes one prone ask one save.
export function pronePairs(campaignId: string): string[] {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return [];
  }
  const enemies = listEnemies(encounter.id);
  const paired = new Set(enemies.flatMap((enemy) => (enemy.ridesEnemyId ? [enemy.id, enemy.ridesEnemyId] : [])));
  return enemies.filter((enemy) => paired.has(enemy.id) && isProne(enemy)).map((enemy) => enemy.id);
}

// Asked where an engine call finishes (encounter-tools.ts settleTurn): each
// rider whose mount the call knocked prone or moved, and each rider the call
// knocked prone. `proneBefore` is null where nobody held the turn as the call
// began; a mount moved is still asked then. Returns what happened to each,
// for the call's result.
export function settleEnemyRiders(campaign: Campaign, proneBefore: readonly string[] | null): string[] {
  const marked = moved.get(campaign.id) ?? new Set<string>();
  moved.delete(campaign.id);
  const happened: string[] = told.get(campaign.id) ?? [];
  told.delete(campaign.id);
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return happened;
  }
  for (const row of listEnemies(encounter.id)) {
    const rider = row.ridesEnemyId ? getEnemy(row.id) : null;
    const mount = rider ? mountOf(listEnemies(encounter.id), rider) : null;
    if (!rider || !mount || rider.status !== "alive" || mount.status !== "alive") {
      continue;
    }
    // The mount knocked prone: no save, whatever else the call did to them.
    if (proneBefore && isProne(mount) && !proneBefore.includes(mount.id)) {
      partPair(campaign, rider, false);
      const live = getActiveEncounter(campaign.id) ?? encounter;
      happened.push(`${mount.displayName} is knocked prone under ${rider.displayName}. ${landsOrFalls(campaign, live, rider, mount.displayName)} ${mount.displayName} lies where the pair stood, on a token of its own, and keeps its turn.`);
      continue;
    }
    // Moved first: a rider thrown by the move is prone by the fall, which
    // asks no second save.
    if (marked.has(mount.id)) {
      const save = saddleSave(campaign, rider, mount, "mount moved");
      happened.push(save.line);
      if (!save.kept) {
        continue;
      }
    }
    const now = getEnemy(rider.id) ?? rider;
    if (proneBefore && isProne(now) && !proneBefore.includes(rider.id)) {
      happened.push(saddleSave(campaign, now, mount, "knocked prone").line);
    }
  }
  return happened;
}
