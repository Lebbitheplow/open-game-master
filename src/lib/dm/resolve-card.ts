// "Resolve as played" on a waiting row of the GM console (issue 685). At a
// table a person runs, a player's card the engine can take whole is still
// posted as a sentence and waits in "Waiting on you" for the GM, who had to
// enter it again by hand from the console's forms. The row keeps the card
// (the message's intent), so the GM can have the engine resolve it exactly
// as the AI turn's direct pass would (intent-logic.ts directCardCalls), with
// the same calls the GM's own card makes at once (the actions route), run as
// the GM through invokeEngine. A card the engine refuses comes back with
// the engine's own words and stays waiting.
//
// The card is answered once: the message is claimed before the first call
// (messages.ts claimCardResolution), and a refusal of that first call lets
// it go again, since nothing happened.
import type { Campaign } from "@/lib/db/campaigns";
import { claimCardResolution, getCampaignMessage, releaseCardResolution, type CampaignMessage } from "@/lib/db/messages";
import { tableAuthors } from "@/lib/db/homebrew";
import { directContextFor } from "@/lib/dm/direct-context";
import { directCardCalls, type DirectCall } from "@/lib/dm/intent-logic";
import { invokeEngine } from "@/lib/dm/invoke";
import { publishPersisted } from "@/lib/events";

type Refusal = { error: string; status: number };

// The calls a waiting card stands for, or why it has none.
function waitingCardCalls(campaign: Campaign, message: CampaignMessage | null): DirectCall[] | Refusal {
  if (!message || message.campaignId !== campaign.id || message.authorType !== "player") {
    return { error: "That action is not waiting at this table.", status: 404 };
  }
  if (!message.intent || !message.characterId) {
    return { error: "That action was typed, not played from a card; answer it from the console.", status: 409 };
  }
  if (message.cardResolvedAt) {
    return { error: "That card has already been resolved.", status: 409 };
  }
  if (message.cardReturned) {
    return { error: "That card went back to its player's hand.", status: 409 };
  }
  const calls = directCardCalls(message.intent, message.characterId, directContextFor(campaign.id, message.intent, tableAuthors(campaign.id)));
  return calls ?? { error: "The engine cannot resolve that card on its own: it needs your ruling. Answer it from the console.", status: 409 };
}

// Which of these waiting messages carry a card the engine can resolve now,
// for the console to offer the button on those rows only.
export function resolvableCards(campaign: Campaign, messageIds: readonly string[]): string[] {
  return messageIds.filter((id) => Array.isArray(waitingCardCalls(campaign, getCampaignMessage(id))));
}

export async function resolveAsPlayed(
  campaign: Campaign,
  userId: string,
  messageId: string,
): Promise<{ ok: true; message: CampaignMessage } | ({ ok: false } & Refusal)> {
  const calls = waitingCardCalls(campaign, getCampaignMessage(messageId));
  if (!Array.isArray(calls)) {
    return { ok: false, ...calls };
  }
  if (!claimCardResolution(messageId)) {
    return { ok: false, error: "That card has already been resolved.", status: 409 };
  }
  // A casting shared out among creatures is one call each, in order: the
  // first spends the slot, the rest draw on the same casting.
  for (const [index, call] of calls.entries()) {
    const resolved = await invokeEngine(campaign, { kind: "human", userId }, call);
    if (!resolved.ok) {
      if (index === 0) {
        releaseCardResolution(messageId);
      } else {
        settled(campaign.id, messageId);
      }
      return { ok: false, error: resolved.error, status: 409 };
    }
  }
  const message = settled(campaign.id, messageId);
  return message ? { ok: true, message } : { ok: false, error: "That action is not waiting at this table.", status: 404 };
}

// Every seat's copy of the line learns it was answered, which takes it off
// the console's waiting list.
function settled(campaignId: string, messageId: string): CampaignMessage | null {
  const message = getCampaignMessage(messageId);
  if (message) {
    publishPersisted(campaignId, "message_updated", { message });
  }
  return message;
}
