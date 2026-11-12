// A sorcerer origin's own spell replaced at a level-up, under the rule its
// feature states (src/lib/srd/subclasses.json):
//
//   Divine Soul, Divine Magic: the affinity spell. "If you replace that spell
//     later, it must become a cleric spell."
//   Aberrant Mind, Psionic Spells: "each time you gain a sorcerer level, one
//     of them may be replaced with a divination or enchantment spell of the
//     same level from the sorcerer, warlock or wizard list."
//   Clockwork Soul, Clockwork Magic: the same, with an abjuration or
//     transmutation spell.
//
// One door: the level-up's spells (src/lib/srd/level-up-spells.ts
// levelUpSpells), where `levelUpForget` names the spell given up. When that
// spell is one of the origin's own, the replacement is one of the spells the
// request names new in `levelUpSpells`, judged by the feature's rule and not
// by the sorcerer's list or the spells known; the swap is recorded on the
// sheet (ar-ws-spell-swap-record.ts), so the spell swapped in is the origin's
// from then on (free of the count, always known, and replaceable again). The
// level-up's offer says so in its spells note (level-up-options.ts), and the
// level-up dialog offers the swap as a pick (originSwapOffer). The library's
// level-up sheet does not: it saves a whole sheet, which cannot carry a swap
// record in (legality/features.ts).
//
// Rulings, where the text leaves a choice:
//   - A request carries one `levelUpForget`, so a level replaces either one of
//     the origin's spells or one spell known the ordinary way, not both.
//   - Of several new spells named, the one that takes the origin spell's
//     place is the first that fits the rule, a spell off the sorcerer's own
//     list before one on it (only the swap can bring that one in); the rest
//     are learned the ordinary way.
//   - The affinity spell's replacement is a cleric spell of any level the
//     sorcerer has slots for: the text names no level, and the class's own
//     rule for a spell learned asks that much.
//   - A psionic or clockwork cantrip (Mind Sliver) is replaced by a cantrip.
//
// Pure.
import { swapRecordFits, swapRecordName, swapsOf, withoutSwapRecords, type SpellSwap } from "@/lib/dm/ar-ws-spell-swap-record";
import { textKey } from "@/lib/language/text-logic";
import { subclassSpellListsFor, subclassSpellsFor } from "@/lib/srd/features";
import type { SpellFacts } from "@/lib/srd/legality/types";
import { dedupeNames, spellOnCasterList, type CasterView } from "@/lib/srd/spell-prep";
import { bundledSpellFacts, bundledSpellNames, bundledSpellSchool } from "@/lib/srd/spell-facts";
import type { ChangeOffer } from "@/lib/srd/level-up-changes";

type SwapRule = {
  feature: string;
  // The schools the new spell may be of; null for any.
  schools: string[] | null;
  // The class lists it may come from, and those lists in words.
  lists: string[];
  listed: string;
  // Of the level of the spell it replaces; otherwise of any level castable.
  sameLevel: boolean;
  // The rule in words.
  say: string;
};

const ARCANE = ["sorcerer", "warlock", "wizard"];
const ARCANE_LISTED = "sorcerer, warlock or wizard";
const RULES: Array<{ classId: string; subclass: string; rule: SwapRule }> = [
  {
    classId: "sorcerer",
    subclass: "Divine Soul",
    rule: { feature: "Divine Magic", schools: null, lists: ["cleric"], listed: "cleric", sameLevel: false, say: "a cleric spell of a level the sorcerer has spell slots for" },
  },
  {
    classId: "sorcerer",
    subclass: "Aberrant Mind",
    rule: {
      feature: "Psionic Spells",
      schools: ["divination", "enchantment"],
      lists: ARCANE,
      listed: ARCANE_LISTED,
      sameLevel: true,
      say: "a divination or enchantment spell of the same level from the sorcerer, warlock or wizard list",
    },
  },
  {
    classId: "sorcerer",
    subclass: "Clockwork Soul",
    rule: {
      feature: "Clockwork Magic",
      schools: ["abjuration", "transmutation"],
      lists: ARCANE,
      listed: ARCANE_LISTED,
      sameLevel: true,
      say: "an abjuration or transmutation spell of the same level from the sorcerer, warlock or wizard list",
    },
  },
];

function ruleFor(classId: string, subclass: string): SwapRule | null {
  return RULES.find((entry) => textKey(entry.classId) === textKey(classId) && textKey(entry.subclass) === textKey(subclass))?.rule ?? null;
}

type Origin = Pick<CasterView, "classId" | "subclass" | "level" | "extras" | "features">;

// The origin's spells a level-up may replace, each as the table names it and
// as it stands now (the spell an earlier level-up put in its place).
export function swappableSpells(view: Origin): Array<{ original: string; current: string }> {
  if (!ruleFor(view.classId, view.subclass)) {
    return [];
  }
  const originals = subclassSpellsFor(view.classId, view.subclass, view.level, view.extras, withoutSwapRecords(view.features));
  const placed = new Map(swapsOf(view.features).map((swap) => [textKey(swap.from), swap.to]));
  return originals.map((original) => ({ original, current: placed.get(textKey(original)) ?? original }));
}

// What the level-up's offer adds to its spells note for an origin, or "":
// the other class's list its spells may come from (Divine Magic, "You can
// learn cleric spells as sorcerer spells": the offer's `list` names the
// sorcerer's alone), and the origin's own spells a level may replace.
export function originSpellNotes(view: Origin): string {
  const rule = ruleFor(view.classId, view.subclass);
  const lists = subclassSpellListsFor(view.classId, view.subclass, view.extras);
  const wider = lists.length ? `${view.subclass}: new spells may also come from the ${lists.join(" and ")} spell list.` : "";
  const spells = swappableSpells(view).map((entry) => entry.current);
  const swap =
    rule && spells.length
      ? `${rule.feature}: levelUpForget may instead name ${spells.length === 1 ? spells[0] : `one of ${spells.join(", ")}`}, to replace it with ${rule.say}, named in levelUpSpells; the new spell stays free of the spells known.`
      : "";
  return [wider, swap].filter(Boolean).join(" ");
}

// Why a spell cannot take the place of an origin spell of `level`, or null.
function misfit(rule: SwapRule, spell: SpellFacts, level: number | null, top: number): string | null {
  if (rule.sameLevel && spell.level !== level) {
    const what = (at: number | null) => (at === 0 ? "a cantrip" : `a level ${at} spell`);
    return `it is ${what(spell.level)}, and the spell it replaces is ${what(level)}`;
  }
  if (!rule.sameLevel && spell.level === 0) {
    return "it is a cantrip";
  }
  if (!rule.sameLevel && spell.level > top) {
    return `it is a level ${spell.level} spell, above the level ${top} the sorcerer has spell slots for`;
  }
  if (rule.schools && !rule.schools.some((school) => textKey(school) === textKey(spell.school ?? ""))) {
    return spell.school ? `its school is ${textKey(spell.school)}` : "the server does not know its school";
  }
  if (!spell.classes.some((entry) => rule.lists.some((list) => textKey(list) === textKey(entry)))) {
    return `it is not on the ${rule.listed} spell list`;
  }
  return null;
}

// The swap as the level-up dialog offers it (LevelUpDialog.tsx, through
// LevelUpChangePick): each origin spell this level may replace, with the
// spells that may take its place, judged by misfit, the rule the door judges
// by, so the dialog offers only what originSwap takes. `candidates` are the
// spells the browser knows (bundledSwapSpells); `held` every spell the caster
// holds now, which the door would not read as new. Null when there is no swap.
export function originSwapOffer(
  view: Origin,
  input: { top: number; held: readonly string[]; candidates: readonly SpellFacts[]; spellOf: (name: string) => SpellFacts | null },
): ChangeOffer | null {
  const rule = ruleFor(view.classId, view.subclass);
  const slots = swappableSpells(view);
  if (!rule || !slots.length) {
    return null;
  }
  // The origin's own spells come free with the level, so the door skips them as new.
  const taken = new Set([...input.held, ...slots.map((slot) => slot.current)].map(textKey));
  const open = input.candidates.filter((spell) => !taken.has(textKey(spell.name)));
  const optionsFor: Record<string, string[]> = {};
  for (const slot of slots) {
    const level = input.spellOf(slot.original)?.level ?? null;
    optionsFor[slot.current] = rule.sameLevel && level === null ? [] : open.filter((spell) => !misfit(rule, spell, level, input.top)).map((spell) => spell.name);
  }
  const froms = slots.map((slot) => slot.current).filter((name) => optionsFor[name].length);
  if (!froms.length) {
    return null;
  }
  const options = dedupeNames(froms.flatMap((name) => optionsFor[name]));
  return {
    kind: "replace",
    label: rule.feature,
    froms,
    options,
    optionsFor,
    shown: {},
    note: `The new spell must be ${rule.say}, and it stays free of your spells known.`,
  };
}

// The request a swap picked in the dialog sends: the spell given up in
// levelUpForget, and its replacement first among levelUpSpells, as originSwap
// takes the first new spell that fits (another new spell may fit as well).
export function originSwapRequest(swap: SpellSwap, spells: readonly string[]): { levelUpForget: string; levelUpSpells: string[] } {
  return { levelUpForget: swap.from, levelUpSpells: dedupeNames([swap.to, ...spells]) };
}

// Every spell the bundled checklist knows, as the swap's rule reads one.
let bundled: SpellFacts[] | null = null;
export function bundledSwapSpells(): SpellFacts[] {
  bundled ??= bundledSpellNames().flatMap((name) => {
    const facts = bundledSpellFacts(name);
    return facts ? [{ name: facts.name, level: facts.level, classes: facts.classes, school: bundledSpellSchool(facts.name) }] : [];
  });
  return bundled;
}

export type OriginSwap =
  | {
      // The caster's lists and features with the swap made.
      features: Array<{ name: string }>;
      known: string[];
      prepared: string[];
      cantrips: string[];
      swap: SpellSwap;
    }
  | { error: string }
  | null;

// `after` holds the lists with the request's new spells already added
// (levelUpSpells does that first); `before` the lists the sheet held. Null
// when the spell given up is not one of the origin's own: the ordinary rule
// for a spell known answers.
export function originSwap(input: {
  before: CasterView;
  after: CasterView;
  forget: string;
  // The highest spell level the class casts after the level.
  top: number;
  spellOf: (name: string) => SpellFacts | null;
}): OriginSwap {
  const { before, after, forget } = input;
  const rule = ruleFor(after.classId, after.subclass);
  const slot = swappableSpells(after).find((entry) => textKey(entry.current) === textKey(forget));
  if (!rule || !slot) {
    return null;
  }
  const ours = `${after.subclass}'s ${rule.feature}`;
  const held = new Set([...before.known, ...before.prepared, ...before.pending, ...before.cantrips, ...before.spellbook].map(textKey));
  const named = dedupeNames([...after.known, ...after.cantrips]).filter((name) => !held.has(textKey(name)));
  if (!named.length) {
    return { error: `${slot.current} is one of the spells of ${ours}: to give it up, name the spell that takes its place in levelUpSpells (${rule.say}). Nothing was changed.` };
  }
  const level = input.spellOf(slot.original)?.level ?? null;
  if (rule.sameLevel && level === null) {
    return { error: `The server does not know the level of ${slot.original}, so it cannot judge a spell of the same level to replace it. Nothing was changed.` };
  }
  const judged = named.map((name) => {
    const spell = input.spellOf(name);
    return { name, spell, why: spell ? misfit(rule, spell, level, input.top) : "it is not a spell this server knows" };
  });
  const fits = judged.flatMap((entry) => (entry.spell && !entry.why ? [entry.spell] : []));
  if (!fits.length) {
    return { error: `${judged[0].spell?.name ?? judged[0].name} cannot take the place of ${slot.current}: ${judged[0].why}. ${ours} replaces one of its spells with ${rule.say}. Nothing was changed.` };
  }
  const taken = fits.find((spell) => !spellOnCasterList(after, spell)) ?? fits[0];
  const swap: SpellSwap = { from: slot.original, to: taken.name };
  // Back to the spell the table names: the record is dropped.
  const back = textKey(swap.from) === textKey(swap.to);
  if (!back && !swapRecordFits(swap)) {
    return { error: `${swap.from} and ${swap.to} are too long to record as one swap on the sheet; choose a spell with a shorter name. Nothing was changed.` };
  }
  const records = [...swapsOf(after.features).filter((entry) => textKey(entry.from) !== textKey(slot.original)), ...(back ? [] : [swap])];
  const gone = textKey(forget);
  const without = (list: string[]) => list.filter((name) => textKey(name) !== gone);
  return {
    features: [...withoutSwapRecords(after.features), ...records.map((entry) => ({ name: swapRecordName(entry) }))],
    known: without(after.known),
    prepared: without(after.prepared),
    // A cantrip swapped in is filed with the origin's spells, as the one it
    // replaced was, and not among the cantrips the class counts.
    cantrips: without(after.cantrips).filter((name) => textKey(name) !== textKey(taken.name)),
    swap,
  };
}
