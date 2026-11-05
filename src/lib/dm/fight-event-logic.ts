// Scripted events in a prepared fight (issue 685, the audit's 4.D): "more
// wolves at round 3", "the captain starts the fight bloodied", "the bridge
// gives way when the boss falls". A GM prepares a fight at home and writes
// what happens when; at the table the server does it at that moment, through
// the same handlers the console's own calls reach, so every rule and refusal
// those keep still holds (src/lib/dm/fight-events.ts runs them).
//
// What an event can do is a short, closed list of state changes: creatures
// come in, a creature is hurt to a number or to half, gains or loses a
// condition, appears or hides, squares of the fight's own map turn to another
// kind of ground, and the GM's words reach the table. None of them names a die
// or a result. A prepared fight never decides a roll: the
// table's dice stay honest whoever wrote the plan, which is why there is no
// such action to normalize and the reader below drops any it does not know.
//
// The "fight starts" event is also what a test fight's opening needs (the
// audit's 4.A, "an ordered list of opening GM actions"): its actions run in
// order right after the deploy, before anyone's first turn.
//
// Pure by design (no "@/" imports, no I/O), so scripts/test-fight-events.mjs
// drives it directly. Slots index the expanded roster, as every other part of
// a prepared fight does (encounter-template-logic.ts expandRoster).

import { z } from "zod";
import {
  fitGroundTiles,
  GROUND_KINDS,
  GROUND_LIMITS,
  groundKindOf,
  groundLine,
  groundWords,
  type GroundKind,
  type GroundTile,
} from "./fight-ground-logic.ts";

export const FIGHT_EVENT_LIMITS = {
  events: 8,
  actions: 6,
  // Round 1 is when the fight starts, which has a trigger of its own.
  roundMin: 2,
  roundMax: 20,
  // start_encounter and add_enemies take eight living enemies at most, so a
  // larger wave could never arrive whole.
  arrivals: 8,
  arrivalRows: 4,
  monster: 80,
  say: 300,
  condition: 40,
  hp: 1000,
  slots: 8,
} as const;

export type FightTrigger =
  | { kind: "start" }
  | { kind: "round"; round: number }
  // At or below half its hit points (SRD 5.1 has no word for it; the table
  // says bloodied).
  | { kind: "bloodied"; slot: number }
  // Dead, fled or knocked out: out of the fight.
  | { kind: "falls"; slot: number };

export type FightArrival = { monster: string; count: number };

export type FightAction =
  // Creatures join the fight already running (add_enemies). `at` picks where
  // they come in: where the engine puts them, where the party came in, or
  // beside a creature of the roster.
  | { kind: "reinforce"; enemies: FightArrival[]; at: "any" | "entry" | "slot"; slot?: number }
  // The creature's hit points go down to `hp`, or to half its maximum.
  | { kind: "hurt"; slot: number; to: "half" | "hp"; hp?: number }
  | { kind: "condition"; slot: number; condition: string; remove: boolean }
  // hidden false: the ambusher in the rafters is seen.
  | { kind: "visibility"; slot: number; hidden: boolean }
  // Squares of the fight's prepared map become another kind of ground: the
  // bridge gives way, the portcullis drops, the sluice floods the floor.
  // Only a fight drawn on a prepared map keeps one (its squares mean
  // nothing on a board the generator makes), fitted to the board's size when
  // the fight is deployed (fitEventsToBoard).
  | { kind: "ground"; tiles: GroundTile[]; terrain: GroundKind }
  // The GM's words, posted to the chronicle as they wrote them.
  | { kind: "say"; text: string };

export type FightEvent = { trigger: FightTrigger; actions: FightAction[] };

// ---- the route's gate ----
//
// The shape a save may carry, checked at the encounter-template routes before
// the normalizer fits it to the roster. An action of a kind this list does
// not hold (a die, a result) is a bad request, not something to drop quietly.

const slotField = z.number().int().min(0).max(FIGHT_EVENT_LIMITS.slots - 1);
const tileField = z.number().int().min(0).max(GROUND_LIMITS.tileMax);

const triggerInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start") }),
  z.object({ kind: z.literal("round"), round: z.number().int().min(1).max(FIGHT_EVENT_LIMITS.roundMax) }),
  z.object({ kind: z.literal("bloodied"), slot: slotField }),
  z.object({ kind: z.literal("falls"), slot: slotField }),
]);

const actionInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("reinforce"),
    enemies: z
      .array(
        z.object({
          monster: z.string().max(FIGHT_EVENT_LIMITS.monster),
          count: z.number().int().min(1).max(FIGHT_EVENT_LIMITS.arrivals),
        }),
      )
      .max(FIGHT_EVENT_LIMITS.arrivalRows),
    at: z.enum(["any", "entry", "slot"]).default("any"),
    slot: slotField.optional(),
  }),
  z.object({
    kind: z.literal("hurt"),
    slot: slotField,
    to: z.enum(["half", "hp"]),
    hp: z.number().int().min(1).max(FIGHT_EVENT_LIMITS.hp).optional(),
  }),
  z.object({
    kind: z.literal("condition"),
    slot: slotField,
    condition: z.string().max(FIGHT_EVENT_LIMITS.condition),
    remove: z.boolean().default(false),
  }),
  z.object({ kind: z.literal("visibility"), slot: slotField, hidden: z.boolean() }),
  z.object({
    kind: z.literal("ground"),
    tiles: z.array(z.object({ x: tileField, y: tileField })).max(GROUND_LIMITS.tiles),
    terrain: z.enum(GROUND_KINDS),
  }),
  z.object({ kind: z.literal("say"), text: z.string().max(FIGHT_EVENT_LIMITS.say) }),
]);

export const FIGHT_EVENTS_INPUT = z
  .array(
    z.object({
      trigger: triggerInput,
      actions: z.array(actionInput).max(FIGHT_EVENT_LIMITS.actions),
    }),
  )
  .max(FIGHT_EVENT_LIMITS.events);

// A prepared fight's extras as a save sends them: the events checked here,
// the rest left to normalizeTemplateExtras as before.
export const EXTRAS_INPUT = z.object({ events: FIGHT_EVENTS_INPUT.optional() }).catchall(z.unknown());

// The 400 a save with an event this list cannot read is answered with.
export const EVENTS_REFUSAL = "An event in the fight's plan could not be read. Pick its trigger and what happens again.";

// Whether a refused save was refused for its events, so the route can say
// so rather than blame the name or the roster.
export function eventsUnreadable(body: unknown): boolean {
  const extras = (body as { extras?: unknown } | null)?.extras;
  return extras !== undefined && !EXTRAS_INPUT.safeParse(extras).success;
}

// ---- the reader ----

function slotOf(value: unknown, slotCount: number): number | null {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 0 && number < slotCount ? number : null;
}

function readTrigger(raw: unknown, slotCount: number): FightTrigger | null {
  // Typed as the kinds the reader acts on: any other value matches none.
  const source = (raw ?? {}) as { kind?: FightTrigger["kind"]; round?: unknown; slot?: unknown };
  if (source.kind === "start") {
    return { kind: "start" };
  }
  if (source.kind === "round") {
    const round = Math.round(Number(source.round));
    if (!Number.isFinite(round)) {
      return null;
    }
    // Round 1 begins as the fight starts: said once, as the start.
    return round <= 1
      ? { kind: "start" }
      : { kind: "round", round: Math.min(FIGHT_EVENT_LIMITS.roundMax, round) };
  }
  if (source.kind === "bloodied" || source.kind === "falls") {
    const slot = slotOf(source.slot, slotCount);
    return slot === null ? null : { kind: source.kind, slot };
  }
  return null;
}

// A wave as a fight can take it: four kinds at most, eight creatures in all.
// The editor fits a pick to it as the reader does a save.
export function fitArrivals(raw: unknown): FightArrival[] {
  const rows: FightArrival[] = [];
  let total = 0;
  for (const entry of Array.isArray(raw) ? raw : []) {
    const row = (entry ?? {}) as { monster?: unknown; count?: unknown };
    const monster = typeof row.monster === "string" ? row.monster.trim().slice(0, FIGHT_EVENT_LIMITS.monster) : "";
    const count = Math.round(Number(row.count) || 1);
    if (!monster || rows.length >= FIGHT_EVENT_LIMITS.arrivalRows) {
      continue;
    }
    // The wave is cut to what a fight takes, never past it: the engine
    // would refuse the whole of it.
    const kept = Math.min(Math.max(1, count), FIGHT_EVENT_LIMITS.arrivals - total);
    if (kept <= 0) {
      break;
    }
    rows.push({ monster, count: kept });
    total += kept;
  }
  return rows;
}

function readAction(raw: unknown, slotCount: number): FightAction | null {
  // Typed as the kinds and choices the reader acts on: any other value
  // matches none of them.
  const source = (raw ?? {}) as Record<string, unknown> & {
    kind?: FightAction["kind"];
    at?: "any" | "entry" | "slot";
    to?: "half" | "hp";
  };
  switch (source.kind) {
    case "reinforce": {
      const enemies = fitArrivals(source.enemies);
      if (!enemies.length) {
        return null;
      }
      const slot = slotOf(source.slot, slotCount);
      if (source.at === "slot" && slot !== null) {
        return { kind: "reinforce", enemies, at: "slot", slot };
      }
      return { kind: "reinforce", enemies, at: source.at === "entry" ? "entry" : "any" };
    }
    case "hurt": {
      const slot = slotOf(source.slot, slotCount);
      if (slot === null) {
        return null;
      }
      const hp = Math.round(Number(source.hp));
      if (source.to === "hp" && Number.isFinite(hp) && hp >= 1) {
        return { kind: "hurt", slot, to: "hp", hp: Math.min(FIGHT_EVENT_LIMITS.hp, hp) };
      }
      return { kind: "hurt", slot, to: "half" };
    }
    case "condition": {
      const slot = slotOf(source.slot, slotCount);
      const condition =
        typeof source.condition === "string" ? source.condition.trim().slice(0, FIGHT_EVENT_LIMITS.condition) : "";
      return slot === null || !condition ? null : { kind: "condition", slot, condition, remove: source.remove === true };
    }
    case "visibility": {
      const slot = slotOf(source.slot, slotCount);
      return slot === null ? null : { kind: "visibility", slot, hidden: source.hidden === true };
    }
    case "ground": {
      const terrain = groundKindOf(source.terrain);
      const tiles = fitGroundTiles(source.tiles);
      return terrain && tiles.length ? { kind: "ground", tiles, terrain } : null;
    }
    case "say": {
      const text = typeof source.text === "string" ? source.text.trim().slice(0, FIGHT_EVENT_LIMITS.say) : "";
      return text ? { kind: "say", text } : null;
    }
    default:
      // A kind this list does not hold (a forced die, a set result) is read
      // as nothing: there is no way to script the dice at a live table.
      return null;
  }
}

// Cleaned against the roster it belongs to, as the rest of the extras are:
// an event or an action naming a slot past the end goes, an event left with
// nothing to do goes, and old rows (no events at all) read as none.
export function normalizeFightEvents(raw: unknown, slotCount: number = FIGHT_EVENT_LIMITS.slots): FightEvent[] {
  const events: FightEvent[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (events.length >= FIGHT_EVENT_LIMITS.events) {
      break;
    }
    const source = (entry ?? {}) as { trigger?: unknown; actions?: unknown };
    const trigger = readTrigger(source.trigger, slotCount);
    if (!trigger) {
      continue;
    }
    const actions = (Array.isArray(source.actions) ? source.actions : [])
      .map((action) => readAction(action, slotCount))
      .filter((action): action is FightAction => action !== null)
      .slice(0, FIGHT_EVENT_LIMITS.actions);
    if (actions.length) {
      events.push({ trigger, actions });
    }
  }
  return events;
}

// The plan as the board it was deployed on can run it. A change of ground
// names squares of the fight's prepared map, so on any other board (no map
// linked, a map that could not be laid, null here) it goes; on the map it
// keeps the squares inside the board. An event left with nothing goes too.
// The routes call it with null for a fight that links no map, so a save
// never keeps squares that name nothing.
export function fitEventsToBoard(events: FightEvent[], board: { width: number; height: number } | null): FightEvent[] {
  return events
    .map((event) => ({
      ...event,
      actions: event.actions.flatMap((action): FightAction[] => {
        if (action.kind !== "ground") {
          return [action];
        }
        const tiles = board ? fitGroundTiles(action.tiles, board) : [];
        return tiles.length ? [{ ...action, tiles }] : [];
      }),
    }))
    .filter((event) => event.actions.length);
}

// ---- when an event is due ----

// What the triggers read of one roster creature in the fight.
export type SlotState = { hp: number; maxHp: number; defeated: boolean };

export type FightMoment = {
  round: number;
  // Each slot the deploy matched to a creature, by slot. A slot the fight
  // never made (a roster cut down to fit the party) is absent and never
  // triggers.
  slots: Map<number, SlotState>;
};

// "At or below half its hit points." A creature dropped from full in one
// blow passed half on its way down, so its bloodied event happens too.
export function isBloodied(state: SlotState): boolean {
  return state.maxHp > 0 && state.hp * 2 <= state.maxHp;
}

export function triggerMet(trigger: FightTrigger, moment: FightMoment): boolean {
  switch (trigger.kind) {
    case "start":
      return true;
    case "round":
      return moment.round >= trigger.round;
    case "bloodied": {
      const state = moment.slots.get(trigger.slot);
      return Boolean(state && isBloodied(state));
    }
    case "falls":
      return Boolean(moment.slots.get(trigger.slot)?.defeated);
  }
}

// The hit points a hurt action leaves, or null when it changes nothing: it
// only ever takes hit points away (a creature already lower stays as it is),
// and it never drops a creature to 0, which is a blow's to do.
export function hurtTarget(action: Extract<FightAction, { kind: "hurt" }>, current: number, maxHp: number): number | null {
  const wanted = action.to === "hp" && action.hp ? Math.min(action.hp, maxHp) : Math.floor(maxHp / 2);
  const target = Math.max(1, wanted);
  return target < current ? target : null;
}

// ---- words ----

const listWords = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

const arrivalWords = (enemies: FightArrival[]) =>
  enemies.map((row) => (row.count > 1 ? `${row.monster} x${row.count}` : row.monster)).join(", ");

export function triggerWords(trigger: FightTrigger, label: (slot: number) => string): string {
  switch (trigger.kind) {
    case "start":
      return "When the fight starts";
    case "round":
      return `When round ${trigger.round} begins`;
    case "bloodied":
      return `When ${label(trigger.slot)} is bloodied`;
    case "falls":
      return `When ${label(trigger.slot)} falls`;
  }
}

export function actionWords(action: FightAction, label: (slot: number) => string): string {
  switch (action.kind) {
    case "reinforce": {
      const where =
        action.at === "entry"
          ? " where the party came in"
          : action.at === "slot" && action.slot !== undefined
            ? ` beside ${label(action.slot)}`
            : "";
      return `${arrivalWords(action.enemies)} join the fight${where}`;
    }
    case "hurt":
      return action.to === "hp" ? `${label(action.slot)} drops to ${action.hp} hit points` : `${label(action.slot)} is bloodied`;
    case "condition":
      return action.remove ? `${label(action.slot)} is no longer ${action.condition}` : `${label(action.slot)} is ${action.condition}`;
    case "visibility":
      return action.hidden ? `${label(action.slot)} hides` : `${label(action.slot)} appears`;
    case "ground":
      return groundWords(action.tiles.length, action.terrain);
    case "say":
      return `the table hears: "${action.text}"`;
  }
}

// The GM's plan note lists each event in plain words, beside the phases.
export function describeFightEvent(event: FightEvent, label: (slot: number) => string): string {
  return `${triggerWords(event.trigger, label)}: ${event.actions.map((action) => actionWords(action, label)).join("; ")}.`;
}

// What the table reads once an action has happened. `name` is how the table
// may know the creature: UNSEEN for one the GM keeps off the board, as the
// tracker says it, written to start a sentence.
export type ActionOutcome =
  | { kind: "reinforce"; names: string[] }
  | { kind: "hurt"; name: string; half: boolean }
  | { kind: "condition"; name: string; condition: string; remove: boolean }
  | { kind: "visibility"; name: string; hidden: boolean }
  // `moved`: who was standing where the ground no longer holds them, as the
  // table may name them (a creature the GM keeps off the board is left out).
  | { kind: "ground"; terrain: GroundKind; moved: string[] }
  | { kind: "say"; text: string };

export const UNSEEN = "Someone unseen";

export function outcomeLine(outcome: ActionOutcome): string {
  switch (outcome.kind) {
    case "reinforce":
      return outcome.names.length
        ? `${listWords(outcome.names)} ${outcome.names.length === 1 ? "joins" : "join"} the fight.`
        : "";
    case "hurt":
      return `${outcome.name} is ${outcome.half ? "bloodied" : "wounded"}.`;
    case "condition":
      return `${outcome.name} is ${outcome.remove ? "no longer " : ""}${outcome.condition}.`;
    case "visibility":
      // One that slips away is not named: it is unseen from now on.
      return outcome.hidden ? "Someone slips out of sight." : `${outcome.name} appears.`;
    case "ground":
      return groundLine(outcome.terrain, outcome.moved);
    case "say":
      return outcome.text;
  }
}
