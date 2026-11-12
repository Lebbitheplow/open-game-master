import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getPendingRoll, publicPendingRoll, setPendingAdvantage, setPendingCarry, setPendingCombatNote } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { reactionFreeFor } from "@/lib/dm/after-roll";
import { spendFeatureUse } from "@/lib/dm/attack-onhit";
import { BEFORE_ROLL_COUNTER, BEFORE_ROLL_FEATURES, OMEN_SIDES, ownBeforeRollChoices } from "@/lib/dm/before-roll-logic";
import { singleD20Expression } from "@/lib/dm/foretold-logic";
import { refuseDuringBreak } from "@/lib/dm/table-break";
import { markReactionUsed } from "@/lib/dm/turn-budget";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const choiceSchema = z.object({ use: z.enum(["cosmic_omen", "restore_balance"]) });

// The roller uses Cosmic Omen's Weal or Restore Balance on their own check or
// save parked for them, before any die is thrown (src/lib/dm/before-roll-logic.ts,
// the maintainer's ruling on issue #908): Weal puts a d6 beside the d20,
// Restore Balance throws one d20 where disadvantage threw two. The use and
// the reaction are paid here, as Portent's number is paid on its own route;
// the roll is then thrown (or entered) as it now reads. Nothing is spent on a
// refusal.
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
  if (!pending || pending.campaignId !== campaignId) {
    return Response.json({ error: "Roll not found." }, { status: 404 });
  }
  if (pending.status !== "pending") {
    return Response.json({ error: "That roll was already resolved." }, { status: 409 });
  }
  if (pending.userId !== context.user.id) {
    return Response.json({ error: "This is not your roll." }, { status: 403 });
  }
  const { use } = parsed.data;
  const feature = BEFORE_ROLL_FEATURES[use];
  if (pending.thrown) {
    return Response.json({ error: `The dice have already landed, and ${feature} is used before the roll.` }, { status: 409 });
  }
  const sheet = pending.characterId ? getSheetById(pending.characterId) : null;
  if (!sheet || sheet.userId !== context.user.id) {
    return Response.json({ error: `Only the character's own player uses their ${feature}.` }, { status: 403 });
  }
  // Asked again as the button is pressed: the use, the reaction, the omen
  // and, for Restore Balance, the disadvantage the roll is about to have.
  const used = pending.carry?.before ?? [];
  const offered = ownBeforeRollChoices(sheet, { kind: pending.kind, expression: pending.expression, reactionFree: reactionFreeFor(campaignId, sheet.id), used });
  if (pending.attack || !offered.some((choice) => choice.id === use)) {
    return Response.json({ error: `${feature} is not on offer for this roll: it is spent, the reaction is, or the roll has nothing for it to change.` }, { status: 409 });
  }
  const expression = use === "restore_balance" ? singleD20Expression(pending.expression) : `${pending.expression}+1d${OMEN_SIDES}`;
  // The roll first, so a roll resolved a moment ago never costs the use.
  const changed = setPendingAdvantage(pending.id, expression, use === "restore_balance" ? "none" : pending.advantage);
  if (!changed || !spendFeatureUse(context.campaign, sheet.id, BEFORE_ROLL_COUNTER[use], use === "cosmic_omen" ? `${feature} (Weal)` : feature, "player")) {
    if (changed) {
      setPendingAdvantage(pending.id, pending.expression, pending.advantage);
    }
    return Response.json({ error: "That roll was already resolved." }, { status: 409 });
  }
  const encounter = getActiveEncounter(campaignId);
  if (encounter) {
    markReactionUsed(encounter, sheet.id);
  }
  const updated = setPendingCarry(pending.id, { ...(pending.carry ?? {}), before: [...used, use] }) ?? changed;
  // The model reads why the roll is not the one it asked for.
  const line = use === "restore_balance" ? `${sheet.name} used Restore Balance: the roll is made with one d20.` : `${sheet.name} used Cosmic Omen (Weal): 1d${OMEN_SIDES} rides the roll.`;
  setPendingCombatNote(pending.id, pending.combatNote ? `${pending.combatNote}; ${line}` : line);
  publishPersisted(campaignId, "roll_pending", { pendingRoll: publicPendingRoll(updated) });
  return Response.json({ pendingRoll: publicPendingRoll(updated) });
}
