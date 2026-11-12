// Empowered Healing (Divine Soul 6): "Spend 1 sorcery point to reroll healing
// dice for yourself or an ally, once per turn." The feature it condenses:
// whenever you or an ally within 5 feet of you rolls dice to determine the hit
// points a spell restores, you can spend 1 sorcery point to reroll any number
// of those dice once; once per turn. The row was narrated ("the GM rolls them
// again and spends the point"), with no record of the dice to roll again.
//
// A healing spell's dice are a trigger record now (last-save.ts, kind
// heal_roll, written by heal-spell.ts through noteHealingRoll while somebody
// at the table holds the feature): who rolled, who was healed, the roll's own
// row and the hit points they had before. Empowered Healing answers it as
// every trigger-shaped feature answers its record (trigger-table.ts: the roll
// of this turn, made by the sorcerer or a creature within 5 feet of them), so
// it is refused with nothing spent when no healing roll is open, and its card
// is dealt only while one is.
//
// Rulings. The spend names no dice, so the dice rolled again are the ones a
// player would pick: every die showing half its faces or less, or the lowest
// `amount` dice when the call gives a number. Each is rolled once and the new
// face stands, higher or lower ("the reroll must be used"): the healed
// creature gains or loses the difference, against the hit points it had
// before the spell and its maximum, and never below 1. With no die at half or
// less and no number given, nothing is worth rolling again and nothing is
// spent. Once per turn is kept on the fight's turn marks, since the turn is
// often an ally's.
//
// Out of a fight no turn keeps a record, so the healing roll is kept as the
// one calm record of its kind (last-save.ts recordCalmTrigger) until it is
// rolled again or another healing roll replaces it: one reroll a roll, as
// "once per turn" asks of a table that keeps no turns. The 5 feet are the
// GM's to judge with no board.
//
// Called by authored-spend-effects.ts resolveSpendEffect (kind reroll_heal).

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, turnKey } from "@/lib/db/encounters";
import { getRoll, type StoredRoll } from "@/lib/db/rolls";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import type { DiceTerm } from "@/lib/dice";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { canAct } from "@/lib/dm/can-act";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import { answerKey } from "@/lib/dm/last-hit";
import { answerSave, calmTrigger, openTriggers, recordCalmTrigger, recordTrigger } from "@/lib/dm/last-save";
import { openTriggersFor, triggerSpecOf } from "@/lib/dm/reaction-triggers";
import { regainHitPoints } from "@/lib/dm/regain";
import { rollOwnDice } from "@/lib/dm/character-roll";
import { toolError, type ToolError } from "@/lib/dm/tool-errors";
import { fightMarked, markFight } from "@/lib/dm/turn-marks";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature } from "@/lib/srd/feature-names";

export const EMPOWERED_HEALING = "Empowered Healing";

type Resolution = ToolError | { result: Record<string, unknown> };

// A healing spell's dice were just rolled (heal-spell.ts): kept as this
// turn's record while a character of the table could roll them again.
export function noteHealingRoll(campaign: Pick<Campaign, "id">, input: { roll: StoredRoll; caster: CharacterSheet; target: CharacterSheet; spell: string }) {
  if (!listSheets(campaign.id).some((sheet) => holdsFeature(sheet, EMPOWERED_HEALING))) {
    return;
  }
  const target = getSheetById(input.target.id) ?? input.target;
  const record = getActiveEncounter(campaign.id) ? recordTrigger : recordCalmTrigger;
  record(campaign.id, {
    kind: "heal_roll",
    characterId: target.id,
    forcer: { id: input.caster.id, name: input.caster.name },
    spell: input.spell,
    damage: { amount: Math.max(1, input.roll.total), type: "healing", spell: true },
    rollId: input.roll.id,
    hpBefore: target.currentHp,
  });
}

type Picked = { term: number; die: number; sides: number; value: number };

// The dice rolled again: the lowest `count` of the roll's kept dice, or with
// no count every die showing half its faces or less.
export function diceToReroll(terms: StoredRoll["breakdown"]["terms"], count: number | undefined): Picked[] {
  const all: Picked[] = terms.flatMap((term, at) =>
    term.kind === "dice" && term.sign === 1 ? term.dice.flatMap((die, index) => (die.kept ? [{ term: at, die: index, sides: die.sides, value: die.value }] : [])) : [],
  );
  if (count === undefined) {
    return all.filter((entry) => entry.value * 2 <= entry.sides);
  }
  // The lowest against what the die could show, so a 3 on a d8 goes before a 3 on a d4.
  return [...all].sort((a, b) => a.value / a.sides - b.value / b.sides).slice(0, Math.max(0, count));
}

// The roll this call answers: this turn's in a fight, as the trigger table
// reads it for the holder; out of one, the calm record of the last healing
// roll, by the holder or another creature (no board measures the 5 feet).
function healingRecord(ctx: SpendContext) {
  const { campaign, sheet, spend } = ctx;
  if (!getActiveEncounter(campaign.id)) {
    return calmTrigger(campaign.id, "heal_roll") ?? undefined;
  }
  const ask = { campaignId: campaign.id, reactor: sheet, name: spend.name, label: answerKey(textKey(spend.name), sheet.id) };
  const spec = triggerSpecOf(ask);
  const [event] = spec ? openTriggersFor(ask, spec).slice(-1) : [];
  return event ? openTriggers(campaign.id).find((entry) => entry.id === event.id) : undefined;
}

export function rerollHealing(ctx: SpendContext): Resolution {
  const { campaign, sheet, spend } = ctx;
  const encounter = getActiveEncounter(campaign.id);
  const record = healingRecord(ctx);
  const roll = record?.rollId ? getRoll(record.rollId) : null;
  const target = record ? getSheetById(record.characterId) : null;
  if (!record || !roll || !target) {
    return { error: `${spend.name} rolls again the healing dice of a spell just cast${encounter ? " this turn" : ""}, and the server has no such roll on record. Nothing was spent.`, refused: "rules" };
  }
  // "Provided you aren't incapacitated": asked as a reaction is, on anyone's
  // turn, though it spends none (the Hand's card asks the same).
  const able = canAct({ sheet, encounter, kind: "reaction" });
  if (!able.ok) {
    return { ...toolError(able), error: `${able.error} Nothing was spent.` };
  }
  const mark = `empowered-healing:${sheet.id}`;
  const stamp = encounter ? `${encounter.id}:${turnKey(encounter)}` : "";
  if (encounter && fightMarked(encounter.id, mark, stamp)) {
    return { error: `${spend.name} is used once a turn, and ${sheet.name} has used it this turn. Nothing was spent.`, refused: "rules" };
  }
  const asked = ctx.args.amount === undefined ? undefined : Math.floor(ctx.args.amount);
  const picked = diceToReroll(roll.breakdown.terms, asked);
  if (!picked.length) {
    return {
      error: `Every die of ${record.spell ?? "the spell"}'s healing on ${target.name} shows more than half its faces, so none is worth rolling again. To roll some again anyway, pass how many in amount (the lowest go first). Nothing was spent.`,
      retry: true,
    };
  }
  // One card for the new dice, grouped by size in the order they were picked.
  const sizes = [...new Set(picked.map((entry) => entry.sides))];
  const expression = sizes.map((sides) => `${picked.filter((entry) => entry.sides === sides).length}d${sides}`).join("+");
  // The sorcerer's own dice, as the feature is theirs (character-roll.ts
  // rollOwnDice): on physical dice their player rolls them again.
  const thrown = rollOwnDice(campaign, sheet, `${spend.name}: ${record.spell ?? "healing"} on ${target.name} (${expression})`, expression, { turn: ctx.turn });
  const fresh = thrown.terms.filter((term): term is DiceTerm => term.kind === "dice").flatMap((term) => term.dice.map((die) => die.value));
  const before = picked.reduce((sum, entry) => sum + entry.value, 0);
  const after = fresh.reduce((sum, value) => sum + value, 0);
  const healedBefore = record.damage?.amount ?? Math.max(1, roll.total);
  const healedNow = Math.max(1, roll.total - before + after);
  // What the new roll changes, against the hit points they had before the spell.
  const max = effectiveMaxHp(target);
  const from = record.hpBefore ?? Math.max(0, target.currentHp - healedBefore);
  const change = Math.min(max, from + healedNow) - Math.min(max, from + healedBefore);
  let moved = 0;
  if (change > 0) {
    moved = regainHitPoints(campaign, ctx.turnId || null, target, change, `${spend.name}: ${record.spell ?? "healing"} rolled again`);
  } else if (change < 0 && target.currentHp > 0) {
    const currentHp = Math.max(1, target.currentHp + change);
    moved = currentHp - target.currentHp;
    patchSheetAudited(campaign.id, target.id, { currentHp }, { kind: "heal", reason: `${spend.name}: ${record.spell ?? "healing"} rolled again, and the new roll stands`, delta: { amount: moved, newHp: currentHp } });
  }
  if (encounter) {
    markFight(encounter.id, mark, stamp);
  } else {
    // Out of a fight the roll is rolled again once (healingRecord).
    answerSave(campaign.id, record.id, answerKey(textKey(spend.name), sheet.id));
  }
  const now = getSheetById(target.id) ?? target;
  return {
    result: {
      target: target.name,
      rerolled: `${picked.length} of ${record.spell ?? "the spell"}'s healing dice (${picked.map((entry) => entry.value).join(", ")}) rolled again: ${fresh.join(", ")}`,
      healing: `${healedBefore} became ${healedNow}`,
      hp: `${now.currentHp}/${max}`,
      applied: `${sheet.name} rolls ${picked.length === 1 ? "a healing die" : "healing dice"} again, and the new roll stands: ${target.name} ${moved > 0 ? `regains ${moved} more` : moved < 0 ? `keeps ${-moved} fewer` : "stays where they are"} (${now.currentHp}/${max}).`,
    },
  };
}
