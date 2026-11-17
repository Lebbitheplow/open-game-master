import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { endOwnTurn, endTurnRefusal } from "@/lib/dm/encounter-tools";
import { requestDmTurn } from "@/lib/dm/loop";
import { refuseDuringBreak } from "@/lib/dm/table-break";
import { requestT } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The current player ends their own combat turn. Attacks no longer advance
// the initiative by themselves (movement and bonus actions stay open), so
// this button is the player's reliable way to say "done"; the DM wakes so
// intervening enemies and companions still act.

// endTurnRefusal's words (src/lib/dm/encounter-tools.ts, the engine's own)
// carried into the reader's keys at this boundary — the source rides the
// fight's tools and is never edited. Each mapping, refusal → key:
//   "{name} is dominated: the GM plays {name} until the charm ends. Use OOC
//    for table talk."                      → board.side.dominated + refusal.oocTail
//   "{names} acts first: wait for its turn, then take yours."
//                                           → refusal.endTurnWaitFirst_one
//   "{names} act first: wait for their turns, then take yours."
//                                           → refusal.endTurnWaitFirst_other
//   "It is not your combat turn."          → refusal.notCombatTurn
function endTurnKey(error: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (error === "It is not your combat turn.") {
    return t("It is not your combat turn.");
  }
  const one = " acts first: wait for its turn, then take yours.";
  if (error.endsWith(one)) {
    return t("{names} acts first: wait for its turn, then take yours.", { names: error.slice(0, error.length - one.length) });
  }
  const many = " act first: wait for their turns, then take yours.";
  if (error.endsWith(many)) {
    return t("{names} act first: wait for their turns, then take yours.", { names: error.slice(0, error.length - many.length) });
  }
  const dominatedMark = " is dominated: the GM plays ";
  const cut = error.indexOf(dominatedMark);
  const dominatedTail = " until the charm ends. Use OOC for table talk.";
  if (cut > 0 && error.startsWith(error.slice(0, cut), cut + dominatedMark.length) && error.endsWith(dominatedTail)) {
    const name = error.slice(0, cut);
    return `${t("{name} is dominated: the GM plays {name} until the charm ends.", { name })} ${t("Use OOC for table talk.")}`;
  }
  return error;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  // The refusals read the asker's language: the floor banner and the board
  // show them raw (requestT — x-odm-locale, then Accept-Language).
  const t = requestT(request);
  const context = await requireMember(campaignId, request);
  if (isErrorResponse(context)) {
    return context;
  }
  // The initiative pointer waits out a table break where it stands.
  const paused = refuseDuringBreak(campaignId, undefined, request);
  if (paused) {
    return paused;
  }
  const ended = endOwnTurn(campaignId, context.user.id);
  if (!ended) {
    return Response.json({ error: endTurnKey(endTurnRefusal(campaignId, context.user.id), t) }, { status: 409 });
  }
  // Held for a watcher's stop (src/lib/dm/turn-hold.ts): the GM's turn
  // follows the move once the stop closes.
  if (ended === "held") {
    return Response.json({ ok: true, held: true });
  }
  requestDmTurn(campaignId);
  return Response.json({ ok: true });
}
