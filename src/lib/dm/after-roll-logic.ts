// What a player may still do with a d20 they have seen, before the game says
// what it did. The Lucky feat, a held Bardic Inspiration die and Dark One's Own
// Luck are decided after the die lands and before the outcome. Rolled up front,
// a Bardic Inspiration die was spent on a natural 20 and a luck point was spent
// blind. This covers the checks and saves request_roll throws; the rolls that
// cannot wait add a held die only where it carries the roll
// (src/lib/dm/forced-save.ts settleHeldDie).
//
// A pause costs the whole table its narration, so it is only offered when an
// ability can change the result: never on a roll that already succeeds, and
// never for a die too small to reach. A roll with no known target (a check
// with no Difficulty Class) cannot be judged, so it asks.
//
// Pure: the sheet and the thrown roll in, the options or the new roll out. The
// spending is src/lib/dm/after-roll.ts.

import type { DiceTerm, DieResult, RollResult } from "@/lib/dice";
import { luckPointsLeft } from "@/lib/srd/class-resources";
import { holdsFeature } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type AfterRollId = "lucky" | "bardic" | "own_luck";

export type AfterRollOption = {
  id: AfterRollId;
  label: string;
  // What choosing it does, in plain words, for the button's tooltip.
  note: string;
};

export const DARK_ONES_OWN_LUCK = "dark_ones_own_luck";
const OWN_LUCK_DIE = "d10";

// A roll that waits on the player's choice, once its dice are known.
export type ThrownRoll = {
  outcome: RollResult;
  options: AfterRollOption[];
  // What this roll has already taken: each of them rides a roll once, a luck
  // point too (with no DC the card would ask again after every pick).
  spent?: AfterRollId[];
  // A luck point's extra d20 has landed: the player picks the die to keep.
  choosing: boolean;
  // How the roll is recorded when it lands, from who threw its dice.
  landing: { status: "submitted" | "fallback"; physical: boolean; source: "digital" | "physical" };
};

// The rolls that can wait: an ability check or a saving throw. Initiative
// locks the order and a death save is thrown by its own engine.
export function canWaitOnRoll(kind: string): boolean {
  return kind === "saving_throw" || kind === "skill_check" || kind === "ability_check";
}

const HELD_DIE = /^(bardic inspiration|dark one's own luck) \((d\d{1,2})\)$/i;

function heldDie(sheet: Pick<CharacterSheet, "conditions">, name: "bardic inspiration" | "dark one's own luck") {
  for (const condition of sheet.conditions ?? []) {
    const match = HELD_DIE.exec(condition.trim());
    if (match && textKey(match[1]) === textKey(name)) {
      return { condition, die: textKey(match[2]) };
    }
  }
  return null;
}

export const heldBardicDie = (sheet: Pick<CharacterSheet, "conditions">) => heldDie(sheet, "bardic inspiration");
export const heldOwnLuckDie = (sheet: Pick<CharacterSheet, "conditions">) => heldDie(sheet, "dark one's own luck");

// A Creation bard's mote bursts when its die is spent on a roll the server
// throws at once (src/lib/dm/authored-mote.ts): a character holding one rolls
// as they always did, so the mote is not lost in the wait.
export function holdsMoteDie(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">): boolean {
  const meta = (sheet.conditionMeta ?? {}) as Record<string, { mote?: boolean } | undefined>;
  return (sheet.conditions ?? []).some((condition) => HELD_DIE.test(condition.trim()) && meta[condition]?.mote === true);
}

function usesLeft(sheet: Pick<CharacterSheet, "resources">, id: string): number {
  const state = sheet.resources?.[id];
  return state ? Math.max(0, state.max - state.used) : 0;
}

export function sidesOf(die: string): number {
  return Number(die.slice(1));
}

function leadD20(outcome: RollResult): DiceTerm | null {
  const lead = outcome.terms[0];
  return lead && lead.kind === "dice" && lead.sides === 20 && lead.sign === 1 ? lead : null;
}

// A luck point the character can spend. Only the feat holds them: a
// halfling's Lucky trait gets no counter (src/lib/srd/class-resources.ts
// featOnly).
export function holdsLuckPoint(sheet: CharacterSheet): boolean {
  return luckPointsLeft(sheet.resources) > 0;
}

// The die the warlock would add: one already called up and held on them
// (use_resource), else the feature's own use.
export function ownLuckDie(sheet: CharacterSheet): string | null {
  const held = heldOwnLuckDie(sheet);
  if (held) return held.die;
  return holdsFeature(sheet, "dark one's own luck") && usesLeft(sheet, DARK_ONES_OWN_LUCK) > 0 ? OWN_LUCK_DIE : null;
}

export function afterRollOptions(
  sheet: CharacterSheet,
  roll: { kind: string; outcome: RollResult; dc: number | null; spent?: readonly AfterRollId[] },
): AfterRollOption[] {
  const { outcome, dc } = roll;
  if (!canWaitOnRoll(roll.kind) || !leadD20(outcome) || (dc !== null && outcome.total >= dc)) {
    return [];
  }
  // Whether a bonus of up to `most` could carry the roll over its target.
  const reaches = (most: number) => dc === null || outcome.total + most >= dc;
  const taken = new Set(roll.spent ?? []);
  const options: AfterRollOption[] = [];
  // A fresh d20 can land at best a 20.
  if (holdsLuckPoint(sheet) && !taken.has("lucky") && (outcome.natural === undefined || reaches(20 - outcome.natural))) {
    options.push({ id: "lucky", label: "Lucky: roll another d20", note: "Spend a luck point: roll another d20, then choose which die counts." });
  }
  const bardic = heldBardicDie(sheet);
  if (bardic && !taken.has("bardic") && reaches(sidesOf(bardic.die))) {
    options.push({ id: "bardic", label: `Add Bardic Inspiration (${bardic.die})`, note: `Spend your Bardic Inspiration die: add 1${bardic.die} to this roll.` });
  }
  const own = ownLuckDie(sheet);
  if (own && !taken.has("own_luck") && reaches(sidesOf(own))) {
    options.push({ id: "own_luck", label: `Add Dark One's Own Luck (${own})`, note: `Add 1${own} to this check or save.` });
  }
  return options;
}

// A luck point spent before the throw (request_roll luck: true) put one d20
// more in the pool than the advantage asks for: that was the roll's one.
export function luckRodeThrow(expression: string, advantage: string): boolean {
  const match = /^(\d+)d20/.exec(expression.replace(/\s+/g, ""));
  return match ? Number(match[1]) > (advantage === "none" ? 1 : 2) : false;
}

// The roll with a bonus die added, the way the dice engine would have written
// it had the die ridden the roll from the start.
export function withBonusDie(outcome: RollResult, die: DieResult): RollResult {
  const term: DiceTerm = { kind: "dice", sign: 1, count: 1, sides: die.sides, dice: [die], subtotal: die.value };
  return { ...outcome, expression: `${outcome.expression}+1d${die.sides}`, total: outcome.total + die.value, terms: [...outcome.terms, term] };
}

// The lead term's reroll and floor suffix ("r1" for a halfling, "f10" for
// Reliable Talent), so the extra d20 obeys what the others obeyed.
export function extraD20Expression(expression: string): string {
  const match = /^\d+d20(?:k[hl]\d+)?((?:r\d+)?(?:f\d+)?)/.exec(expression.replace(/\s+/g, ""));
  return `1d20${match?.[1] ?? ""}`;
}

// Keep one of the lead term's d20s: any of them, whatever the advantage (the
// feat lets the character choose which die is used).
export function keepD20(outcome: RollResult, index: number): RollResult | null {
  const lead = leadD20(outcome);
  if (!lead || !Number.isInteger(index) || index < 0 || index >= lead.dice.length) {
    return null;
  }
  const dice = lead.dice.map((die, at) => ({ ...die, kept: at === index }));
  const natural = dice[index].value;
  const rest = { ...outcome };
  delete rest.crit;
  return {
    ...rest,
    total: outcome.total - lead.subtotal + natural,
    terms: [{ ...lead, dice, subtotal: natural }, ...outcome.terms.slice(1)],
    natural,
    ...(natural === 20 ? { crit: "nat20" as const } : natural === 1 ? { crit: "nat1" as const } : {}),
  };
}

// The extra d20 in the pool, the best kept until the player says otherwise.
export function withExtraD20(outcome: RollResult, die: DieResult): RollResult | null {
  const lead = leadD20(outcome);
  if (!lead) return null;
  const dice = [...lead.dice, { ...die, kept: false }];
  const pooled: RollResult = { ...outcome, terms: [{ ...lead, count: dice.length, dice }, ...outcome.terms.slice(1)] };
  const best = dice.reduce((top, entry, at) => (entry.value > dice[top].value ? at : top), 0);
  return keepD20(pooled, best);
}
