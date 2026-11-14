import { z } from "zod";
import { claimMindSeat } from "@/lib/db/mind-seats";
import { requireSeatHolder } from "@/lib/mind-seat-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ code: z.string().trim().min(4).max(32) });

// Claims a mind seat by the code its lead shared.
export async function POST(request: Request) {
  const user = await requireSeatHolder();
  if (user instanceof Response) {
    return user;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Send the seat's code." }, { status: 400 });
  }
  const claimed = claimMindSeat(parsed.data.code, user.id);
  if ("error" in claimed) {
    return Response.json({ error: claimed.error, refused: "rules" }, { status: 409 });
  }
  return Response.json({
    seatId: claimed.seat.id,
    campaignId: claimed.seat.campaignId,
    note: "The server gives you a character the first time the story needs one. Wait for questions with odm_mind_wait.",
  });
}
