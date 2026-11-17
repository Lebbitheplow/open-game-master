// Everyone who travels with the party is at its fights (user decision after
// live play: a fight with Brakk alone on the board while the captain, her
// guards and two chained prisoners stood beside him read as broken). Each
// tracked NPC following the party takes the field on the party's side as an
// enemy row (src/lib/dm/combat-sides-logic.ts lets any row stand there),
// with a plain stat block; a prisoner in bonds is on the board, can be
// struck, and does nothing. The other half is
// src/lib/dm/party-npcs-fight.ts.
//
// Dependency-free so scripts/test-party-npcs-fight.mjs can drive it.

import type { NpcState } from "./npc-state-logic.ts";

// A free person with their weapons fights as a guard; someone disarmed or a
// prisoner as a commoner. An NPC with their own stat block keeps it.
export const ARMED_ALLY_BLOCK = "guard";
export const UNARMED_ALLY_BLOCK = "commoner";

export type AllyField = {
  block: string;
  // Conditions the row opens with: a prisoner in bonds is restrained and
  // can take no action; one lying senseless is down.
  conditions: string[];
  down: boolean;
};

// How a tracked NPC following the party takes the field, or null when they
// do not (the dead).
export function allyField(state: NpcState): AllyField | null {
  if (state.condition === "dead") {
    return null;
  }
  const bound = state.custody === "captive" && state.restraint !== "none";
  const block = state.custody === "captive" || state.disarmed ? UNARMED_ALLY_BLOCK : ARMED_ALLY_BLOCK;
  const down = state.condition === "unconscious";
  const conditions = [...(bound ? ["restrained", "incapacitated"] : []), ...(down ? ["unconscious"] : [])];
  return { block, conditions, down };
}

// What the fight left an NPC who fought on the party's side as, for their
// record (npc_state): killed, knocked out, or as they were.
export function stateAfterFight(state: NpcState, row: { status: string; currentHp: number }): NpcState {
  if (row.status === "dead") {
    return { ...state, condition: "dead" };
  }
  if (row.status === "alive" && row.currentHp <= 0) {
    return { ...state, condition: "unconscious" };
  }
  return state;
}
