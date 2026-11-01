import type { Footprint } from "@/lib/battlemap/footprint";
import { restandOn, standsOnOpenGround } from "@/lib/battlemap/ground-change";
import type { OrderEntry } from "@/lib/db/encounters";
import type { ConditionMetaMap } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";

// What a prepared fight's event changed, and how "Revert this turn" takes it
// back (issue 685; the events: src/lib/dm/fight-events.ts). Pure, so the
// suites read the rules without a table.
//
// The event runs through the console's own handlers, and those do more than
// the plan names: reinforcements renumber the goblins already there, a
// condition can drop a flyer. So the fight is pictured just before the event
// and just after (fight-event-undo.ts), and what differs is what the event
// did. Taking it back follows the sheet undo's rule where a value can only be
// set (hit points, a token's place): it goes back to what it was, and when it
// has changed since the lead is told first. A condition is taken off or put
// back by itself, so one gained since stays. Two things are never forced:
// a creature that has left the fight since is not brought back by a revert
// of something done to it before, and a token that has moved since stays
// where it stands.

export type EnemyState = {
  displayName: string;
  currentHp: number;
  status: "alive" | "dead" | "fled";
  conditions: string[];
  conditionMeta: ConditionMetaMap;
};

export type TokenState = {
  refId: string;
  name: string;
  x: number;
  y: number;
  hidden: boolean;
  footprint: Footprint;
};

// The fight as one event found it or left it.
export type FightPicture = {
  encounterId: string;
  order: OrderEntry[];
  turnIndex: number;
  enemies: Record<string, EnemyState>;
  // The drawn terrain (what the painter edits) and the ground the engine
  // walks, of the fight's board; null with no board.
  map: { id: string; width: number; height: number; drawn: string; ground: string } | null;
  tokens: Record<string, TokenState>;
};

type TokenPlace = Pick<TokenState, "name" | "x" | "y" | "hidden">;

export type FightEventUndo = {
  encounterId: string;
  // The creatures it brought in, as they arrived.
  arrivals: Array<{ id: string; state: EnemyState }>;
  // What it changed of the creatures already there.
  enemies: Array<{ id: string; before: Partial<EnemyState>; after: Partial<EnemyState> }>;
  // What it changed of the tokens already on the board.
  tokens: Array<{ id: string; before: Partial<TokenPlace>; after: Partial<TokenPlace> }>;
  // The squares it changed, by index into the drawn terrain.
  ground: { mapId: string; tiles: Array<{ index: number; before: string; after: string }> } | null;
};

const ENEMY_FIELDS = ["displayName", "currentHp", "status", "conditions", "conditionMeta"] as const;
const TOKEN_FIELDS = ["name", "x", "y", "hidden"] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function changedFields<T extends object, K extends keyof T>(fields: readonly K[], before: T, after: T) {
  const was: Partial<T> = {};
  const now: Partial<T> = {};
  for (const field of fields) {
    if (!same(before[field], after[field])) {
      was[field] = before[field];
      now[field] = after[field];
    }
  }
  return Object.keys(was).length ? { before: was, after: now } : null;
}

export function diffFightPictures(before: FightPicture, after: FightPicture): FightEventUndo {
  const arrivals = Object.entries(after.enemies)
    .filter(([id]) => !before.enemies[id])
    .map(([id, state]) => ({ id, state }));
  // A changed creature keeps its standing beside what changed, so a revert
  // can tell a creature that has left the fight since from one that stood.
  const enemies = Object.entries(before.enemies).flatMap(([id, was]) => {
    const now = after.enemies[id];
    const changed = now ? changedFields(ENEMY_FIELDS, was, now) : null;
    return changed && now
      ? [{ id, before: { status: was.status, ...changed.before }, after: { status: now.status, ...changed.after } }]
      : [];
  });
  const tokens = Object.entries(before.tokens).flatMap(([id, was]) => {
    const now = after.tokens[id];
    const changed = now ? changedFields(TOKEN_FIELDS, was, now) : null;
    return changed ? [{ id, ...changed }] : [];
  });
  let ground: FightEventUndo["ground"] = null;
  if (before.map && after.map && before.map.id === after.map.id && before.map.drawn !== after.map.drawn) {
    const tiles: Array<{ index: number; before: string; after: string }> = [];
    for (let index = 0; index < after.map.drawn.length; index += 1) {
      if (before.map.drawn[index] !== after.map.drawn[index]) {
        tiles.push({ index, before: before.map.drawn[index] ?? "", after: after.map.drawn[index] });
      }
    }
    ground = tiles.length ? { mapId: after.map.id, tiles } : null;
  }
  return { encounterId: after.encounterId, arrivals, enemies, tokens, ground };
}

// Whether the event changed anything at all.
export function undoesNothing(undo: FightEventUndo): boolean {
  return !undo.arrivals.length && !undo.enemies.length && !undo.tokens.length && !undo.ground;
}

// The chronicle keeps what the table was told, as it keeps a reverted
// turn's narration; the event's line says it was taken back, so nobody reads
// it as standing, nor twice when the event fires again (a fresh line of its
// own). A change is reverted once, so the line is marked once.
export function takenBackLine(line: string): string {
  return `Taken back: ${line}`;
}

export type TakeBackPlan = {
  removeEnemies: string[];
  removeTokens: string[];
  enemies: Array<{ id: string; set: Partial<EnemyState> }>;
  tokens: Array<{ id: string; set: Partial<TokenPlace> }>;
  order: { order: OrderEntry[]; turnIndex: number } | null;
  // The drawn terrain to write, with no square someone stands on left blocked.
  ground: { mapId: string; drawn: string } | null;
  warnings: string[];
};

// A condition as the engine reads one: "Prone" and "prone" are the same.
const holds = (list: readonly string[], name: string) => list.some((entry) => isConditionNamed(entry, name));

// The event's conditions taken off and the ones it removed put back, by
// themselves: any other condition the creature has now stays.
function conditionsBack(now: EnemyState, before: Partial<EnemyState>, after: Partial<EnemyState>) {
  const was = before.conditions ?? [];
  const left = after.conditions ?? [];
  const gained = left.filter((name) => !holds(was, name));
  const lost = was.filter((name) => !holds(left, name));
  const conditions = now.conditions.filter((name) => !holds(gained, name));
  const meta: ConditionMetaMap = { ...now.conditionMeta };
  for (const name of Object.keys(meta)) {
    if (holds(gained, name) && !holds(conditions, name)) {
      delete meta[name];
    }
  }
  for (const name of lost) {
    if (!holds(conditions, name)) {
      conditions.push(name);
      const kept = before.conditionMeta?.[name];
      if (kept !== undefined) {
        meta[name] = kept;
      }
    }
  }
  return same(conditions, now.conditions) && same(meta, now.conditionMeta) ? null : { conditions, conditionMeta: meta };
}

function orderBack(undo: FightEventUndo, now: FightPicture, removed: Set<string>): TakeBackPlan["order"] {
  const renamed = new Map<string, { from: string; to: string }>();
  for (const entry of undo.enemies) {
    if (entry.before.displayName !== undefined && entry.after.displayName !== undefined) {
      renamed.set(entry.id, { from: entry.after.displayName, to: entry.before.displayName });
    }
  }
  const enemyOf = (entry: OrderEntry) => (entry.kind === "enemy" ? entry.enemyId : null);
  const kept = now.order.filter((entry) => !removed.has(enemyOf(entry) ?? ""));
  let changed = kept.length !== now.order.length;
  const order = kept.map((entry) => {
    const name = renamed.get(enemyOf(entry) ?? "");
    if (name && entry.name === name.from) {
      changed = true;
      return { ...entry, name: name.to };
    }
    return entry;
  });
  if (!changed) {
    return null;
  }
  // The turn stays with whoever holds it; when that was a newcomer, it passes
  // to the next one still in the order (the last one, past the end).
  let turnIndex = Math.max(0, order.length - 1);
  for (let index = Math.max(0, now.turnIndex); index < now.order.length; index += 1) {
    const at = kept.indexOf(now.order[index]);
    if (at >= 0) {
      turnIndex = at;
      break;
    }
  }
  return { order, turnIndex: order.length ? turnIndex : 0 };
}

export function planTakeBack(undo: FightEventUndo, now: FightPicture): TakeBackPlan {
  const warnings: string[] = [];

  // The newcomers leave, their tokens with them.
  const removeEnemies = undo.arrivals.filter((arrival) => now.enemies[arrival.id]).map((arrival) => arrival.id);
  for (const arrival of undo.arrivals) {
    const state = now.enemies[arrival.id];
    if (state && (state.currentHp !== arrival.state.currentHp || state.status !== arrival.state.status || !same(state.conditions, arrival.state.conditions))) {
      warnings.push(`${state.displayName}, brought in by the fight's plan, has fought since; reverting takes it out of the fight anyway.`);
    }
  }
  const removed = new Set(removeEnemies);
  const removeTokens = Object.entries(now.tokens)
    .filter(([, token]) => removed.has(token.refId))
    .map(([id]) => id);
  const gone = new Set(removeTokens);

  const enemies: TakeBackPlan["enemies"] = [];
  for (const entry of undo.enemies) {
    const state = now.enemies[entry.id];
    if (!state || removed.has(entry.id)) {
      continue;
    }
    const set: Partial<EnemyState> = {};
    if (entry.before.displayName !== undefined && state.displayName === entry.after.displayName) {
      set.displayName = entry.before.displayName;
    }
    const statusTouched = entry.before.status !== undefined && entry.before.status !== entry.after.status;
    if (entry.before.currentHp !== undefined || statusTouched) {
      const leftHp = entry.after.currentHp ?? state.currentHp;
      const leftStatus = entry.after.status ?? state.status;
      if (state.status !== "alive" && leftStatus === "alive") {
        warnings.push(`${state.displayName} has left the fight since; its hit points stay as they are.`);
      } else {
        if (state.currentHp !== leftHp || state.status !== leftStatus) {
          warnings.push(`${state.displayName}'s hit points have changed since; reverting sets them back to ${entry.before.currentHp ?? state.currentHp}.`);
        }
        if (entry.before.currentHp !== undefined) {
          set.currentHp = entry.before.currentHp;
        }
        if (statusTouched) {
          set.status = entry.before.status;
        }
      }
    }
    if (entry.before.conditions !== undefined) {
      const back = conditionsBack(state, entry.before, entry.after);
      if (back) {
        Object.assign(set, back);
      }
    }
    if (Object.keys(set).length) {
      enemies.push({ id: entry.id, set });
    }
  }

  // The ground first, so a token put back is put back on it.
  let drawn = now.map?.drawn ?? "";
  let ground = now.map?.ground ?? "";
  let groundChanged = false;
  if (undo.ground && now.map && now.map.id === undo.ground.mapId) {
    const nextDrawn = [...drawn];
    const nextGround = [...ground];
    let painted = false;
    for (const tile of undo.ground.tiles) {
      if (nextDrawn[tile.index] === tile.after) {
        nextDrawn[tile.index] = tile.before;
        nextGround[tile.index] = tile.before;
        groundChanged = true;
      } else {
        painted = true;
      }
    }
    if (painted) {
      warnings.push("Squares the fight's plan changed have been painted since; those stay as they are.");
    }
    drawn = nextDrawn.join("");
    ground = nextGround.join("");
  } else if (undo.ground) {
    warnings.push("The board the fight's plan changed is no longer on the table; its ground stays as it is.");
  }

  const tokens: TakeBackPlan["tokens"] = [];
  const places = new Map<string, { x: number; y: number; footprint: Footprint }>();
  for (const [id, token] of Object.entries(now.tokens)) {
    if (!gone.has(id)) {
      places.set(id, { x: token.x, y: token.y, footprint: token.footprint });
    }
  }
  const width = now.map?.width ?? 0;
  const occupied = (x: number, y: number, self: string) =>
    [...places].some(([id, at]) => id !== self && x >= at.x && x < at.x + at.footprint && y >= at.y && y < at.y + at.footprint);
  for (const entry of undo.tokens) {
    const token = now.tokens[entry.id];
    if (!token || gone.has(entry.id)) {
      continue;
    }
    const set: Partial<TokenPlace> = {};
    if (entry.before.name !== undefined && token.name === entry.after.name) {
      set.name = entry.before.name;
    }
    if (entry.before.hidden !== undefined) {
      if (token.hidden === entry.after.hidden) {
        set.hidden = entry.before.hidden;
      } else {
        warnings.push(`${token.name} has been ${token.hidden ? "hidden" : "shown"} again since; it stays so.`);
      }
    }
    if (entry.before.x !== undefined || entry.before.y !== undefined) {
      const back = { x: entry.before.x ?? token.x, y: entry.before.y ?? token.y };
      const where = (entry.after.x ?? token.x) === token.x && (entry.after.y ?? token.y) === token.y;
      const open = width > 0 && !occupied(back.x, back.y, entry.id) && standsOnOpenGround(ground, width, back, token.footprint);
      if (!where) {
        warnings.push(`${token.name} has moved since; it stays where it stands.`);
      } else if (open) {
        set.x = back.x;
        set.y = back.y;
        places.set(entry.id, { x: back.x, y: back.y, footprint: token.footprint });
      }
    }
    if (Object.keys(set).length) {
      tokens.push({ id: entry.id, set });
    }
  }

  // Nobody is left inside ground the revert puts back.
  let groundPlan: TakeBackPlan["ground"] = null;
  if (groundChanged && now.map) {
    const standing = [...places].map(([id, at]) => ({ id, x: at.x, y: at.y, footprint: at.footprint }));
    const moves = restandOn(ground, now.map.width, now.map.height, standing);
    if ("error" in moves) {
      warnings.push("The ground the fight's plan changed cannot go back: someone would be left inside it.");
    } else {
      groundPlan = { mapId: now.map.id, drawn };
      for (const move of moves) {
        const existing = tokens.find((entry) => entry.id === move.id);
        if (existing) {
          existing.set.x = move.x;
          existing.set.y = move.y;
        } else {
          tokens.push({ id: move.id, set: { x: move.x, y: move.y } });
        }
      }
    }
  }

  return {
    removeEnemies,
    removeTokens,
    enemies,
    tokens,
    order: orderBack(undo, now, removed),
    ground: groundPlan,
    warnings,
  };
}
