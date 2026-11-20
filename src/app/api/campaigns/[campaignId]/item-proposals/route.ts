import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { refuseDuringBreak } from "@/lib/dm/table-break";
import { allocateSeq, capsFor } from "@/lib/db/campaigns";
import { insertItemProposal, listOpenItemProposals } from "@/lib/db/item-proposals";
import { getSheetById, getSheetForUser } from "@/lib/db/sheets";
import { publicItemProposal } from "@/lib/dm/proposal-intercept";
import { offerVisibleTo } from "@/lib/dm/proposal-view";
import { computeTrade, normalizeTradeOffer, tradeSummary } from "@/lib/dm/trade-logic";
import { publishPersisted } from "@/lib/events";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What TradeDialog.tsx sends. normalizeTradeOffer still trims names and
// clamps quantities and coins, so only the kinds of things are checked here.
const tradeLineSchema = z.object({ name: z.string(), qty: z.number().optional() });
const tradeOfferSchema = z.object({
  toCharacterId: z.string().optional(),
  give: z.array(tradeLineSchema).optional(),
  giveCp: z.number().optional(),
  want: z.array(tradeLineSchema).optional(),
  wantCp: z.number().optional(),
});

// Open DM item/gold offers (inventoryApprovals). Inventory is party
// knowledge, so every member sees the pending offers, except one that is
// owner-only (a pact's approach, issue 503): its player and the storyteller.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const caps = capsFor(context.campaign, context.user.id);
  return Response.json({
    proposals: listOpenItemProposals(campaignId)
      .filter((proposal) => offerVisibleTo(proposal, context.user.id, caps))
      .map(publicItemProposal),
  });
}

// A player offers a trade to another character
// (docs/vtt-parity-implementation-plan.md 11.2). The offer is checked
// against both sheets now, so an offer of what one does not carry never
// reaches the other side, and checked again when accepted.
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = tradeOfferSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "That offer could not be read." }, { status: 400 });
  }
  const offer = normalizeTradeOffer(parsed.data);
  if (!offer) {
    return Response.json({ error: "Offer something, or ask for something." }, { status: 400 });
  }
  // A trade between characters is play, which waits out a break.
  const paused = refuseDuringBreak(campaignId);
  if (paused) {
    return paused;
  }
  const from = getSheetForUser(campaignId, context.user.id);
  if (!from) {
    return Response.json({ error: "You have no character to trade with." }, { status: 400 });
  }
  const to = getSheetById(offer.toCharacterId);
  if (!to || to.campaignId !== campaignId || to.id === from.id) {
    return Response.json({ error: "Pick another character at this table." }, { status: 400 });
  }
  const computed = computeTrade(from, to, offer);
  if ("error" in computed) {
    return Response.json({ error: computed.error }, { status: 409 });
  }
  const proposal = insertItemProposal({
    campaignId,
    turnId: null,
    characterId: from.id,
    userId: context.user.id,
    toolName: "trade",
    argsJson: JSON.stringify(offer),
    summary: tradeSummary(offer, from.name, to.name),
    reason: "",
    seq: allocateSeq(campaignId),
    toCharacterId: to.id,
  });
  publishPersisted(campaignId, "item_proposal_added", { proposal: publicItemProposal(proposal) });
  return Response.json({ proposal: publicItemProposal(proposal) });
}
