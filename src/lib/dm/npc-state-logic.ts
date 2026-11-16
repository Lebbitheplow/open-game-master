// The body of a tracked NPC, as the server keeps it (docs/specs/ogm-npc-state.md):
// whether they are free or someone's prisoner, what holds them, and whether
// they stand, bleed, lie senseless or are dead. Before this sheet the only
// physical fact about an NPC was a free-text location the narrator rewrote
// when it remembered to, so a prisoner taken at the mill stayed "at the mill"
// in the record while the party marched him to town, fell off the roster's
// head, and was forgotten for a night of play. The GM declares a change with
// npc_state; the server stores it, keeps it self-consistent, and shows it on
// the NPC's roster line every turn.
//
// Dependency-free so scripts/test-npc-state.mjs can drive it.

import { textKey } from "../language/text-logic.ts";

export const NPC_CUSTODY = ["free", "captive"] as const;
export const NPC_RESTRAINTS = ["none", "bound", "chained", "locked_up"] as const;
export const NPC_CONDITIONS = ["up", "wounded", "unconscious", "dead"] as const;

export type NpcCustody = (typeof NPC_CUSTODY)[number];
export type NpcRestraint = (typeof NPC_RESTRAINTS)[number];
export type NpcCondition = (typeof NPC_CONDITIONS)[number];

// Story things they carry (a ledger, a key, a seal), not ordinary gear.
export const NPC_CARRIES_MAX = 8;
export const NPC_CARRIED_MAX_CHARS = 60;

export type NpcState = {
  custody: NpcCustody;
  // Who holds them, by name: a character or another NPC. "" while free.
  heldBy: string;
  restraint: NpcRestraint;
  condition: NpcCondition;
  // Travels with the party: their place follows the party's (followers).
  withParty: boolean;
  // Their weapons taken from them.
  disarmed: boolean;
  // What they carry that matters to the story; notes, not an inventory.
  carries: string[];
  // When they last drank and ate, as clock instants (minutes); absent when
  // the story never tracked it, and then nothing is said of hunger or thirst.
  drankAt?: number;
  ateAt?: number;
};

export const DEFAULT_NPC_STATE: NpcState = { custody: "free", heldBy: "", restraint: "none", condition: "up", withParty: false, disarmed: false, carries: [] };

// A declared change; a field left out stays as it was.
export type NpcStatePatch = Partial<NpcState>;

function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

// The stored column ('' or JSON) read back; anything unreadable is the default,
// so a row written before the sheet existed reads as a free, unbound, standing NPC.
export function parseNpcState(raw: string | null | undefined): NpcState {
  if (!raw) {
    return { ...DEFAULT_NPC_STATE };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_NPC_STATE };
  }
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const custody = oneOf(NPC_CUSTODY, record.custody, DEFAULT_NPC_STATE.custody);
  return {
    custody,
    heldBy: custody === "captive" && typeof record.heldBy === "string" ? record.heldBy.trim().slice(0, 80) : "",
    restraint: oneOf(NPC_RESTRAINTS, record.restraint, DEFAULT_NPC_STATE.restraint),
    condition: oneOf(NPC_CONDITIONS, record.condition, DEFAULT_NPC_STATE.condition),
    withParty: record.withParty === true,
    disarmed: record.disarmed === true,
    carries: Array.isArray(record.carries)
      ? record.carries.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, NPC_CARRIED_MAX_CHARS)).slice(0, NPC_CARRIES_MAX)
      : [],
    ...(typeof record.drankAt === "number" && Number.isFinite(record.drankAt) ? { drankAt: record.drankAt } : {}),
    ...(typeof record.ateAt === "number" && Number.isFinite(record.ateAt) ? { ateAt: record.ateAt } : {}),
  };
}

export function isDefaultNpcState(state: NpcState): boolean {
  return (
    state.custody === DEFAULT_NPC_STATE.custody &&
    state.restraint === DEFAULT_NPC_STATE.restraint &&
    state.condition === DEFAULT_NPC_STATE.condition &&
    state.withParty === DEFAULT_NPC_STATE.withParty &&
    !state.disarmed &&
    state.carries.length === 0 &&
    state.drankAt === undefined &&
    state.ateAt === undefined
  );
}

// '' for the default, so an untouched row keeps its empty column.
export function serializeNpcState(state: NpcState): string {
  return isDefaultNpcState(state) ? "" : JSON.stringify(state);
}

// The declared change applied, or why it cannot be: what to correct, in the
// words the GM reads. Freeing someone frees them of their bonds too; the dead
// are not taken prisoner or tied up anew, and stay dead.
export function applyNpcStatePatch(current: NpcState, patch: NpcStatePatch): { state: NpcState } | { error: string } {
  const next: NpcState = { ...current };
  if (patch.condition) {
    next.condition = patch.condition;
  }
  if (patch.custody === "free") {
    next.custody = "free";
    next.heldBy = "";
    next.restraint = "none";
  } else if (patch.custody === "captive" || (patch.heldBy && patch.heldBy.trim())) {
    const heldBy = (patch.heldBy ?? (current.custody === "captive" ? current.heldBy : "")).trim();
    if (!heldBy) {
      return { error: "custody captive needs heldBy: the name of whoever holds them." };
    }
    next.custody = "captive";
    next.heldBy = heldBy.slice(0, 80);
  }
  if (patch.restraint) {
    next.restraint = patch.restraint;
  }
  if (typeof patch.withParty === "boolean") {
    next.withParty = patch.withParty;
  }
  if (typeof patch.disarmed === "boolean") {
    next.disarmed = patch.disarmed;
  }
  if (patch.carries) {
    const carries = patch.carries.map((item) => item.trim()).filter(Boolean);
    if (carries.length > NPC_CARRIES_MAX) {
      return { error: `carries lists ${carries.length} things, over the limit of ${NPC_CARRIES_MAX}: keep only what matters to the story.` };
    }
    const long = carries.find((item) => item.length > NPC_CARRIED_MAX_CHARS);
    if (long) {
      return { error: `"${long.slice(0, 40)}..." is over ${NPC_CARRIED_MAX_CHARS} characters: name the thing, not its story.` };
    }
    next.carries = carries;
  }
  if (typeof patch.drankAt === "number") {
    next.drankAt = patch.drankAt;
  }
  if (typeof patch.ateAt === "number") {
    next.ateAt = patch.ateAt;
  }
  if (current.condition === "dead" && next.condition !== "dead") {
    return { error: "they are dead on the record; the dead do not get up. Leave condition dead." };
  }
  if (current.condition === "dead" && (patch.custody === "captive" || patch.restraint)) {
    return { error: "they are dead on the record: a body is not taken prisoner or tied up. Leave them as they are." };
  }
  return { state: next };
}

const RESTRAINT_WORDS: Record<NpcRestraint, string> = { none: "", bound: "bound", chained: "in chains", locked_up: "locked up" };
const CONDITION_WORDS: Record<NpcCondition, string> = { up: "", wounded: "wounded", unconscious: "unconscious", dead: "dead" };

// The roster line's words for what is not the default ("prisoner of Mara,
// in chains, wounded"), '' for a free, unbound, standing NPC so their line
// reads exactly as before the sheet.
export function npcStateWords(state: NpcState): string {
  return [
    state.custody === "captive" ? `prisoner of ${state.heldBy}` : "",
    RESTRAINT_WORDS[state.restraint],
    CONDITION_WORDS[state.condition],
    state.withParty ? "with the party" : "",
    state.disarmed ? "disarmed" : "",
    state.carries.length ? `carries ${state.carries.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

// Hunger and thirst (the raft sandbox, 2026-11-16: two days adrift and
// nobody drank, ate or fought over the barrel). Words for how long a body has
// gone without, read at the clock's instant: thirst bites after 12 hours and
// kills in about three days, hunger after a day and kills in weeks.
export function needsWords(state: Pick<NpcState, "drankAt" | "ateAt" | "condition">, now: number): string {
  if (state.condition === "dead") {
    return "";
  }
  const hours = (at: number | undefined) => (at === undefined ? -1 : Math.floor((now - at) / 60));
  const dry = hours(state.drankAt);
  const empty = hours(state.ateAt);
  const thirst =
    dry >= 60 ? `dying of thirst (${dry} hours without water): delirious, too weak to stand long`
    : dry >= 36 ? `parched (${dry} hours without water): cracked lips, dizzy, weak`
    : dry >= 12 ? `thirsty (${dry} hours without water)`
    : "";
  const hunger =
    empty >= 96 ? `starving (${empty} hours without food): faint and shaking`
    : empty >= 48 ? `very hungry (${empty} hours without food), growing weak`
    : empty >= 24 ? `hungry (${empty} hours without food)`
    : "";
  return [thirst, hunger].filter(Boolean).join("; ");
}

// Whether the roster keeps them near its head wherever the record puts them:
// a prisoner goes where their captor goes, and must not slide off the list.
export function npcStateKeepsInView(state: NpcState): boolean {
  return state.custody === "captive" || state.withParty;
}

export type FollowerCandidate = { id: string; name: string; aliases?: readonly string[]; state: NpcState; away: boolean };

// Who goes where the party goes, by id: whoever travels with them, and every
// prisoner whose keeper does (a character of the party, or an NPC who is
// followed in turn). A prisoner held by someone staying behind stays with
// them; nobody apart from the party (a mind left elsewhere) is moved.
export function partyFollowers(npcs: readonly FollowerCandidate[]): string[] {
  const byName = new Map<string, FollowerCandidate>();
  for (const npc of npcs) {
    for (const name of [npc.name, ...(npc.aliases ?? [])]) {
      if (name && !byName.has(textKey(name))) {
        byName.set(textKey(name), npc);
      }
    }
  }
  const decided = new Map<string, boolean>();
  const follows = (npc: FollowerCandidate, path: Set<string>): boolean => {
    const known = decided.get(npc.id);
    if (known !== undefined) {
      return known;
    }
    let result = false;
    if (!npc.away) {
      if (npc.state.withParty) {
        result = true;
      } else if (npc.state.custody === "captive") {
        const keeper = byName.get(textKey(npc.state.heldBy));
        // Kept by someone not tracked as an NPC: a hero of the party.
        result = !keeper ? true : keeper.id !== npc.id && !path.has(keeper.id) && follows(keeper, new Set([...path, npc.id]));
      }
    }
    decided.set(npc.id, result);
    return result;
  };
  return npcs.filter((npc) => follows(npc, new Set([npc.id]))).map((npc) => npc.id);
}

// Why this NPC cannot speak now, or '' if they can.
export function npcSilencedBy(state: NpcState): string {
  if (state.condition === "dead") {
    return "dead";
  }
  if (state.condition === "unconscious") {
    return "unconscious";
  }
  return "";
}

// What anyone looking at them sees: the sheet without what they carry,
// which may be hidden on them (docs/specs/ogm-npc-state.md, what a mind sees).
export function npcVisibleStateWords(state: NpcState): string {
  return npcStateWords({ ...state, carries: [] });
}

// What a mind looking at them sees, in its own context: as above, with the
// keeper's name only when the onlooker knows it (a name is learned, never
// read off the sheet), and nothing for someone free and standing.
export function npcSeenStateWords(state: NpcState, knowsKeeper: boolean): string {
  const seen = npcVisibleStateWords({ ...state, withParty: false });
  return state.custody === "captive" && !knowsKeeper ? seen.replace(`prisoner of ${state.heldBy}`, "a prisoner") : seen;
}
