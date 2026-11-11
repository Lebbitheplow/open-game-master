import { z } from "zod";
import { isErrorResponse, requireMember, steersStory } from "@/lib/campaign-api";
import { refuseDuringBreak } from "@/lib/dm/table-break";
import {
  dicePreferencesOf,
  getPendingRoll,
  publicPendingRoll,
  setPendingThrown,
} from "@/lib/db/dm-turns";
import { rollEnteredDice, rollExpression, type RollResult } from "@/lib/dice";
import { heroRollTag } from "@/lib/dice-script-logic";
import { mayTypeFaces } from "@/lib/dice/held-rolls";
import { optionsForPending } from "@/lib/dm/after-roll";
import { afterRollDeadline, armAfterRollKeep } from "@/lib/dm/after-roll-timer";
import { throwDamage } from "@/lib/dm/attack-blow";
import type { DamageAsk } from "@/lib/dm/attack-record";
import { landedBody, landPendingRoll } from "@/lib/dm/pending-roll-land";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const submitSchema = z.union([
  // Each entry is a die face, or the literal "digital" for a face whose
  // source preference asked the server to roll that one die.
  z.object({
    dice: z
      .array(z.union([z.number().int().min(1).max(100), z.literal("digital")]))
      .min(1)
      .max(120),
  }),
  z.object({ fallback: z.literal("digital") }),
]);

// A player (or, for the digital fallback, the owner) resolves a parked
// physical roll. When the turn has no pending rolls left, the DM resumes.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; pendingRollId: string }> },
) {
  const { campaignId, pendingRollId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  // Body parsing happens before the pending-roll lookup on purpose: with no
  // await between the status check and resolvePendingRoll below, concurrent
  // double-submits cannot both insert a roll row (better-sqlite3 is sync).
  const raw = await request.json().catch(() => ({}));
  const parsed = submitSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid roll submission." }, { status: 400 });
  }
  // A roll parked before the break waits out the break with its turn:
  // resolving it would record initiative and lock the order, land damage or
  // resume the DM while the table is paused (table audit 2026-10-26, T05).
  // After Resume it resolves as it would have.
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

  // A watch stop holds no roll, and is answered on its own route.
  if (pending.parkedFor === "watch") {
    return Response.json({ error: "That is a stop for Portent, not a roll." }, { status: 409 });
  }
  // A screen that knows nothing of Portent shows this roll as one to type in:
  // the server throws it, so the table is never left on a refused answer.
  const isFallback = "fallback" in parsed.data || pending.parkedFor === "foretold";
  const isRoller = pending.userId === context.user.id;
  // Whoever runs the story can force the digital fallback when a player is
  // away from their physical dice: the lead in an AI campaign, the DM in a
  // human-run one.
  const canForceFallback = steersStory(context);
  if (isFallback ? !isRoller && !canForceFallback : !isRoller) {
    return Response.json({ error: "This is not your roll." }, { status: 403 });
  }

  // The dice are already thrown and wait on the player's choice. A card from
  // an older screen, or an agent seat answering the roll it was woken for,
  // has no such choice to make: its answer keeps the dice as they lie, so the
  // table is never left waiting on a button the answerer cannot see.
  if (pending.thrown) {
    const kept = landPendingRoll(context.campaign, pending, pending.thrown.outcome, pending.thrown.landing);
    return kept ? Response.json(landedBody(kept)) : Response.json({ error: "That roll was already resolved." }, { status: 409 });
  }

  // The faces the player typed or their Pixels dice reported. A "digital"
  // entry stands in for a face rolled by the server: drawn crypto-random
  // here, never fabricated in the browser where it would be predictable
  // and forgeable.
  const submitted = isFallback
    ? []
    : (parsed.data as { dice: Array<number | "digital"> }).dice;
  const anyDigital = submitted.includes("digital");
  // A face the player typed is believed only for a roll parked for real
  // dice, at a table that still allows them for this player. A held roll is
  // released, never chosen: the server throws it.
  if (submitted.some((entry) => entry !== "digital")) {
    const preferences = dicePreferencesOf(campaignId, pending.userId);
    if (!mayTypeFaces(pending.parkedFor, preferences.dicePolicy, preferences.member)) {
      return Response.json(
        {
          error:
            "This roll is thrown by the server: release it to roll, since typed dice count only for a player rolling real dice at a table that allows them.",
        },
        { status: 403 },
      );
    }
  }
  const allDigital = submitted.length > 0 && submitted.every((entry) => entry === "digital");

  // A pc_attack's damage roll carries the feats the hit spent on its dice
  // (attack-swing.ts spendDamageFeats). The player rolling real dice is told
  // the steps on the card; dice the server throws take them here, as its own
  // throw of the damage does (attack-blow.ts throwDamage). Thrown plain, a
  // released hold or "Roll digitally" lost Piercer, Savage Attacker, Brutal
  // Attack and Great Weapon Fighting the hit had already spent.
  const damageAsk = pending.kind === "damage" ? ((pending.attack as { damage?: DamageAsk } | null)?.damage ?? null) : null;
  let outcome: RollResult;
  try {
    if (isFallback || allDigital) {
      outcome = damageAsk
        ? throwDamage(damageAsk, pending.attack?.attacker ?? "", [])
        : rollExpression(pending.expression, undefined, { purpose: heroRollTag(pending.kind) });
    } else {
      // One entry per die (entryDice): a typed face is the one the player
      // kept, a "digital" one the server draws with the die's own rerolls.
      outcome = rollEnteredDice(
        pending.expression,
        submitted.map((entry) => (entry === "digital" ? null : entry)),
        { purpose: heroRollTag(pending.kind), ...(damageAsk?.rerollBelow ? { rerollBelow: damageAsk.rerollBelow } : {}) },
      );
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid dice values." },
      { status: 400 },
    );
  }

  // Something the character holds could still change this roll: its dice wait
  // on the player, the way the server's own throw does.
  // Only for the roller: whoever runs the story pressed fallback because the
  // player is away, and the roll must not go back to waiting on them.
  const options = isRoller ? optionsForPending(pending, outcome) : [];
  if (options.length) {
    const waiting = setPendingThrown(pendingRollId, {
      outcome,
      options,
      choosing: false,
      landing: {
        status: isFallback ? "fallback" : "submitted",
        physical: !isFallback && !anyDigital,
        source: isFallback || allDigital ? "digital" : "physical",
      },
      // The same clock as the server's own throw (after-roll-timer.ts).
      deadline: afterRollDeadline(campaignId, pending.userId),
    });
    if (!waiting) {
      return Response.json({ error: "That roll was already resolved." }, { status: 409 });
    }
    armAfterRollKeep(waiting.id, waiting.thrown?.deadline);
    publishPersisted(campaignId, "roll_pending", { pendingRoll: publicPendingRoll(waiting) });
    return Response.json({ pendingRoll: publicPendingRoll(waiting) });
  }

  const roll = landPendingRoll(context.campaign, pending, outcome, {
    status: isFallback ? "fallback" : "submitted",
    physical: !isFallback && !anyDigital,
    source: isFallback || allDigital ? "digital" : "physical",
  });
  if (!roll) {
    return Response.json({ error: "That roll was already resolved." }, { status: 409 });
  }
  return Response.json(landedBody(roll));
}
