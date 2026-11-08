import { z } from "zod";
import { isErrorResponse, requireMember, steersStory } from "@/lib/campaign-api";
import { getPendingRoll } from "@/lib/db/dm-turns";
import { getSheetById } from "@/lib/db/sheets";
import { answerWatch } from "@/lib/dm/foresight-release";
import { foretoldLeft } from "@/lib/dm/foretold-logic";
import { refuseDuringBreak } from "@/lib/dm/table-break";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const choiceSchema = z.union([z.object({ value: z.number().int().min(1).max(20) }), z.object({ pass: z.literal(true) })]);

// The watcher answers a stop before a roll (src/lib/dm/foresight.ts): a number
// they hold goes on the roll's d20, or the roll goes ahead. Whoever runs the
// story may send a stop on, and so may anyone once its time is up.
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
  const paused = refuseDuringBreak(campaignId);
  if (paused) {
    return paused;
  }
  const pending = getPendingRoll(pendingRollId);
  if (!pending || pending.campaignId !== campaignId || pending.parkedFor !== "watch" || !pending.watch) {
    return Response.json({ error: "Roll not found." }, { status: 404 });
  }
  if (pending.status !== "pending") {
    return Response.json({ error: "That roll has already gone ahead." }, { status: 409 });
  }
  const isWatcher = pending.userId === context.user.id;
  const due = Date.now() >= new Date(pending.watch.deadline).getTime();
  if ("value" in parsed.data) {
    if (!isWatcher) {
      return Response.json({ error: "Only the wizard's own player uses their Portent." }, { status: 403 });
    }
    const sheet = pending.characterId ? getSheetById(pending.characterId) : null;
    if (!sheet || !foretoldLeft(sheet).includes(parsed.data.value)) {
      return Response.json({ error: `You hold no foretold ${parsed.data.value}.` }, { status: 409 });
    }
  } else if (!isWatcher && !due && !steersStory(context)) {
    return Response.json({ error: "This is not your choice yet." }, { status: 403 });
  }
  const face = "value" in parsed.data ? parsed.data.value : null;
  return answerWatch(pending.id, face)
    ? Response.json({ ok: true })
    : Response.json({ error: "That roll has already gone ahead." }, { status: 409 });
}
