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
import { holdsFeature, isNamed } from "@/lib/srd/feature-names";
import { channelOptions } from "@/lib/dm/option-costs";
import { classLevelOf } from "@/lib/srd/trait-rules";
import { textKey } from "@/lib/language/text-logic";
import { holdsDestructiveWrath } from "@/lib/dm/destructive-wrath-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type AfterRollId = "lucky" | "bardic" | "own_luck" | "chronal_shift" | "guided_strike" | "master_duelist" | "favored_by_the_gods" | "war_gods_blessing" | "flash_of_genius" | "touch_of_death" | "destructive_wrath";

export type AfterRollOption = {
  id: AfterRollId;
  label: string;
  // What choosing it does, in plain words, for the button's tooltip.
  note: string;
  // Another character's, offered on their player's screen: a Chronurgy
  // wizard's Chronal Shift on an ally's roll ("after you or a creature you
  // can see within 30 feet of you makes an attack roll, an ability check,
  // or a saving throw"), War God's Blessing, Flash of Genius. Absent: the
  // roller's own.
  by?: string;
};

export const DARK_ONES_OWN_LUCK = "dark_ones_own_luck";
export const CHRONAL_SHIFT = "sub_chronal_shift";
export const CHANNEL_DIVINITY = "channel_divinity";
export const MASTER_DUELIST = "sub_master_duelist";
export const FAVORED_BY_THE_GODS = "sub_favored_by_the_gods";
export const FLASH_OF_GENIUS = "art_flash_of_genius";
export const GUIDED_STRIKE_BONUS = 10;
export const WAR_GODS_BLESSING_BONUS = 10;
const FAVORED_DICE = 2;
const FAVORED_SIDES = 4;

// Spent from this card and no other: dealt to the Hand they spent a use and
// changed nothing, since the roll they ride had already landed. use_resource
// still takes them, for a roll that cannot wait (an agent's seat, a forced
// save), where the GM narrates the result.
export const AFTER_ROLL_COUNTERS: readonly string[] = [MASTER_DUELIST, FAVORED_BY_THE_GODS, FLASH_OF_GENIUS];
export const isAfterRollChannelOption = (name: string) => isNamed(name, "guided strike", "war god's blessing", "touch of death");

// How long a roll waits on its player before the dice are kept as they lie
// (src/lib/dm/after-roll-timer.ts); the card counts it down.
export const AFTER_ROLL_SECONDS = 20;
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

// Chronal Shift (Chronurgy 2): "after you ... make an attack roll, an ability
// check, or a saving throw", the wizard's reaction rolls it again once they
// see it fail, and the second roll stands. The wizard's own roll is theirs to
// answer here; a hit on them or an ally is the reaction card's
// (src/lib/battlemap/hand-react.ts). `reactionFree`: their reaction is not
// spent this round (always so outside a fight).
function chronalShiftOption(sheet: CharacterSheet, reactionFree: boolean, taken: Set<AfterRollId>, what: string): AfterRollOption | null {
  if (!reactionFree || taken.has("chronal_shift") || usesLeft(sheet, CHRONAL_SHIFT) < 1 || !holdsFeature(sheet, "chronal shift")) {
    return null;
  }
  return { id: "chronal_shift", label: "Chronal Shift: roll it again", note: `Spend a use of Chronal Shift and your reaction: roll this ${what} again, and the new roll stands.` };
}

// Favored by the Gods (Divine Soul 1): "if you fail a saving throw or miss with
// an attack roll, you can roll 2d4 and add it to the total". `reaches` is
// whether the most it can add carries the roll.
function favoredOption(sheet: CharacterSheet, taken: Set<AfterRollId>, reaches: boolean, what: string): AfterRollOption | null {
  if (!reaches || taken.has("favored_by_the_gods") || usesLeft(sheet, FAVORED_BY_THE_GODS) < 1 || !holdsFeature(sheet, "favored by the gods")) {
    return null;
  }
  return { id: "favored_by_the_gods", label: `Favored by the Gods: add ${FAVORED_DICE}d${FAVORED_SIDES}`, note: `Spend your use of Favored by the Gods: add ${FAVORED_DICE}d${FAVORED_SIDES} to this ${what}.` };
}

export function afterRollOptions(
  sheet: CharacterSheet,
  roll: { kind: string; outcome: RollResult; dc: number | null; spent?: readonly AfterRollId[]; reactionFree?: boolean },
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
  const shift = outcome.natural === undefined || reaches(20 - outcome.natural) ? chronalShiftOption(sheet, roll.reactionFree !== false, taken, roll.kind === "saving_throw" ? "save" : "check") : null;
  if (shift) {
    options.push(shift);
  }
  const favored = roll.kind === "saving_throw" ? favoredOption(sheet, taken, reaches(FAVORED_DICE * FAVORED_SIDES), "save") : null;
  if (favored) {
    options.push(favored);
  }
  return options;
}

// An attack roll waits only when it misses as it stands: a hit is already what
// the player wants, and the game knows the target's AC where a check may have
// no DC. A natural 1 misses whatever is added to it, so only a fresh d20 can
// save it; a fresh d20 can always save a miss, since a natural 20 hits. Dark
// One's Own Luck is for checks and saves alone.
export function afterAttackOptions(
  sheet: CharacterSheet,
  // `wrathDice`: the hit would roll lightning or thunder dice (destructive-wrath-logic.ts rollsWrathDice).
  roll: { outcome: RollResult; ac: number; critRange: number; spent?: readonly AfterRollId[]; reactionFree?: boolean; melee?: boolean; wrathDice?: boolean },
): AfterRollOption[] {
  const { outcome, ac } = roll;
  const natural = outcome.natural;
  if (!leadD20(outcome) || natural === undefined) {
    return [];
  }
  const taken = new Set(roll.spent ?? []);
  if (natural !== 1 && (natural >= roll.critRange || outcome.total >= ac)) {
    return [
      ...(roll.melee && !taken.has("touch_of_death") ? touchOfDeathOption(sheet) : []),
      ...(roll.wrathDice && !taken.has("destructive_wrath") ? destructiveWrathOption(sheet) : []),
    ];
  }
  const options: AfterRollOption[] = [];
  if (holdsLuckPoint(sheet) && !taken.has("lucky")) {
    options.push({ id: "lucky", label: "Lucky: roll another d20", note: "Spend a luck point: roll another d20, then choose which die counts." });
  }
  const bardic = heldBardicDie(sheet);
  if (bardic && !taken.has("bardic") && natural !== 1 && outcome.total + sidesOf(bardic.die) >= ac) {
    options.push({ id: "bardic", label: `Add Bardic Inspiration (${bardic.die})`, note: `Spend your Bardic Inspiration die: add 1${bardic.die} to this attack roll.` });
  }
  // A fresh d20 can always save a miss: a natural 20 hits.
  const shift = chronalShiftOption(sheet, roll.reactionFree !== false, taken, "attack roll");
  if (shift) {
    options.push(shift);
  }
  // Guided Strike (War Domain 2, Oath of Conquest 3): +10, chosen after the
  // roll and before the GM says whether it hits. Channel Divinity is a short
  // supply, so it is offered only where it turns the miss.
  const guided = usesLeft(sheet, CHANNEL_DIVINITY) > 0 && channelOptions(sheet).some((option) => isNamed(option.name, "guided strike"));
  if (guided && !taken.has("guided_strike") && natural !== 1 && outcome.total + GUIDED_STRIKE_BONUS >= ac) {
    options.push({ id: "guided_strike", label: `Guided Strike: add ${GUIDED_STRIKE_BONUS}`, note: `Spend a use of Channel Divinity: add ${GUIDED_STRIKE_BONUS} to this attack roll.` });
  }
  // Master Duelist (Swashbuckler 17): "if you miss with an attack roll, you can
  // roll it again with advantage". A fresh d20 can always save a miss.
  if (!taken.has("master_duelist") && usesLeft(sheet, MASTER_DUELIST) > 0 && holdsFeature(sheet, "master duelist")) {
    options.push({ id: "master_duelist", label: "Master Duelist: roll again with advantage", note: "Spend your use of Master Duelist: roll this attack again with advantage, and the new roll stands." });
  }
  const favored = favoredOption(sheet, taken, natural !== 1 && outcome.total + FAVORED_DICE * FAVORED_SIDES >= ac, "attack roll");
  if (favored) {
    options.push(favored);
  }
  return options;
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

// War God's Blessing (War Domain 6): "when a creature within 30 feet of you makes
// an attack roll, you can use your reaction to grant that creature a +10 bonus
// to the roll... after you see the roll, but before the DM says whether the
// attack hits or misses." Offered where the 10 turns the miss.
export function warGodsBlessingOption(cleric: CharacterSheet, roll: { outcome: RollResult; ac: number; critRange: number }): AfterRollOption | null {
  const { outcome, ac } = roll;
  const natural = outcome.natural;
  if (natural === undefined || natural === 1 || natural >= roll.critRange || outcome.total >= ac || outcome.total + WAR_GODS_BLESSING_BONUS < ac || !leadD20(outcome)) {
    return null;
  }
  if (usesLeft(cleric, CHANNEL_DIVINITY) < 1 || !channelOptions(cleric).some((option) => isNamed(option.name, "war god's blessing"))) {
    return null;
  }
  return {
    id: "war_gods_blessing",
    by: cleric.id,
    label: `War God's Blessing: add ${WAR_GODS_BLESSING_BONUS}`,
    note: `Use your reaction and a use of Channel Divinity: add ${WAR_GODS_BLESSING_BONUS} to this attack roll.`,
  };
}

// Flash of Genius (Artificer 7): "when you or another creature you can see within
// 30 feet of you makes an ability check or a saving throw, you can use your
// reaction to add your Intelligence modifier to the roll." Offered where the
// modifier could carry it. `ally`: on another character's roll, where a roll
// with no DC is not offered, as for Chronal Shift (shiftCanHelp).
export function flashOfGeniusOption(artificer: CharacterSheet, intelligence: number, roll: { kind: string; outcome: RollResult; dc: number | null }, ally: boolean): AfterRollOption | null {
  const { outcome, dc } = roll;
  if (!canWaitOnRoll(roll.kind) || !leadD20(outcome) || intelligence < 1 || (ally && dc === null)) {
    return null;
  }
  if (dc !== null && (outcome.total >= dc || outcome.total + intelligence < dc)) {
    return null;
  }
  if (usesLeft(artificer, FLASH_OF_GENIUS) < 1 || !holdsFeature(artificer, "flash of genius")) {
    return null;
  }
  return {
    id: "flash_of_genius",
    ...(ally ? { by: artificer.id } : {}),
    label: `Flash of Genius: add ${intelligence}`,
    note: `Use your reaction and a use of Flash of Genius: add ${intelligence} to this roll.`,
  };
}

// The line the model reads when another character changed this roll.
export function answeredLine(id: AfterRollId, helper: string, roller: string, before: number, after: number): string {
  if (id === "chronal_shift") {
    return `${helper} used Chronal Shift: ${roller} rolled again (${before} became ${after}), and the new roll stands.`;
  }
  return `${helper} used ${id === "war_gods_blessing" ? "War God's Blessing" : "Flash of Genius"}: ${roller}'s roll went from ${before} to ${after}.`;
}

// A wizard's Chronal Shift offered on another character's roll.
export function allyShiftOption(wizardId: string, rollerName: string, kind: string): AfterRollOption {
  const what = kind === "attack" ? "attack roll" : kind === "saving_throw" ? "save" : "check";
  return {
    id: "chronal_shift",
    by: wizardId,
    label: `Chronal Shift: make ${rollerName} roll again`,
    note: `Spend a use of Chronal Shift and your reaction: ${rollerName} rolls this ${what} again, and the new roll stands.`,
  };
}

// Touch of Death (Death Domain 2): "when you hit a creature with a melee attack,
// you can use Channel Divinity to deal extra necrotic damage": the one choice
// that waits on a hit. The cleric sees the hit before spending the use.
function touchOfDeathOption(sheet: CharacterSheet): AfterRollOption[] {
  if (usesLeft(sheet, CHANNEL_DIVINITY) < 1 || !channelOptions(sheet).some((option) => isNamed(option.name, "touch of death"))) {
    return [];
  }
  const damage = touchOfDeathDamage(sheet);
  return [{ id: "touch_of_death", label: `Touch of Death: add ${damage} necrotic`, note: `Spend a use of Channel Divinity: this hit deals ${damage} extra necrotic damage.` }];
}

// Destructive Wrath (Tempest Domain 2): "When you roll lightning or thunder
// damage, you can use your Channel Divinity to deal maximum damage, instead of
// rolling." A hit is where its damage is rolled, so the hit waits on the
// choice as it does for Touch of Death. One already held from the Hand takes
// the roll by itself (destructive-wrath.ts), so it is not offered again.
function destructiveWrathOption(sheet: CharacterSheet): AfterRollOption[] {
  if (holdsDestructiveWrath(sheet) || usesLeft(sheet, CHANNEL_DIVINITY) < 1 || !channelOptions(sheet).some((option) => isNamed(option.name, "destructive wrath"))) {
    return [];
  }
  return [{ id: "destructive_wrath", label: "Destructive Wrath: maximum lightning and thunder", note: "Spend a use of Channel Divinity: this hit's lightning and thunder dice are dealt at their maximum instead of rolled." }];
}

// 5 + twice the cleric level.
export function touchOfDeathDamage(sheet: CharacterSheet): number {
  return 5 + 2 * classLevelOf(sheet, "cleric");
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
