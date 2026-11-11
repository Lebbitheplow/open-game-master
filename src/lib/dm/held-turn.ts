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
import { getActiveEncounter, listEnemies, orderEntryId, saveEncounter, turnKey, type Encounter } from "@/lib/db/encounters";
import { getDmTurn } from "@/lib/db/dm-turns";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { publishPersisted } from "@/lib/events";
import { endTurnStartHolds, turnHoldKeys } from "@/lib/dm/condition-tick";
import { beginTurns } from "@/lib/dm/turn-end";
import { lateFor } from "@/lib/dm/last-hit";
import { PET_REACTION_PREFIX, VIGILANT_PREFIX } from "@/lib/srd/authored-effects-more";
import { canEnemyAct } from "@/lib/dm/can-act";
import { readiedHeld } from "@/lib/dm/readied-kinds";
import type { ToolError } from "@/lib/dm/tool-errors";

// The reactions a character's turn gives back: their own, Vigilant
// Defender's per-turn ones ("vigilant:<id>:<mover>") and their pet's
// ("pet-reaction:<id>:<pet>", summon-reactions.ts).
function withoutReactionsOf(reactionsUsed: string[], id: string): string[] {
  return reactionsUsed.filter((entry) => entry !== id && !entry.startsWith(`${VIGILANT_PREFIX}${id}:`) && !entry.startsWith(`${PET_REACTION_PREFIX}${id}:`));
}

// The enemies of the pass before the held turn have had their turns, which
// were theirs to play until now (enemiesAhead): what holds them now is what
// those turns ended under, and so what they save against when the pointer
// next moves (condition-tick.ts turnHoldKeys). A hold laid during one of
// them, a readied Hold Person released as the creature moved, is saved
// against as that turn ends; one the held character lays once their turn
// has begun waits for the end of the creature's next turn. Only where the
// pass is known to be over (the character acts, the GM hands the turn on,
// the reply that played them is narrated): a turn begun by the pointer
// moving again keeps the list the pass began with.
function passTurnsEnded(campaign: Campaign, encounter: Encounter) {
  const walked = encounter.legendary.walked ?? [];
  if (walked.length) {
    encounter.legendary.walkedHolds = turnHoldKeys(campaign, encounter.id, walked);
  }
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
  passTurnsEnded(campaign, encounter);
  startHeldTurn(campaign, encounter);
  saveEncounter(encounter);
}

// The enemies a held turn still waits on, by name: those the pass left due,
// and those an AI reply was handed while that reply still plays, that can
// still take their turn's action (canEnemyAct: not dead, fled, incapacitated
// or surprised, and not acted this round). Moving and acting are both the
// turn's (SRD 5.1, Your Turn: "On your turn, you can move a distance up to
// your speed and take one action"), so until they have the move route
// refuses the walk, the board lights no square, and the character's own
// actions are refused (heldTurnRefusal). One that cannot act holds nobody,
// nor does a reply that ended without its narration: the character's walk or
// action begins the turn (beginHeldTurnOf). Empty when the turn is not held.
export function enemiesAhead(encounter: Encounter, id: string): string[] {
  if (encounter.legendary.turnStart !== id) {
    return [];
  }
  const waiting = new Set(passEnemies(encounter));
  return listEnemies(encounter.id)
    .filter((enemy) => waiting.has(enemy.id) && canEnemyAct({ enemy, encounter, kind: "action" }).ok)
    .map((enemy) => enemy.displayName);
}

// The enemies of the pass before the held turn: those it left due, and those
// an AI reply was handed while that reply still plays.
function passEnemies(encounter: Encounter): string[] {
  const handoff = encounter.legendary.handoff;
  const reply = handoff ? getDmTurn(handoff.turnId) : null;
  const playing = Boolean(reply && (reply.status === "running" || reply.status === "awaiting_rolls"));
  return [...(encounter.legendary.due ?? []), ...(playing && handoff ? handoff.enemyIds : [])];
}

// The character the pointer rests on, whose turn is held while an enemy
// before them is still to act.
export function turnHeldForEnemies(encounter: Encounter | null, id: string): boolean {
  const entry = encounter?.orderReady ? encounter.order[encounter.turnIndex] : undefined;
  return Boolean(encounter && entry && orderEntryId(entry) === id && enemiesAhead(encounter, id).length);
}

// Whether it is `id`'s own turn: the pointer rests on them AND their turn is
// not held for the enemies grouped before them. Every reader that asks "is
// this X's turn" goes through here, never through order[turnIndex] or
// actingCombatantId alone: a reader of the bare pointer answered "it is
// Brom's own turn" in the middle of the goblins' before him, so a shove by
// the first goblin was refused as a walk of Brom's (map-tools.ts move_token)
// and a reaction to the goblin's move was refused as one taken on his own
// turn. scripts/test-turn-pointer-readers.mjs holds every remaining raw read
// to its ledger (scripts/turn-pointer-readers.json), each with its reason
// (the pointer's own mechanics, a display of whose place it is).
export function ownTurnOf(encounter: Encounter | null, id: string): boolean {
  const entry = encounter?.orderReady ? encounter.order[encounter.turnIndex] : undefined;
  return Boolean(encounter && entry && orderEntryId(entry) === id && !enemiesAhead(encounter, id).length);
}

// What they readied on their turn before, released while the enemies of the
// pass before their turn are taking theirs (their turn begins once the turn
// is handed on or the reply is narrated): off their own turn, with their
// reaction (SRD 5.1, Ready), also after the enemy whose act triggered it has
// taken its action. The engine read the pointer and took a readied swing
// released as the worm acted for the character's own Attack action, which
// began their turn early and spent its attack.
export function releasesReadiedOffTurn(encounter: Encounter | null, sheet: { id: string; conditions: string[]; conditionMeta?: unknown }): boolean {
  const entry = encounter?.orderReady ? encounter.order[encounter.turnIndex] : undefined;
  return Boolean(
    encounter &&
      entry &&
      readiedHeld(sheet) &&
      orderEntryId(entry) === sheet.id &&
      encounter.legendary.turnStart === sheet.id &&
      passEnemies(encounter).length,
  );
}

// An action of the character's own turn (an attack, a spell, an action, an
// item, a feature, a walk) while an enemy before them is still to act:
// refused, so the order holds (SRD 5.1, Initiative), whoever asks (the AI,
// the GM's console). It used to begin their turn at once, and the enemy was
// skipped or played after them. A reaction, an opportunity attack and a
// readied release are not their turn's, and pass.
export function heldTurnRefusal(encounter: Encounter | null, sheet: { id: string; name: string; conditions: string[]; conditionMeta?: unknown }): ToolError | null {
  // Their End Turn is in, and the move waits on a watch stop (turn-hold.ts):
  // the turn is over, so nothing more of it is taken.
  const held = encounter?.legendary.heldMove;
  if (held && held.characterId === sheet.id && reacting.getStore() !== sheet.id) {
    return { error: `${sheet.name}'s turn is ending: it passes once ${held.watcher || "the watcher"} has answered the roll it brings. Nothing was spent.`, retry: true };
  }
  if (!encounter || reacting.getStore() === sheet.id || readiedHeld(sheet) || !turnHeldForEnemies(encounter, sheet.id)) {
    return null;
  }
  return { error: heldActionLine(sheet.name, enemiesAhead(encounter, sheet.id)), retry: true };
}

function heldActionLine(name: string, ahead: string[]): string {
  const one = ahead.length === 1;
  const who = one ? ahead[0] : `${ahead.slice(0, -1).join(", ")} and ${ahead[ahead.length - 1]}`;
  return `${who} ${one ? "acts" : "act"} before ${name}: play ${one ? "its turn" : "their turns"} (enemy_attack / take_action with ${one ? "its" : "each one's"} enemyId) first, then resolve ${name}'s action. Nothing was spent.`;
}

// The refusal of a walk on a turn that has not begun, in a player's words
// (the board's walk; `does` the act, "acts" for the sheet's gear toggle, whose
// route relayed heldActionLine's sentence for the model, tool names and all).
export function heldTurnLine(name: string, ahead: string[], does = "moves"): string {
  const who = ahead.length > 1 ? `${ahead.slice(0, -1).join(", ")} and ${ahead[ahead.length - 1]}` : ahead[0];
  return who
    ? `${who} ${ahead.length > 1 ? "take their turns" : "takes its turn"} before ${name}'s: ${name} ${does} once their turn begins.`
    : `The enemies before ${name} are taking their turns; ${name} ${does} once the GM hands the turn on.`;
}

// The enemies before the held character have acted: their turn begins.
// `passOver`: the caller knows the enemies' turns are over (the GM handed the
// turn on, the reply that played them is narrated), not a turn ending while
// the rest of a pass waited (encounter-tools.ts finishPassBeforeMove).
export function beginHeldTurn(campaign: Campaign, passOver = false) {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter?.legendary.turnStart) {
    return;
  }
  if (passOver) {
    passTurnsEnded(campaign, encounter);
  }
  startHeldTurn(campaign, encounter);
  saveEncounter(encounter);
  publishPersisted(campaign.id, "encounter_updated", { encounter: activePublicEncounter(campaign.id) });
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
