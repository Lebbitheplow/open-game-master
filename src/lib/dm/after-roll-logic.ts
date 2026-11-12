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
// Every choice is a row of src/lib/dm/after-roll-table.ts: what it costs,
// which rolls and whose it answers, what it does and when. This reads the
// rows against a sheet and a thrown roll.
//
// Pure: the sheet and the thrown roll in, the options or the new roll out. The
// spending is src/lib/dm/after-roll.ts.

import type { DiceTerm, DieResult, RollResult } from "@/lib/dice";
import { luckPointsLeft } from "@/lib/srd/class-resources";
import { holdsFeature, isNamed } from "@/lib/srd/feature-names";
import { channelOptions } from "@/lib/dm/option-costs";
import { classLevelOf } from "@/lib/srd/trait-rules";
import { textKey } from "@/lib/language/text-logic";
import { holdsDestructiveWrath } from "@/lib/dm/destructive-wrath-logic";
import {
  AFTER_ROLL_CHANNEL_OPTIONS,
  AFTER_ROLL_ROWS,
  afterRollRow,
  amountWords,
  answers,
  fillWords,
  mostAdded,
  ownsItself,
  type AfterRollId,
  type AfterRollRow,
} from "@/lib/dm/after-roll-table";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { mrAttackOffers, mrCheckOffers, type MrCheck, type MrSwing } from "@/lib/dm/mt-mr-offers-logic";
import { combatInspirationOption } from "@/lib/dm/ar-wbf-bard-dice-logic";

export type { AfterRollId } from "@/lib/dm/after-roll-table";
export { AFTER_ROLL_COUNTERS } from "@/lib/dm/after-roll-table";

export type AfterRollOption = {
  id: AfterRollId;
  label: string;
  // What choosing it does, in plain words, for the button's tooltip.
  note: string;
  // Another character's, offered on their player's screen: a Chronurgy
  // wizard's Chronal Shift on an ally's roll ("after you or a creature you
  // can see within 30 feet of you makes an attack roll, an ability check,
  // or a saving throw"), War God's Blessing, Flash of Genius, Violent
  // Attraction. Absent: the roller's own.
  by?: string;
};

export const DARK_ONES_OWN_LUCK = "dark_ones_own_luck";
export const CHRONAL_SHIFT = "sub_chronal_shift";
export const CHANNEL_DIVINITY = "channel_divinity";
export const MASTER_DUELIST = "sub_master_duelist";
export const FAVORED_BY_THE_GODS = "sub_favored_by_the_gods";
export const FLASH_OF_GENIUS = "art_flash_of_genius";
export const VIOLENT_ATTRACTION = "sub_violent_attraction";
export const GUIDED_STRIKE_BONUS = mostAdded(afterRollRow("guided_strike"));
export const WAR_GODS_BLESSING_BONUS = mostAdded(afterRollRow("war_gods_blessing"));

// The Channel Divinity options spent from this card and no other
// (after-roll-table.ts cardOnly): the Hand deals no card for them.
export const isAfterRollChannelOption = (name: string) => isNamed(name, ...AFTER_ROLL_CHANNEL_OPTIONS);

// How long a roll waits on its player before the dice are kept as they lie
// (src/lib/dm/after-roll-timer.ts); the card counts it down.
export const AFTER_ROLL_SECONDS = 20;

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
  // When the dice are kept as they lie if the player has not chosen
  // (src/lib/dm/after-roll-timer.ts). A roll parked before there was one has none.
  deadline?: string;
  // The characters who answered this roll from their own screen, and those
  // who let it stand: neither is offered anything more on it.
  shiftedBy?: string[];
  declined?: string[];
  // The roller kept the roll while a wizard could still answer it: the
  // roller is offered nothing more, and the roll waits on the wizard alone.
  kept?: boolean;
};

// The rolls that can wait: an ability check or a saving throw, initiative
// (a Dexterity check) among them. Death saves are saving throws, and wait
// through src/lib/dm/character-roll.ts. The 20 second clock keeps a table
// from waiting long on either ("After-the-roll holders are asked on
// initiative and death saves too": maintainer decision R4 of the
// 2026-11-09 gap sweep; they were left out before as the order locking and
// the death save's own engine).
export function canWaitOnRoll(kind: string): boolean {
  return kind === "saving_throw" || kind === "skill_check" || kind === "ability_check" || kind === "initiative";
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

// The bard whose Bardic Inspiration die the sheet holds (the condition's
// `source`, written as the die is given), for the record a roll it turns into
// a success leaves (last-save.ts recordInspiredSuccess). Null for a die given
// before the source was kept, or none held.
export function bardOfHeldDie(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">): string | null {
  const held = heldBardicDie(sheet);
  const meta = (sheet.conditionMeta ?? {}) as Record<string, { source?: unknown } | undefined>;
  const source = held ? meta[held.condition]?.source : null;
  return typeof source === "string" && source ? source : null;
}

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
  const row = afterRollRow("own_luck");
  return holdsFeature(sheet, row.feature) && usesLeft(sheet, DARK_ONES_OWN_LUCK) > 0 && row.amount?.kind === "held" ? (row.amount.fallback ?? null) : null;
}

// The die a held_die row adds: the condition the sheet holds, or (Dark One's
// Own Luck) the feature's own use.
function heldDieOf(sheet: CharacterSheet, row: AfterRollRow): string | null {
  if (row.amount?.kind !== "held") return null;
  return row.amount.condition === "bardic inspiration" ? (heldBardicDie(sheet)?.die ?? null) : ownLuckDie(sheet);
}

// Whether the sheet can pay for the row now: the feature and its cost.
// Destructive Wrath already held from the Hand takes the roll by itself
// (destructive-wrath.ts), so it is not offered again.
export function holdsRow(sheet: CharacterSheet, row: AfterRollRow): boolean {
  if (row.cost === "luck_point") return holdsLuckPoint(sheet);
  if (row.cost === "held_die") return heldDieOf(sheet, row) !== null;
  if (row.cost === "channel_divinity") {
    return usesLeft(sheet, CHANNEL_DIVINITY) > 0 && channelOptions(sheet).some((option) => isNamed(option.name, row.feature)) && !(row.id === "destructive_wrath" && holdsDestructiveWrath(sheet));
  }
  return usesLeft(sheet, row.counter ?? "") > 0 && holdsFeature(sheet, row.feature);
}

// What the row adds, in the card's words, for this holder.
function amountFor(sheet: CharacterSheet, row: AfterRollRow, modifier?: number): string {
  const amount = row.amount;
  if (!amount) return "";
  if (amount.kind === "flat") return String(amount.value);
  if (amount.kind === "dice") return `${amount.count}d${amount.sides}`;
  if (amount.kind === "ability") return String(modifier ?? 0);
  if (amount.kind === "held") return heldDieOf(sheet, row) ?? "";
  if (amount.kind === "level") return String(levelDamage(sheet, row));
  return "";
}

function levelDamage(sheet: CharacterSheet, row: AfterRollRow): number {
  return row.amount?.kind === "level" ? row.amount.base + row.amount.per * classLevelOf(sheet, row.amount.className) : 0;
}

// The most the row could add for this holder.
function mostFor(sheet: CharacterSheet, row: AfterRollRow, modifier?: number): number {
  return mostAdded(row, { held: heldDieOf(sheet, row), modifier });
}

// The roll a row reads: its kind, its dice, and the number it must reach.
type Target = { dc: number | null } | { ac: number; critRange: number };
type Reading = { kind: string; outcome: RollResult; target: Target; taken: ReadonlySet<string> };

// An attack that hits as it stands: a natural 1 misses whatever is added to
// it, a natural in the critical range hits.
export function attackHits(outcome: RollResult, ac: number, critRange: number): boolean {
  const natural = outcome.natural;
  return natural !== undefined && natural !== 1 && (natural >= critRange || outcome.total >= ac);
}

// Whether the row, once paid, could turn this roll that falls short. A
// fresh d20 can land at best a 20 on a check or save, and can always save a
// miss (a natural 20 hits); a number added cannot lift a natural 1 to a hit.
function carries(sheet: CharacterSheet, row: AfterRollRow, roll: Reading, modifier?: number): boolean {
  const { outcome, target } = roll;
  const natural = outcome.natural;
  if ("ac" in target) {
    if (row.effect === "extra_d20" || row.effect === "reroll" || row.effect === "reroll_edge") return true;
    return natural !== 1 && outcome.total + mostFor(sheet, row, modifier) >= target.ac;
  }
  const reaches = (most: number) => target.dc === null || outcome.total + most >= target.dc;
  if (row.effect === "extra_d20" || row.effect === "reroll") return natural === undefined || reaches(20 - natural);
  return reaches(mostFor(sheet, row, modifier));
}

// The option as the card shows it. `by`: the helper answering another's roll
// (their row's other words, when it has them); absent, the roller's own.
function optionOf(sheet: CharacterSheet, row: AfterRollRow, kind: string, input: { by?: string; rollerName?: string; modifier?: number } = {}): AfterRollOption {
  const words = { kind, amount: amountFor(sheet, row, input.modifier), name: input.rollerName };
  const other = input.by !== undefined && row.otherLabel !== undefined && row.otherNote !== undefined;
  return {
    id: row.id as AfterRollId,
    ...(input.by !== undefined ? { by: input.by } : {}),
    label: fillWords(other ? row.otherLabel! : row.label, words),
    note: fillWords(other ? row.otherNote! : row.note, words),
  };
}

// The roller's own choices on a roll as it stands, in the table's order.
function ownOptions(sheet: CharacterSheet, roll: Reading, when: "short" | "hit", hit?: { melee?: boolean; wrathDice?: boolean }, reactionFree = true): AfterRollOption[] {
  const options: AfterRollOption[] = [];
  for (const row of AFTER_ROLL_ROWS as readonly AfterRollRow[]) {
    // A row of its own (effect "own") is offered by its module, after these.
    if (ownsItself(row) || row.whose === "other" || row.ownAmongHelpers || row.when !== when || !answers(row, roll.kind) || roll.taken.has(row.id)) continue;
    if (row.reaction && !reactionFree) continue;
    if (when === "hit" && ((row.hitBy === "melee" && !hit?.melee) || (row.amount?.kind === "max" && !hit?.wrathDice))) continue;
    if (!holdsRow(sheet, row)) continue;
    if (when === "short" && !carries(sheet, row, roll)) continue;
    options.push(optionOf(sheet, row, roll.kind));
  }
  return options;
}

export function afterRollOptions(
  sheet: CharacterSheet,
  // `check`: the skill or tool of a check, for the features that read it (mt-mr-offers-logic.ts).
  roll: { kind: string; outcome: RollResult; dc: number | null; spent?: readonly AfterRollId[]; reactionFree?: boolean; check?: MrCheck },
): AfterRollOption[] {
  const { outcome, dc } = roll;
  if (!canWaitOnRoll(roll.kind) || !leadD20(outcome) || (dc !== null && outcome.total >= dc)) {
    return [];
  }
  const taken = new Set(roll.spent ?? []);
  return [
    ...ownOptions(sheet, { kind: roll.kind, outcome, target: { dc }, taken }, "short", undefined, roll.reactionFree !== false),
    // The rows of their own (after-roll-table.ts effect "own"), after the table's.
    ...mrCheckOffers(sheet, { kind: roll.kind, total: outcome.total, natural: outcome.natural, dc, taken, reactionFree: roll.reactionFree !== false, check: roll.check }),
  ];
}

// An attack roll waits only when it misses as it stands: a hit is already what
// the player wants, and the game knows the target's AC where a check may have
// no DC. A natural 1 misses whatever is added to it, so only a fresh d20 can
// save it; a fresh d20 can always save a miss, since a natural 20 hits. Dark
// One's Own Luck is for checks and saves alone. A hit waits on the choices
// that ride one (Touch of Death, Destructive Wrath).
export function afterAttackOptions(
  sheet: CharacterSheet,
  // `wrathDice`: the hit would roll lightning or thunder dice (destructive-wrath-logic.ts rollsWrathDice).
  // `swing`: the weapon and the turn, for the features that read them (mt-mr-offers-logic.ts).
  roll: { outcome: RollResult; ac: number; critRange: number; spent?: readonly AfterRollId[]; reactionFree?: boolean; melee?: boolean; wrathDice?: boolean; swing?: MrSwing },
): AfterRollOption[] {
  const { outcome, ac, critRange } = roll;
  if (!leadD20(outcome) || outcome.natural === undefined) {
    return [];
  }
  const taken = new Set(roll.spent ?? []);
  const reading: Reading = { kind: "attack", outcome, target: { ac, critRange }, taken };
  if (attackHits(outcome, ac, critRange)) {
    return [
      ...ownOptions(sheet, reading, "hit", { melee: roll.melee, wrathDice: roll.wrathDice }),
      // A Valor bard's die on the hit's damage (ar-wbf-bard-dice-logic.ts).
      ...(!taken.has("combat_inspiration") ? combatInspirationOption(sheet) : []),
    ];
  }
  return [...ownOptions(sheet, reading, "short", undefined, roll.reactionFree !== false), ...mrAttackOffers(sheet, { total: outcome.total, natural: outcome.natural!, ac, taken }, roll.swing)];
}

// Whether an ally's roll, as it stands, fails where a fresh d20 could still
// carry it: a check or save against a known Difficulty Class, or an attack
// against the target's AC. A roll with no DC is not offered to an ally: they
// cannot see whether it succeeded, and a pause on every such roll would hold
// the table for nothing.
export function shiftCanHelp(roll: { kind: string; outcome: RollResult; dc: number | null } | { kind: "attack"; outcome: RollResult; ac: number; critRange: number }): boolean {
  const { outcome } = roll;
  const natural = outcome.natural;
  if (!leadD20(outcome)) {
    return false;
  }
  if ("ac" in roll) {
    return natural === 1 || (natural !== undefined && natural < roll.critRange && outcome.total < roll.ac);
  }
  if (!canWaitOnRoll(roll.kind) || roll.dc === null || outcome.total >= roll.dc) {
    return false;
  }
  return natural === undefined || outcome.total - natural + 20 >= roll.dc;
}

// Another character's choice on this roll, for a row that answers another's:
// War God's Blessing (+10 where it turns a miss), Flash of Genius (the
// artificer's Intelligence modifier, `modifier`). A roll with no DC is not
// offered to a helper (shiftCanHelp).
// `own`: the helper is the roller (Flash of Genius on the artificer's own
// roll, offered with the helpers'), where a roll with no DC still asks.
export function helperOption(
  helper: CharacterSheet,
  id: AfterRollId,
  roll: { kind: string; outcome: RollResult; dc: number | null; spent?: readonly AfterRollId[] } | { kind: "attack"; outcome: RollResult; ac: number; critRange: number },
  input: { rollerName: string; modifier?: number; own?: boolean },
): AfterRollOption | null {
  const row = afterRollRow(id);
  const { outcome } = roll;
  if (row.when !== "short" || !answers(row, roll.kind) || !leadD20(outcome)) {
    return null;
  }
  const target: Target = "ac" in roll ? { ac: roll.ac, critRange: roll.critRange } : { dc: roll.dc };
  if ("ac" in target) {
    if (outcome.natural === undefined || attackHits(outcome, target.ac, target.critRange)) return null;
  } else if ((!input.own && target.dc === null) || (target.dc !== null && outcome.total >= target.dc) || !canWaitOnRoll(roll.kind)) {
    return null;
  }
  if (row.amount?.kind === "ability" && (input.modifier ?? 0) < 1) {
    return null;
  }
  const reading: Reading = { kind: roll.kind, outcome, target, taken: new Set("spent" in roll ? (roll.spent ?? []) : []) };
  if (!carries(helper, row, reading, input.modifier) || !holdsRow(helper, row)) {
    return null;
  }
  return optionOf(helper, row, roll.kind, { ...(input.own ? {} : { by: helper.id }), rollerName: input.rollerName, modifier: input.modifier });
}

// A helper's choice on an ally's hit (Violent Attraction: "when a creature
// you can see within 60 feet hits with a weapon attack").
export function hitHelperOption(helper: CharacterSheet, id: AfterRollId, roll: { outcome: RollResult; ac: number; critRange: number; weapon: boolean }, rollerName: string): AfterRollOption | null {
  const row = afterRollRow(id);
  if (row.when !== "hit" || row.whose === "own" || !attackHits(roll.outcome, roll.ac, roll.critRange) || (row.hitBy === "weapon" && !roll.weapon) || !holdsRow(helper, row)) {
    return null;
  }
  return optionOf(helper, row, "attack", { by: helper.id, rollerName });
}

// War God's Blessing (War Domain 6): "when a creature within 30 feet of you makes
// an attack roll, you can use your reaction to grant that creature a +10 bonus
// to the roll... after you see the roll, but before the DM says whether the
// attack hits or misses." Offered where the 10 turns the miss.
export function warGodsBlessingOption(cleric: CharacterSheet, roll: { outcome: RollResult; ac: number; critRange: number }): AfterRollOption | null {
  return helperOption(cleric, "war_gods_blessing", { kind: "attack", ...roll }, { rollerName: "" });
}

// Flash of Genius (Artificer 7): "when you or another creature you can see within
// 30 feet of you makes an ability check or a saving throw, you can use your
// reaction to add your Intelligence modifier to the roll." Offered where the
// modifier could carry it. `ally`: on another character's roll, where a roll
// with no DC is not offered, as for Chronal Shift (shiftCanHelp).
export function flashOfGeniusOption(artificer: CharacterSheet, intelligence: number, roll: { kind: string; outcome: RollResult; dc: number | null }, ally: boolean): AfterRollOption | null {
  return helperOption(artificer, "flash_of_genius", roll, { rollerName: "", modifier: intelligence, own: !ally });
}

// The line the model reads when another character changed this roll.
export function answeredLine(id: AfterRollId, helper: string, roller: string, before: number, after: number): string {
  const row = afterRollRow(id);
  if (row.effect === "reroll") {
    return `${helper} used ${row.feature}: ${roller} rolled again (${before} became ${after}), and the new roll stands.`;
  }
  if (row.when === "hit") {
    return `${helper} used ${row.feature}: ${roller}'s hit deals ${amountWords(row)} more damage.`;
  }
  return `${helper} used ${row.feature}: ${roller}'s roll went from ${before} to ${after}.`;
}

// A wizard's Chronal Shift offered on another character's roll.
export function allyShiftOption(wizardId: string, rollerName: string, kind: string): AfterRollOption {
  const row = afterRollRow("chronal_shift");
  const words = { kind, name: rollerName };
  return { id: "chronal_shift", by: wizardId, label: fillWords(row.otherLabel!, words), note: fillWords(row.otherNote!, words) };
}

// 5 + twice the cleric level.
export function touchOfDeathDamage(sheet: CharacterSheet): number {
  return levelDamage(sheet, afterRollRow("touch_of_death"));
}

// The roll with its d20s thrown again (`fresh`, one for each die the lead term
// threw), kept by the same rule, advantage and all: the creature rolls again
// and must use the new roll.
export function withRerolledD20(outcome: RollResult, fresh: DieResult[]): RollResult | null {
  const lead = leadD20(outcome);
  if (!lead || fresh.length !== lead.dice.length) {
    return null;
  }
  const order = fresh.map((die, at) => ({ value: die.value, at }));
  const keepCount = lead.keep?.count ?? order.length;
  const ranked = lead.keep ? [...order].sort((a, b) => (lead.keep!.mode === "highest" ? b.value - a.value : a.value - b.value)) : order;
  const kept = new Set(ranked.slice(0, keepCount).map((entry) => entry.at));
  const dice = fresh.map((die, at) => ({ ...die, kept: kept.has(at) }));
  const subtotal = dice.reduce((sum, die) => sum + (die.kept ? die.value : 0), 0);
  const natural = keepCount === 1 ? dice.find((die) => die.kept)!.value : undefined;
  const rest = { ...outcome };
  delete rest.crit;
  return {
    ...rest,
    total: outcome.total - lead.subtotal + subtotal,
    terms: [{ ...lead, dice, subtotal }, ...outcome.terms.slice(1)],
    ...(natural !== undefined ? { natural } : {}),
    ...(natural === 20 ? { crit: "nat20" as const } : natural === 1 ? { crit: "nat1" as const } : {}),
  };
}

// The roll thrown again with advantage (Master Duelist): two fresh d20s (three
// with Elven Accuracy), the highest kept. Disadvantage the attack already had cancels it, leaving one d20
// (`fresh` then holds one).
export function withAdvantageReroll(outcome: RollResult, fresh: DieResult[]): RollResult | null {
  const lead = leadD20(outcome);
  if (!lead || !fresh.length) {
    return null;
  }
  const pool: DiceTerm = { ...lead, count: fresh.length, dice: fresh };
  delete pool.keep;
  if (fresh.length > 1) {
    pool.keep = { mode: "highest", count: 1 };
  }
  const written = fresh.length > 1 ? `${fresh.length}d20kh1` : "1d20";
  return withRerolledD20({ ...outcome, expression: outcome.expression.replace(/^\s*\d+d20(?:k[hl]\d+)?/, written), terms: [pool, ...outcome.terms.slice(1)] }, fresh);
}

// A flat bonus on the roll (Guided Strike's +10), written as the dice engine
// writes a modifier.
export function withFlatBonus(outcome: RollResult, value: number): RollResult {
  return { ...outcome, expression: `${outcome.expression}+${value}`, total: outcome.total + value, terms: [...outcome.terms, { kind: "modifier", sign: 1, value }] };
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
