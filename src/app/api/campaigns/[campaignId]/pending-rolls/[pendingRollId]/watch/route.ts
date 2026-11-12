import { z } from "zod";
import { isErrorResponse, requireMember, steersStory } from "@/lib/campaign-api";
import { getPendingRoll } from "@/lib/db/dm-turns";
import { isSaveHelp, WATCH_FEATURES, watchWords, type WatchPower } from "@/lib/dm/after-roll-table";
import { getSheetById } from "@/lib/db/sheets";
import { answerWatch } from "@/lib/dm/foresight-release";
import { foretoldLeft } from "@/lib/dm/foretold-logic";
import { canHelpSaveNow, canReactNow, canShiftNow } from "@/lib/dm/chronal-shift";
import { refuseDuringBreak } from "@/lib/dm/table-break";
import { canTurnFate } from "@/lib/dm/fate-turn";
import { isFatePower } from "@/lib/dm/fate-turn-logic";
import { balanceLeft, omenLeft } from "@/lib/dm/before-roll-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

// Whether the watcher could still pay for the power they say to use: the
// stop's own (Slayer's Counter's reaction, the Cloud Rune's reaction and a use
// of the rune) or a watch row of after-roll-table.ts (a save help's use and
// reaction, Convergent Future's or Bend Luck's cost, a Chronal Shift).
function canAnswerNow(campaignId: string, sheet: CharacterSheet, power: WatchPower): boolean {
  if (power === "portent") return false;
  if (power === "slayers_counter") return canReactNow(campaignId, sheet);
  // Before the roll: the reaction and a use, and Cosmic Omen's omen (before-roll-logic.ts).
  if (power === "cosmic_omen") return canReactNow(campaignId, sheet) && omenLeft(sheet) !== null;
  if (power === "restore_balance") return canReactNow(campaignId, sheet) && balanceLeft(sheet);
  if (power === "cloud_rune") {
    const rune = sheet.resources?.sub_cloud_rune;
    return canReactNow(campaignId, sheet) && Boolean(rune) && rune!.max - rune!.used > 0;
  }
  if (isSaveHelp(power)) return canHelpSaveNow(campaignId, sheet, power);
  if (isFatePower(power)) return canTurnFate(campaignId, sheet, power);
  return canShiftNow(campaignId, sheet);
}

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
// save if it fails, Convergent Future or Bend Luck to turn it
// (src/lib/dm/chronal-shift.ts, fate-turn.ts), Slayer's Counter or the Cloud
// Rune to act at the stop itself, Cosmic Omen or Restore Balance to go on the
// d20 as it is thrown (src/lib/dm/foresight-before.ts), or the roll goes ahead.
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
  const feature = WATCH_FEATURES[power];
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
    if ("shift" in data && (!sheet || !canAnswerNow(campaignId, sheet, power))) {
      return Response.json({ error: watchWords(power).spentError }, { status: 409 });
    }
  } else if (!isWatcher && !due && !steersStory(context)) {
    return Response.json({ error: "This is not your choice yet." }, { status: 403 });
  }
  const face = "value" in data ? data.value : null;
  return answerWatch(pending.id, face, { ...(chosen !== undefined ? { chosen } : {}), ...("shift" in data ? { shift: true } : {}) })
    ? Response.json({ ok: true })
    : Response.json({ error: "That roll has already gone ahead." }, { status: 409 });
}
