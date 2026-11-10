import { isKnockedOut } from "@/lib/dm/knockout";
import { type LastSave } from "@/lib/dm/last-save";
import { triggerRecords } from "@/lib/dm/reaction-triggers";
import type { TriggerRecordView } from "@/lib/srd/trigger-table";
import { defaultSide, type CombatSide } from "@/lib/dm/combat-sides-logic";
import { sideOf } from "@/lib/dm/combatant";
import { lairChoices, legendaryProfile } from "@/lib/dm/legendary-logic";
import { enemyActionsView, type PublicEnemyActions, type PublicEnemyMovement } from "@/lib/dm/enemy-actions-view";
import { enemyMoveBudget } from "@/lib/dm/enemy-speed";
import { enemyActedThisRound, isSurprised } from "@/lib/dm/can-act";
import { getCampaignById } from "@/lib/db/campaigns";
import { castLookup, npcFace, type CastLookup } from "@/lib/db/npc-faces";
import { foeLook } from "@/lib/actor-sex-logic";
import { dmPlaysTurn } from "@/lib/dm/companion-command";
import { aiRunsTestTable } from "@/lib/workshop/test-seats-logic";
import { answerLabel, critTurnsNormal, heaviestHit, hitIdOf, openHits, reactedLate, type LastHit } from "@/lib/dm/last-hit";
import { conditionNote, conditionNoteLine, namesLookup } from "@/lib/battlemap/condition-notes";
import { healthState, type HealthState } from "@/lib/bestiary/health";
import { creatureTypeOf } from "@/lib/bestiary/creature-type";
import { isRegeneratingDown } from "@/lib/dm/regeneration";
import { REGENERATION_STOPPED } from "@/lib/dm/monster-abilities";
import { getBattleMapForEncounter, getTokenByRef, listHiddenRefIds, type BattleMap } from "@/lib/db/battle-maps";
import { ENEMY_TURN_NAME, turnOwner } from "@/lib/dm/turn-owner";
import {
  getActiveEncounter,
  listEnemies,
  orderEntryId,
  type Encounter,
  type EncounterEnemy,
  type EncounterStatus,
  type EnemyStatus,
} from "@/lib/db/encounters";

// What a client is allowed to know about a fight. Split out of
// encounters.ts, which is persistence: this is the projection, and it is the
// only shape that ever leaves the server.

// Client-safe projection: vague health states only, no HP numbers, no stats.
//
// The one exception is the person running the fight. A human DM cannot run
// an encounter from "bloodied", so when `enemyNumbers` is granted the real
// hit points, AC and initiative ride along. That grant comes from
// src/lib/dm/viewer.ts and is never a raw id comparison here.
export type PublicEncounter = {
  id: string;
  status: EncounterStatus;
  round: number;
  turnIndex: number;
  orderReady: boolean;
  // DM view only. While the order is collected: who has rolled so far.
  staged?: Array<{ name: string; initiative: number }>;
  // DM view only: the enemies the pointer walked past that are due before
  // the player up next, the floor held for them (src/lib/dm/enemies-due.ts);
  // `acted` once one has taken its action.
  enemiesDue?: Array<{ id: string; name: string; acted: boolean }>;
  // Every view: the floor is held for the enemies' turns, which a hold for
  // table talk wrapping the fight's floor (held responses) is not.
  enemyTurns?: boolean;
  // DM view only: an AI companion is up, and nobody at the table holds it.
  companionTurn?: { id: string; name: string };
  order: Array<{
    kind: "pc" | "enemy" | "npc";
    id: string;
    name: string;
    hidden: boolean;
    // An "npc" entry the Cast knows: their portrait or the plate their
    // role, race and gender pick (src/lib/db/npc-faces.ts).
    face?: string;
    // DM view only, like the enemy numbers below.
    initiative?: number;
    // Thief's Reflexes: the thief's second turn in the first round, a
    // second entry with the same id (so rows are keyed by position).
    reflex?: boolean;
    // The feature behind an extra turn taken at once (Strength before Death).
    extra?: string;
  }>;
  enemies: Array<{
    id: string;
    name: string;
    health: HealthState;
    status: EnemyStatus;
    cr: number;
    // SRD creature type off the snapshot, for the thumbnail.
    type: string;
    // The stat block's slug (the SRD slug a reskin fights as, "custom" for
    // an invented enemy, "summon:<form>" for a summon turned hostile), so the
    // thumbnail can draw the creature's own family plate
    // (monsterPlaceholder in src/lib/placeholders.ts). Not new information:
    // groupKey has always been this same slug. Optional so a client talking
    // to an older server still renders.
    slug?: string;
    // Who a humanoid foe is, for the face (enemyNpcPlaceholder): an SRD
    // race id and a gender. A Cast NPC's come from their record, so an edit
    // there shows at once; a nameless foe's from start_encounter. Absent
    // when unrecorded, and nothing a player could not already see.
    race?: string;
    gender?: string;
    // Kept off the players' board and tracker by the DM. Only ever true in
    // the DM's own projection: a hidden enemy is absent from a player's.
    hidden: boolean;
    // The mob this one belongs to: every enemy from the same stat block in
    // this fight shares it. Initiative never stopped on enemies
    // individually (advanceOrder walks past them all to the next PC), so
    // this is what lets the panel show a mob as one line the DM can open up
    // rather than four rows of the same goblin.
    groupKey: string;
    // Alive at 0 hit points after a nonlethal blow: out of the fight.
    knockedOut?: boolean;
    // Down at 0 hit points waiting to regenerate (a troll, regeneration.ts):
    // it rises at its turn, or dies then when `stopped` (acid or fire landed).
    regenerating?: { stopped: boolean };
    conditions: string[];
    conditionRounds: Record<string, number>;
    // "until Kael's turn", "save ends (WIS 13)", "from Kael", per condition.
    conditionNotes?: Record<string, string>;
    // DM view only; absent for every player.
    currentHp?: number;
    maxHp?: number;
    ac?: number;
    initiative?: number | null;
    // DM view only: legendary actions left this round and resistances
    // left this fight (docs/vtt-parity-implementation-plan.md 4.1).
    legendary?: { actions: number; actionsMax: number; resistances: number; resistancesMax: number };
    // DM view only: what it can do on its turn, as cards for the person
    // running it (src/lib/dm/enemy-actions-view.ts, issue #108).
    actions?: PublicEnemyActions;
  }>;
  // Whether the lair acts on initiative 20, and whether it has this round.
  lair?: { active: boolean; usedThisRound: boolean };
  // What the character whose turn it is has spent (src/lib/dm/action-budget.ts),
  // so the Hand and the board's turn pips show the engine's count rather than
  // a guess. Only ever a player character's: nothing here is hidden from the
  // table, and an enemy's economy stays the DM's.
  turn?: PublicTurn;
  // Whose turn it is, so a client can ask the engine's own canAct
  // (src/lib/dm/can-act.ts) the question the server will ask. The id is a
  // character's; any other combatant is named but not identified. While the
  // enemies the pointer walked past still have their turns, it is theirs and
  // not the player's the pointer already rests on (src/lib/dm/turn-owner.ts):
  // the enemy side is named then, with no id and nobody's name.
  acting?: { id: string; name: string } | null;
  // While the enemies hold the turn: the player whose turn follows theirs.
  upNext?: { id: string; name: string };
  // Every view: the character whose End Turn is in while the move waits on a
  // watcher's stop (src/lib/dm/turn-hold.ts), and the watcher it waits on.
  // The End Turn controls show it; absent on an older server.
  turnHeld?: { characterId: string; watcher: string };
  // While the enemies hold the turn: the ones it is held for, by id, as this
  // viewer may know them (a hidden one is left out of a player's), so the
  // trackers light their rows.
  enemiesUp?: string[];
  // Characters surprised in round 1: those who may not act yet, and those who
  // may not react yet (isSurprised in can-act.ts, asked on the server).
  surprised?: { acting: string[]; reacting: string[] };
  // Characters whose reaction is spent until their next turn starts. A
  // reaction is spent on somebody else's turn, so it lives here and not in
  // the turn budget.
  reactionsUsed?: string[];
  // Every view: the combatants fighting on the side their kind does not (a
  // companion turned on the party: "foe"; a creature the party dominates:
  // "party"), by id, so the tracker and the board's token rims follow the
  // server (src/lib/dm/combatant.ts). Absent when everyone is on their
  // kind's side; a combatant hidden from this viewer is left out.
  sides?: Record<string, CombatSide>;
  // The attacks a reaction may still answer (src/lib/dm/last-hit.ts): every
  // hit still open on each character, oldest first, while the engine would
  // accept a reaction to it. Absent keys mean nothing to answer.
  lastHits?: PublicLastHit[];
  // The triggers open now that no hit record holds (src/lib/dm/last-save.ts,
  // reaction-triggers.ts triggerRecords): saves made or failed and who forced
  // them, deaths, a turn's end and the next one's start, casts, a pet's damage,
  // the running turn's weapon hits and Action Surge. Named for the first of
  // them it carried (a save, for Vigilant Rebuke); an entry with no kind is a
  // save made. A creature hidden from this viewer is left out.
  lastSaves?: PublicSave[];
};

export type PublicSave = TriggerRecordView;

export type PublicTurn = {
  ownerId: string;
  actionUsed: boolean;
  bonusUsed: boolean;
  reactionUsed: boolean;
  attacksMade: number;
  attacksAllowed: number;
  extraActions?: number;
  // Action Surge's additional action, still to spend.
  grantedActions?: number;
  // The budget's once-per-turn marks (Sneak Attack spent, Martial Arts'
  // bonus strike open, a levelled or bonus-action spell cast, the creatures
  // attacked), so the Hand can ask the engine's own spend and cast rules.
  marks?: string[];
  // Flurry of Blows strikes bought and not yet made.
  flurryStrikes?: number;
  dashed?: boolean;
  // How many Dashes the turn has taken, when more than one.
  dashes?: number;
  disengaged?: boolean;
  // A levelled spell already cast this turn with this kind of action.
  castThisAction?: boolean;
  // What the Attack action was made with, which is what opens the off-hand
  // swing of two-weapon fighting (attack-rules.ts offHandProblem). Always
  // sent, so a Hand can tell "not earned" from a server too old to say
  // (issue 210).
  lightMeleeAttack?: boolean;
  oneHandMeleeAttack?: boolean;
  // The turn's free object interaction is spent (issue #424): a draw, a
  // pick-up or a hand-over now takes the Use an Object action.
  interactionUsed?: boolean;
};

export type PublicLastHit = {
  // The hit's id, which a reaction card sends to answer this hit and no
  // other (use_reaction's `hit`). Absent from an older host, which kept one
  // hit per character.
  id?: string;
  characterId: string;
  attacker: string;
  // The enemy that made it, when the player may know it (not hidden).
  attackerId: string | null;
  // The hit a one-attack reaction answers (the heaviest, as Uncanny Dodge
  // takes it): its attack, damage type and damage. A multiattack's other
  // hits are counted in hits, not added to the damage.
  attack: string;
  type: string;
  ranged: boolean;
  source: "attack" | "fall" | "missile";
  // Whether any swing hit, and how many did.
  hit: boolean;
  hits: number;
  damage: number;
  // The heaviest critical among its swings that can become a normal hit
  // (Sentinel at Death's Door), which need not be the hit named above.
  crit?: { attack: string; damage: number };
  // Reactions already taken against it, by name. `answeredBy` keeps who took
  // each (last-hit.ts answerKey), so a second holder of the same feature is
  // still offered it; an older host sends names only.
  answered: string[];
  answeredBy?: string[];
  // How the character stood as it landed: up or already at 0, and their
  // conditions then. A reaction that answers the hit is asked of them as
  // they stood (src/lib/dm/reaction-gate.ts), so a card for one the hit
  // dropped reads this, not the fall. Absent from an older host.
  stood?: { up: boolean; conditions: string[] };
};

function turnView(encounter: Encounter): { turn?: PublicTurn } {
  const budget = encounter.turnBudget;
  if (!budget || budget.round !== encounter.round) {
    return {};
  }
  if (!encounter.order.some((entry) => entry.kind === "pc" && entry.characterId === budget.ownerId)) {
    return {};
  }
  return {
    turn: {
      ownerId: budget.ownerId,
      actionUsed: budget.actionUsed,
      bonusUsed: budget.bonusUsed,
      reactionUsed: budget.reactionUsed,
      attacksMade: budget.attacksMade,
      attacksAllowed: budget.attacksAllowed,
      ...(budget.extraActions ? { extraActions: budget.extraActions } : {}),
      ...(budget.grantedActions ? { grantedActions: budget.grantedActions } : {}),
      ...(budget.oncePerTurn.length ? { marks: budget.oncePerTurn } : {}),
      ...(budget.flurryStrikes ? { flurryStrikes: budget.flurryStrikes } : {}),
      ...(budget.dashed ? { dashed: true } : {}),
      ...((budget.dashes ?? 0) > 1 ? { dashes: budget.dashes } : {}),
      ...(budget.disengaged ? { disengaged: true } : {}),
      ...(budget.castThisAction ? { castThisAction: true } : {}),
      lightMeleeAttack: Boolean(budget.lightMeleeAttack),
      oneHandMeleeAttack: Boolean(budget.oneHandMeleeAttack ?? budget.lightMeleeAttack),
      ...(budget.interaction ? { interactionUsed: true } : {}),
    },
  };
}

// The engine's own reading of whose turn it is, surprise and spent
// reactions, for the characters only: an enemy's id or its reaction is the
// DM's business, and a hidden one must not be given away. Whose turn it is
// comes from turnOwner, which the board's turn name and token read too, so
// the two projections cannot disagree: they used to name the player up next
// while the enemies before them still had their turns.
function actingView(encounter: Encounter, hidden: Set<string>, showNumbers: boolean) {
  const pcIds = encounter.order
    .filter((entry) => entry.kind === "pc")
    .map((entry) => orderEntryId(entry));
  const owner = turnOwner(encounter);
  const current = owner.next;
  const concealed = current && !showNumbers && hidden.has(orderEntryId(current));
  const pointer = current
    ? { id: current.kind === "pc" ? current.characterId : "", name: concealed ? "someone unseen" : current.name }
    : null;
  const enemiesFirst = owner.enemies.length > 0;
  return {
    acting: enemiesFirst ? { id: "", name: ENEMY_TURN_NAME } : pointer,
    // Every view: the floor is held for the enemies' turns.
    ...(enemiesFirst ? { enemyTurns: true } : {}),
    ...(enemiesFirst && pointer ? { upNext: pointer } : {}),
    ...(enemiesFirst ? { enemiesUp: owner.enemies.filter((id) => showNumbers || !hidden.has(id)) } : {}),
    ...(encounter.legendary.heldMove ? { turnHeld: { characterId: encounter.legendary.heldMove.characterId, watcher: encounter.legendary.heldMove.watcher } } : {}),
    surprised: {
      acting: pcIds.filter((id) => isSurprised(encounter, id)),
      reacting: pcIds.filter((id) => isSurprised(encounter, id, true)),
    },
    // A character who answered the enemies' pass after their turn began has
    // their reaction back for that turn, and no second one for the pass
    // (last-hit.ts reactedLate): the Hand offered one the engine refused.
    reactionsUsed: pcIds.filter((id) => encounter.reactionsUsed.includes(id) || reactedLate(encounter.campaignId, encounter, id)),
  };
}

function lastHitView(record: LastHit, hidden: Set<string>, showNumbers: boolean): PublicLastHit {
  const attackerId = record.attacker.id;
  const index = heaviestHit(record.swings);
  const answered = index >= 0 ? record.swings[index] : null;
  const critical = record.swings[heaviestHit(record.swings, (swing) => critTurnsNormal(record, swing))];
  return {
    id: hitIdOf(record),
    characterId: record.characterId,
    attacker: record.attacker.name,
    attackerId: attackerId && (showNumbers || !hidden.has(attackerId)) ? attackerId : null,
    attack: answered?.attack ?? record.attack,
    type: answered?.type || record.type,
    // That hit's own reach: the record's is its last swing's, so a routine
    // that shot first and stabbed last offered no Deflect Missiles against
    // the arrow it named.
    ranged: answered?.ranged ?? record.ranged,
    source: record.source,
    hit: record.source === "fall" || record.swings.some((swing) => swing.hit),
    hits: record.swings.filter((swing) => swing.hit).length,
    damage: answered?.raw ?? 0,
    ...(critical ? { crit: { attack: critical.attack ?? record.attack, damage: critical.raw } } : {}),
    answered: [...new Set(record.answered.map(answerLabel))],
    answeredBy: record.answered,
    stood: { up: record.before.currentHp > 0, conditions: record.before.conditions },
  };
}


// The face an initiative entry for a tracked NPC draws (npc-faces.ts).
function entryFace(cast: CastLookup, npcId: string, name: string): { face?: string } {
  const npc = cast.byId(npcId) ?? cast.byName(name);
  return npc ? { face: npcFace(npc) } : {};
}

// Who a foe is, for its face: a Cast NPC's own record, read live so an edit
// there shows in a running fight, else its row's look, the one a 3D board
// view's model reads too (src/lib/actor-sex-logic.ts).
function lookOf(cast: CastLookup, enemy: EncounterEnemy): { race?: string; gender?: string } {
  const { race, gender } = foeLook(enemy, cast.byId(enemy.npcId));
  return { ...(race ? { race } : {}), ...(gender ? { gender } : {}) };
}

// How far an enemy may still walk this turn, for the person running it: the
// Monster Hand's roster and its Dash card (issue #621). Undefined with no
// board or no rounds to count.
function movementView(encounter: Encounter, enemy: EncounterEnemy, map: BattleMap | null): PublicEnemyMovement | undefined {
  const token = map && encounter.kind !== "scene" && enemy.status === "alive" ? getTokenByRef(map.id, enemy.id) : null;
  if (!token) {
    return undefined;
  }
  const budget = enemyMoveBudget(encounter, enemy, token);
  return { speedFeet: budget.speedTiles * 5, leftFeet: budget.tilesLeft * 5, dashes: budget.dashes, disengaged: budget.disengaged };
}

export function publicEncounter(
  encounter: Encounter,
  enemies: EncounterEnemy[],
  options: { enemyNumbers?: boolean; hiddenRefIds?: string[]; lastHits?: LastHit[]; lastSaves?: LastSave[] } = {},
): PublicEncounter {
  const showNumbers = options.enemyNumbers === true;
  const board = showNumbers ? getBattleMapForEncounter(encounter.id) : null;
  // The lair's options while it may act, numbered across the whole fight as
  // lair_action numbers them: each creature's card carries its own.
  const lair = showNumbers ? lairChoices(enemies, encounter.legendary) : null;
  // Hidden is one flag on the board token (src/lib/db/battle-maps.ts) and it
  // means the same thing in both places: an ambusher the players have not
  // met yet is neither on the map nor on the tracker.
  const hidden = new Set(options.hiddenRefIds ?? []);
  const cast = castLookup(encounter.campaignId);
  // Names a condition's "until X's turn" or "from X" may show: the order as
  // this viewer sees it.
  const nameOf = namesLookup(
    encounter.order
      .filter((entry) => showNumbers || !hidden.has(orderEntryId(entry)))
      .map((entry) => ({ id: orderEntryId(entry), name: entry.name })),
  );
  return {
    id: encounter.id,
    status: encounter.status,
    round: encounter.round,
    turnIndex: encounter.turnIndex,
    orderReady: encounter.orderReady,
    order: encounter.orderReady
      ? encounter.order
          // A hidden combatant is not on the players' tracker at all. The DM
          // gets the whole order, marked, because they are the one hiding it.
          .filter((entry) => showNumbers || !hidden.has(orderEntryId(entry)))
          .map((entry) => ({
            kind: entry.kind,
            id: orderEntryId(entry),
            name: entry.name,
            hidden: hidden.has(orderEntryId(entry)),
            // The count itself rides along only for the seat that may edit
            // it. Players hear initiative announced; they do not need a
            // column of it, and the tracker has never shown one.
            ...(showNumbers ? { initiative: entry.initiative } : {}),
            ...(entry.kind === "pc" && entry.reflex ? { reflex: true } : {}),
            ...(entry.kind === "pc" && entry.extra ? { extra: entry.extra } : {}),
            ...(entry.kind === "npc" ? entryFace(cast, entry.npcId, entry.name) : {}),
          }))
      : [],
    enemies: enemies
      .filter((enemy) => showNumbers || !hidden.has(enemy.id))
      .map((enemy) => ({
      id: enemy.id,
      hidden: hidden.has(enemy.id),
      name: enemy.displayName,
      health: enemy.status === "fled" ? "healthy" : healthState(enemy.currentHp, enemy.maxHp),
      status: enemy.status,
      cr: enemy.cr,
      type: creatureTypeOf(enemy.stats),
      slug: enemy.slug,
      ...lookOf(cast, enemy),
      groupKey: enemy.slug,
      // Knocked out by a nonlethal blow (src/lib/dm/knockout.ts): alive at
      // 0 hit points, out of the fight, not dying.
      ...(knockedOut(enemy) ? { knockedOut: true } : {}),
      ...(enemy.status === "alive" && isRegeneratingDown(enemy)
        ? { regenerating: { stopped: enemy.conditions.includes(REGENERATION_STOPPED) } }
        : {}),
      conditions: enemy.status === "alive" ? enemy.conditions : [],
      conditionRounds:
        enemy.status === "alive"
          ? Object.fromEntries(
              Object.entries(enemy.conditionMeta)
                .filter(([, meta]) => typeof meta.rounds === "number")
                .map(([name, meta]) => [name, meta.rounds as number]),
            )
          : {},
      // The rest of what each condition's metadata says: a turn it ends on,
      // the save that ends it, who laid it (condition-notes.ts).
      conditionNotes:
        enemy.status === "alive"
          ? Object.fromEntries(
              enemy.conditions.flatMap((name) => {
                const line = conditionNoteLine(conditionNote(name, enemy.conditionMeta[name], nameOf, enemy.id), {
                  skipCounted: true,
                });
                return line ? [[name, line]] : [];
              }),
            )
          : {},
      ...(showNumbers
        ? {
            currentHp: enemy.currentHp,
            maxHp: enemy.maxHp,
            ac: enemy.ac,
            initiative: enemy.initiative,
            ...legendaryView(encounter, enemy),
            actions: enemyActionsView(encounter, enemy, movementView(encounter, enemy, board), lair ?? undefined),
          }
        : {}),
    })),
    ...(encounter.legendary.lair
      ? { lair: { active: true, usedThisRound: encounter.legendary.lairUsedRound === encounter.round } }
      : {}),
    ...turnView(encounter),
    ...actingView(encounter, hidden, showNumbers),
    ...(showNumbers ? dmTurnView(encounter, enemies) : {}),
    ...(options.lastHits?.length
      ? { lastHits: options.lastHits.map((record) => lastHitView(record, hidden, showNumbers)) }
      : {}),
    ...sidesView(encounter, enemies, hidden, showNumbers),
    ...savesView(options.lastSaves, hidden, showNumbers),
  };
}

function savesView(saves: LastSave[] | undefined, hidden: Set<string>, showNumbers: boolean): { lastSaves?: PublicSave[] } {
  const shown = (saves ?? []).filter((save) => showNumbers || !hidden.has(save.forcer.id));
  return shown.length
    ? {
        lastSaves: shown.map((save) => ({
          id: save.id,
          characterId: save.characterId,
          ability: save.ability,
          forcerId: save.forcer.id,
          forcer: save.forcer.name,
          ...(save.kind ? { kind: save.kind } : {}),
          ...(save.success !== undefined ? { success: save.success } : {}),
          ...(save.against ? { against: save.against } : {}),
          ...(save.damage ? { damage: save.damage } : {}),
          ...(save.petName ? { petName: save.petName } : {}),
          ...(save.creatureType !== undefined ? { creatureType: save.creatureType } : {}),
          ...(save.killerId !== undefined ? { killerId: save.killerId } : {}),
          ...(save.spell ? { spell: save.spell } : {}),
          ...(save.enemy !== undefined ? { enemy: save.enemy } : {}),
          ...(save.answered?.length ? { answered: save.answered } : {}),
        })),
      }
    : {};
}

// The side exceptions every client draws, a domination's included.
function sidesView(encounter: Encounter, enemies: EncounterEnemy[], hidden: Set<string>, showNumbers: boolean): { sides?: Record<string, CombatSide> } {
  const sides: Record<string, CombatSide> = {};
  const seen = new Set<string>();
  const note = (kind: "sheet" | "enemy", id: string, holder?: EncounterEnemy) => {
    if (seen.has(id) || (!showNumbers && hidden.has(id))) {
      return;
    }
    seen.add(id);
    const side = sideOf(encounter, kind, id, holder);
    if (side !== defaultSide(kind)) {
      sides[id] = side;
    }
  };
  for (const entry of encounter.order) {
    if (entry.kind === "pc") {
      note("sheet", entry.characterId);
    }
  }
  for (const enemy of enemies) {
    note("enemy", enemy.id, enemy);
  }
  return Object.keys(sides).length ? { sides } : {};
}

// What the person running the fight is waiting on: the rolls so far while
// the order is collected, the enemies due, an AI companion up.
function dmTurnView(encounter: Encounter, enemies: EncounterEnemy[]) {
  if (!encounter.orderReady) {
    const staged = encounter.order.flatMap((entry) =>
      entry.kind === "pc" ? [{ name: entry.name, initiative: entry.initiative }] : [],
    );
    return staged.length ? { staged } : {};
  }
  const names = new Map(enemies.map((enemy) => [enemy.id, enemy.displayName]));
  const due = (encounter.legendary.due ?? []).flatMap((id) =>
    names.has(id) ? [{ id, name: names.get(id) as string, acted: enemyActedThisRound(encounter, id) }] : [],
  );
  const current = encounter.order[encounter.turnIndex];
  const campaign = getCampaignById(encounter.campaignId);
  return {
    ...(due.length ? { enemiesDue: due } : {}),
    // A companion turn for the DM to play; one a player commands is theirs,
    // and at a test the AI GM runs the AI plays it (issue 685), so the
    // author's tracker offers no button to play it twice.
    ...(current?.kind === "pc" && campaign && !aiRunsTestTable(campaign) && dmPlaysTurn(campaign, current)
      ? { companionTurn: { id: current.characterId, name: current.name } }
      : {}),
  };
}

// The one test of a knock-out (knockout.ts), which reads the conditions
// list as well as the meta: this copy read the meta alone (issue #667).
function knockedOut(enemy: EncounterEnemy): boolean {
  return isKnockedOut(enemy);
}

function legendaryView(encounter: Encounter, enemy: EncounterEnemy) {
  const pool = encounter.legendary.pools[enemy.id];
  const profile = pool ? legendaryProfile(enemy.stats) : null;
  if (!pool || !profile) {
    return {};
  }
  return {
    legendary: {
      actions: pool.actions,
      actionsMax: profile.actionsPerRound,
      resistances: pool.resistances,
      resistancesMax: profile.resistances,
    },
  };
}

export function activePublicEncounter(
  campaignId: string,
  options: { enemyNumbers?: boolean } = {},
): PublicEncounter | null {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return null;
  }
  const map = getBattleMapForEncounter(encounter.id);
  // Only records a reaction may still answer: the engine's own freshness
  // rule, asked per character in the order, every open hit of each. Once per
  // character: an extra turn (Strength before Death, Thief's Reflexes) puts
  // them in the order twice, and each of their hits came twice with its cards.
  const heroes = [...new Set(encounter.order.flatMap((entry) => (entry.kind === "pc" ? [entry.characterId] : [])))];
  const lastHits = heroes.flatMap((id) => openHits(campaignId, id));
  return publicEncounter(encounter, listEnemies(encounter.id), {
    ...options,
    lastHits,
    lastSaves: triggerRecords(campaignId),
    hiddenRefIds: map ? listHiddenRefIds(map.id) : [],
  });
}
