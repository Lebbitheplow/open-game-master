// How many of what a summoning spell makes, from which slot, for how long
// (SRD 5.1). Pure: src/lib/dm/summon-cast.ts asks summonPlan before anything
// is spent, and spawns what it answers.

import { findSummonForm, summonFormsHolding, summonFormsOf, type SummonForm } from "@/lib/srd/summon-forms";
import { formatCr, formList } from "@/lib/srd/beast-forms";
import { holdingHint, type ToolError } from "@/lib/dm/tool-errors";
import { compareNames, textKey, words } from "@/lib/language/text-logic";

const HOUR = 600;
const DAY = 14400;

export type SummonSpell = {
  name: string;
  // Durable Summons reads it: a conjuration spell's creatures get its hit points.
  school: string;
  level: number;
  concentration: boolean;
  // Rounds the creatures last (null: until dismissed or destroyed).
  rounds: number | null;
  // The creature types it may call, or the named forms it makes.
  types?: string[];
  forms?: string[];
  // How many creatures of a challenge rating one casting brings (Conjure
  // Animals: [2, 1], [1, 2], [0.5, 4], [0.25, 8]).
  byCr?: Array<[number, number]>;
  // How the count multiplies with the slot ([5, 2]: twice from 5th).
  multiplier?: Array<[number, number]>;
  // One creature of at most this challenge rating, one more per slot level
  // above the spell's own when `crPerSlot`.
  maxCr?: number;
  crPerSlot?: number;
  // Conjure Celestial: a 9th level slot raises the rating to 5.
  maxCrBySlot?: Array<[number, number]>;
  // A fixed number of each named form (Giant Insect), and the creatures one
  // more slot level adds (Animate Dead: two).
  countByForm?: Record<string, number>;
  base?: number;
  perSlotLevel?: number;
  // Create Undead: what each slot level makes, and the options one casting
  // picks between ("five ghouls or two ghasts or wights"), each the forms
  // that share its number.
  bySlot?: Array<[number, Record<string, number>]>;
  options?: string[][];
  // Animate Objects: a budget of objects, larger ones counting for more.
  objectBudget?: { base: number; perSlotLevel: number; cost: Record<string, number> };
  hostileOnBreak?: boolean;
  // Animate Dead, Create Undead: the duration is the caster's control, not
  // the creature's life. When it runs out the undead stays and turns on the
  // party; a casting may instead reassert control over this many of the
  // ones already made (and `reassertPerSlot` more a slot level above).
  controlExpires?: boolean;
  reassert?: number;
  reassertPerSlot?: number;
  // "group": one initiative roll for the lot, on its own turns; "caster": it
  // acts right after its maker (Giant Insect: "they act on your turn").
  initiative: "group" | "caster";
  // Find Steed: one at a time; a new casting replaces the old.
  single?: boolean;
  // Find Steed: an Intelligence below 6 becomes 6.
  minInt?: number;
  // Find Steed: the kind of creature it is instead of its own, the caster's
  // choice ("a fey warhorse"), the first when none is named.
  kinds?: string[];
  // Each target takes its own form (SRD 5.1): Animate Dead raises bones as a
  // skeleton and a corpse as a zombie, Animate Objects animates objects of
  // any size. One casting may bring several forms (cast_buff's `mix`), held
  // to the one budget its slot gives.
  perTarget?: boolean;
  // Phantom Steed's speed.
  speed?: number;
  // Faithful Hound: it acts at the start of its caster's turn (its entry
  // goes right before the caster's).
  beforeCaster?: boolean;
  // The conditions it arrives with (the invisible hound).
  conditions?: string[];
  note: string;
};


const CR_TIERS: Array<[number, number]> = [[2, 1], [1, 2], [0.5, 4], [0.25, 8]];

export const SUMMON_SPELLS: SummonSpell[] = [
  {
    name: "Conjure Animals", school: "conjuration", level: 3, concentration: true, rounds: HOUR, types: ["beast"],
    byCr: CR_TIERS, multiplier: [[5, 2], [7, 3], [9, 4]], initiative: "group",
    note: "Fey spirits in beast form: one beast of CR 2, two of CR 1, four of CR 1/2 or eight of CR 1/4 (twice as many from a 5th level slot, three times from 7th, four from 9th).",
  },
  {
    name: "Conjure Woodland Beings", school: "conjuration", level: 4, concentration: true, rounds: HOUR, types: ["fey"],
    byCr: CR_TIERS, multiplier: [[6, 2], [8, 3]], initiative: "group",
    note: "Fey creatures: one of CR 2, two of CR 1, four of CR 1/2 or eight of CR 1/4 (twice as many from a 6th level slot, three times from 8th).",
  },
  {
    name: "Conjure Minor Elementals", school: "conjuration", level: 4, concentration: true, rounds: HOUR, types: ["elemental"],
    byCr: CR_TIERS, multiplier: [[6, 2], [8, 3]], initiative: "group",
    note: "Elementals: one of CR 2, two of CR 1, four of CR 1/2 or eight of CR 1/4 (twice as many from a 6th level slot, three times from 8th).",
  },
  {
    name: "Conjure Elemental", school: "conjuration", level: 5, concentration: true, rounds: HOUR, types: ["elemental"],
    maxCr: 5, crPerSlot: 1, hostileOnBreak: true, initiative: "group",
    note: "One elemental of CR 5 or lower (one higher for each slot level above 5th). If concentration breaks it stays and turns hostile.",
  },
  {
    name: "Conjure Fey", school: "conjuration", level: 6, concentration: true, rounds: HOUR, types: ["fey", "beast"],
    maxCr: 6, crPerSlot: 1, hostileOnBreak: true, initiative: "group",
    note: "One fey or fey spirit in beast form of CR 6 or lower (one higher for each slot level above 6th). If concentration breaks it stays and turns hostile.",
  },
  {
    name: "Conjure Celestial", school: "conjuration", level: 7, concentration: true, rounds: HOUR, types: ["celestial"],
    maxCr: 4, maxCrBySlot: [[9, 5]], initiative: "group",
    note: "One celestial of CR 4 or lower (CR 5 from a 9th level slot).",
  },
  {
    name: "Animate Dead", school: "necromancy", level: 3, concentration: false, rounds: DAY, forms: ["Skeleton", "Zombie"], perTarget: true,
    base: 1, perSlotLevel: 2, initiative: "group", controlExpires: true, reassert: 4, reassertPerSlot: 2,
    note: "A skeleton or zombie under the caster's command for 24 hours (two more for each slot level above 3rd); a bonus action commands them all.",
  },
  {
    name: "Create Undead", school: "necromancy", level: 6, concentration: false, rounds: DAY, forms: ["Ghoul", "Ghast", "Wight", "Mummy"],
    controlExpires: true, reassert: 3, reassertPerSlot: 1,
    bySlot: [
      [6, { Ghoul: 3 }],
      [7, { Ghoul: 4 }],
      [8, { Ghoul: 5, Ghast: 2, Wight: 2 }],
      [9, { Ghoul: 6, Ghast: 3, Wight: 3, Mummy: 2 }],
    ],
    options: [["Ghoul"], ["Ghast", "Wight"], ["Mummy"]],
    initiative: "group",
    note: "Ghouls under the caster's command for 24 hours; from 8th level ghasts or wights, from 9th mummies.",
  },
  {
    name: "Giant Insect", school: "transmutation", level: 4, concentration: true, rounds: 100,
    forms: ["Giant Centipede", "Giant Spider", "Giant Wasp", "Giant Scorpion"],
    countByForm: { "Giant Centipede": 10, "Giant Spider": 3, "Giant Wasp": 5, "Giant Scorpion": 1 },
    initiative: "caster",
    note: "Ten centipedes, three spiders, five wasps or one scorpion grow giant for 10 minutes and act on the caster's turn.",
  },
  {
    name: "Find Steed", school: "conjuration", level: 2, concentration: false, rounds: null,
    forms: ["Warhorse", "Pony", "Camel", "Elk", "Mastiff"], base: 1, single: true, minInt: 6,
    kinds: ["celestial", "fey", "fiend"],
    initiative: "caster",
    note: "A celestial, fey or fiend steed (the caster's choice: 'fey warhorse'; celestial when none is named) with the chosen form's statistics (Intelligence at least 6), until dismissed or dropped to 0 hit points; one at a time.",
  },
  {
    name: "Phantom Steed", school: "illusion", level: 3, concentration: false, rounds: HOUR, forms: ["Riding Horse"], base: 1,
    speed: 100, initiative: "caster",
    note: "A quasi-real horse with a riding horse's statistics and a speed of 100 feet for an hour; it disappears if it takes any damage.",
  },
  {
    name: "Animate Objects", school: "transmutation", level: 5, concentration: true, rounds: 10, perTarget: true,
    forms: ["Animated Object (Tiny)", "Animated Object (Small)", "Animated Object (Medium)", "Animated Object (Large)", "Animated Object (Huge)"],
    objectBudget: {
      base: 10,
      perSlotLevel: 2,
      cost: { "Animated Object (Tiny)": 1, "Animated Object (Small)": 1, "Animated Object (Medium)": 2, "Animated Object (Large)": 4, "Animated Object (Huge)": 8 },
    },
    initiative: "caster",
    note: "Ten objects (Medium count as two, Large four, Huge eight; two more per slot level above 5th) with the spell's table; a bonus action commands them.",
  },
  {
    name: "Arcane Hand", school: "evocation", level: 5, concentration: true, rounds: 10, forms: ["Arcane Hand"], base: 1,
    initiative: "caster",
    note: "A Large hand of force: AC 20, hit points equal to the caster's hit point maximum, Strength 26; Clenched Fist is a melee spell attack at the caster's bonus for 4d8 force (2d8 more per slot level above 5th); it grapples with its own Strength (Grasping Hand, crushing for 2d6 + the caster's spellcasting modifier), shoves (Forceful Hand) or gives half cover (Interposing Hand).",
  },
  {
    name: "Faithful Hound", school: "conjuration", level: 4, concentration: false, rounds: 8 * HOUR, forms: ["Faithful Hound"], base: 1,
    beforeCaster: true, conditions: ["invisible"], initiative: "caster",
    note: "An invisible phantom watchdog that cannot be harmed and stays where it was conjured for 8 hours; at the start of the caster's turns it bites one hostile creature within 5 feet (the caster's spell attack bonus, 4d8 piercing).",
  },
  {
    name: "Unseen Servant", school: "conjuration", level: 1, concentration: false, rounds: HOUR, forms: ["Unseen Servant"], base: 1,
    initiative: "caster",
    note: "An invisible force (AC 10, 1 hit point, Strength 2) that cannot attack.",
  },
];

// A summoning spell spent through a bare slot would leave its creatures to be
// invented: the refusal that sends it to cast_buff, or null.
export function summonSlotProblem(spell: string): ToolError | null {
  const summoning = summonSpellFor(spell);
  return summoning
    ? { error: `${summoning.name} brings its creatures in with their stat blocks: cast it with cast_buff, the creature in variant (and count for fewer). Nothing was spent.`, retry: true }
    : null;
}

// Animate Dead and Create Undead may be cast to hold the undead already made
// for another day rather than to make more (cast_buff variant "reassert
// control", src/lib/dm/summon-cast.ts), the caster naming which of them
// after it ("reassert control ghast"; SRD 5.1: "up to" so many "creatures
// you have animated"). The kind named, "" for none, or null when the variant
// is no reassert.
export function reassertKind(spell: SummonSpell, variant: string | undefined): string | null {
  const said = words(variant ?? "");
  if (!spell.reassert || said.length < 2 || textKey(said.slice(0, 2).join(" ")) !== "reassert control") {
    return null;
  }
  return said.slice(2).join(" ");
}

export function reassertsControl(spell: SummonSpell, variant: string | undefined): boolean {
  return reassertKind(spell, variant) !== null;
}

export function summonSpellFor(spell: string): SummonSpell | null {
  const wanted = textKey(spell);
  return SUMMON_SPELLS.find((entry) => textKey(entry.name) === wanted) ?? null;
}


export type SummonPlan = { form: SummonForm; count: number; spell: SummonSpell };

// The kind a spell lets its caster choose, read off the name asked for
// ("fey warhorse", "elk (fiend)"), and the name with it taken out; the
// spell's first kind when none is named.
function chosenKind(spell: SummonSpell, named: string): { kind: string | null; rest: string } {
  const kinds = spell.kinds;
  if (!kinds) {
    return { kind: null, rest: named };
  }
  const said = words(named);
  return {
    kind: kinds.find((kind) => said.some((word) => textKey(word) === kind)) ?? kinds[0],
    rest: said.filter((word) => !kinds.includes(textKey(word))).join(" "),
  };
}

// The highest challenge rating a casting from `slotLevel` calls, for a spell
// that calls by challenge rating.
function crCeiling(spell: SummonSpell, slotLevel: number): number | null {
  if (spell.byCr) {
    return spell.byCr[0][0];
  }
  if (spell.maxCr === undefined) {
    return null;
  }
  const bySlot = [...(spell.maxCrBySlot ?? [])].reverse().find(([slot]) => slotLevel >= slot)?.[1];
  return bySlot ?? spell.maxCr + (spell.crPerSlot ?? 0) * Math.max(0, slotLevel - spell.level);
}

// The creatures a casting can be asked for, by name and challenge rating.
function callable(spell: SummonSpell, slotLevel: number): string {
  if (spell.forms) {
    return spell.forms.join(", ");
  }
  const ceiling = crCeiling(spell, slotLevel);
  return formList(summonFormsOf(spell.types ?? [], ceiling ?? Infinity));
}

// The numbers a casting offers, in words: "1, 2, 4 or 8", "1 to 10".
function countWords(counts: readonly number[]): string {
  if (counts.length >= 4 && counts.every((count, index) => count === index + 1)) {
    return `1 to ${counts.length}`;
  }
  return counts.length > 1 ? `${counts.slice(0, -1).join(", ")} or ${counts.at(-1)}` : String(counts[0] ?? 1);
}

// What one casting of `spell` from `slotLevel` makes of the form the caller
// names, or the rule it breaks. `wanted` is one of the numbers the spell
// offers for that creature from that slot (summonCounts); without it the
// casting brings the most. A number it does not offer is refused with the
// ones it does: three wolves from a 3rd level Conjure Animals were three,
// where the spell prints one, two, four or eight.
export function summonPlan(
  spell: SummonSpell,
  slotLevel: number,
  formName: string,
  wanted?: number,
): SummonPlan | ToolError {
  const { kind, rest: named } = chosenKind(spell, formName.trim());
  const found = named ? findSummonForm(named) : spell.forms?.length === 1 ? findSummonForm(spell.forms[0]) : null;
  if (!found) {
    const asked = named ? `${spell.name} has no stat block here for "${named}"; it calls` : `${spell.name} needs the creature in variant`;
    const hint = named ? holdingHint(named, summonFormsHolding(named)) : "";
    const kinds = spell.kinds ? ` as a ${spell.kinds.join(", a ")} (named with it: "${spell.kinds[1]} ${(spell.forms?.[0] ?? "").toLowerCase()}"; ${spell.kinds[0]} when none is named)` : "";
    return { error: `${asked}: ${callable(spell, slotLevel)}${kinds}.${hint} Ask the player which, unless they named one. Nothing was spent.`, retry: true };
  }
  // Find Steed's steed has the form's statistics, but is the kind chosen.
  const form = kind ? { ...found, type: kind } : found;
  if (spell.forms && !spell.forms.includes(form.name)) {
    return { error: `${spell.name} makes ${spell.forms.join(", ")}, not a ${form.name}. Nothing was spent.`, retry: true };
  }
  if (spell.types && !spell.types.includes(form.type)) {
    return { error: `${spell.name} calls a ${spell.types.join(" or ")}; a ${form.name} is a ${form.type}. Nothing was spent.`, retry: true };
  }
  if (spell.byCr && form.cr > spell.byCr[0][0]) {
    return { error: `${spell.name} calls creatures of challenge rating ${formatCr(spell.byCr[0][0])} or lower; a ${form.name} is CR ${formatCr(form.cr)}. Nothing was spent.`, retry: true };
  }
  if (!spell.byCr && spell.maxCr !== undefined) {
    const ceiling = crCeiling(spell, slotLevel) ?? spell.maxCr;
    if (form.cr > ceiling) {
      return { error: `${spell.name} from a level ${slotLevel} slot calls a creature of challenge rating ${formatCr(ceiling)} or lower; a ${form.name} is CR ${formatCr(form.cr)}. Nothing was spent.`, retry: true };
    }
  }
  const row = spell.bySlot && !spell.countByForm ? slotRow(spell, slotLevel) : null;
  if (row && !(row[form.name] > 0)) {
    return { error: `${spell.name} from a level ${slotLevel} slot makes ${Object.entries(row).map(([name, count]) => `${count} ${name.toLowerCase()}s`).join(" or ")}; not a ${form.name}. Nothing was spent.`, retry: true };
  }
  const counts = summonCounts(spell, slotLevel, form);
  if (wanted && wanted > 0 && counts.length && !counts.includes(wanted)) {
    return {
      error: `${spell.name} from a level ${slotLevel} slot brings ${countWords(counts)} of that creature (${form.name}), not ${wanted}. Ask the player which, unless they named one. Nothing was spent.`,
      retry: true,
    };
  }
  const count = wanted && wanted > 0 ? wanted : (counts.at(-1) ?? 1);
  return { form, count: Math.max(1, count), spell };
}

// Which of a caster's undead one reasserting casting holds another day, by
// their place in `held` (their forms, oldest first). Animate Dead holds four
// of any kind, two more a slot level above 3rd. Create Undead holds by kind,
// as its slot prints them, one option per casting: from an 8th level slot
// "five ghouls or two ghasts or wights"; from a 6th, three ghouls. Counted
// alike, an 8th level casting held five wights. The kind the caster names
// (reassertKind) is held first, and picks Create Undead's option; with none
// named, the option holding more of them. A kind they have none of holds
// nothing.
export function reassertHold(spell: SummonSpell, slotLevel: number, held: readonly string[], kind = ""): number[] {
  const named = (index: number) => textKey(held[index]) === textKey(kind);
  const places = held.map((_, index) => index).sort((a, b) => Number(named(b)) - Number(named(a)));
  if (kind && !places.some(named)) {
    return [];
  }
  if (!spell.bySlot || !spell.options) {
    return places.slice(0, (spell.reassert ?? 0) + (spell.reassertPerSlot ?? 0) * Math.max(0, slotLevel - spell.level));
  }
  const row = slotRow(spell, slotLevel);
  let best: number[] = [];
  for (const option of spell.options) {
    if (kind && !option.some((form) => textKey(form) === textKey(kind))) {
      continue;
    }
    const most = Math.max(0, ...option.map((form) => row[form] ?? 0));
    const kept = places.filter((index) => option.some((form) => textKey(form) === textKey(held[index]))).slice(0, most);
    if (kept.length > best.length) {
      best = kept;
    }
  }
  return best;
}

// What a reasserting casting from this slot holds, in words: "up to 5 Ghoul,
// or up to 2 Ghast or Wight".
export function reassertWords(spell: SummonSpell, slotLevel: number): string {
  if (!spell.bySlot || !spell.options) {
    return `up to ${(spell.reassert ?? 0) + (spell.reassertPerSlot ?? 0) * Math.max(0, slotLevel - spell.level)}`;
  }
  const row = slotRow(spell, slotLevel);
  return spell.options
    .map((option) => ({ option, most: Math.max(0, ...option.map((form) => row[form] ?? 0)) }))
    .filter((entry) => entry.most > 0)
    .map((entry) => `up to ${entry.most} ${entry.option.join(" or ")}`)
    .join(", or ");
}

// Create Undead: what a casting from this slot makes, by form.
function slotRow(spell: SummonSpell, slotLevel: number): Record<string, number> {
  return [...(spell.bySlot ?? [])].reverse().find(([slot]) => slotLevel >= slot)?.[1] ?? {};
}

// The numbers of this form one casting from `slotLevel` may bring, fewest
// first, or none when that slot cannot call it. Conjure Animals' caster
// picks one of the options the spell prints (one beast of CR 2 or lower,
// two of CR 1, four of CR 1/2, eight of CR 1/4, twice as many from a 5th
// level slot), so a wolf comes one, two, four or eight at a time; a spell
// that says "up to" (Giant Insect's ten centipedes, Animate Objects' ten
// objects, Create Undead's three corpses) or makes more from a higher slot
// (Animate Dead) brings any number up to its most. The last number is what
// summonPlan brings when no count is asked, and the Hand's picker offers
// these (src/lib/battlemap/hand-summon.ts), so the two cannot disagree.
export function summonCounts(spell: SummonSpell, slotLevel: number, form: Pick<SummonForm, "name" | "cr" | "type">): number[] {
  const above = Math.max(0, slotLevel - spell.level);
  if (spell.forms && !spell.forms.includes(form.name)) {
    return [];
  }
  if (spell.types && !spell.types.includes(form.type)) {
    return [];
  }
  if (spell.byCr) {
    const factor = [...(spell.multiplier ?? [])].reverse().find(([slot]) => slotLevel >= slot)?.[1] ?? 1;
    const counts = spell.byCr.filter(([cr]) => form.cr <= cr).map(([, count]) => count * factor);
    return [...new Set(counts)].sort((a, b) => a - b);
  }
  if (spell.maxCr !== undefined) {
    return form.cr <= (crCeiling(spell, slotLevel) ?? spell.maxCr) ? [1] : [];
  }
  let most: number;
  if (spell.countByForm) {
    most = spell.countByForm[form.name] ?? 1;
  } else if (spell.bySlot) {
    most = slotRow(spell, slotLevel)[form.name] ?? 0;
  } else if (spell.objectBudget) {
    const cost = spell.objectBudget.cost[form.name] ?? 1;
    most = Math.floor((spell.objectBudget.base + spell.objectBudget.perSlotLevel * above) / cost);
  } else {
    most = (spell.base ?? 1) + (spell.perSlotLevel ?? 0) * above;
  }
  return Array.from({ length: Math.max(0, most) }, (_, index) => index + 1);
}

// What the Hand's creature picker reads for a summoning spell (the route
// GET /api/campaigns/[id]/summons): every creature the spell can call from
// some slot, from the same stat blocks summonPlan spawns, with the numbers
// each slot level may bring. The forms a spell names keep its own order;
// the ones it calls by challenge rating come strongest first, then by name.
export type SummonCatalogueForm = {
  name: string;
  // Pact of the Chain's four familiar forms (imp, pseudodragon, quasit,
  // sprite), offered only to a caster who holds the pact.
  chainOnly?: boolean;
  type: string;
  cr: number;
  ac: number;
  hp: number;
  // By slot level ("3"), the numbers it may come in, fewest first.
  counts: Record<string, number[]>;
};

// `calls`: whether the spell names its forms (Giant Insect's four insects)
// or calls any creature of its kinds up to a challenge rating (Conjure
// Animals), which the picker lists under their ratings.
export type SummonCatalogue = {
  spell: string;
  calls: "forms" | "rating";
  forms: SummonCatalogueForm[];
  // The kinds the caster chooses the creature to be instead of its own
  // (Find Steed's and Find Familiar's celestial, fey or fiend), the first
  // being the engine's when none is named.
  kinds?: string[];
  // A casting whose targets each take their own form (Animate Dead, Animate
  // Objects): by slot level, the budget the forms share, and what one of
  // each form costs of it.
  perTarget?: { budgets: Record<string, number>; cost: Record<string, number> };
  // The asking caster may cast it as a ritual (src/lib/dm/cast-rules.ts
  // ritualProblem): no slot, ten minutes longer. Set by the route, which
  // knows the caster.
  ritual?: boolean;
  // Its casting time is a minute or more, so in a fight it is begun and held
  // across the caster's turns, and the Hand deals no card for it. Set by the
  // route from the spell's facts.
  long?: boolean;
};

// One form of a per-target casting and how many of it (cast_buff's `mix`).
export type SummonMixEntry = { variant: string; count: number };

// The budget a per-target casting from `slotLevel` shares out, and what one
// creature of a form costs of it: Animate Objects' ten objects (two more a
// slot level above 5th), a Medium counting two, a Large four, a Huge eight;
// Animate Dead's one creature (two more a slot level above 3rd), each one.
function mixBudget(spell: SummonSpell, slotLevel: number): { budget: number; cost: (form: string) => number } {
  const above = Math.max(0, slotLevel - spell.level);
  if (spell.objectBudget) {
    const objects = spell.objectBudget;
    return { budget: objects.base + objects.perSlotLevel * above, cost: (form) => objects.cost[form] ?? 1 };
  }
  return { budget: (spell.base ?? 1) + (spell.perSlotLevel ?? 0) * above, cost: () => 1 };
}

// A per-target casting's forms and numbers (Animate Dead's two skeletons and
// a zombie), each a form the spell makes, together within the slot's budget,
// or the rule they break. A spell that calls one kind per casting refuses a
// mix: its creature goes in variant.
export function summonMixPlan(spell: SummonSpell, slotLevel: number, mix: readonly SummonMixEntry[]): SummonPlan[] | ToolError {
  if (!spell.perTarget) {
    return { error: `${spell.name} calls one kind of creature per casting: name it in variant (and count for fewer), not mix. Nothing was spent.`, retry: true };
  }
  const plans: SummonPlan[] = [];
  for (const entry of mix) {
    const plan = summonPlan(spell, slotLevel, entry.variant);
    if ("error" in plan) {
      return plan;
    }
    const same = plans.find((held) => held.form.name === plan.form.name);
    if (same) {
      same.count += entry.count;
    } else {
      plans.push({ ...plan, count: entry.count });
    }
  }
  if (!plans.length) {
    return { error: `${spell.name} needs at least one creature in mix. Nothing was spent.`, retry: true };
  }
  const { budget, cost } = mixBudget(spell, slotLevel);
  const used = plans.reduce((sum, plan) => sum + plan.count * cost(plan.form.name), 0);
  if (used > budget) {
    const counted = spell.objectBudget ? " (a Medium object counts as two, a Large four, a Huge eight)" : "";
    return { error: `${spell.name} from a level ${slotLevel} slot brings ${budget} at most${counted}; these come to ${used}. Nothing was spent.`, retry: true };
  }
  return plans;
}

export function summonCatalogue(spell: SummonSpell): SummonCatalogue {
  const candidates = spell.forms
    ? spell.forms.map((name) => findSummonForm(name)).filter((form): form is SummonForm => form !== null)
    : summonFormsOf(spell.types ?? [], crCeiling(spell, 9) ?? Infinity).sort((a, b) => b.cr - a.cr || compareNames(a.name, b.name));
  const forms: SummonCatalogueForm[] = [];
  for (const form of candidates) {
    const counts: Record<string, number[]> = {};
    for (let slot = Math.max(1, spell.level); slot <= 9; slot += 1) {
      const allowed = summonCounts(spell, slot, form);
      if (allowed.length) {
        counts[String(slot)] = allowed;
      }
    }
    if (Object.keys(counts).length) {
      forms.push({ name: form.name, type: form.type, cr: form.cr, ac: form.ac, hp: form.hp, counts });
    }
  }
  const perTarget = spell.perTarget
    ? {
        budgets: Object.fromEntries(Object.keys(forms[0]?.counts ?? {}).map((slot) => [slot, mixBudget(spell, Number(slot)).budget])),
        cost: Object.fromEntries(forms.map((form) => [form.name, mixBudget(spell, spell.level).cost(form.name)])),
      }
    : null;
  return {
    spell: spell.name,
    calls: spell.forms ? "forms" : "rating",
    forms,
    ...(spell.kinds ? { kinds: spell.kinds } : {}),
    ...(perTarget ? { perTarget } : {}),
  };
}
