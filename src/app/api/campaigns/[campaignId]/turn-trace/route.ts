import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { turnTracePage } from "@/lib/dm/turn-trace";
import { isPlaytest } from "@/lib/workshop/kind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The test fight's turn trace (issue 685, src/lib/dm/turn-trace-logic.ts):
// every call the GM made, newest turn first, with what the engine answered.
//
// A test table only, and its author only. The calls carry what a live
// table's GM keeps behind the screen (an enemy's hit points, a hidden
// creature, the storyteller's own section that even a lead who steers an AI
// table is kept from: context-trace route), and at a live table no seat holds
// all of that. At a test fight one person holds every seat and every secret,
// and nobody can join it, so its author reads the calls whole.

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).default(10),
  // A turn id of this table: the page is the turns before it.
  before: z.string().trim().min(1).max(64).optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!isPlaytest(context.campaign)) {
    return Response.json(
      { error: "Only a test fight shows its turn trace. At a table in play, the GM's calls stay behind the screen." },
      { status: 403 },
    );
  }
  if (context.user.id !== context.campaign.ownerUserId) {
    return Response.json({ error: "Only the person who started this test fight can read its turn trace." }, { status: 403 });
  }
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    before: url.searchParams.get("before") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: "Ask for between 1 and 30 turns, and for earlier ones by a turn's id." }, { status: 400 });
  }
  const page = turnTracePage(campaignId, parsed.data.limit, parsed.data.before ?? null);
  if (!page) {
    return Response.json({ error: "That turn is not one of this table's, so there is nothing before it to show." }, { status: 404 });
  }
  return Response.json(page);
}
