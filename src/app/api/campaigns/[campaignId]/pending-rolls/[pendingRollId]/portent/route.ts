import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { foretoldPromised, getPendingRoll, publicPendingRoll, setPendingThrown } from "@/lib/db/dm-turns";
import { getSheetById } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { optionsForPending } from "@/lib/dm/after-roll";
import { afterRollDeadline, armAfterRollKeep } from "@/lib/dm/after-roll-timer";
import { canWaitOnRoll } from "@/lib/dm/after-roll-logic";
import { spendForetold } from "@/lib/dm/foretold";
import { foretoldLeft, foretoldWithout, singleD20Expression, withForetoldD20 } from "@/lib/dm/foretold-logic";
import { landedBody, landPendingRoll } from "@/lib/dm/pending-roll-land";
import { refuseDuringBreak } from "@/lib/dm/table-break";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const choiceSchema = z.object({ value: z.number().int().min(1).max(20) });

// The roller replaces the d20 of a roll parked for them with a number Portent
// foretold, before any die is thrown. The rest of the roll (its modifier and
// any dice beside the d20) still counts, and what the character holds for a
// roll they have seen may still answer it (src/lib/dm/after-roll.ts).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; pendingRollId: string }> },
) {
  const { campaignId, pendingRollId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = choiceSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid number." }, { status: 400 });
  }
  const paused = refuseDuringBreak(campaignId);
  if (paused) {
    return paused;
  }

  const pending = getPendingRoll(pendingRollId);
  if (!pending || pending.campaignId !== campaignId) {
    return Response.json({ error: "Roll not found." }, { status: 404 });
  }
  if (pending.status !== "pending") {
    return Response.json({ error: "That roll was already resolved." }, { status: 409 });
  }
  if (pending.userId !== context.user.id) {
    return Response.json({ error: "This is not your roll." }, { status: 403 });
  }
  // Portent is declared before the roll, and these dice are thrown.
  if (pending.thrown) {
    return Response.json({ error: "The dice have already landed, and Portent is used before the roll." }, { status: 409 });
  }
  if (!canWaitOnRoll(pending.kind) || pending.attack) {
    return Response.json({ error: "Portent can be used here on an ability check or a saving throw." }, { status: 409 });
  }
  const sheet = pending.characterId ? getSheetById(pending.characterId) : null;
  if (!sheet || sheet.userId !== context.user.id) {
    return Response.json({ error: "Only the character's own player uses their Portent." }, { status: 403 });
  }
  const { value } = parsed.data;
  // A stop in this turn may have promised the number already.
  let free = foretoldLeft(sheet);
  for (const promised of foretoldPromised(pending.turnId, sheet.id)) {
    free = foretoldWithout(free, promised);
  }
  if (!free.includes(value)) {
    return Response.json({ error: `${sheet.name} holds no foretold ${value}.` }, { status: 409 });
  }

  let outcome;
  try {
    outcome = withForetoldD20(rollExpression(singleD20Expression(pending.expression)), value);
  } catch {
    outcome = null;
  }
  if (!outcome) {
    return Response.json({ error: "This roll has no d20 to replace." }, { status: 409 });
  }

  spendForetold(context.campaign, sheet.id, value, pending.turnId, pending.detail || pending.kind.replaceAll("_", " "));

  const landing = { status: "fallback", physical: false, source: "digital" } as const;
  const options = optionsForPending(pending, outcome);
  if (options.length) {
    const waiting = setPendingThrown(pending.id, { outcome, options, choosing: false, landing, deadline: afterRollDeadline(campaignId, pending.userId) });
    if (!waiting) {
      return Response.json({ error: "That roll was already resolved." }, { status: 409 });
    }
    armAfterRollKeep(waiting.id, waiting.thrown?.deadline);
    publishPersisted(campaignId, "roll_pending", { pendingRoll: publicPendingRoll(waiting) });
    return Response.json({ pendingRoll: publicPendingRoll(waiting) });
  }
  const roll = landPendingRoll(context.campaign, pending, outcome, landing);
  return roll ? Response.json(landedBody(roll)) : Response.json({ error: "That roll was already resolved." }, { status: 409 });
}
