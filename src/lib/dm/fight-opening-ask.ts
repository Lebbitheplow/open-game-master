import { listMembers, type Campaign } from "@/lib/db/campaigns";
import { createDmTurn, getDmTurn, listOpenPendingRolls, saveDmTurn } from "@/lib/db/dm-turns";
import { heldRollUserIds } from "@/lib/dice/held-rolls";
import { askForInitiative, describeInitiativeAsk } from "@/lib/dm/initiative-ask";
import { currentTurnId } from "@/lib/dm/job-control";

// The initiative half of a fight's opening (fight-opening.ts), for the doors
// that open a fight with no model to read the answer.

// A fight the engine opened at a table a person runs: every hero it left
// out of the order is asked for initiative now, on the person's turn in hand
// (or one of their own), as the console's start_encounter asks
// (invoke.ts askForInitiative, issue 63). A seat on physical dice gets its
// card; the rest are rolled. Returns the console's words, or null when
// nobody was left to ask.
export function askThoseTheOpeningLeft(campaign: Campaign): Record<string, unknown> | null {
  const scoped = currentTurnId();
  const inHand = scoped ? getDmTurn(scoped) : null;
  const turn = inHand ?? createDmTurn(campaign.id, [], "human_dm");
  const ask = askForInitiative(campaign, turn, heldRollUserIds(campaign.gameSettings.dicePolicy, listMembers(campaign.id)));
  if (!inHand) {
    // A parked card keeps the turn open for its answer, as a person's turn
    // reached through invokeEngine does.
    const parked = listOpenPendingRolls(campaign.id).some((pending) => pending.turnId === turn.id);
    turn.status = parked ? "awaiting_rolls" : "done";
    saveDmTurn(turn);
  }
  return ask ? describeInitiativeAsk(campaign.id, ask) : null;
}
