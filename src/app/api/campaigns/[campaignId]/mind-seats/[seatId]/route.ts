import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { releaseMindSeat } from "@/lib/db/mind-seats";
import { dropSeatQuestions } from "@/lib/dm/mind-seat-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The lead takes a seat back: its mind returns to the server, from the
// question it is waiting on onward.
export async function DELETE(_request: Request, { params }: { params: Promise<{ campaignId: string; seatId: string }> }) {
  const { campaignId, seatId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!releaseMindSeat(campaignId, seatId)) {
    return Response.json({ error: "No such seat at this table." }, { status: 404 });
  }
  dropSeatQuestions(seatId);
  return Response.json({ ok: true });
}
