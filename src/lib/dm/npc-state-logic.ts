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
};

export const DEFAULT_NPC_STATE: NpcState = { custody: "free", heldBy: "", restraint: "none", condition: "up" };

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
  };
}

export function isDefaultNpcState(state: NpcState): boolean {
  return (
    state.custody === DEFAULT_NPC_STATE.custody &&
    state.restraint === DEFAULT_NPC_STATE.restraint &&
    state.condition === DEFAULT_NPC_STATE.condition
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
  ]
    .filter(Boolean)
    .join(", ");
}

// Whether the roster keeps them near its head wherever the record puts them:
// a prisoner goes where their captor goes, and must not slide off the list.
export function npcStateKeepsInView(state: NpcState): boolean {
  return state.custody === "captive";
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
