// The DB/model rim of the NPC state guard (the pure half and the why are in
// src/lib/dm/npc-state-guard-logic.ts): who the narration names and what the
// record says of them, one utility read, and what it found. Asked only with
// the table's outcome check on, and only when someone named is held or down,
// the prose shows a body changing, or the party moves while it holds anyone.
// A read that fails finds nothing.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { listNpcs } from "@/lib/db/npcs";
import { requestUtilityMessage } from "@/lib/dm/model";
import { partyFollowers, npcStateWords } from "@/lib/dm/npc-state-logic";
import {
  parseStateReading,
  peopleNamed,
  stateGuardDue,
  stateReading,
  type GuardPerson,
  type StateReading,
} from "@/lib/dm/npc-state-guard-logic";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { stripReasoningArtifacts } from "@/lib/story-prompt";

export type StateReader = (messages: { role: "system" | "user"; content: string }[]) => Promise<string | null>;

const PARTY_MOVES = new Set(["move_party", "travel"]);

const utilityReader =
  (campaign: Campaign, turn: DmTurn): StateReader =>
  async (messages) => {
    const { message, error } = await requestUtilityMessage(campaign.settings, messages, {
      meta: { task: "npc_state_guard", turnId: turn.id },
      timeoutMs: arcTextTimeoutMs(),
      thinking: false,
      temperature: 0,
    });
    return error ? null : stripReasoningArtifacts(String(message?.content ?? ""));
  };

// What the narration does against the record, or null when nothing was asked
// or nothing could be read.
export async function readStateGuard(
  campaign: Campaign,
  turn: DmTurn,
  heroes: readonly string[],
  narration: string,
  calls: ReadonlyArray<{ name: string; args: Record<string, unknown> }>,
  read: StateReader = utilityReader(campaign, turn),
): Promise<StateReading | null> {
  if (!campaign.gameSettings.narrationGuard || !narration.trim()) {
    return null;
  }
  const cast = listNpcs(campaign.id).filter((npc) => !npc.archived && !npc.companionSheetId);
  const record = (npc: (typeof cast)[number]) =>
    [npcStateWords(npc.state), npc.location ? `at ${npc.location}` : ""].filter(Boolean).join(", ");
  const people: GuardPerson[] = cast.map((npc) => ({ name: npc.name, aliases: npc.aliases, record: npcStateWords(npc.state) ? record(npc) : "" }));
  const named = peopleNamed(narration, people);
  const partyMoved = calls.some((call) => PARTY_MOVES.has(call.name));
  const followers = new Set(
    partyFollowers(cast.map((npc) => ({ id: npc.id, name: npc.name, aliases: npc.aliases, state: npc.state, away: false }))),
  );
  const held = cast.filter((npc) => followers.has(npc.id) && npc.state.custody === "captive");
  if (!stateGuardDue({ named, narration, partyMoved, partyHolds: held.length > 0 })) {
    return null;
  }
  // The party's prisoners ride along when it moves, named or not: leaving
  // one behind is what the read is for.
  const asked = [...named, ...(partyMoved ? held.map((npc) => people.find((person) => person.name === npc.name)).filter((person): person is GuardPerson => Boolean(person)) : [])];
  const unique = asked.filter((person, index) => asked.findIndex((other) => other.name === person.name) === index);
  const stateCalls = calls.filter((call) => call.name === "npc_state").map((call) => JSON.stringify(call.args));
  const reply = await read(stateReading({ narration, people: unique, calls: stateCalls, heroes }));
  if (reply === null) {
    console.warn(`[npc-state-guard] turn ${turn.id}: the reader call failed; nothing was checked`);
    return null;
  }
  const reading = parseStateReading(reply, narration, unique);
  if (reading === null) {
    console.warn(`[npc-state-guard] turn ${turn.id}: the reader's reply was unreadable; nothing was checked`);
    return null;
  }
  if (reading.clashes.length || reading.unrecorded.length) {
    console.warn(`[npc-state-guard] turn ${turn.id}: ${reading.clashes.length} clash(es), ${reading.unrecorded.length} unrecorded change(s)`);
  }
  return reading;
}
