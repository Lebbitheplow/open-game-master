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
import { getSheetById } from "@/lib/db/sheets";
import { liveCardChanges, recordTurnChange, type TurnChange } from "@/lib/db/turn-changes";
import { directContextFor } from "@/lib/dm/direct-context";
import { directCardCalls, drawStopsCast, isStoredCast, isTypedReaction, type DirectCall } from "@/lib/dm/intent-logic";
import { takeBackItemCast } from "@/lib/dm/item-use";
import { invokeEngine } from "@/lib/dm/invoke";
import { publishPersisted } from "@/lib/events";

type Refusal = { error: string; status: number };

// The calls a waiting card stands for, or why it has none.
function waitingCardCalls(campaign: Campaign, message: CampaignMessage | null): DirectCall[] | Refusal {
  if (!message || message.campaignId !== campaign.id || message.authorType !== "player") {
    return { error: "That action is not waiting at this table.", status: 404 };
  }
  if (!message.intent || !message.characterId || isTypedReaction(message.intent)) {
    return { error: "That action was typed, not played from a card; answer it from the console.", status: 409 };
  }
  if (message.cardResolvedAt) {
    return { error: "That card has already been resolved.", status: 409 };
  }
  if (message.cardReturned) {
    return { error: "That card went back to its player's hand.", status: 409 };
  }
  const calls = directCardCalls(message.intent, message.characterId, directContextFor(campaign.id, message.intent, tableAuthors(campaign.id), message.characterId));
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
  const waiting = getCampaignMessage(messageId);
  const calls = waitingCardCalls(campaign, waiting);
  if (!Array.isArray(calls)) {
    return { ok: false, ...calls };
  }
  if (!claimCardResolution(messageId)) {
    return { ok: false, error: "That card has already been resolved.", status: 409 };
  }
  // A casting shared out among creatures is one call each, in order: the
  // first spends the slot, the rest draw on the same casting.
  const turns: string[] = [];
  // A spell drawn from an item has not happened until its tool casts it, and the
  // draw pays only once, so a refused cast lets the card go again too.
  const firstCast = calls.some((call) => call.name === "use_item") ? 1 : 0;
  for (const [index, call] of calls.entries()) {
    const resolved = await invokeEngine(campaign, { kind: "human", userId }, call);
    if (!resolved.ok) {
      if (index <= firstCast) {
        releaseCardResolution(messageId);
        // The spell did not happen: what its item spent comes back, so resolving it
        // again pays afresh.
        if (waiting?.intent && waiting.characterId && isStoredCast(waiting.intent)) {
          takeBackItemCast(campaign, waiting.characterId, waiting.intent.spell ?? "");
        }
      } else {
        keepUnderTurns(campaign.id, messageId, turns);
        settled(campaign.id, messageId);
      }
      return { ok: false, error: resolved.error, status: 409 };
    }
    if (!turns.includes(resolved.turnId)) {
      turns.push(resolved.turnId);
    }
    // A scroll misread is the card answered: no spell's tool follows it.
    if (drawStopsCast(call.name, resolved.result)) {
      break;
    }
  }
  keepUnderTurns(campaign.id, messageId, turns);
  const message = settled(campaign.id, messageId);
  return message ? { ok: true, message } : { ok: false, error: "That action is not waiting at this table.", status: 404 };
}

// The card is answered by the turns its calls ran in (a person's call is a
// turn of its own, src/lib/dm/invoke.ts): kept under each, so reverting any
// of them puts the card back in "Waiting on you" (issue 685). Before, the
// revert took the call's changes back and the card stayed answered, so the
// GM could not resolve it again.
function keepUnderTurns(campaignId: string, messageId: string, turns: readonly string[]) {
  const message = getCampaignMessage(messageId);
  if (!message?.cardResolvedAt) {
    return;
  }
  const who = message.characterId ? getSheetById(message.characterId)?.name : null;
  const line = `${who ? `${who}'s card` : "A card"} resolved as played by the GM.`;
  for (const turnId of turns) {
    recordTurnChange(campaignId, turnId, "card", { messageId, resolvedAt: message.cardResolvedAt, turns: [...turns], line });
  }
}

function cardPayloadOf(change: TurnChange) {
  const raw = change.payload;
  return {
    messageId: typeof raw.messageId === "string" ? raw.messageId : "",
    resolvedAt: typeof raw.resolvedAt === "string" ? raw.resolvedAt : "",
    turns: Array.isArray(raw.turns) ? raw.turns.filter((entry): entry is string => typeof entry === "string") : [],
  };
}

// What the lead is told before the revert: a card shared out among
// creatures ran as several turns, and the others stand.
export function cardRevertWarnings(change: TurnChange): string[] {
  const card = cardPayloadOf(change);
  const others = liveCardChanges(change.campaignId, card.messageId).filter(
    (entry) => entry.turnId !== change.turnId && cardPayloadOf(entry).resolvedAt === card.resolvedAt,
  );
  return others.length
    ? [`That card's other calls ran as turns of their own and stay; resolving it again runs all of them again. Revert those turns too to play it afresh.`]
    : [];
}

// "Revert this turn": the card the turn resolved goes back to the GM's
// waiting list, unless it has been resolved again since (another press,
// after an earlier revert), which is that press's to take back.
export function takeBackCardResolution(change: TurnChange) {
  const card = cardPayloadOf(change);
  const message = getCampaignMessage(card.messageId);
  if (!message || message.cardResolvedAt !== card.resolvedAt) {
    return;
  }
  releaseCardResolution(message.id);
  settled(change.campaignId, message.id);
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
