// request_roll, for both callers of the engine.
//
// The AI's turn loop (turn.ts) used to carry its own copy of this, and the
// two drifted: the copy skipped the table's strictness and rolled for the
// dead. There is one now. The model's call differs in three things only:
// a parked roll remembers the tool call it answers, so the model can be
// resumed with the result, the refusals are worded for a model, and a field
// it leaves unnamed that the character's traits would read is asked for.
// Everything else is shared: the expression comes from the sheet, conditions
// can decide the roll outright, a held die waits for its holder to spend it
// after the dice land (src/lib/dm/after-roll.ts) whether they are physical or
// digital, an initiative roll feeds the encounter, and a damage roll aimed at
// an enemy applies itself.
import { afterRollOptions, canWaitOnRoll } from "@/lib/dm/after-roll-logic";
import { allyChoicesFor, reactionFreeFor, rollsCanWait } from "@/lib/dm/after-roll";
import { noteShift, takeShift } from "@/lib/dm/chronal-shift";
import { LUCK_SPEND } from "@/lib/dm/roll-riders";
import { foretoldLeft } from "@/lib/dm/foretold-logic";
import { claimedAdvantage } from "@/lib/dm/pc-attack-options";
import { askedFields, unnamedTraitFields } from "@/lib/dm/roll-feature-riders";
import { rollExpression } from "@/lib/dice";
import { heroRollTag } from "@/lib/dice-script-logic";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getFoe } from "@/lib/dm/sheet-foe";
import { charmedBy } from "@/lib/dm/enemy-profile";
import { insertRoll } from "@/lib/db/rolls";
import { createPendingRoll, listOpenPendingRolls, publicPendingRoll, setPendingCombatNote, type DmTurn } from "@/lib/db/dm-turns";
import { getSheetById } from "@/lib/db/sheets";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { allocateSeq } from "@/lib/db/campaigns";
import { rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import { redactRoll } from "@/lib/dm/viewer";
import { autoApplyDamageRoll } from "@/lib/dm/enemy-damage";
import { heldInitiative, recordInitiativeRoll } from "@/lib/dm/encounter-tools";
import { applyInitiativeRefills } from "@/lib/dm/feature-hooks";
import {
  resolveRollExpression,
  resolveSheetRef,
  rollArgsSchema,
  rollDcFor,
  type RollArgs,
} from "@/lib/dm/rolls";
import { strictnessShift } from "@/lib/dm/safety-logic";
import type { Campaign } from "@/lib/db/campaigns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { moteAfterRoll, moteOf } from "@/lib/dm/authored-mote";
import { applyRollGates } from "@/lib/dm/roll-gates";
import { afterRollDeadline, armAfterRollKeep } from "@/lib/dm/after-roll-timer";
import { badArguments, invalidArguments, toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { swayUnasked } from "@/lib/dm/player-word";
import { swaySkill } from "@/lib/dm/player-word-logic";

export function handleRequestRoll(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  // Players who roll real dice at the table: their rolls park for them to
  // enter instead of being rolled by the server.
  realDiceUserIds: Set<string>,
  // Set by the AI's turn loop: the tool call a parked roll answers.
  model?: { toolCallId: string | null },
): ToolResult {
  const campaignId = campaign.id;
  const needs = model
    ? "Invalid request_roll arguments. Send JSON with kind, and skill/ability/dc or expression as documented."
    : "Pick a roll kind, and a skill, ability or DC to go with it.";
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments || "{}");
  } catch (error) {
    return badArguments(needs, error, rawArguments);
  }
  const parsed = rollArgsSchema.safeParse(raw);
  if (!parsed.success) {
    // Each field zod refused, with its reason, at the console as for the
    // model: the fixed line answered a valid call with one null optional in
    // it, and named no field (#875, gap sweep 2026-11-09).
    return invalidArguments(needs, parsed.error, raw);
  }
  let args: RollArgs = parsed.data;
  args = {
    ...args,
    dc: rollDcFor(args, raw, strictnessShift(campaign.gameSettings.gm?.strictness ?? "standard")),
  };

  // The AI's advantage stands only on a circumstance the server cannot see
  // (the same rule as pc_attack's); the DM console rules freely.
  if (turn.actor === "ai" && args.advantage && args.advantage !== "none") {
    const claim = claimedAdvantage({ requested: args.advantage, source: args.advantageSource, reason: args.advantageReason, byAi: true });
    args = { ...args, advantage: claim.requested };
  }
  const sheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  // The dead roll nothing: not a check, not a save, not initiative.
  if (sheet) {
    const fresh = getSheetById(sheet.id) ?? sheet;
    if (fresh.deathSaves?.dead) {
      return {
        error: `${fresh.name} is dead and makes no rolls. Only magic that raises the dead brings them back.`,
        refused: "rules",
      };
    }
  }
  // A roll to sway someone answers an attempt, and a player who only asked
  // a question made none (src/lib/dm/player-word.ts swayUnasked).
  if (sheet && args.kind === "skill_check" && swaySkill(args.skill)) {
    const unasked = swayUnasked(campaignId, turn, sheet);
    if (unasked) {
      return unasked;
    }
  }
  // No stealth on a normal or fast march, and a contest rolls the
  // creature's own check for the DC (src/lib/dm/roll-gates.ts).
  const gated = applyRollGates(campaign, turn, args, sheet ? (getSheetById(sheet.id) ?? sheet) : null);
  if ("error" in gated) {
    return toolError(gated);
  }
  args = gated.args;
  // In combat a character's attack belongs to the attack engine, which
  // adjudicates against the enemy's AC and applies the damage itself.
  if (args.kind === "attack" && sheet && getActiveEncounter(campaignId)) {
    return {
      error: model
        ? "Character attacks in combat go through pc_attack: call it with characterId, targetEnemyId, and the weapon (or an attack-roll spell by name). The server rolls to-hit from their sheet, adjudicates against the enemy's AC, and applies damage itself."
        : "Use Player attacks for a swing in combat: it rolls to hit from their sheet, compares it to the enemy's AC and applies the damage.",
      retry: true,
    };
  }
  // Out of a fight there is no one on the board to swing at: the AI's attack
  // roll with no fight running rolled a bare d20 that hit nobody, and
  // gpt-oss-20b and Qwen3.6-35B, each rolling one after the last goblin fell,
  // narrated a hit on a goblin already dead. A person at the console rolls
  // what they rule.
  if (args.kind === "attack" && sheet && model && !getActiveEncounter(campaignId)) {
    return {
      error: "No fight is running, so there is nobody to attack: every enemy of the last fight is down or gone. If the character attacks someone who stands, start the fight with start_encounter and resolve the swing with pc_attack; otherwise narrate what they do instead.",
      refused: "rules",
    };
  }
  // The same holds for the damage: a party character's damage on an enemy
  // with no attack roll behind it would skip the hit, the action and the
  // turn. Damage aimed at an enemy from nobody's sheet (an NPC ally the
  // story never recruited) still lands.
  if (args.kind === "damage" && args.targetEnemyId && sheet && getActiveEncounter(campaignId)) {
    return {
      error: model
        ? `${sheet.name}'s damage on an enemy comes from pc_attack (or the spell tools), which roll the hit first and apply the damage themselves; request_roll does not apply a party character's damage to an enemy.`
        : `${sheet.name}'s damage on an enemy comes from Player attacks or a cast form, which roll the hit first; a bare damage roll does not land on an enemy.`,
      retry: true,
    };
  }

  // An initiative roll for a character the fight already ordered rolls
  // nothing (src/lib/dm/encounter-tools.ts heldInitiative): it would change
  // no count and only throw dice in front of the table.
  if (args.kind === "initiative" && sheet) {
    const held = heldInitiative(campaignId, sheet.id);
    if (held) {
      return { error: held, refused: "rules" };
    }
    // Nor does one for a character whose initiative card is already with
    // their player in this fight: the AI's fight asks its real-dice seats
    // itself (src/lib/dm/initiative-ask.ts), and a model that also asked
    // put a second card for the same roll in front of them.
    const fight = getActiveEncounter(campaignId);
    const carded = fight
      ? listOpenPendingRolls(campaignId).some(
          (pending) => pending.kind === "initiative" && pending.characterId === sheet.id && pending.createdAt >= fight.createdAt,
        )
      : false;
    if (carded) {
      return {
        error: model
          ? `${sheet.name}'s initiative roll card is already with their player, so nothing was rolled. The order locks once every initiative is in.`
          : `${sheet.name} already has an initiative roll to make. The order locks once every initiative is in.`,
        refused: "rules",
      };
    }
  }

  // A check aimed at a creature the roller charmed (SRD 5.1, Charmed): an
  // enemy row, or a character fighting on the other side (sheet-foe.ts).
  const aimedAt = sheet && args.againstEnemyId ? getFoe(args.againstEnemyId.trim()) : null;
  const charmedTarget = sheet && aimedAt && charmedBy(aimedAt.conditions, aimedAt.conditionMeta, sheet.id) ? aimedAt.displayName : undefined;
  // A check or a save in the open can wait on its player once its dice land
  // (src/lib/dm/after-roll.ts): a roll behind the screen cannot.
  const fresh = sheet ? (getSheetById(sheet.id) ?? sheet) : null;
  const canWait = (Boolean(model) || (args.visibility ?? "public") === "public") && canWaitOnRoll(args.kind) && rollsCanWait(fresh);
  const extras = sheet
    ? { ...rollExtrasFor(campaign, sheet, args.kind), ...(charmedTarget ? { charmedTarget } : {}), keepHeldDie: canWait }
    : { encumbrance: campaign.gameSettings.variantRules.encumbrance };
  // A trait of the character's that a field the model left unnamed would
  // call on (src/lib/dm/roll-about.ts): it names the field, or 'none', before
  // anything is rolled, so the trait is never lost to an omission.
  if (turn.actor === "ai" && sheet) {
    const asked = unnamedTraitFields(sheet, args);
    if (asked.length) {
      return {
        error: `${sheet.name} holds a trait this roll can call on. Name ${askedFields(asked)}, as the fiction is, and send the roll again. Nothing was rolled.`,
        retry: true,
      };
    }
  }
  const resolved = resolveRollExpression(args, sheet, extras);
  if ("error" in resolved) {
    return toolError(resolved);
  }
  if ("autoFail" in resolved) {
    return {
      ok: true,
      success: false,
      autoFailed: true,
      note: `${sheet?.name ?? "The character"} automatically fails: ${resolved.notes.join("; ")}.${
        model ? " No dice are rolled; narrate the failure." : ""
      }`,
    };
  }

  // The inspiration die and a held Help are already baked into the
  // expression, so they are spent either way.
  // A Creation bard's mote rides the die being spent (authored-mote.ts).
  const mote = sheet ? moteOf(sheet, resolved.spendInspiration) : null;
  if (sheet) {
    spendRollCarriers(campaignId, sheet.id, resolved.spendInspiration);
  }

  const contestLine = gated.contest ? `${gated.contest.name} rolled ${gated.contest.skill} ${gated.contest.total}; ${gated.contest.answering ? "a tie goes to the character" : "the character must beat it"}.` : null;
  // Portent replaces the d20 before it is thrown, so a wizard holding a number
  // decides here: the roll waits unthrown, and the model waits with it.
  // Not on initiative: the watch leaves it be (a ruling the maintainer has
  // still to make), and so does a wizard's own card.
  const foretelling = canWait && fresh && args.kind !== "initiative" ? foretoldLeft(fresh).length > 0 : false;
  if (sheet && (foretelling || realDiceUserIds.has(sheet.userId))) {
    const pending = createPendingRoll({
      campaignId,
      turnId: turn.id,
      toolCallId: model?.toolCallId ?? null,
      userId: sheet.userId,
      characterId: sheet.id,
      kind: args.kind,
      detail: resolved.detail,
      expression: resolved.expression,
      advantage: args.advantage ?? "none",
      dc: args.dc ?? null,
      reason: args.reason?.slice(0, 200) ?? "",
      targetEnemyId: args.kind === "damage" ? args.targetEnemyId ?? null : null,
      // The mote the spent inspiration die carried, set off as the roll lands.
      ...(mote ? { carry: { mote } } : {}),
      // The screen holds while the player's dice are on their way.
      visibility: model ? "public" : args.visibility ?? "public",
      ...(realDiceUserIds.has(sheet.userId) ? {} : { parkedFor: "foretold" as const }),
    });
    if (foretelling) {
      const told = [contestLine, ...(resolved.conditionNotes ?? [])].filter(Boolean).join("; ");
      if (told) {
        setPendingCombatNote(pending.id, told);
      }
    }
    publishPersisted(campaignId, "roll_pending", { pendingRoll: publicPendingRoll(pending) });
    return {
      ok: true,
      parked: true,
      note: foretelling ? `Waiting on ${sheet.name} to roll or to use Portent.` : `Waiting on ${sheet.name} to enter ${resolved.expression}.`,
    };
  }

  try {
    const purpose = sheet ? heroRollTag(args.kind, sheet.name) : undefined;
    let outcome = rollExpression(resolved.expression, undefined, { purpose });
    // A Chronal Shift a watching wizard set on this roll at the stop before
    // it (src/lib/dm/chronal-shift.ts): it goes the wrong way, and the d20s
    // are thrown again, the new roll standing.
    if (sheet && typeof args.dc === "number" && canWaitOnRoll(args.kind)) {
      const by = takeShift(campaignId, purpose, outcome.total >= args.dc);
      if (by) {
        const first = outcome.total;
        outcome = rollExpression(resolved.expression, undefined, { purpose });
        noteShift(campaignId, `${by} used Chronal Shift: ${sheet.name} rolled the ${args.kind.replaceAll("_", " ")} again (${first} became ${outcome.total}), and the new roll stands.`);
      }
    }
    // The server threw it: the dice wait on the player when something they
    // hold could change the result, or a wizard beside them could make them
    // roll it again, and the model waits with them.
    const options = canWait && sheet && fresh
      // A luck point spent before the throw (luck: true) was this roll's one.
      ? [
          ...afterRollOptions(fresh, { kind: args.kind, outcome, dc: args.dc ?? null, spent: resolved.spendInspiration?.split("|").includes(LUCK_SPEND) ? ["lucky"] : [], reactionFree: reactionFreeFor(campaignId, fresh.id) }),
          ...allyChoicesFor(campaignId, fresh, { kind: args.kind, outcome, dc: args.dc ?? null }),
        ]
      : [];
    if (sheet && options.length) {
      const pending = createPendingRoll({
        campaignId,
        turnId: turn.id,
        toolCallId: model?.toolCallId ?? null,
        userId: sheet.userId,
        characterId: sheet.id,
        kind: args.kind,
        detail: resolved.detail,
        expression: resolved.expression,
        advantage: args.advantage ?? "none",
        dc: args.dc ?? null,
        reason: args.reason?.slice(0, 200) ?? "",
        parkedFor: "after_roll",
        thrown: { outcome, options, choosing: false, landing: { status: "fallback", physical: false, source: "digital" }, deadline: afterRollDeadline(campaignId, sheet.userId) },
      });
      // What the digital answer would have told the model, for the answer the
      // resumed turn writes.
      const told = [contestLine, ...(resolved.conditionNotes ?? [])].filter(Boolean).join("; ");
      if (told) {
        setPendingCombatNote(pending.id, told);
      }
      publishPersisted(campaignId, "roll_pending", { pendingRoll: publicPendingRoll(pending) });
      armAfterRollKeep(pending.id, pending.thrown?.deadline);
      return {
        ok: true,
        parked: true,
        note: `Waiting on ${sheet.name} to decide what to do with their roll.`,
      };
    }
    const roll = insertRoll({
      campaignId,
      characterId: sheet?.id ?? null,
      requestedBy: "dm",
      kind: args.kind,
      detail: resolved.detail,
      advantage: args.advantage ?? "none",
      dc: args.dc ?? null,
      result: outcome,
      // Free text about the sheet's own roll: its owner reads as the roller.
      attacker: null,
      // A screen is a person's tool; the model's rolls are the table's.
      visibility: model ? "public" : args.visibility ?? "public",
    });
    turn.rollIds.push(roll.id);
    // The stream is shared, so it carries what a PLAYER may see. Whoever is
    // allowed the number re-fetches it from GET /rolls, exactly as the DM
    // re-fetches their own enemy numbers.
    publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", {
      roll: roll.visibility === "public" ? roll : redactRoll(roll),
      source: "digital",
    });
    const combatNote =
      args.kind === "initiative"
        ? recordInitiativeRoll(campaignId, sheet?.id ?? null, roll.total)
        : null;
    // Superior Inspiration, Perfect Self: a use back on rolling initiative.
    const refilled = args.kind === "initiative" && sheet ? applyInitiativeRefills(campaign, sheet.id) : [];
    const moteLine = sheet ? moteAfterRoll(campaign, sheet, mote, args.kind, outcome) : null;
    const applied =
      args.kind === "damage" && args.targetEnemyId
        ? autoApplyDamageRoll(
            campaign,
            turn,
            args.targetEnemyId,
            roll,
            sheets,
            sheetsById,
            args.damageType,
          )
        : null;
    return {
      ok: true,
      total: roll.total,
      dice: outcome.terms,
      ...(args.dc !== undefined ? { dc: args.dc, success: roll.total >= args.dc } : {}),
      ...(contestLine ? { contest: contestLine } : {}),
      ...(outcome.crit ? { crit: outcome.crit } : {}),
      ...(resolved.conditionNotes ? { conditionEffects: resolved.conditionNotes } : {}),
      ...(combatNote ? { combat: combatNote } : {}),
      ...(refilled.length ? { refilled } : {}),
      ...(moteLine ? { mote: moteLine } : {}),
      ...(applied ? { applied } : {}),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid dice expression.", retry: true };
  }
}
