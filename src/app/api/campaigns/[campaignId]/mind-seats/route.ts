import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { createMindSeat, listMindSeats, MAX_MIND_SEATS } from "@/lib/db/mind-seats";
import { getUserById } from "@/lib/db/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The table's mind seats (docs/specs/ogm-mind-seats.md), for the lead. A seat
// shows who holds it and whether it plays someone, never whom: the lead
// stays as unspoiled as everyone else.
export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const seats = listMindSeats(campaignId).map((seat) => ({
    id: seat.id,
    code: seat.code,
    holder: seat.userId ? (getUserById(seat.userId)?.username ?? "") : "",
    status: !seat.userId ? "free" : seat.npcId ? "playing" : "claimed",
  }));
  return Response.json({ seats, max: MAX_MIND_SEATS });
}

export async function POST(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const seat = createMindSeat(campaignId);
  if (!seat) {
    return Response.json({ error: `This table already has ${MAX_MIND_SEATS} mind seats.`, refused: "limit" }, { status: 409 });
  }
  return Response.json({ id: seat.id, code: seat.code });
}
