// A player character acts on their own turn when their player says so
// (issue 17: a character that attacked with no command given). The DM turn
// that opens a character's turn often has no word from its player (another
// player pressed End Turn, a wake), and the AI used to play the turn for
// them. So for the AI DM, every call that spends a character's turn (an
// attack, a spell they cast, an action, an item, a feature) or ends it is
// refused while it is that character's own turn and their player has not
// spoken in the input this DM turn answers. An absent player's turn is the lead's to
// skip (skipCurrentTurn), not the AI's to play. Companions are the AI's to
// play, unless a player commands one (src/lib/dm/companion-command.ts): then
// it waits for them the same way. Reactions and anything off the character's
// turn never come here.
// A person at the console keeps a free hand, as with every correction
// (src/lib/dm/enemy-turn-order.ts is the same rule for enemies).

import type { DmTurn } from "@/lib/db/dm-turns";
import { getCampaignById } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { listRecentMessages } from "@/lib/db/messages";
import { getSheetById } from "@/lib/db/sheets";
import { canAct } from "@/lib/dm/can-act";
import { aiPlaysSheet } from "@/lib/dm/companion-command";
import { isNarration } from "@/lib/dm/ooc-question";
import { resolveSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { Campaign } from "@/lib/db/campaigns";
import { listEnemies } from "@/lib/db/encounters";
import { askedSwayRefusal, heldRefusal, onlyAsked, readPlayerWord, unaskedRefusal, type PlayerWord } from "@/lib/dm/player-word-logic";
import { keptWordReading, readWords } from "@/lib/dm/player-word-read";

// The character's own words since the DM last spoke, table talk and
// reactions aside. A reaction card answers a hit in somebody else's turn
// (Shield, Uncanny Dodge): it says nothing of what the character does with
// a turn of their own. Counted, the hero up next who answered a hit in the
// enemies' pass had "declared", so the AI was let play that turn for them and
// the narration's hand-off moved it on unplayed (issue 685).
function ownWordsSinceDm(campaignId: string, characterId: string) {
  const messages = listRecentMessages(campaignId, 50);
  // An out-of-character answer in between leaves the move standing.
  const since = messages.slice(messages.findLastIndex(isNarration) + 1);
  return since.filter(
    (message) =>
      message.authorType === "player" &&
      message.characterId === characterId &&
      !message.content.startsWith("(ooc)") &&
      message.intent?.card !== "reaction",
  );
}

// What the character's player's words since the DM last spoke let the AI do
// with their turn (src/lib/dm/player-word-logic.ts): whether they declare an
// action, and whether they keep the character where they stand. A line
// written before the running fight began counts only when it names
// something done in it; a line that only asks counts for nothing; at a table
// in another language the words are read by the utility model first
// (prepareWordFor).
export function playerWord(campaignId: string, characterId: string): PlayerWord {
  const lines = ownWordsSinceDm(campaignId, characterId);
  if (!lines.length) {
    return readPlayerWord([], { fightStartedAt: null, english: true, names: [], read: null });
  }
  const campaign = getCampaignById(campaignId);
  const english = (campaign?.gameSettings.tableLanguage ?? "english") === "english";
  const encounter = getActiveEncounter(campaignId);
  const fight = encounter && encounter.kind !== "scene" ? encounter : null;
  const sheet = getSheetById(characterId);
  const names = [
    ...(fight ? listEnemies(fight.id).filter((enemy) => enemy.status === "alive").map((enemy) => enemy.displayName) : []),
    ...(sheet?.spellcasting ? [...sheet.spellcasting.prepared, ...sheet.spellcasting.known, ...sheet.spellcasting.cantrips] : []),
  ];
  const text = lines.filter((line) => !line.intent?.card).map((line) => line.content).join("\n\n");
  const read = !english && campaign && text.trim() ? keptWordReading(campaign, text) : null;
  return readPlayerWord(
    lines.map((line) => ({ content: line.content, createdAt: line.createdAt, card: line.intent?.card ?? null })),
    { fightStartedAt: fight?.createdAt ?? null, english, names, read },
  );
}

// Whether the character's player asked for something in the input this DM
// turn answers. A token never walks on a turn its player did not speak in
// (issue 17: a token that moved with no input).
export function declaredThisTurn(campaignId: string, characterId: string): boolean {
  return playerWord(campaignId, characterId).declares;
}

// The refusal of a walk for a player's character whose player keeps them
// where they stand, or null. The AI's turn only: the console keeps its free
// hand. Asked before anything is spent (`tail` says so).
export function walkHeld(campaignId: string, actor: Pick<DmTurn, "actor"> | null, sheet: Pick<CharacterSheet, "id" | "name">, tail?: string): ToolError | null {
  if (actor?.actor !== "ai") {
    return null;
  }
  const campaign = getCampaignById(campaignId);
  const full = getSheetById(sheet.id);
  if (!campaign || !full || aiPlaysSheet(campaign, full)) {
    return null;
  }
  const word = playerWord(campaignId, sheet.id);
  return word.holds ? { error: heldRefusal(sheet.name, word.holdQuote, tail), retry: true } : null;
}

// The refusal of a roll to sway someone (social_check, or a Persuasion,
// Deception or Intimidation check) for a player's character whose player
// only asked a question since the DM last spoke, or null. In a fight or out
// of one: a player asked a companion something, and the AI rolled
// Persuasion against a DC for an attempt they never made (0.34.1 report).
// The AI's turn only, and never a character the AI plays; asked before
// anything is rolled or spent.
export function swayUnasked(campaignId: string, actor: Pick<DmTurn, "actor"> | null, sheet: Pick<CharacterSheet, "id" | "name">): ToolError | null {
  if (actor?.actor !== "ai") {
    return null;
  }
  const campaign = getCampaignById(campaignId);
  const full = getSheetById(sheet.id);
  if (!campaign || !full || aiPlaysSheet(campaign, full)) {
    return null;
  }
  const lines = ownWordsSinceDm(campaignId, sheet.id).map((line) => ({ content: line.content, card: line.intent?.card ?? null }));
  const english = (campaign.gameSettings.tableLanguage ?? "english") === "english";
  return onlyAsked(lines, english) ? { error: askedSwayRefusal(full.name), retry: true } : null;
}

// Reads the words of the character a call names at a table in another
// language, once, before the synchronous gates run (playerWord finds the
// reading kept). English needs no reading. Only the AI's calls are gated.
export async function prepareWordFor(campaign: Campaign, actor: Pick<DmTurn, "actor"> | null, rawArguments: string): Promise<void> {
  if (actor?.actor !== "ai" || (campaign.gameSettings.tableLanguage ?? "english") === "english") {
    return;
  }
  const encounter = getActiveEncounter(campaign.id);
  const current = encounter?.orderReady && encounter.kind !== "scene" ? encounter.order[encounter.turnIndex] : null;
  if (current?.kind !== "pc" || !current.characterId) {
    return;
  }
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  } catch {
    return;
  }
  const sheet = getSheetById(current.characterId);
  if (!sheet) {
    return;
  }
  const refs = ["characterId", "casterId", "casterCharacterId", "healerId", "token"].map((key) => args[key]).filter((ref): ref is string => typeof ref === "string");
  if (!refs.some((ref) => resolveSheetRef(ref, [sheet], new Map([[sheet.id, sheet]])))) {
    return;
  }
  const text = ownWordsSinceDm(campaign.id, sheet.id)
    .filter((line) => !line.intent?.card)
    .map((line) => line.content)
    .join("\n\n");
  if (text.trim()) {
    await readWords(campaign, text);
  }
}

// What the character's player wrote since the DM last spoke, table talk
// aside: the words a turn's end may be read from (src/lib/dm/claims.ts
// readTurnEndInWords).
export function wordsThisTurn(campaignId: string, characterId: string): string {
  return ownWordsSinceDm(campaignId, characterId)
    .map((message) => message.content)
    .join("\n\n");
}

// The character whose own turn waits on their player: a player's character
// (not a companion) who could act, and whose player has not spoken since the
// DM last did. GAME STATE says so (src/lib/dm/turn.ts buildEncounterState),
// and the refusal below holds the AI to it. A character who cannot act
// (down, stunned, surprised) has no turn to play: passing it plays nothing
// for them, and a spend is refused by its own handler with the reason.
export function characterAwaitingPlayer(campaignId: string): CharacterSheet | null {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter || !encounter.orderReady || encounter.kind === "scene") {
    return null;
  }
  const current = encounter.order[encounter.turnIndex];
  const sheet = current.kind === "pc" ? getSheetById(current.characterId) : null;
  if (!sheet || aiPlaysSheet(getCampaignById(campaignId), sheet) || !canAct({ sheet, encounter, kind: "free" }).ok || declaredThisTurn(campaignId, sheet.id)) {
    return null;
  }
  return sheet;
}

// The character on their own turn whose player keeps them where they stand:
// GAME STATE says so, and the walks refuse (walkHeld).
export function characterHeld(campaignId: string): CharacterSheet | null {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter || !encounter.orderReady || encounter.kind === "scene") {
    return null;
  }
  const current = encounter.order[encounter.turnIndex];
  const sheet = current.kind === "pc" ? getSheetById(current.characterId) : null;
  if (!sheet || aiPlaysSheet(getCampaignById(campaignId), sheet)) {
    return null;
  }
  return playerWord(campaignId, sheet.id).holds ? sheet : null;
}

// Read from a tool call's arguments (characterId for an attack or an
// action; casterCharacterId, heal's casterId or healerId where the character
// is not the target): the refusal, or null.
export function characterCallUnasked(
  campaignId: string,
  turn: Pick<DmTurn, "actor"> | null,
  rawArguments: string,
  key: "characterId" | "casterId" | "casterCharacterId" | "healerId",
  // end_turn: a player who chose to stay put and do nothing has ended
  // nothing yet, but the turn may pass on their word.
  ending = false,
): ToolError | null {
  if (turn?.actor !== "ai") {
    return null;
  }
  let ref: unknown;
  try {
    ref = (JSON.parse(rawArguments || "{}") as Record<string, unknown>)[key];
  } catch {
    return null;
  }
  const sheet = characterAwaitingPlayer(campaignId);
  if (typeof ref !== "string" || !sheet || !resolveSheetRef(ref, [sheet], new Map([[sheet.id, sheet]]))) {
    return null;
  }
  const word = playerWord(campaignId, sheet.id);
  if (ending && word.why === "held") {
    return null;
  }
  return { error: unaskedRefusal(sheet.name, word), retry: true };
}
