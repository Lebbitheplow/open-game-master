// A check a character makes inside another tool: the Stealth of a Hide, the
// Athletics of a grapple or a shove, the side of a contest the server rolls
// for them. It is built by the same resolver a requested check is
// (src/lib/dm/rolls.ts), so everything that rides a check rides this one
// too: Reliable Talent's floor, Halfling Lucky's reroll, a held Bardic
// Inspiration die (spent by the roll), Guidance, the lasting effects on
// checks, conditions, exhaustion, armor, and the items that ride checks.
// The roll is stored and published like any other.

import { rollCard } from "@/lib/dm/roll-card";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertRoll } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { heldDieWaits, rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import { rollCharacterD20 } from "@/lib/dm/character-roll";
import { resolveRollExpression, type RollArgs } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { noteShift, takeShift } from "@/lib/dm/chronal-shift";
import type { RollTag } from "@/lib/dice-script-logic";

type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

export type CharacterCheck = {
  total: number;
  expression: string;
  notes: string[];
  rollId: string | null;
  // Set when a condition decided the check with no die rolled; the total is
  // then the lowest a check can be.
  autoFailed?: boolean;
};

// `charmedTarget`: the creature the check is aimed at, when this character
// charmed it (rolls.ts: advantage on a Charisma check with it).
type CheckAsked = { skill?: string; ability?: Ability; advantage?: "advantage" | "disadvantage"; dc?: number; charmedTarget?: string };

// The check as the resolver builds it, before any die is rolled.
// `keepHeldDie`: a held die is settled after the d20 (forced-save.ts
// heldDieWaits) rather than baked in.
function resolveCheck(campaign: Campaign, sheet: CharacterSheet, check: CheckAsked, keepHeldDie = false) {
  const args = (
    check.skill
      ? { kind: "skill_check", skill: check.skill }
      : { kind: "ability_check", ability: check.ability ?? "str" }
  ) as RollArgs;
  const resolved = resolveRollExpression(
    { ...args, ...(check.advantage ? { advantage: check.advantage } : {}) },
    sheet,
    { ...rollExtrasFor(campaign, sheet, args.kind), ...(check.charmedTarget ? { charmedTarget: check.charmedTarget } : {}), keepHeldDie },
  );
  return resolved;
}

// The most the check can total, every die at its highest. Nothing is
// rolled or spent: an improvised attempt whose DC is past it is impossible
// for the character (src/lib/dm/improvise.ts). The skill is a validated id,
// and with no sense named (`by`) no condition fails a check unrolled.
export function checkCeiling(campaign: Campaign, stale: CharacterSheet, check: CheckAsked): number {
  const resolved = resolveCheck(campaign, getSheetById(stale.id) ?? stale, check);
  if ("error" in resolved || "autoFail" in resolved) {
    throw new Error(`checkCeiling: ${"error" in resolved ? resolved.error : resolved.notes.join("; ")}`);
  }
  return rollExpression(resolved.expression, (sides) => sides).total;
}

export function rollCharacterCheck(
  campaign: Campaign,
  stale: CharacterSheet,
  check: CheckAsked,
  detail: string,
): CharacterCheck {
  const sheet = getSheetById(stale.id) ?? stale;
  const waits = heldDieWaits(sheet, check.dc);
  const resolved = resolveCheck(campaign, sheet, check, waits);
  if ("error" in resolved) {
    // An unknown skill: fall back to the plain ability, never to nothing.
    const outcome = rollCard(campaign, null, sheet.id, check.skill ? "skill_check" : "ability_check", `${detail}: ${check.skill ?? check.ability ?? "check"}`, d20Expression(0, check.advantage ?? "none"), null);
    return { total: outcome.total, expression: "1d20", notes: [resolved.error], rollId: null };
  }
  if ("autoFail" in resolved) {
    return { total: 1, expression: "", notes: resolved.notes, rollId: null, autoFailed: true };
  }
  spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
  const kind = check.skill ? "skill_check" : "ability_check";
  // The player's own d20 (src/lib/dm/character-roll.ts): on physical dice
  // they roll it, and a roll that falls short waits on what they hold.
  const outcome = rollCharacterD20(campaign, sheet, {
    kind,
    expression: resolved.expression,
    detail: `${detail}: ${resolved.detail}`.slice(0, 120),
    dc: check.dc ?? null,
    ...(check.advantage ? { advantage: check.advantage } : {}),
    settleHeldDie: waits,
  });
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind,
    detail: `${detail}: ${resolved.detail}`.slice(0, 120),
    ...(check.dc ? { dc: check.dc } : {}),
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll,
    source: "digital",
  });
  return {
    total: outcome.total,
    expression: resolved.expression,
    notes: resolved.conditionNotes ?? [],
    rollId: roll.id,
  };
}

// A contest once both sides have landed (SRD 5.1, Contests): a Chronal Shift
// a watch stop armed for one side is asked now, when whether that side won is
// known ("you make this decision after you see whether the roll succeeds or
// fails"), and that side is rolled again; the new roll stands. A side has no
// DC of its own to be judged by as it lands (character-roll.ts).
type ContestSide = { tag: RollTag; total: number; again: () => number };
export function contestShift(campaignId: string, mine: ContestSide, theirs: ContestSide, mineWins: (mine: number, theirs: number) => boolean): { mine: number; theirs: number } {
  const won = mineWins(mine.total, theirs.total);
  const side = takeShift(campaignId, mine.tag, won) ? "mine" : takeShift(campaignId, theirs.tag, !won) ? "theirs" : null;
  if (!side) {
    return { mine: mine.total, theirs: theirs.total };
  }
  const rolled = side === "mine" ? mine : theirs;
  const total = rolled.again();
  noteShift(campaignId, `Chronal Shift: ${[rolled.tag.who ?? []].flat()[0] ?? "the creature"} rolled its side of the contest again, ${rolled.total} became ${total}, and the new roll stands.`);
  return side === "mine" ? { mine: total, theirs: theirs.total } : { mine: mine.total, theirs: total };
}

// A saving throw a feature makes the character roll outside any tool that
// holds a DM turn (Relentless Rage inside the damage path, Indomitable's
// reroll): the same resolver and the same record as a forced save.
export function rollFeatureSave(
  campaign: Campaign,
  stale: CharacterSheet,
  ability: Ability,
  dc: number,
  detail: string,
  against?: string,
): { success: boolean; total: number | null; notes: string[] } {
  const sheet = getSheetById(stale.id) ?? stale;
  const args = {
    kind: "saving_throw",
    ability,
    dc,
    ...(against ? { against } : {}),
  } as RollArgs;
  const waits = heldDieWaits(sheet, dc);
  const resolved = resolveRollExpression(args, sheet, { ...rollExtrasFor(campaign, sheet, "saving_throw"), keepHeldDie: waits });
  if ("error" in resolved) {
    return { success: false, total: null, notes: [resolved.error] };
  }
  if ("autoFail" in resolved) {
    return { success: false, total: null, notes: resolved.notes };
  }
  spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
  const said = `${sheet.name}: ${ability.toUpperCase()} save, ${detail}`.slice(0, 120);
  const outcome = rollCharacterD20(campaign, sheet, { kind: "saving_throw", expression: resolved.expression, detail: said, dc, settleHeldDie: waits });
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "saving_throw",
    detail: said,
    dc,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll,
    source: "digital",
  });
  return { success: outcome.total >= dc, total: outcome.total, notes: resolved.conditionNotes ?? [] };
}

// A character's initiative as request_roll would build it (src/lib/dm/rolls.ts):
// Alert, Feral Instinct's advantage, exhaustion, a halfling's Lucky, lasting
// effects on initiative. For the rolls a tool makes itself (a late arrival, a
// recruited companion). A held die it spends is spent here.
export function characterInitiativeExpression(campaign: Campaign, sheet: CharacterSheet, fallbackModifier: number): string {
  const resolved = resolveRollExpression({ kind: "initiative" } as RollArgs, sheet, rollExtrasFor(campaign, sheet, "initiative"));
  if ("error" in resolved || "autoFail" in resolved) {
    return d20Expression(fallbackModifier);
  }
  spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
  return resolved.expression;
}
