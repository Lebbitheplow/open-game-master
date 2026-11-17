import { z } from "zod";
import { isErrorResponse, requireMember, steersStory } from "@/lib/campaign-api";
import { getPendingRoll } from "@/lib/db/dm-turns";
import { refuseDuringBreak } from "@/lib/dm/table-break";
import { landedBody } from "@/lib/dm/pending-roll-land";
import { answerOpportunityAsk } from "@/lib/dm/opportunity-ask-timer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// `smite`: Divine Smite on the swing, at the slot the card offered
// (opportunity-ask-logic.ts smiteSlotOf).
const answerSchema = z.object({ strike: z.boolean(), smite: z.boolean().optional() }).strict();

// The player answers the ask before their character's opportunity attack
// (src/lib/dm/opportunity-ask.ts): Strike spends the reaction on the swing
// (with `smite`, Divine Smite's slot too if it hits), Let it go spends
// nothing and the walk goes on. Only their own player
// decides; whoever runs the story may send the card on, and so may anyone
// once its time is up, and either way the swing is taken, as the clock takes
// it (opportunity-ask-timer.ts).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; pendingRollId: string }> },
) {
  const { campaignId, pendingRollId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = answerSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say strike: true or strike: false." }, { status: 400 });
  }
  // The walk waits out a break with its turn, as any parked roll does.
  const paused = refuseDuringBreak(campaignId);
  if (paused) {
    return paused;
  }
  const pending = getPendingRoll(pendingRollId);
  if (!pending || pending.campaignId !== campaignId || pending.parkedFor !== "opportunity" || !pending.carry?.ask) {
    return Response.json({ error: "Opportunity attack not found." }, { status: 404 });
  }
  if (pending.status !== "pending") {
    return Response.json({ error: "That opportunity attack was already decided." }, { status: 409 });
  }
  if (parsed.data.smite && (!parsed.data.strike || pending.carry.ask.smiteSlot === undefined)) {
    return Response.json({ error: "No smite was offered on this attack: answer Strike or Let it go." }, { status: 400 });
  }
  const isPlayer = pending.userId === context.user.id;
  const deadline = pending.carry.ask.deadline;
  const due = Boolean(deadline) && Date.now() >= new Date(deadline!).getTime();
  if (!isPlayer && !((steersStory(context) || due) && parsed.data.strike)) {
    return Response.json({ error: "Only this character's player decides whether to take the opportunity attack." }, { status: 403 });
  }
  // Only the player spends their slot: a swing sent on by anyone else is a plain one.
  const smite = isPlayer && parsed.data.smite === true;
  const landed = await answerOpportunityAsk(context.campaign, pending, { strike: parsed.data.strike, ...(smite ? { smite: true } : {}), ...(!isPlayer && due ? { timedOut: true } : {}) });
  return landed ? Response.json(landedBody(landed)) : Response.json({ error: "That opportunity attack was already decided." }, { status: 409 });
}
