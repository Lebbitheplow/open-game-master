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

export type NpcState = {
  custody: NpcCustody;
  // Who holds them, by name: a character or another NPC. "" while free.
  heldBy: string;
  restraint: NpcRestraint;
  condition: NpcCondition;
  // Travels with the party: their place follows the party's (followers).
  withParty: boolean;
};

export const DEFAULT_NPC_STATE: NpcState = { custody: "free", heldBy: "", restraint: "none", condition: "up", withParty: false };

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
  };
}

export function isDefaultNpcState(state: NpcState): boolean {
  return (
    state.custody === DEFAULT_NPC_STATE.custody &&
    state.restraint === DEFAULT_NPC_STATE.restraint &&
    state.condition === DEFAULT_NPC_STATE.condition &&
    state.withParty === DEFAULT_NPC_STATE.withParty
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
  ]
    .filter(Boolean)
    .join(", ");
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
