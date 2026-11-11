// The Metamagic options a sorcerer pays for with use_resource (sorcery
// points, the option as the variant), carried from the spend to the spell
// they are cast on (SRD 5.1, sorcerer, Metamagic):
//
//   - "You can use only one Metamagic option on a spell when you cast it,
//     unless otherwise noted." A second option paid before the spell is cast
//     is refused, spending nothing; Empowered Spell is the one noted ("even
//     if you have already used a different Metamagic option").
//   - Heightened Spell: "give one target of the spell disadvantage on its
//     first saving throw made against the spell."
//   - Subtle Spell: "cast it without any somatic or verbal components."
//
//   - Careful Spell: "choose a number of those creatures up to your Charisma
//     modifier (minimum of one creature). A chosen creature automatically
//     succeeds on its saving throw against the spell."
//   - Distant Spell: "double the range of the spell", and "a range of touch"
//     becomes "30 feet".
//   - Empowered Spell: "reroll a number of the damage dice up to your
//     Charisma modifier (minimum of one). You must use the new rolls."
//   - Extended Spell: "a duration of 1 minute or longer ... double its
//     duration, to a maximum duration of 24 hours."
//   - Twinned Spell: "a spell that targets only one creature and doesn't have
//     a range of self ... target a second creature in range with the same
//     spell", for "a number of sorcery points equal to the spell's level (1
//     sorcery point if the spell is a cantrip)"; "a spell must be incapable
//     of targeting more than one creature at the spell's current level."
//
// The option paid is a mark on the sorcerer (a condition named for it) that
// the next spell takes, and `metamagicPaid` is the one reader of it: every
// cast path asks it through the helpers below (the range a spell reaches,
// how long what it lays lasts, who is spared its save, how its damage dice
// are thrown, how many creatures it takes), and the Hand's spell card asks
// the same helpers (`cardMetamagic`), so the card says what the cast will do.
// A cast that goes through clears what was paid for it; Heightened Spell
// waits for the spell's first save and Empowered Spell for its damage roll,
// which come after the cast. A mark not used lapses with the round.
// Quickened Spell keeps its own engine (bonus-actions.ts) and is marked here
// only so the one-option rule sees it.
//
// A new option, or a new cast path, goes through this module: nothing else
// reads the marks.

import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { optionsOfKind } from "@/lib/srd/options";
import type { SpellFacts, SpellRange } from "@/lib/srd/spell-facts";

const PREFIX = "metamagic: ";
// Compared as keys: the mark as it is stored, and as textKey reads it.
const PREFIX_KEY = textKey(PREFIX);
const markOf = (option: string) => textKey(`${PREFIX}${option}`);
const isMark = (entry: string) => textKey(entry).startsWith(PREFIX_KEY);
const EMPOWERED = markOf("Empowered Spell");
const HEIGHTENED = markOf("Heightened Spell");
const SUBTLE = markOf("Subtle Spell");
const CAREFUL = markOf("Careful Spell");
const DISTANT = markOf("Distant Spell");
const EXTENDED = markOf("Extended Spell");
const TWINNED = markOf("Twinned Spell");
// What the cast itself does not use: the spell's first save and its damage
// roll take these two, after the cast.
const AFTER_CAST = [HEIGHTENED, EMPOWERED];

type Marked = { conditions: readonly string[] };

function paid(sheet: Marked): string[] {
  return sheet.conditions.filter(isMark).map(textKey);
}

// Why this option cannot be added to the spell being cast, or null.
export function secondOptionProblem(sheet: Marked & { name: string }, option: string, ownRepeat = false): ToolError | null {
  const mark = markOf(option);
  const waiting = paid(sheet);
  // Quickened Spell's own engine answers a second Quickened Spell (`ownRepeat`).
  if (waiting.includes(mark)) {
    if (ownRepeat) {
      return null;
    }
    return { error: `${sheet.name} has already paid for ${option} and has not cast the spell yet. Cast it first. Nothing more was spent.`, retry: true };
  }
  const other = waiting.find((entry) => entry !== EMPOWERED);
  if (!other || mark === EMPOWERED) {
    return null;
  }
  return {
    error: `${sheet.name} has already paid for ${other.slice(PREFIX_KEY.length).trim()} on the spell they are casting, and a spell takes one Metamagic option (Empowered Spell alone goes with another). Cast the spell first. Nothing was spent.`,
    refused: "rules",
  };
}

// What was paid rides the mark: the points in `slotLevel` (Twinned Spell's
// are the level of the spell they pay for) and the pool in `source`.
type Paid = { points?: number; pool?: string };

function write(campaign: Pick<Campaign, "id">, sheetId: string, change: (conditions: string[]) => string[], add?: string, paidWith: Paid = {}, pool?: { id: string; delta: number }) {
  const fresh = getSheetById(sheetId);
  if (!fresh) {
    return;
  }
  const conditions = change(fresh.conditions);
  const meta = { ...(fresh.conditionMeta as ConditionMetaMap) };
  for (const key of Object.keys(meta)) {
    if (isMark(key) && !conditions.some((entry) => textKey(entry) === textKey(key))) {
      delete meta[key];
    }
  }
  if (add) {
    meta[add] = { rounds: 1, ...(paidWith.points ? { slotLevel: paidWith.points } : {}), ...(paidWith.pool ? { source: paidWith.pool } : {}) };
  }
  // Points given back, or the rest of a price charged (Twinned Spell).
  const counter = pool ? fresh.resources?.[pool.id] : undefined;
  const resources = pool && counter ? { ...fresh.resources, [pool.id]: { ...counter, used: Math.max(0, counter.used + pool.delta) } } : undefined;
  const updated = patchSheet(sheetId, { conditions, conditionMeta: meta, ...(resources ? { resources } : {}) });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// The option is paid: the next spell takes it.
export function markMetamagic(campaign: Pick<Campaign, "id">, sheetId: string, option: string, paidWith: Paid = {}) {
  const mark = `${PREFIX}${option.toLowerCase()}`;
  write(campaign, sheetId, (conditions) => [...conditions.filter((entry) => textKey(entry) !== textKey(mark)), mark], mark, paidWith);
}

// After a spend went through: a variant that names a Metamagic option is
// marked, any other variant is not one.
export function markPaidOption(campaign: Pick<Campaign, "id">, sheetId: string, variant: string | undefined, paidWith: Paid = {}) {
  const option = variant?.trim() ? optionsOfKind("metamagic").find((entry) => textKey(entry.n) === textKey(variant)) : undefined;
  if (option) {
    markMetamagic(campaign, sheetId, option.n, paidWith);
  }
}

// ---- the one reader ----

type Caster = CharacterSheet;

// "up to your Charisma modifier (minimum of one)": Careful Spell's creatures
// and Empowered Spell's dice.
function charismaCount(sheet: Caster): number {
  return Math.max(1, computeSheetDerived(sheet).abilityMods.cha);
}

// What the sorcerer has paid for the spell they are about to cast.
export function metamagicPaid(sheet: Marked): { careful: boolean; distant: boolean; empowered: boolean; extended: boolean; twinned: boolean; heightened: boolean; subtle: boolean } {
  const waiting = paid(sheet);
  return {
    careful: waiting.includes(CAREFUL),
    distant: waiting.includes(DISTANT),
    empowered: waiting.includes(EMPOWERED),
    extended: waiting.includes(EXTENDED),
    twinned: waiting.includes(TWINNED),
    heightened: waiting.includes(HEIGHTENED),
    subtle: waiting.includes(SUBTLE),
  };
}

// ---- Distant Spell ----

const DISTANT_TOUCH_FEET = 30;

function distantRange(range: SpellRange): SpellRange {
  if (range.kind === "touch") {
    return { kind: "feet", feet: DISTANT_TOUCH_FEET };
  }
  // "a range of 5 feet or greater": a range of self, sight or none is not one.
  return range.kind === "feet" && range.feet >= 5 ? { kind: "feet", feet: range.feet * 2 } : range;
}

// The spell's facts as this caster casts it now: Distant Spell's range.
// Every cast path measures with these (cast_at_enemy, cast_buff, aoe_damage,
// heal, a spell attack, a square named for an area).
export function factsAsCast<T extends SpellFacts | null | undefined>(sheet: Marked | null | undefined, facts: T): T {
  if (!facts || !sheet || !metamagicPaid(sheet).distant) {
    return facts;
  }
  return { ...facts, range: distantRange(facts.range) };
}

// ---- Extended Spell ----

const MINUTE_ROUNDS = 10;
const DAY_ROUNDS = 24 * 60 * MINUTE_ROUNDS;

// How long what the spell lays lasts, in rounds: doubled, to 24 hours at
// most, for a duration of a minute or longer. Null (until dispelled) stays.
export function extendedRounds<T extends number | null | undefined>(sheet: Marked, rounds: T): T | number {
  if (!rounds || rounds < MINUTE_ROUNDS || !metamagicPaid(sheet).extended) {
    return rounds;
  }
  // A spell that already outlasts a day is not cut short.
  return Math.max(rounds, Math.min(DAY_ROUNDS, rounds * 2));
}

// A condition's stored lifetime, extended the same way.
export function extendedMeta<M extends { rounds?: number }>(sheet: Marked, meta: M): M {
  const rounds = extendedRounds(sheet, meta.rounds);
  return rounds && rounds !== meta.rounds ? { ...meta, rounds } : meta;
}

// ---- Careful Spell ----

// The creatures caught in the sorcerer's own area that automatically succeed
// on its save: the ones named (or, with none named, every character caught),
// never the sorcerer ("other creatures"), up to the Charisma modifier.
export function carefulIds(caster: Caster, caught: string[], named: string[] | undefined): string[] {
  if (!metamagicPaid(caster).careful) {
    return [];
  }
  return (named ?? caught).filter((id) => caught.includes(id) && id !== caster.id).slice(0, charismaCount(caster));
}

// ---- Empowered Spell ----

// The damage dice the spell's roll may throw again, taken off the sorcerer
// as the roll uses it: the option for rollExpression (src/lib/dice.ts).
export function empoweredRoll(campaign: Pick<Campaign, "id">, casterId: string): { empower?: number } {
  const sheet = getSheetById(casterId);
  if (!sheet || !paid(sheet).includes(EMPOWERED)) {
    return {};
  }
  write(campaign, casterId, (conditions) => conditions.filter((entry) => textKey(entry) !== EMPOWERED));
  return { empower: charismaCount(sheet) };
}

// What the result says of a roll Empowered Spell rode.
export function empoweredLine(count: number): string {
  return `Empowered Spell: the damage dice that fell below their average, ${count} at most, were rolled again and the new faces kept.`;
}

// ---- Twinned Spell ----

// The spell as it is being cast: its facts, the creatures one casting of it
// takes at this slot (castShares, src/lib/srd/spell-mechanics.ts) and the
// slot. An area's shares are many, so an area is never eligible.
export type TwinAsk = { facts: SpellFacts | null; shares: number; slotLevel: number | null };

type TwinSheet = Marked & Pick<CharacterSheet, "conditionMeta" | "resources">;

function twinPlan(sheet: TwinSheet, ask: TwinAsk): { paid: number; pool: string; price: number; problem: string | null } | null {
  if (!paid(sheet).includes(TWINNED)) {
    return null;
  }
  const meta = Object.entries(sheet.conditionMeta as ConditionMetaMap).find(([key]) => textKey(key) === TWINNED)?.[1];
  const pool = meta?.source ?? "sorcery_points";
  const points = meta?.slotLevel ?? 1;
  // "equal to the spell's level (1 sorcery point if the spell is a cantrip)"
  const price = Math.max(1, ask.slotLevel ?? ask.facts?.level ?? 1);
  const counter = sheet.resources?.[pool];
  const left = counter ? Math.max(0, counter.max - counter.used) : 0;
  const problem =
    ask.facts?.range.kind === "self"
      ? "it has a range of self"
      : ask.shares !== 1
        ? "it can target more than one creature at this level"
        : points + left < price
          ? `twinning it costs ${price} sorcery points`
          : null;
  return { paid: points, pool, price, problem };
}

// How many more creatures this casting takes for Twinned Spell: one, when it
// is paid and the spell is eligible. Read by the tools that take every
// target in one call (cast_buff, heal) before the cast, and by the cast.
export function twinExtra(sheet: TwinSheet, ask: TwinAsk): 0 | 1 {
  const plan = twinPlan(sheet, ask);
  return plan && !plan.problem ? 1 : 0;
}

// The cast settles Twinned Spell: the price is the spell's level whatever
// the spend named (the rest charged, or the excess given back), and a spell
// that cannot be twinned gives every point back. The line for the result.
export function settleTwin(campaign: Pick<Campaign, "id">, casterId: string, spell: string, ask: TwinAsk): { extra: 0 | 1; note: string } | null {
  const sheet = getSheetById(casterId);
  const plan = sheet ? twinPlan(sheet, ask) : null;
  if (!sheet || !plan) {
    return null;
  }
  const delta = plan.problem ? -plan.paid : plan.price - plan.paid;
  write(campaign, casterId, (conditions) => conditions.filter((entry) => textKey(entry) !== TWINNED), undefined, {}, { id: plan.pool, delta });
  if (plan.problem) {
    return { extra: 0, note: `Twinned Spell does not take ${spell}: ${plan.problem}. The ${plan.paid} sorcery point${plan.paid === 1 ? "" : "s"} paid for it ${plan.paid === 1 ? "is" : "are"} back, and the spell is cast on its one target.` };
  }
  const settled = delta > 0 ? ` (${delta} more charged: the price is the spell's level)` : delta < 0 ? ` (${-delta} given back: the price is the spell's level)` : "";
  return { extra: 1, note: `Twinned Spell: ${spell} takes a second creature in range, for ${plan.price} sorcery point${plan.price === 1 ? "" : "s"}${settled}. The second target is another creature, never the first again.` };
}

// Why this creature cannot take the casting's other share: a casting that
// takes one creature and still holds one (Twinned Spell's second target)
// goes to "a second creature", never the first again. `open` is the casting
// as the turn holds it (area-casting.ts openAreaCast), `ownShares` what the
// spell takes without Twinned Spell.
export function secondTargetProblem(open: { caught?: string[] } | null, ownShares: number, spell: string, target: { id: string; name: string }): ToolError | null {
  if (ownShares !== 1 || !open?.caught?.includes(target.id)) {
    return null;
  }
  return { error: `${target.name} already took this casting of ${spell}: its second target is another creature in range. Ask the player which, unless they named one. Nothing more was spent.`, retry: true };
}

// ---- the Hand ----

// What the spell's card says of the options paid, read off the same helpers
// the cast uses: the range it will reach and a line an option.
export function cardMetamagic(
  sheet: Caster,
  facts: SpellFacts | null,
  // `rounds`: how long what the spell lays lasts, asked only when Extended
  // Spell is paid (it reads the spell's row).
  spell: { shares: number; slotLevel: number | null; rolls: boolean; saves: boolean; rounds: () => number | null },
): { range: SpellRange | null; notes: string[] } {
  const on = metamagicPaid(sheet);
  const notes: string[] = [];
  const cast = factsAsCast(sheet, facts);
  const range = cast && facts && cast.range !== facts.range ? cast.range : null;
  if (range?.kind === "feet") {
    notes.push(`Distant Spell: it reaches ${range.feet} feet.`);
  }
  if (on.twinned) {
    const plan = twinPlan(sheet, { facts, shares: spell.shares, slotLevel: spell.slotLevel });
    notes.push(plan?.problem ? `Twinned Spell does not take it: ${plan.problem}. Its points come back.` : `Twinned Spell: a second creature, for ${plan?.price ?? 1} sorcery point${(plan?.price ?? 1) === 1 ? "" : "s"} in all.`);
  }
  if (on.careful && spell.saves) {
    const count = charismaCount(sheet);
    notes.push(`Careful Spell: up to ${count} of your allies in it succeed on the save.`);
  }
  if (on.empowered && spell.rolls) {
    const count = charismaCount(sheet);
    notes.push(`Empowered Spell: up to ${count} low damage ${count === 1 ? "die is" : "dice are"} rolled again.`);
  }
  const lasts = on.extended ? spell.rounds() : null;
  const longer = extendedRounds(sheet, lasts);
  if (longer && longer !== lasts) {
    notes.push(`Extended Spell: it lasts ${longer % 600 === 0 ? `${longer / 600} hour${longer === 600 ? "" : "s"}` : `${Math.ceil(longer / MINUTE_ROUNDS)} minutes`}.`);
  }
  return { range, notes };
}

// Subtle Spell on the spell being cast: no words, no gestures.
export function subtleSpellPaid(sheet: Marked): boolean {
  return paid(sheet).includes(SUBTLE);
}

// Heightened Spell for the save a spell cast at one creature asks: the
// option on the roll, taken off the sorcerer as it is used.
export function heightenedSave(campaign: Pick<Campaign, "id">, casterId: string): { disadvantage?: true } {
  const sheet = getSheetById(casterId);
  if (!sheet || !paid(sheet).includes(HEIGHTENED)) {
    return {};
  }
  write(campaign, casterId, (conditions) => conditions.filter((entry) => textKey(entry) !== HEIGHTENED));
  return { disadvantage: true };
}

// A spell was cast: what was paid for it is used. Where the spell's save and
// its damage are still to come (`resolvesAfter`: cast at a creature, an area,
// a spell attack), Heightened Spell and Empowered Spell wait for them.
export function clearCastMarks(campaign: Pick<Campaign, "id">, casterId: string, resolvesAfter = false) {
  const sheet = getSheetById(casterId);
  const kept = resolvesAfter ? AFTER_CAST : [];
  if (!sheet || !paid(sheet).some((entry) => !kept.includes(entry))) {
    return;
  }
  write(campaign, casterId, (conditions) => conditions.filter((entry) => !isMark(entry) || kept.includes(textKey(entry))));
}
