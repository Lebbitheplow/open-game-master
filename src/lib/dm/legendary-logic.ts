import { groupTraits } from "@/lib/bestiary/block-sections";
import { legendaryCountIn } from "@/lib/dm/ability-entries";
import type { EnemyAttack, EnemyStats } from "@/lib/bestiary/statblock";
import { findMonsterAbility, normalizeAbilityLedgers, type AbilityLedger, type MonsterAbility } from "@/lib/dm/monster-abilities";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { TurnBudget } from "@/lib/dm/action-budget";
import { legendaryRoutes, type LegendaryRoute } from "@/lib/dm/legendary-route-logic";
import { isNamed } from "@/lib/srd/feature-names";
import { normalizeEnemyTurns, type EnemyTurns } from "@/lib/dm/enemy-turn-logic";
import { lairForbidsRepeat, lairRepeatRefusal, type LairHolder } from "@/lib/dm/lair-logic";

// The lair's own readers live in lair-logic.ts; callers keep importing them here.
export { lairCountPassed, lairForbidsRepeat, lairRepeatRefusal, lairResolution, lairSave, pickLairOption, type LairSave } from "@/lib/dm/lair-logic";

// Legendary and lair actions and legendary resistance (docs/vtt-parity-
// implementation-plan.md 4.1): what a stat block says a creature may do
// out of turn, and the pools the fight keeps for it. Pure; the tools and
// the tracker read it.

export type LegendaryAction = { name: string; cost: number; text: string };

export type LegendaryProfile = {
  actionsPerRound: number;
  resistances: number;
  actions: LegendaryAction[];
  lairActions: string[];
};

// Per enemy, what is left: actions refill at the top of its own turn,
// resistances last the fight.
export type LegendaryPool = { actions: number; resistances: number };
// What the fight remembers about a round beyond the pools, carried in the
// same stored object because it is the encounter's per-enemy, per-round
// record. Optional: a fight saved before it existed reads as nobody having
// acted.
//   acted.ids   the enemies that have taken their action in acted.round
//   acted.owed  enemies owed one action more: the round a surprised party
//               lost to them (src/lib/dm/can-act.ts canEnemyAct)
export type RoundLedger = { round: number; ids: string[]; owed?: string[] };
export type LegendaryState = {
  pools: Record<string, LegendaryPool>;
  lair: boolean;
  lairUsedRound: number;
  acted?: RoundLedger;
  // Enemies whose next enemy_attack is the one attack a legendary action
  // bought: one swing, not the Multiattack. Optional, like everything below.
  strikes?: string[];
  // A concentration area's explicit strikes off the board: "<spell>|<caster
  // id>|<creature id>" -> the turn it struck (src/lib/dm/area-casting.ts).
  areaStruck?: Record<string, string>;
  // What each enemy has spent of its limited abilities this fight: recharge
  // abilities waiting on their d6, uses a day, spell slots
  // (src/lib/dm/monster-abilities.ts).
  abilities?: Record<string, AbilityLedger>;
  // The enemies a model's end_turn handed it to act, with the DM turn that
  // got them, so the finalize step neither moves the pointer twice nor acts
  // them again (src/lib/dm/encounter-tools.ts). `wrapped`: that end_turn
  // began a new round, which the turn's table note says once the narration
  // is in.
  handoff?: { turnId: string; enemyIds: string[]; wrapped?: boolean; dying?: string[] };
  // The backstop stopped on a held roll (src/lib/dm/backstop-calls.ts): the
  // DM turn it belongs to, and where the close of that turn goes on once the
  // roll is in: the whole close again (`narration`, the pass came first in
  // it), or only the rest of the pass and the wake after it (`follow`).
  backstop?: { turnId: string; then: "narration" | "follow" };
  // The enemies that have taken a bonus action in `round` (Nimble Escape's
  // Disengage or Hide).
  bonus?: { round: number; ids: string[] };
  // The enemies a pass outside the model's own end_turn walked past that
  // nobody has yet played or waved through (src/lib/dm/enemies-due.ts).
  due?: string[];
  // The enemies a pass walked past that could not act (stunned, paralyzed,
  // held by a spell): owed no turn, and owed a line saying they lost it, in
  // the backstop's note (src/lib/dm/encounter-tools.ts, issue #666).
  lost?: string[];
  // What the last pass left for once the enemies it walked past have gone
  // (issue 713, src/lib/dm/encounter-logic.ts passWaits): the death saves
  // of the dying after them, and, with `wrap`, the rest of the walk from
  // the end of the order, the round turning over with it
  // (src/lib/dm/encounter-tools.ts finishPass).
  rest?: { wrap?: true; dying?: string[] };
  // A stretch with nobody able to act: the round it began, and whether the
  // table was told it ran too long to keep waking the DM
  // (src/lib/dm/encounter-tools.ts idledOut).
  idle?: { since: number; told?: boolean };
  // The enemies the pointer walked past last move: their turns, taken in
  // the DM turn since, end as the pointer moves again, with the saves their
  // conditions grant at the end of a turn (src/lib/dm/condition-tick.ts).
  walked?: string[];
  // What held those enemies as their turns began, read again once those
  // turns are over (condition-tick.ts turnHoldKeys, held-turn.ts): only
  // these are saved against as those turns end. A hold
  // laid after an enemy's turn, Hold Person cast by the character who goes
  // next, waits for the end of a turn the creature takes under it (SRD 5.1:
  // "at the end of each of its turns"). Absent on a row written before it.
  walkedHolds?: string[];
  // A pointer move held for a watch stop (src/lib/dm/turn-hold.ts): whose
  // turn is ending, the watcher whose choice it waits on, and the stop. The
  // pointer stays and that character acts no more until the stop closes.
  heldMove?: { pendingId: string; characterId: string; watcher: string };
  // The last save a legendary creature failed, for legendary_resist: what
  // it laid and what a success would have spared (src/lib/dm/forced-save.ts).
  failedSave?: FailedSave;
  // The legendary actions taken, by the turn each followed: one option per
  // creature at the end of another creature's turn (legendary-tools.ts).
  opportunities?: { key: string; ids: string[] };
  // The round whose initiative count 20 the pointer has just passed: the
  // lair acts then or not at all (lairCountPassed), and the option it took
  // last, which some blocks forbid two rounds in a row.
  lairDue?: number;
  lairLast?: string;
  // Each enemy's turn this round: its Dashes, a Disengage, what its action
  // went on (src/lib/dm/enemy-turn-logic.ts, issue #621).
  turns?: EnemyTurns;
  // A legendary action spent on what a later call makes (its attack, its
  // ability, a spell), by enemy: what it cost and at which turn's end, so a
  // refused follow-up gives the action back (legendary-tools.ts
  // settleLegendaryFollowUp). Cleared once the follow-up is made.
  purchases?: Record<string, LegendaryPurchaseRecord>;
  // The character the pointer landed on while enemies it walked past still
  // had their turns (enemies-due.ts): that character's turn begins once those
  // enemies have acted (held-turn.ts), so the reaction they spent and what
  // lasts until the start of their turn (Shield) hold until then.
  turnStart?: string;
  // The characters who took a reaction against the enemies' pass before
  // their turn after the engine began it (a hit stays open to a reaction
  // until they act, last-hit.ts), by that turn's key: one reaction for the
  // pass (held-turn.ts).
  lateReacted?: { turn: string; ids: string[] };
  // What the turn the pointer last left spent, kept past its end
  // (encounter-tools.ts advancePointer): a call that ends its own turn (a
  // Fathomless Plunge taking the warlock out of the order passes it on,
  // settleTurn) still shows the action it paid, read where the live budget
  // has gone to the next creature.
  endedTurn?: TurnBudget;
};

export type LegendaryPurchaseRecord = {
  action: string;
  cost: number;
  key: string;
  strike: boolean;
  bought: string | null;
  // A legendary move's allowance (squares, whether it provokes, aloft), and
  // a teleport's reach in feet, for the move_token or teleport_token after it.
  move?: { tiles: number; provokes: boolean; fly: boolean };
  teleportFeet?: number;
};

export type FailedSave = {
  enemyId: string;
  round: number;
  detail: string;
  conditions?: string[];
  spell?: string;
  source?: string;
  refund?: number;
  resisted?: boolean;
};

function stringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
}

export function normalizeLegendaryState(raw: unknown): LegendaryState {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pools: Record<string, LegendaryPool> = {};
  const rawPools = (record.pools && typeof record.pools === "object" ? record.pools : {}) as Record<string, unknown>;
  for (const [id, pool] of Object.entries(rawPools)) {
    const entry = (pool && typeof pool === "object" ? pool : {}) as Record<string, unknown>;
    pools[id] = { actions: Math.max(0, Number(entry.actions) || 0), resistances: Math.max(0, Number(entry.resistances) || 0) };
  }
  const acted = (record.acted && typeof record.acted === "object" ? record.acted : null) as Record<string, unknown> | null;
  const abilities = normalizeAbilityLedgers(record.abilities);
  const handoff = (record.handoff && typeof record.handoff === "object" ? record.handoff : null) as Record<string, unknown> | null;
  const heldMove = (record.heldMove && typeof record.heldMove === "object" ? record.heldMove : null) as Record<string, unknown> | null;
  const bonus = (record.bonus && typeof record.bonus === "object" ? record.bonus : null) as Record<string, unknown> | null;
  const backstop = (record.backstop && typeof record.backstop === "object" ? record.backstop : null) as Record<string, unknown> | null;
  const idle = (record.idle && typeof record.idle === "object" ? record.idle : null) as Record<string, unknown> | null;
  const rest = (record.rest && typeof record.rest === "object" ? record.rest : null) as Record<string, unknown> | null;
  const failed = (record.failedSave && typeof record.failedSave === "object" ? record.failedSave : null) as Record<string, unknown> | null;
  const opportunities = (record.opportunities && typeof record.opportunities === "object" ? record.opportunities : null) as Record<string, unknown> | null;
  const turns = normalizeEnemyTurns(record.turns);
  const purchases = purchasesOf(record.purchases);
  const lateReacted = (record.lateReacted && typeof record.lateReacted === "object" ? record.lateReacted : null) as Record<string, unknown> | null;
  const areaStruck = record.areaStruck && typeof record.areaStruck === "object"
    ? Object.fromEntries(Object.entries(record.areaStruck as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : null;
  return {
    pools,
    lair: record.lair === true,
    lairUsedRound: Math.max(0, Number(record.lairUsedRound) || 0),
    ...(acted
      ? {
          acted: {
            round: Number(acted.round) || 0,
            ids: stringList(acted.ids),
            ...(stringList(acted.owed).length ? { owed: stringList(acted.owed) } : {}),
          },
        }
      : {}),
    ...(stringList(record.strikes).length ? { strikes: stringList(record.strikes) } : {}),
    ...(Object.keys(abilities).length ? { abilities } : {}),
    ...(handoff && typeof handoff.turnId === "string"
      ? {
          handoff: {
            turnId: handoff.turnId,
            enemyIds: stringList(handoff.enemyIds),
            ...(handoff.wrapped === true ? { wrapped: true } : {}),
            ...(stringList(handoff.dying).length ? { dying: stringList(handoff.dying) } : {}),
          },
        }
      : {}),
    ...(backstop && typeof backstop.turnId === "string" ? { backstop: { turnId: backstop.turnId, then: backstop.then === "follow" ? ("follow" as const) : ("narration" as const) } } : {}),
    ...(bonus ? { bonus: { round: Number(bonus.round) || 0, ids: stringList(bonus.ids) } } : {}),
    ...(stringList(record.due).length ? { due: stringList(record.due) } : {}),
    ...(stringList(record.lost).length ? { lost: stringList(record.lost) } : {}),
    ...(rest && (rest.wrap === true || stringList(rest.dying).length)
      ? { rest: { ...(rest.wrap === true ? { wrap: true as const } : {}), ...(stringList(rest.dying).length ? { dying: stringList(rest.dying) } : {}) } }
      : {}),
    ...(idle ? { idle: { since: Number(idle.since) || 0, ...(idle.told === true ? { told: true } : {}) } } : {}),
    ...(stringList(record.walked).length ? { walked: stringList(record.walked) } : {}),
    ...(Array.isArray(record.walkedHolds) ? { walkedHolds: stringList(record.walkedHolds) } : {}),
    ...(heldMove && typeof heldMove.pendingId === "string" && typeof heldMove.characterId === "string"
      ? { heldMove: { pendingId: heldMove.pendingId, characterId: heldMove.characterId, watcher: typeof heldMove.watcher === "string" ? heldMove.watcher : "" } }
      : {}),
    ...(failed && typeof failed.enemyId === "string"
      ? {
          failedSave: {
            enemyId: failed.enemyId,
            round: Number(failed.round) || 0,
            detail: String(failed.detail ?? ""),
            ...(stringList(failed.conditions).length ? { conditions: stringList(failed.conditions) } : {}),
            ...(typeof failed.spell === "string" ? { spell: failed.spell } : {}),
            ...(typeof failed.source === "string" ? { source: failed.source } : {}),
            ...(Number(failed.refund) > 0 ? { refund: Number(failed.refund) } : {}),
            ...(failed.resisted === true ? { resisted: true } : {}),
          },
        }
      : {}),
    ...(opportunities && typeof opportunities.key === "string"
      ? { opportunities: { key: opportunities.key, ids: stringList(opportunities.ids) } }
      : {}),
    ...(Number(record.lairDue) > 0 ? { lairDue: Number(record.lairDue) } : {}),
    ...(typeof record.lairLast === "string" ? { lairLast: record.lairLast } : {}),
    ...(areaStruck && Object.keys(areaStruck).length ? { areaStruck } : {}),
    ...(turns ? { turns } : {}),
    ...(purchases && Object.keys(purchases).length ? { purchases } : {}),
    ...(typeof record.turnStart === "string" && record.turnStart ? { turnStart: record.turnStart } : {}),
    ...(lateReacted && typeof lateReacted.turn === "string" && stringList(lateReacted.ids).length
      ? { lateReacted: { turn: lateReacted.turn, ids: stringList(lateReacted.ids) } }
      : {}),
    ...(record.endedTurn && typeof record.endedTurn === "object" && typeof (record.endedTurn as { ownerId?: unknown }).ownerId === "string"
      ? { endedTurn: record.endedTurn as TurnBudget }
      : {}),
  };
}

function purchasesOf(raw: unknown): Record<string, LegendaryPurchaseRecord> | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const out: Record<string, LegendaryPurchaseRecord> = {};
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    const record = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    if (typeof record.action === "string" && typeof record.key === "string") {
      const move = (record.move && typeof record.move === "object" ? record.move : null) as Record<string, unknown> | null;
      out[id] = {
        action: record.action,
        cost: Math.max(1, Number(record.cost) || 1),
        key: record.key,
        strike: record.strike === true,
        bought: typeof record.bought === "string" ? record.bought : null,
        ...(move ? { move: { tiles: Math.max(0, Number(move.tiles) || 0), provokes: move.provokes !== false, fly: move.fly === true } } : {}),
        ...(Number(record.teleportFeet) > 0 ? { teleportFeet: Number(record.teleportFeet) } : {}),
      };
    }
  }
  return out;
}

// A cost however the book prints it: "(Costs 2 Actions)", "(Costs 2 Actions;
// Humanoid Form Only)", "(Costs 2 Actions, Recharge 5-6)", Tome of Beasts'
// "(2 actions)" and Tome of Beasts 3's bare "(2)".
const COST = /\((?:[^)]*?\bcosts?\s+(\d)\s+actions?\b[^)]*|(\d)(?:\s+actions?\b[^)]*)?)\)/i;
const NAME_SPLIT = /^([^.:(]{2,60}?)((?:\s*\([^)]*\))*)\s*[.:]+\s*([\s\S]*)$/i;

// One tagged line ("Legendary action: Wing Attack (Costs 2 Actions). The
// dragon beats...") as a row with its cost, read from the name's tags.
export function parseLegendaryLine(text: string): LegendaryAction {
  const split = NAME_SPLIT.exec(text.trim());
  const costMatch = COST.exec(split ? split[2] : text);
  const cost = costMatch ? Math.max(1, Math.min(3, Number(costMatch[1] ?? costMatch[2]))) : 1;
  if (split) {
    return { name: split[1].trim(), cost, text: split[3].trim() };
  }
  return { name: text.trim().slice(0, 60), cost, text: "" };
}

// The profile a stat block implies: legendary lines become actions, a
// "Legendary Resistance (3/Day)" trait becomes the counter, lair lines
// become lair actions. A block with none of them has no profile. A legendary
// line that only states the count (A5e prints "The dragon can take 3
// legendary actions" as the first option) gives the count and is no action.
export function legendaryProfile(stats: Pick<EnemyStats, "traits">): LegendaryProfile | null {
  const groups = groupTraits(stats.traits ?? []);
  const legendaryLines = groups.find((group) => group.section === "legendary")?.lines ?? [];
  const counted = legendaryLines.map((line) => legendaryCountIn(parseLegendaryLine(line).name)).find((count) => count !== null) ?? null;
  const actions = legendaryLines.map(parseLegendaryLine).filter((action) => legendaryCountIn(action.name) === null);
  const lairActions = groups.find((group) => group.section === "lair")?.lines ?? [];
  let resistances = 0;
  let actionsPerRound = counted ?? 3;
  for (const line of stats.traits ?? []) {
    const resist = /legendary resistance\s*\((\d)\s*\/\s*day\)/i.exec(line);
    if (resist) {
      resistances = Number(resist[1]);
    }
    // The count statblock.ts writes when the block's differs from three
    // ("Legendary actions: The creature can take 1 legendary actions a
    // round."), or a line a person wrote that says it.
    const perRound = legendaryCountIn(line);
    if (perRound !== null) {
      actionsPerRound = perRound;
    }
  }
  if (!actions.length && !resistances && !lairActions.length) {
    return null;
  }
  return { actionsPerRound: actions.length ? actionsPerRound : 0, resistances, actions, lairActions };
}

export function freshPool(profile: LegendaryProfile): LegendaryPool {
  return { actions: profile.actionsPerRound, resistances: profile.resistances };
}

// The pool the enemy starts its own turn with: actions refill, the
// resistances left are kept.
export function refillActions(pool: LegendaryPool | undefined, profile: LegendaryProfile): LegendaryPool {
  return { actions: profile.actionsPerRound, resistances: pool ? pool.resistances : profile.resistances };
}

export type SpendOutcome = { ok: true; pool: LegendaryPool; action: LegendaryAction } | ({ ok: false } & ToolError);

export function spendLegendaryAction(
  pool: LegendaryPool,
  profile: LegendaryProfile,
  actionName: string,
): SpendOutcome {
  // By its whole name; a cost note sent with it is read aside ("Wing Attack
  // (Costs 2 Actions)").
  const action = profile.actions.find((entry) => isNamed(actionName, entry.name));
  if (!action) {
    return { ok: false, error: `No legendary action called "${actionName}". It has: ${profile.actions.map((entry) => entry.name).join(", ")}.`, retry: true };
  }
  if (pool.actions < action.cost) {
    return { ok: false, error: `${action.name} costs ${action.cost}; only ${pool.actions} legendary action${pool.actions === 1 ? "" : "s"} left this round. Pick a cheaper one, or wait for the next round.`, retry: true };
  }
  return { ok: true, pool: { ...pool, actions: pool.actions - action.cost }, action };
}

// What a legendary action buys for a later call once it is spent, read one
// way for the tool's next step (legendary-tools.ts handleLegendaryAction)
// and for the GM's card (src/lib/dm/enemy-actions-view.ts): the way to play
// it (legendary-route-logic.ts) picked, its first step's attack, its ability
// with numbers of its own (Wing Attack's save), a cantrip or a spell from its
// list. Anything else (a check, a move, a heal) the action resolves itself,
// or the GM narrates.
export type LegendaryPurchase =
  | { kind: "attack"; attack: EnemyAttack }
  | { kind: "ability"; ability: MonsterAbility }
  | { kind: "cantrip" }
  | { kind: "spell" }
  | { kind: "none" };

export function legendaryPurchase(
  stats: Pick<EnemyStats, "attacks" | "legendaryAttacks" | "traits" | "specials">,
  action: LegendaryAction,
  route?: LegendaryRoute | null,
): LegendaryPurchase {
  const chosen = route === undefined ? (legendaryRoutes(stats, action)[0] ?? null) : route;
  const step = chosen?.steps[0];
  if (step?.kind === "attack" || step?.kind === "swallow") {
    const attack = [...(stats.attacks ?? []), ...(stats.legendaryAttacks ?? [])].find((entry) => entry.name === step.attack);
    return attack ? { kind: "attack", attack } : { kind: "none" };
  }
  if (step?.kind === "save") {
    const ability = findMonsterAbility(stats, step.ability);
    return ability ? { kind: "ability", ability } : { kind: "none" };
  }
  if (step?.kind === "spell") {
    return step.cantrip ? { kind: "cantrip" } : { kind: "spell" };
  }
  return { kind: "none" };
}

// When a legendary action may be taken (SRD 5.1, Legendary Actions: "only
// one legendary action option can be used at a time and only at the end of
// another creature's turn"), read one way by the tool and by the GM's card.
// One option at the end of each other creature's turn: the turn is the
// pointer's (`turn`, turnKey), and each enemy that acts since closes a turn
// of its own. Its own turn is the pointer on it, or its turn begun and not
// yet taken: handed to the model by an end_turn (`handoff`), or walked past
// at a table a person runs and held for them (`due`, enemies-due.ts), where
// the console's form used to spend one on the creature's own turn. Having
// acted, it is still in its own turn while it is held so and no creature
// has acted after it: before this, a GM who played a dragon's Tail on its
// turn could spend a legendary Detect inside that same turn. Its turn ends
// with another's after it, or when the turn is handed on; the pointer then
// rests on the next character, whose turn's end is the moment the next one
// is keyed to.
// The turn's end a legendary action is taken at: the turn ending, and how
// many creatures' own turns have run inside it (the pointer never rests on
// an enemy, so each one played there is its own turn's end).
export function legendaryMomentKey(turn: string, round: number, legendary: Pick<LegendaryState, "acted">): string {
  const acted = legendary.acted?.round === round ? legendary.acted.ids.length : 0;
  return `${turn}:${acted}`;
}

// What a legendary action bought for a later call, while the turn's end it
// was bought at lasts. One never made by then is gone: a Move nobody walked
// must not make the creature's own walk a round later a free one, nor a
// Teleport left waiting stretch its next jump.
export function livePurchase(
  legendary: Pick<LegendaryState, "acted" | "purchases">,
  moment: { turn: string; round: number },
  enemyId: string,
): LegendaryPurchaseRecord | null {
  const record = legendary.purchases?.[enemyId];
  return record && record.key === legendaryMomentKey(moment.turn, moment.round, legendary) ? record : null;
}

export function legendaryOpening(
  moment: {
    turn: string;
    round: number;
    onPointer: boolean;
    actedThisRound: boolean;
    legendary: Pick<LegendaryState, "acted" | "opportunities" | "handoff" | "due">;
  },
  enemy: { id: string; displayName: string },
): { key: string; taken: string[]; refusal: ToolError | null } {
  const begun = Boolean(moment.legendary.handoff?.enemyIds.includes(enemy.id) || moment.legendary.due?.includes(enemy.id));
  const acted = moment.legendary.acted?.round === moment.round ? moment.legendary.acted.ids : [];
  const running = begun && moment.actedThisRound && acted.at(-1) === enemy.id;
  if (moment.onPointer || (begun && !moment.actedThisRound) || running) {
    return {
      key: "",
      taken: [],
      refusal: {
        error: running
          ? `It is ${enemy.displayName}'s own turn; legendary actions come at the end of other creatures' turns, and the end of its own turn is not one. The next comes once another creature's turn ends. Nothing was spent.`
          : `It is ${enemy.displayName}'s own turn; legendary actions come at the end of other creatures' turns. Take its turn first: enemy_attack, or cast_at_player / aoe_damage with casterEnemyId and enemyAbility or spell.`,
        retry: true,
      },
    };
  }
  const key = legendaryMomentKey(moment.turn, moment.round, moment.legendary);
  const taken = moment.legendary.opportunities?.key === key ? moment.legendary.opportunities.ids : [];
  if (taken.includes(enemy.id)) {
    return {
      key,
      taken,
      refusal: {
        error: `${enemy.displayName} has already taken a legendary action at the end of this turn. It takes one option at the end of each other creature's turn; the next comes when another creature's turn ends. Nothing was spent.`,
        retry: true,
      },
    };
  }
  return { key, taken, refusal: null };
}

export function spendResistance(pool: LegendaryPool): LegendaryPool | null {
  return pool.resistances > 0 ? { ...pool, resistances: pool.resistances - 1 } : null;
}

// Whether a failed save is worth a Legendary Resistance to the creature
// that would suffer it, as a DM running it would judge (SRD 5.1: the
// creature "can choose to succeed instead"): a condition that takes its
// turn, its movement, its senses or its will, or a spell's lasting hold.
// A rider that ends with its next turn (Vicious Mockery's disadvantage) or
// a fall to prone is not; damage alone is left to legendary_resist.
const WORTH_RESISTING = new Set([
  "blinded", "charmed", "deafened", "frightened", "incapacitated", "paralyzed", "petrified",
  "restrained", "stunned", "unconscious", "polymorphed", "banished", "slowed", "confused",
  "feebleminded", "imprisoned", "mazed", "dominated", "dancing", "turned", "cursed",
]);

export function bindsWorthResisting(conditions: string[], endsWithTurn = false): boolean {
  if (endsWithTurn) {
    return false;
  }
  return conditions.some((name) => {
    const lower = name.trim().toLowerCase();
    return WORTH_RESISTING.has(lower) || [...WORTH_RESISTING].some((word) => lower.startsWith(`${word} `));
  });
}

// Every lair option the fight's creatures print, in the order lair_action
// numbers them. A book's printed lair options (Tome of Beasts' dragons) are
// offered in a fight the DM started in the lair; they never make one a lair
// fight.
export function legendaryLairLines(enemies: LairHolder[]): string[] {
  return enemies.flatMap((enemy) => [...(legendaryProfile(enemy.stats)?.lairActions ?? []), ...(enemy.stats.lairOptions ?? [])]);
}

// The lair's options while its moment is open (initiative count 20 has
// passed this move and the lair has not acted on it), each numbered as
// lair_action takes it, with the creature whose block prints it and the
// tool's own refusal of it. Null when the lair may not act now: the GM's
// lair cards (src/lib/dm/enemy-actions-view.ts) are offered only then.
export type LairChoice = { number: number; line: string; enemyId: string; refusal: string | null };

export function lairChoices(
  enemies: LairHolder[],
  legendary: Pick<LegendaryState, "lair" | "lairDue" | "lairUsedRound" | "lairLast">,
): LairChoice[] | null {
  const due = legendary.lairDue;
  if (!legendary.lair || due === undefined || legendary.lairUsedRound === due) {
    return null;
  }
  const options = legendaryLairLines(enemies);
  const noRepeat = lairForbidsRepeat(enemies);
  let number = 0;
  return enemies.flatMap((enemy) =>
    legendaryLairLines([enemy]).map((line) => {
      number += 1;
      return { number, line, enemyId: enemy.id, refusal: lairRepeatRefusal(options, line, legendary, due, noRepeat) };
    }),
  );
}
