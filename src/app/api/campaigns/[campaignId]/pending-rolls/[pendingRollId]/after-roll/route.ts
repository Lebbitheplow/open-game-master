import { z } from "zod";
import { isErrorResponse, requireMember, steersStory } from "@/lib/campaign-api";
import { getPendingRoll, publicPendingRoll, setPendingThrown } from "@/lib/db/dm-turns";
import { getSheetById } from "@/lib/db/sheets";
import { optionsForPending, spendAfterRoll } from "@/lib/dm/after-roll";
import { keepD20 } from "@/lib/dm/after-roll-logic";
import { afterRollDeadline, armAfterRollKeep } from "@/lib/dm/after-roll-timer";
import { runInTurnScope } from "@/lib/dm/job-control";
import { landPendingRoll } from "@/lib/dm/pending-roll-land";
import { refuseDuringBreak } from "@/lib/dm/table-break";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const choiceSchema = z.union([
  z.object({ use: z.enum(["lucky", "bardic", "own_luck", "chronal_shift", "guided_strike", "master_duelist", "favored_by_the_gods", "touch_of_death"]) }),
  // Which of a luck point's d20s counts.
  z.object({ die: z.number().int().min(0).max(20) }),
  z.object({ keep: z.literal(true) }),
]);

// The roller decides what to do with a d20 they have seen, before the game
// says what it did (src/lib/dm/after-roll-logic.ts). Whoever runs the story
// may keep the dice as they lie for a player who has stepped away.
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
    return Response.json({ error: "Invalid choice." }, { status: 400 });
  }
  const choice = parsed.data;
  // A roll waits out a break with its turn, and a choice would land it.
  const paused = refuseDuringBreak(campaignId);
  if (paused) {
    return paused;
  }

  const pending = getPendingRoll(pendingRollId);
  if (!pending || pending.campaignId !== campaignId) {
    return Response.json({ error: "Roll not found." }, { status: 404 });
  }
  if (pending.status !== "pending" || !pending.thrown) {
    return Response.json({ error: "That roll is not waiting on a choice." }, { status: 409 });
  }
  const thrown = pending.thrown;
  const isRoller = pending.userId === context.user.id;
  if (!isRoller && !("keep" in choice && steersStory(context))) {
    return Response.json({ error: "This is not your roll." }, { status: 403 });
  }

  const land = (outcome: typeof thrown.outcome, landing = thrown.landing, landed = pending) => {
    const roll = landPendingRoll(context.campaign, landed, outcome, landing);
    return roll ? Response.json({ roll }) : Response.json({ error: "That roll was already resolved." }, { status: 409 });
  };
  if ("keep" in choice) {
    return land(thrown.outcome);
  }

  const sheet = pending.characterId ? getSheetById(pending.characterId) : null;
  if (!sheet) {
    return Response.json({ error: "That character is gone." }, { status: 409 });
  }

  let outcome = thrown.outcome;
  let choosing = false;
  let spent = thrown.spent ?? [];
  let landing = thrown.landing;
  let landed = pending;
  if ("die" in choice) {
    const kept = thrown.choosing ? keepD20(outcome, choice.die) : null;
    if (!kept) {
      return Response.json({ error: "That die is not one of this roll's." }, { status: 400 });
    }
    outcome = kept;
  } else {
    if (thrown.choosing) {
      return Response.json({ error: "Choose which die counts first." }, { status: 409 });
    }
    // Asked again: the die may have been spent, or the rest used, since the
    // card was drawn. A refusal spends nothing.
    if (!optionsForPending(pending, outcome, thrown.spent).some((option) => option.id === choice.use)) {
      return Response.json({ error: "That is no longer on offer for this roll." }, { status: 409 });
    }
    // The parked turn's spend: its revert gives it back (issue #622).
    const paid = runInTurnScope(pending.turnId, () => spendAfterRoll(context.campaign, sheet, choice.use, outcome, pending.advantage));
    if (!paid) {
      return Response.json({ error: "That is no longer on offer for this roll." }, { status: 409 });
    }
    outcome = paid.outcome;
    choosing = paid.choosing;
    spent = [...spent, choice.use];
    if (paid.touchOfDeath && pending.attack) {
      // No die is thrown: the roll stays the player's, and the hit carries it.
      landed = { ...pending, attack: { ...pending.attack, touchOfDeath: paid.touchOfDeath } };
    } else {
      // The server threw this die: "(physical)" would overclaim the roll now,
      // and the model would be told the player threw it all.
      landing = { ...landing, status: "fallback", physical: false };
    }
  }

  // Choosing among the dice comes first. After that the roll lands as soon as
  // it succeeds or nothing more could change it.
  const options = choosing ? [] : optionsForPending(pending, outcome, spent);
  if (!choosing && !options.length) {
    return land(outcome, landing, landed);
  }
  // A new decision gets its own time.
  const updated = setPendingThrown(pending.id, { ...thrown, outcome, options, choosing, spent, landing, deadline: afterRollDeadline(campaignId, pending.userId) });
  if (!updated) {
    return Response.json({ error: "That roll was already resolved." }, { status: 409 });
  }
  armAfterRollKeep(updated.id, updated.thrown?.deadline);
  publishPersisted(campaignId, "roll_pending", { pendingRoll: publicPendingRoll(updated) });
  return Response.json({ pendingRoll: publicPendingRoll(updated) });
}
