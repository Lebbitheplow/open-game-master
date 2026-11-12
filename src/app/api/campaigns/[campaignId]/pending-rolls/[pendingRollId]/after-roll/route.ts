import { mrSpendAfterRoll } from "@/lib/dm/mt-mr-offers";
import { isMrAfterRoll } from "@/lib/dm/mt-mr-offers-logic";
import { z } from "zod";
import { isErrorResponse, requireMember, steersStory } from "@/lib/campaign-api";
import { getPendingRoll, publicPendingRoll, setPendingAttack, setPendingCombatNote, setPendingThrown } from "@/lib/db/dm-turns";
import { getSheetById } from "@/lib/db/sheets";
import { optionsForPending, spendAfterRoll } from "@/lib/dm/after-roll";
import { answeredLine, bardOfHeldDie, keepD20, type ThrownRoll } from "@/lib/dm/after-roll-logic";
import { recordInspiredSuccess } from "@/lib/dm/last-save";
import { AFTER_ROLL_IDS } from "@/lib/dm/after-roll-table";
import { afterRollDeadline, armAfterRollKeep } from "@/lib/dm/after-roll-timer";
import { recordTargetAc, type AttackRecord } from "@/lib/dm/attack-record";
import { runInTurnScope } from "@/lib/dm/job-control";
import { landedBody, landPendingRoll } from "@/lib/dm/pending-roll-land";
import { refuseDuringBreak } from "@/lib/dm/table-break";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const choiceSchema = z.union([
  // `by`: the character whose choice this is, on another character's roll.
  z.object({ use: z.enum(AFTER_ROLL_IDS), by: z.string().min(1).max(80).optional() }),
  // Which of a luck point's d20s counts.
  z.object({ die: z.number().int().min(0).max(20) }),
  z.object({ keep: z.literal(true) }),
  // A character lets an ally's roll stand.
  z.object({ decline: z.literal(true), by: z.string().min(1).max(80) }),
]);

// The roller decides what to do with a d20 they have seen, before the game
// says what it did (src/lib/dm/after-roll-logic.ts), and a Chronurgy wizard
// beside them may make them roll it again (src/lib/dm/chronal-shift.ts), each
// on their own screen. Whoever runs the story may keep the dice as they lie
// for a player who has stepped away.
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
  // A wizard answering another's roll: their own sheet, on offer here.
  const by = "by" in choice && choice.by ? choice.by : null;
  const wizard = by ? getSheetById(by) : null;
  if (by && (!wizard || wizard.campaignId !== campaignId || wizard.userId !== context.user.id || wizard.id === pending.characterId)) {
    return Response.json({ error: "That is not your character." }, { status: 403 });
  }
  if (!by && !isRoller && !("keep" in choice && steersStory(context))) {
    return Response.json({ error: "This is not your roll." }, { status: 403 });
  }

  // Read again as it lands: a helper's choice on a hit (Violent Attraction)
  // rides the attack's stored record.
  const land = (outcome: typeof thrown.outcome, landing = thrown.landing, landed = getPendingRoll(pending.id) ?? pending) => {
    const roll = landPendingRoll(context.campaign, landed, outcome, landing);
    return roll ? Response.json(landedBody(roll)) : Response.json({ error: "That roll was already resolved." }, { status: 409 });
  };
  // A new decision gets its own time; with nothing left to decide it lands.
  const next = (fields: Partial<ThrownRoll>) => {
    const merged: ThrownRoll = { ...thrown, ...fields };
    const options = merged.choosing ? [] : optionsForPending(pending, merged.outcome, merged.spent ?? [], merged);
    if (!merged.choosing && !options.length) {
      return land(merged.outcome, merged.landing);
    }
    const updated = setPendingThrown(pending.id, { ...merged, options, deadline: afterRollDeadline(campaignId, pending.userId) });
    if (!updated) {
      return Response.json({ error: "That roll was already resolved." }, { status: 409 });
    }
    armAfterRollKeep(updated.id, updated.thrown?.deadline);
    publishPersisted(campaignId, "roll_pending", { pendingRoll: publicPendingRoll(updated) });
    return Response.json({ pendingRoll: publicPendingRoll(updated) });
  };
  if ("keep" in choice) {
    // The roller keeps it, but a wizard who may still answer it decides
    // for themselves: the roll waits on them. Whoever runs the story keeps
    // it outright for a table that has stepped away. A helper this account
    // also plays was offered on the same card as the keep, so the keep is
    // their answer too: the roll waited on that card with nothing left to
    // press, and with nobody else online no clock ever kept it (play-test
    // 2026-11-09).
    if (isRoller && !thrown.choosing && thrown.options.some((option) => option.by)) {
      const own = [...new Set(thrown.options.flatMap((option) => (option.by && getSheetById(option.by)?.userId === context.user.id ? [option.by] : [])))];
      return next({ kept: true, ...(own.length ? { declined: [...(thrown.declined ?? []), ...own] } : {}) });
    }
    return land(thrown.outcome);
  }
  if ("decline" in choice) {
    if (!thrown.options.some((option) => option.by === by)) {
      return Response.json({ error: "That is no longer on offer for this roll." }, { status: 409 });
    }
    return next({ declined: [...(thrown.declined ?? []), by!] });
  }

  const sheet = pending.characterId ? getSheetById(pending.characterId) : null;
  if (!sheet) {
    return Response.json({ error: "That character is gone." }, { status: 409 });
  }

  if ("die" in choice) {
    const kept = thrown.choosing ? keepD20(thrown.outcome, choice.die) : null;
    if (!kept) {
      return Response.json({ error: "That die is not one of this roll's." }, { status: 400 });
    }
    return next({ outcome: kept, choosing: false });
  }
  if (thrown.choosing) {
    return Response.json({ error: "Choose which die counts first." }, { status: 409 });
  }
  // Asked again: the die may have been spent, or the rest used, since the
  // card was drawn. A refusal spends nothing.
  if (!optionsForPending(pending, thrown.outcome, thrown.spent, thrown).some((option) => option.id === choice.use && (option.by ?? null) === by)) {
    return Response.json({ error: "That is no longer on offer for this roll." }, { status: 409 });
  }
  // The bard whose die this is, read before the spend takes it off the sheet.
  const bard = choice.use === "bardic" ? bardOfHeldDie(sheet) : null;
  // The parked turn's spend: its revert gives it back (issue #622).
  // A monk's or a rogue's subclass choice reads the roll's target, since two
  // of them are paid only when they change the result (mt-mr-offers.ts).
  const paid = runInTurnScope(pending.turnId, () =>
    isMrAfterRoll(choice.use)
      ? mrSpendAfterRoll(context.campaign, sheet, choice.use, thrown.outcome, pending)
      : spendAfterRoll(context.campaign, sheet, choice.use, thrown.outcome, pending.advantage, wizard ?? undefined, (pending.attack as AttackRecord | null)?.elvenAccuracy === true, pending.attack ? recordTargetAc(pending.campaignId, pending.attack as AttackRecord) : pending.dc),
  );
  if (!paid) {
    return Response.json({ error: "That is no longer on offer for this roll." }, { status: 409 });
  }
  // Combat Inspiration is the bard's die on an attack's damage (after-roll.ts);
  // a monk's or a rogue's choice never carries it.
  const combatInspiration = "combatInspiration" in paid ? paid.combatInspiration : undefined;
  // A Bardic Inspiration die that made the roll succeed is on record as its
  // bard's (last-save.ts recordInspiredSuccess): Infectious Inspiration answers it.
  const mark = pending.dc ?? (pending.attack as AttackRecord | null)?.targetAc ?? null;
  if (bard && typeof mark === "number" && paid.outcome.total >= mark) {
    runInTurnScope(pending.turnId, () => recordInspiredSuccess(context.campaign.id, { id: sheet.id, name: sheet.name }, bard, pending.attack ? "attack" : pending.kind === "saving_throw" ? "save" : "check"));
  }
  if ((paid.touchOfDeath || paid.destructiveWrath || combatInspiration) && pending.attack) {
    // No die is thrown: the roll stays the player's, and the hit carries the
    // necrotic and pays its use once it stands (attack-swing.ts), or its
    // lightning and thunder at their maximum. A hit waits on one cleric's
    // Channel Divinity, so it lands with the choice.
    const attack = { ...pending.attack, ...(paid.touchOfDeath ? { touchOfDeath: paid.touchOfDeath } : {}), ...(paid.destructiveWrath ? { destructiveWrath: true } : {}), ...(combatInspiration ? { combatInspiration: true } : {}) };
    return land(paid.outcome, thrown.landing, { ...pending, attack });
  }
  if ("helperHit" in paid && paid.helperHit && pending.attack && wizard) {
    // Another's choice on the hit (Violent Attraction): no die is thrown now.
    // The hit carries the helper's dice and pays their use and reaction once
    // it stands (attack-swing.ts), and the roller may still choose their own.
    const attack = pending.attack as AttackRecord;
    setPendingAttack(pending.id, { ...attack, helperHits: [...(attack.helperHits ?? []), { by: wizard.id, use: choice.use }] });
    return next({ shiftedBy: [...(thrown.shiftedBy ?? []), wizard.id] });
  }
  // The server threw this die: "(physical)" would overclaim the roll now,
  // and the model would be told the player threw it all.
  const landing = { ...thrown.landing, status: "fallback" as const, physical: false };
  if (wizard) {
    // The model reads the roll as it lands; this says why it changed.
    const line = answeredLine(choice.use, wizard.name, sheet.name, thrown.outcome.total, paid.outcome.total);
    setPendingCombatNote(pending.id, [pending.combatNote, line].filter(Boolean).join("; "));
    // A new total: the roller may answer it again, and this character is done.
    return next({ outcome: paid.outcome, choosing: paid.choosing, landing, kept: false, shiftedBy: [...(thrown.shiftedBy ?? []), wizard.id] });
  }
  return next({ outcome: paid.outcome, choosing: paid.choosing, landing, spent: [...(thrown.spent ?? []), choice.use] });
}
