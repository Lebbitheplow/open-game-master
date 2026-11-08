// Which factions the party is dealing with, for the GM's factions block and
// for the tool groups a compact call opens (issue 870): a faction named in
// recent play since its standing last moved, by its name or a member's, and
// the ones a chapter that just closed dealt with without its standing
// moving. The rules are in src/lib/dm/faction-logic.ts.
import { listFactions } from "@/lib/db/factions";
import { listRecentMessages } from "@/lib/db/messages";
import { listNpcs } from "@/lib/db/npcs";
import { getParty, setParty } from "@/lib/db/party";
import { factionsNamedSince, factionsToSettle, type FactionMember, type NamedLine } from "@/lib/dm/faction-logic";
import { isNarration } from "@/lib/dm/ooc-question";

// The lines of play read for names: about the last few exchanges.
const RECENT_LINES = 40;

export type FactionAttention = { named: Map<string, number>; settle: string[] };

function membersOf(campaignId: string): FactionMember[] {
  return listNpcs(campaignId)
    .filter((npc) => npc.factionId)
    .map((npc) => ({ name: npc.name, factionId: npc.factionId }));
}

export function factionAttention(campaignId: string): FactionAttention {
  const factions = listFactions(campaignId);
  if (!factions.length) {
    return { named: new Map(), settle: [] };
  }
  const messages = listRecentMessages(campaignId, RECENT_LINES);
  const lines: NamedLine[] = messages
    .filter((message) => message.authorType !== "system" && !message.content.startsWith("(ooc)"))
    .map((message) => ({ content: message.content, createdAt: message.createdAt }));
  const party = getParty(campaignId);
  const review = party.factionReview;
  // Shown until the GM has narrated once since the chapter closed.
  const settle = review && !messages.some((message) => isNarration(message) && message.createdAt > review.at) ? review.ids : [];
  return { named: factionsNamedSince(factions, lines, membersOf(campaignId), party.reputationMovedAt), settle };
}

// Whether a faction is in play now: its tools are offered unasked.
export function factionsInPlay(campaignId: string): boolean {
  const attention = factionAttention(campaignId);
  return attention.settle.length > 0 || attention.named.size > 0;
}

// At a chapter's close: the factions it dealt with whose standing did not
// move during it, kept for the next GM turn.
export function recordFactionReview(campaignId: string, transcript: string, chapterStartedAt: string, closedAt: string): void {
  const factions = listFactions(campaignId);
  if (!factions.length) {
    return;
  }
  const party = getParty(campaignId);
  const ids = factionsToSettle(factions, transcript, membersOf(campaignId), party.reputationMovedAt, chapterStartedAt);
  setParty(campaignId, { ...party, factionReview: ids.length ? { ids, at: closedAt } : null });
}
