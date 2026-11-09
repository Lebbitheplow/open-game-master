import { z } from "zod";
import { isErrorResponse, requireMember, steersStory } from "@/lib/campaign-api";
import { getPendingRoll, type WatchPower } from "@/lib/db/dm-turns";
import { getSheetById } from "@/lib/db/sheets";
import { answerWatch } from "@/lib/dm/foresight-release";
import { foretoldLeft } from "@/lib/dm/foretold-logic";
import { canHelpSaveNow, canShiftNow } from "@/lib/dm/chronal-shift";
import { refuseDuringBreak } from "@/lib/dm/table-break";

export const runtime = "nodejs";

const FEATURES: Record<WatchPower, string> = { portent: "Portent", chronal_shift: "Chronal Shift", flash_of_genius: "Flash of Genius", favored_by_the_gods: "Favored by the Gods" };
export const dynamic = "force-dynamic";

// `choice`: whose roll, by its place in the stop's list, when the stop offers
// more than one (an area's saves).
const choice = z.number().int().min(0).max(99).optional();
const choiceSchema = z.union([
  z.object({ value: z.number().int().min(1).max(20), choice }),
  z.object({ shift: z.literal(true), choice }),
  z.object({ pass: z.literal(true) }),
]);

// The watcher answers a stop before a roll (src/lib/dm/foresight.ts): a number
// they hold goes on the roll's d20, a Chronal Shift is set to roll it again if
// it goes the wrong way, Flash of Genius or Favored by the Gods to add to the
// save if it fails (src/lib/dm/chronal-shift.ts), or the roll goes ahead.
// Whoever runs the story may send a stop on, and so may anyone once its time
// is up.
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
  const data = parsed.data;
  const power = pending.watch.power ?? "portent";
  const feature = FEATURES[power];
  const choices = pending.watch.choices ?? [];
  let chosen: number | undefined;
  if ("value" in data || "shift" in data) {
    if (!isWatcher) {
      return Response.json({ error: `Only the watcher's own player uses their ${feature}.` }, { status: 403 });
    }
    // `shift`: use it if the roll goes wrong, whichever feature the stop is for.
    if (("value" in data && power !== "portent") || ("shift" in data && power === "portent")) {
      return Response.json({ error: `This stop is for ${feature}.` }, { status: 409 });
    }
    // Whose roll: asked for when there is more than one to answer.
    if (choices.length > 1 && data.choice === undefined) {
      return Response.json({ error: "Choose whose roll it answers first." }, { status: 400 });
    }
    if (data.choice !== undefined && data.choice >= Math.max(1, choices.length)) {
      return Response.json({ error: "That creature is not one of this roll's." }, { status: 400 });
    }
    chosen = data.choice;
    const sheet = pending.characterId ? getSheetById(pending.characterId) : null;
    if ("value" in data && (!sheet || !foretoldLeft(sheet).includes(data.value))) {
      return Response.json({ error: `You hold no foretold ${data.value}.` }, { status: 409 });
    }
    if ("shift" in data && power === "chronal_shift" && (!sheet || !canShiftNow(campaignId, sheet))) {
      return Response.json({ error: "Your Chronal Shift is spent, or your reaction is." }, { status: 409 });
    }
    if ("shift" in data && (power === "flash_of_genius" || power === "favored_by_the_gods") && (!sheet || !canHelpSaveNow(campaignId, sheet, power))) {
      return Response.json({ error: power === "flash_of_genius" ? "Your Flash of Genius is spent, or your reaction is." : "Your Favored by the Gods is spent." }, { status: 409 });
    }
  } else if (!isWatcher && !due && !steersStory(context)) {
    return Response.json({ error: "This is not your choice yet." }, { status: 403 });
  }
  const face = "value" in data ? data.value : null;
  return answerWatch(pending.id, face, { ...(chosen !== undefined ? { chosen } : {}), ...("shift" in data ? { shift: true } : {}) })
    ? Response.json({ ok: true })
    : Response.json({ error: "That roll has already gone ahead." }, { status: 409 });
}
