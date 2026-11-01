import type { Campaign } from "@/lib/db/campaigns";
import { insertFact, listActiveFacts, setFactStatus } from "@/lib/db/facts";
import { listRecentMessages } from "@/lib/db/messages";
import { listCastNpcs } from "@/lib/db/npcs";
import { getRelationship, listRelationships } from "@/lib/db/relationships";
import { romanceSafetyBlock } from "@/lib/dm/advance-logic";
import { holdRomanceStep } from "@/lib/dm/romance-held";
import { exclusiveBetween } from "@/lib/dm/romance-exclusive";
import type { RomanceStage } from "@/lib/dm/relationship-logic";
import { normalizeSubject } from "@/lib/dm/fact-logic";
import { isNarration } from "@/lib/dm/ooc-question";
import type { Speaker } from "@/lib/dm/speech";
import { containsPhrase, textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { FIGHT_MOVE_NOTE, MOVE_NOTE, moveNoteSubject, namedPeople } from "@/lib/dm/story-moves-logic";

// The reading half of the story-moves check (issue 641, the logic in
// src/lib/dm/story-moves-logic.ts): what the claims reader is given for a
// bond, and the notes it leaves the GM, which last one exchange. What the
// engine does with the bonds it read is src/lib/dm/story-moves-settle.ts.
// Runs where the reader runs: the AI storyteller's turn (the guard,
// src/lib/dm/turn.ts) and a connected agent program's narration
// (src/lib/dm/agent-turn.ts). A table a person runs reads nothing per
// narration (src/lib/dm/speech-lines.ts personLines), so nothing here runs
// there.

type BondRead = { mode: "romance" | "kindness"; people: Map<string, string>; companions: Set<string>; words: string };

export type ExchangeWords = { characterId: string; name: string; text: string };

// Romance is on and the table's safety leaves room for it: a family table or
// a line drawn at romance reads the kindnesses alone.
export function romanceReadable(campaign: Pick<Campaign, "gameSettings">): boolean {
  const settings = campaign.gameSettings;
  return settings.relationships !== "off" && settings.romance !== "off" && !romanceSafetyBlock(settings.safety);
}

// What each player wrote since the GM last narrated, table talk aside, by
// character: the words a flirt or an ask is usually made in. Up to `before`
// (the turn's start), since a line posted while the GM was thinking is the
// next exchange's.
export function exchangeWords(campaignId: string, sheets: readonly CharacterSheet[], before?: string): ExchangeWords[] {
  const messages = listRecentMessages(campaignId, 50);
  const since = messages.slice(messages.findLastIndex(isNarration) + 1);
  const cutoff = before ? Date.parse(before) : Number.POSITIVE_INFINITY;
  const byCharacter = new Map<string, ExchangeWords>();
  for (const message of since) {
    const sheet = message.characterId ? sheets.find((entry) => entry.id === message.characterId) : undefined;
    if (message.authorType !== "player" || !sheet || message.content.startsWith("(ooc)") || Date.parse(message.createdAt) > cutoff) {
      continue;
    }
    const known = byCharacter.get(sheet.id);
    byCharacter.set(sheet.id, { characterId: sheet.id, name: sheet.name, text: known ? `${known.text}\n${message.content}` : message.content });
  }
  return [...byCharacter.values()];
}

// The people a bond may name in this passage, or null when it names nobody
// tracked: the cast NPCs it names (by a short ref), the party's companions,
// and the players' words as the request shows them. Mid-fight only someone a
// party character already has a bond with counts, so a fight's reads carry
// the kind only where an ask or a defence could matter.
export function bondRefs(
  campaign: Campaign,
  sheets: readonly CharacterSheet[],
  text: string,
  words: readonly ExchangeWords[],
  fight: boolean,
): BondRead | null {
  const passage = `${words.map((entry) => entry.text).join("\n")}\n${text}`;
  const bonded = fight
    ? new Set(listRelationships(campaign.id).filter((row) => row.status !== "ended").map((row) => textKey(row.subjectName)))
    : null;
  const counts = (name: string) => !bonded || bonded.has(textKey(name));
  const cast = new Map<string, Speaker>(
    listCastNpcs(campaign.id)
      .filter((npc) => !npc.archived && counts(npc.name))
      .map((npc, index) => [`n${index + 1}`, { kind: "npc", id: npc.id, name: npc.name, aliases: npc.aliases }]),
  );
  const people = new Map([...namedPeople(passage, cast)].map(([ref, person]) => [ref, person.name]));
  const companions = sheets.filter((sheet) => sheet.isCompanion && !sheet.summon);
  const companionNamed = companions.some((sheet) => counts(sheet.name) && containsPhrase(passage, sheet.name));
  if (!people.size && !companionNamed) {
    return null;
  }
  return {
    mode: romanceReadable(campaign) ? "romance" : "kindness",
    people,
    companions: new Set(companions.map((sheet) => sheet.id)),
    words: words.map((entry) => `${entry.name}: ${entry.text}`).join("\n"),
  };
}

// An ask made mid-fight, handed to the engine's hold (issue 640,
// romance-held.ts), so it is answered once the fight is over as an ask the
// GM recorded would be. False when nothing holds it: no bond yet, a step
// that is not the bond's next, or one romance's exclusivity refuses (issue
// 642); the GM is then told to answer it after the fight.
export function holdFightStep(campaign: Campaign, step: { characterId: string; subject: string; to: RomanceStage; quote: string }): boolean {
  const row = getRelationship(campaign.id, step.characterId, step.subject);
  if (!row || step.to === "none" || exclusiveBetween(campaign.id, step.characterId, step.subject)) {
    return false;
  }
  return holdRomanceStep(campaign, row, step.to, step.quote, "claim") !== null;
}

// By the subject's first words, as the facts table keeps it (normalized).
function startsAs(subject: string, prefix: string): boolean {
  return subject.startsWith(`${normalizeSubject(prefix)} `);
}

// A note lasts the one exchange it was written for; one that waits on a
// fight lasts until the fight is over, and then one exchange more, written
// again so that exchange reads it.
export function expireMoveNotes(campaignId: string, fight: boolean): boolean {
  let changed = false;
  for (const fact of listActiveFacts(campaignId).filter((entry) => startsAs(entry.subject, MOVE_NOTE))) {
    const waited = startsAs(fact.subject, FIGHT_MOVE_NOTE);
    if (waited && fight) {
      continue;
    }
    setFactStatus(fact.id, "retired");
    changed = true;
    if (waited) {
      const pair = fact.subject.slice(normalizeSubject(FIGHT_MOVE_NOTE).length).trim();
      insertFact({ campaignId, category: "party", subject: `${MOVE_NOTE}: ${pair}`, fact: fact.fact, knownBy: "dm", source: "manual" });
    }
  }
  return changed;
}

// The GM recorded something for the pair (relationship-tools.ts): the notes
// about them are answered.
export function settleMoveNotes(campaignId: string, characterName: string, subjectName: string) {
  const pair = { character: characterName, subject: subjectName };
  const subjects = new Set([normalizeSubject(moveNoteSubject(pair, false)), normalizeSubject(moveNoteSubject(pair, true))]);
  for (const fact of listActiveFacts(campaignId)) {
    if (subjects.has(fact.subject)) {
      setFactStatus(fact.id, "retired");
    }
  }
}
