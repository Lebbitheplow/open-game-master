import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { resolvableCards, resolveAsPlayed } from "@/lib/dm/resolve-card";
import { refuseDuringBreak } from "@/lib/dm/table-break";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Resolve as played" on a row of the GM console's "Waiting on you" list
// (issue 685, src/lib/dm/resolve-card.ts): a player's card the engine can
// take whole, resolved with the calls the AI's direct pass would make, as the
// GM. GET says which of the waiting rows can be, so the console offers the
// button on those alone; POST resolves one.

const MAX_IDS = 50;

const idsSchema = z.array(z.string().trim().min(1).max(80)).max(MAX_IDS);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  // One `id` per waiting message: ?id=a&id=b.
  const parsed = idsSchema.safeParse(new URL(request.url).searchParams.getAll("id"));
  if (!parsed.success) {
    return Response.json({ error: `Ask about up to ${MAX_IDS} waiting actions at a time.` }, { status: 400 });
  }
  return Response.json({ resolvable: resolvableCards(context.campaign, parsed.data) });
}

const resolveSchema = z.object({ messageId: z.string().trim().min(1).max(80) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const { campaign, user } = context;
  if (campaign.status !== "active") {
    return Response.json({ error: "The adventure has not started yet." }, { status: 400 });
  }
  const parsed = resolveSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Name the waiting action to resolve." }, { status: 400 });
  }
  // A break holds play, and this is play: a cast, a swing, a slot spent.
  const paused = refuseDuringBreak(campaignId);
  if (paused) {
    return paused;
  }
  const outcome = await resolveAsPlayed(campaign, user.id, parsed.data.messageId);
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: outcome.status });
  }
  return Response.json({ resolved: true, message: outcome.message });
}
