// Asking a player before their character's opportunity attack.
//
// SRD 5.1, Opportunity Attacks: "You CAN make an opportunity attack when a
// hostile creature that you can see moves out of your reach." It costs the
// reaction, which a player may be keeping for Shield, Hellish Rebuke or
// Uncanny Dodge, so the swing is theirs to take. The engine used to take it
// for them wherever an enemy walked (opportunity.ts resolvePcOpportunityWalk).
//
// The walk stops before the swing and the card asks. The pause is the held
// call's (held-call.ts), the one a roll on real dice uses: the walk's call is
// rolled back, a card remembers it with the faces drawn so far, and once the
// player answers the call runs again from the start, the same faces drawn,
// until this swing, where it reads their answer and goes on. A watch stop
// (foresight.ts) holds a call only before it begins, and this stop comes in
// the middle of a walk, after other swings may have landed; the held call is
// the pause that resumes a call partway through, and every door an enemy
// walks through already runs inside one (the AI's turn, the console, the
// server's play of a skipped turn), so they all ask the same way.
//
// Not asked, and swung as before: a character no player of theirs could
// answer for (a companion, a seat an agent plays, a player who has left the
// table or is on the bench: chronal-shift.ts stopReaches), and a walk outside
// a held call (a character's own move from the board, which has no turn to
// hold). A character who cannot react at all is never reached here: the
// walk's own checks come first.

import type { Campaign } from "@/lib/db/campaigns";
import { afterRollDeadline } from "@/lib/dm/after-roll-timer";
import { stopReaches } from "@/lib/dm/chronal-shift";
import { inHeldCall, parkHeldCall, takeOpportunityChoice } from "@/lib/dm/held-call";
import { askDetail, askLine, type OpportunityAsk, type OpportunityChoice, type OpportunityTrigger } from "@/lib/dm/opportunity-ask-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The player's answer for this swing, or null when nobody is asked and it is
// taken as it always was. With no answer yet, the card is put out and the
// walk's call waits on it: this never returns then.
export function opportunityAnswer(
  campaign: Campaign,
  sheet: CharacterSheet,
  walk: { walkerId: string; walker: string; weapon: string; trigger: OpportunityTrigger },
): OpportunityChoice | null {
  if (!inHeldCall() || !stopReaches(campaign.id, sheet)) {
    return null;
  }
  const given = takeOpportunityChoice(sheet.id, walk.walkerId);
  if (given) {
    return given;
  }
  // The clock only while another player is at the table, as the
  // after-the-roll card's (after-roll-timer.ts): alone, nobody is kept waiting.
  const deadline = afterRollDeadline(campaign.id, sheet.userId);
  const ask: OpportunityAsk = { ...walk, ...(deadline ? { deadline } : {}) };
  const line = askLine(ask);
  return parkHeldCall({
    sheet: { id: sheet.id, userId: sheet.userId, name: sheet.name },
    kind: "custom",
    detail: askDetail(ask, sheet.name),
    // A screen that knows nothing of the card draws it as a roll, and its
    // answer is a Strike (the pending-rolls route).
    expression: "1d20",
    advantage: "none",
    dc: null,
    reason: line,
    visibility: "public",
    parkedFor: "opportunity",
    ask,
    note: `Waiting on ${sheet.name}'s player: take the opportunity attack on ${walk.walker}, or let it go.`,
  });
}
