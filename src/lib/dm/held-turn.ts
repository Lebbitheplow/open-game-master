// A character's turn held while the enemies before it take theirs.
//
// The pointer rests only on characters: walking past enemies who still take
// their turns, it lands on the character after them at once
// (src/lib/dm/enemies-due.ts), and that was when the character's reaction
// came back and what lasted until the start of their turn (Shield, Dodge, a
// protector's Protection) ended. So a Shield cast against the first goblin
// of the pass ran on through the character's own turn and met the goblin
// after it, the reaction it spent stayed spent into that turn, and a Shield
// from the round before was gone before the goblins swung (SRD 5.1: a
// creature's reaction comes back at the start of its turn; Shield lasts until
// then). Now the landing holds those two things (advancePointer records
// turnStart), and the character's turn begins once the enemies before it
// have acted: the GM hands the turn on (handOnEnemyTurns), the AI's reply
// that played them is narrated (advanceAfterNarration), the character acts
// (budgetFor), or the pointer moves again. The rest of a turn's start (its
// counts, the spells that act then) runs as the pointer lands, as before.
//
// A hit of that pass stays open to a reaction until the character acts
// (last-hit.ts isFresh), so a player may answer it after the engine began
// their turn. That reaction was taken before the turn in the fight: it does
// not stay spent through it, and what it lasts "until the start of your
// next turn" ends at once (lateReaction). It is still their one reaction for
// that pass (reactedLate).

import { AsyncLocalStorage } from "node:async_hooks";
import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, saveEncounter, turnKey, type Encounter } from "@/lib/db/encounters";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { publishPersisted } from "@/lib/events";
import { endTurnStartHolds } from "@/lib/dm/condition-tick";
import { beginTurns } from "@/lib/dm/turn-end";
import { passHitsOpen } from "@/lib/dm/last-hit";
import { VIGILANT_PREFIX } from "@/lib/srd/authored-effects-more";

// The reactions a character's turn gives back: their own, and Vigilant
// Defender's per-turn ones ("vigilant:<id>:<mover>").
function withoutReactionsOf(reactionsUsed: string[], id: string): string[] {
  return reactionsUsed.filter((entry) => entry !== id && !entry.startsWith(`${VIGILANT_PREFIX}${id}:`));
}

// The held turn begins on the encounter in hand, which the caller saves.
// Returns the character whose turn it was.
export function startHeldTurn(campaign: Campaign, encounter: Encounter): string | null {
  const id = encounter.legendary.turnStart;
  if (!id) {
    return null;
  }
  delete encounter.legendary.turnStart;
  encounter.reactionsUsed = withoutReactionsOf(encounter.reactionsUsed, id);
  endTurnStartHolds(campaign, encounter.id, new Set([id]));
  // What was laid in the meantime to last until the end of this turn (a
  // mummy lord's Blinding Dust before it) waits on this turn's end.
  beginTurns(campaign, encounter.id, [id]);
  return id;
}

// The character whose reaction is resolving (reaction-tools.ts
// handleUseReaction): a reaction is taken on another creature's turn, so the
// budget it reads (a reaction spell's cast) begins no turn of theirs.
const reacting = new AsyncLocalStorage<string>();

export function asReaction<T>(id: string, run: () => T): T {
  return reacting.run(id, run);
}

// The held character acts (src/lib/dm/turn-budget.ts budgetFor): their turn
// has begun, before what they do lays anything that lasts until the start of
// their next one. On the encounter in hand, saved here too, since a refused
// act saves nothing.
export function beginHeldTurnOf(encounter: Encounter, id: string) {
  if (encounter.legendary.turnStart !== id || reacting.getStore() === id) {
    return;
  }
  const campaign = getCampaignById(encounter.campaignId);
  if (!campaign) {
    return;
  }
  startHeldTurn(campaign, encounter);
  saveEncounter(encounter);
}

// The enemies before the held character have acted: their turn begins.
export function beginHeldTurn(campaign: Campaign) {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter?.legendary.turnStart) {
    return;
  }
  startHeldTurn(campaign, encounter);
  saveEncounter(encounter);
  publishPersisted(campaign.id, "encounter_updated", { encounter: activePublicEncounter(campaign.id) });
}

// Whether a reaction the character takes now belongs before their turn: the
// pointer names them, their turn has begun, and a hit of the enemies' pass
// before it is still open.
function lateFor(campaignId: string, encounter: Encounter, id: string): boolean {
  const current = encounter.order[encounter.turnIndex];
  return (
    current?.kind === "pc" &&
    current.characterId === id &&
    encounter.legendary.turnStart !== id &&
    !encounter.legendary.due?.length &&
    !encounter.legendary.handoff &&
    passHitsOpen(campaignId, encounter)
  );
}

// Whether the character already answered that pass after their turn began:
// one reaction for it, though their turn has given theirs back.
export function reactedLate(campaignId: string, encounter: Encounter, id: string): boolean {
  const late = encounter.legendary.lateReacted;
  return Boolean(late && late.turn === turnKey(encounter) && late.ids.includes(id) && lateFor(campaignId, encounter, id));
}

// A reaction just taken: when it answered the pass before the character's
// turn after the engine began that turn, it comes back with the turn and
// what it lasts until then ends. Returns whether it did.
export function lateReaction(campaign: Campaign, id: string): boolean {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || !lateFor(campaign.id, encounter, id)) {
    return false;
  }
  const turn = turnKey(encounter);
  const earlier = encounter.legendary.lateReacted?.turn === turn ? encounter.legendary.lateReacted.ids : [];
  encounter.legendary.lateReacted = { turn, ids: [...new Set([...earlier, id])] };
  encounter.reactionsUsed = withoutReactionsOf(encounter.reactionsUsed, id);
  saveEncounter(encounter);
  endTurnStartHolds(campaign, encounter.id, new Set([id]));
  publishPersisted(campaign.id, "encounter_updated", { encounter: activePublicEncounter(campaign.id) });
  return true;
}
