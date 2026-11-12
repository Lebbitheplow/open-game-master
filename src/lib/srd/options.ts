// The pick-lists that hang off a class feature: invocations, maneuvers,
// metamagic, pact boons, infusions, runes, elemental disciplines, the
// Hunter ranger's four choices, a Draconic Bloodline sorcerer's dragon, a
// ranger's favored enemies and terrains, a Land druid's terrain, and a
// wizard's Spell Mastery and Signature Spells.
//
// Before this existed a warlock's sheet said "Eldritch Invocations" and
// stopped, so the player never chose any and never got the abilities. The
// storage trick is the one Fighting Style already used: a pick becomes a
// "choice"-sourced feature named with the kind's prefix ("Invocation:
// Agonizing Blast"), which populateFeatures preserves across level-ups, so
// nothing about the sheet schema changes.
//
// Pure data and pure functions, client-importable like the rest of srd/.

import { featOptionSlots } from "@/lib/srd/feat-combat";
import optionsJson from "@/lib/srd/options.json";
import subclassesJson from "@/lib/srd/subclasses.json";
import { subclassNamed } from "@/lib/srd/subclass-name";
import { textKey } from "@/lib/language/text-logic";
import { choiceIn } from "@/lib/srd/feature-names";
import { sameRulesKey } from "@/lib/srd/name-forms";
import { checklistSpellsOn } from "@/lib/srd/spell-lists";

export type OptionKind =
  | "invocation"
  | "maneuver"
  | "metamagic"
  | "pact_boon"
  | "infusion"
  | "rune"
  | "arcane_shot"
  | "discipline"
  | "hunters_prey"
  | "defensive_tactics"
  | "hunter_multiattack"
  | "superior_hunters_defense"
  | "dragon_ancestor"
  | "favored_enemy"
  | "favored_terrain"
  | "land_circle"
  | "spell_mastery_1"
  | "spell_mastery_2"
  | "signature_spell";

export type OptionDef = {
  k: OptionKind;
  n: string;
  d: string;
  req?: string;
  // Half a pick: a favored enemy's humanoid race, two of which make one
  // (SRD 5.1, Favored Enemy: "two races of humanoid").
  half?: boolean;
};

type KindMeta = {
  label: string;
  prefix: string;
  grantedBy: string;
  // Only the stored name ("Dragon Ancestor: Red") names the pick. The bare
  // option ("Red", "Forest", "Shield") is no feature of its own: read as one,
  // a workshop species choice labelled "Gold" was refused as a published
  // feature, and use_reaction "Red" was told the rules knew it (issue #833).
  stored?: boolean;
  // One feature may list several picks ("Favored Enemy: undead, fiends",
  // "Spell Mastery: Shield, Misty Step"), the way the engines read them.
  split?: boolean;
  // The options are the spells of this level on this class's list, the ones
  // in the spellbook where it is known (Spell Mastery, Signature Spells).
  spellLevel?: number;
  spellList?: string;
  // Other feature names the engines read this kind's picks from ("Favored
  // Enemy Improvement: orcs", check-traits.ts), counted toward its slots.
  families?: string[];
};

const KINDS = (optionsJson as { kinds: Record<OptionKind, KindMeta> }).kinds;
const LISTED = (optionsJson as { options: OptionDef[] }).options;

// What a spell pick does, said once for every spell of its list.
const SPELL_PICK_TEXT: Partial<Record<OptionKind, string>> = {
  spell_mastery_1:
    "Spell Mastery: while it is prepared, cast it at 1st level without spending a spell slot, as often as you like.",
  spell_mastery_2:
    "Spell Mastery: while it is prepared, cast it at 2nd level without spending a spell slot, as often as you like.",
  signature_spell:
    "Signature Spell: always prepared and not counted against your prepared spells; once between short or long rests, cast it at 3rd level without a slot.",
};

const spellOptions = new Map<OptionKind, OptionDef[]>();
function spellOptionsOf(kind: OptionKind): OptionDef[] {
  const meta = KINDS[kind];
  if (meta.spellLevel === undefined || !meta.spellList) {
    return [];
  }
  let list = spellOptions.get(kind);
  if (!list) {
    list = checklistSpellsOn(meta.spellList)
      .filter((spell) => spell.level === meta.spellLevel)
      .map((spell) => ({ k: kind, n: spell.name, d: SPELL_PICK_TEXT[kind] ?? "" }));
    spellOptions.set(kind, list);
  }
  return list;
}

export function optionsOfKind(kind: OptionKind): OptionDef[] {
  return KINDS[kind]?.spellLevel !== undefined ? spellOptionsOf(kind) : LISTED.filter((option) => option.k === kind);
}

// What one pick of this option spends of its kind's slots.
export function optionCost(option: Pick<OptionDef, "half">): number {
  return option.half ? 0.5 : 1;
}

// "Invocation: Agonizing Blast". The prefix is what makes a pick findable on
// a sheet without a new column.
export function optionFeatureName(kind: OptionKind, name: string): string {
  return `${KINDS[kind].prefix}${name}`;
}

function optionOfKind(kind: OptionKind, name: string): OptionDef | null {
  const wanted = textKey(name);
  const options = optionsOfKind(kind);
  // A stored kind's pick may be written in the singular or the plural, as
  // the engines read it ("Favored Enemy: orc" is Orcs, name-forms.ts).
  return (
    options.find((option) => textKey(option.n) === wanted) ??
    (KINDS[kind]?.stored ? (options.find((option) => sameRulesKey(textKey(option.n), wanted)) ?? null) : null)
  );
}

// The choices one feature records for a kind: after the prefix ("Dragon
// Ancestor: Red"), or in brackets after the feature that grants the kind
// ("Dragon Ancestor (gold)", "Natural Explorer (forest and swamp)", "Circle
// Spells (Forest)"), the forms the engines read. A kind sharing its prefix
// with another (Spell Mastery's two levels), and every stored kind, counts
// only its own options.
function choicesIn(name: string, kind: OptionKind): string[] {
  const meta = KINDS[kind];
  const trimmed = name.trim();
  const bracket = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(trimmed);
  const families = [meta.grantedBy, ...(meta.families ?? [])];
  const raw =
    choiceIn(trimmed, meta.prefix) ??
    (meta.stored
      ? (families.map((family) => choiceIn(trimmed, family)).find(Boolean) ??
        (bracket && families.some((family) => textKey(bracket[1]) === textKey(family)) ? bracket[2] : null))
      : null);
  if (!raw) {
    return [];
  }
  const parts = meta.split ? raw.split(/,|\band\b/).map((part) => part.trim()).filter(Boolean) : [raw];
  if (!meta.stored) {
    return parts;
  }
  return parts.flatMap((part) => optionOfKind(kind, part)?.n ?? []);
}

// The picks of one kind already on a sheet, as bare option names.
export function chosenOptions(features: Array<{ name: string }>, kind: OptionKind): string[] {
  return features.flatMap((feature) => choicesIn(feature.name, kind));
}

// How much of a kind's slots the sheet's picks fill: a humanoid race is half.
function usedOf(chosen: string[], kind: OptionKind): number {
  return chosen.reduce((sum, name) => sum + optionCost(optionOfKind(kind, name) ?? {}), 0);
}

// Whether a bare name is an option of any kind ("Riposte", "Agonizing Blast").
// A stored kind's bare option is not: "Red" is no feature, "Dragon Ancestor:
// Red" is.
export function isOptionName(name: string): boolean {
  const wanted = textKey(name);
  return (
    LISTED.some((option) => !KINDS[option.k]?.stored && textKey(option.n) === wanted) ||
    findOptionByFeatureName(name) !== null
  );
}

// Any option pick on a sheet, whatever its kind. Used by the help layer so
// "Invocation: Agonizing Blast" can explain itself. Two kinds may share a
// prefix (Spell Mastery's 1st and 2nd level): the one holding the option wins.
export function findOptionByFeatureName(featureName: string): OptionDef | null {
  for (const [kind, meta] of Object.entries(KINDS) as Array<[OptionKind, KindMeta]>) {
    const choice = choiceIn(featureName, meta.prefix);
    if (choice) {
      const found = optionOfKind(kind, choice);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

// How many picks of a kind a character has earned. Descending [level, count]
// tables, first match wins, exactly like the resource tables.
// `opens`: the subclass feature that opens the picks, so a workshop subclass
// that borrowed it (a fighter subclass with Combat Superiority) is granted
// them too, by the level of the class that holds the feature. A name too
// common to mean this subclass alone ("Multiattack") opens them only in the
// grant's own class (`opensInClass`).
type Grant = {
  kind: OptionKind;
  classId: string;
  subclass?: string;
  opens?: string[];
  opensInClass?: boolean;
  steps: Array<[number, number]>;
};

const GRANTS: Grant[] = [
  // Warlock invocations: 2 at level 2, then one at 5, 7, 9, 12, 15 and 18.
  {
    kind: "invocation",
    classId: "warlock",
    steps: [
      [18, 8],
      [15, 7],
      [12, 6],
      [9, 5],
      [7, 4],
      [5, 3],
      [2, 2],
    ],
  },
  { kind: "pact_boon", classId: "warlock", steps: [[3, 1]] },
  {
    kind: "maneuver",
    classId: "fighter",
    subclass: "Battle Master",
    opens: ["Combat Superiority", "Maneuvers"],
    steps: [
      [15, 9],
      [10, 7],
      [7, 5],
      [3, 3],
    ],
  },
  {
    kind: "metamagic",
    classId: "sorcerer",
    steps: [
      [17, 4],
      [10, 3],
      [3, 2],
    ],
  },
  {
    kind: "infusion",
    classId: "artificer",
    steps: [
      [18, 12],
      [14, 10],
      [10, 8],
      [6, 6],
      [2, 4],
    ],
  },
  {
    kind: "rune",
    classId: "fighter",
    subclass: "Rune Knight",
    opens: ["Rune Carver"],
    steps: [
      [15, 5],
      [10, 4],
      [7, 3],
      [3, 2],
    ],
  },
  // An Arcane Archer's Arcane Shot options (XGtE): two at 3rd level, another
  // at 7th, 10th, 15th and 18th (src/lib/dm/mt-fb-arcane-shot.ts runs them).
  {
    kind: "arcane_shot",
    classId: "fighter",
    subclass: "Arcane Archer",
    opens: ["Arcane Shot"],
    steps: [
      [18, 6],
      [15, 5],
      [10, 4],
      [7, 3],
      [3, 2],
    ],
  },
  // The Hunter ranger's one Hunter's Prey pick at 3rd level; Colossus Slayer
  // rides pc_attack (src/lib/dm/pc-attack-damage.ts).
  { kind: "hunters_prey", classId: "ranger", subclass: "Hunter", opens: ["Hunter's Prey"], steps: [[3, 1]] },
  { kind: "defensive_tactics", classId: "ranger", subclass: "Hunter", opens: ["Defensive Tactics"], steps: [[7, 1]] },
  { kind: "hunter_multiattack", classId: "ranger", subclass: "Hunter", opens: ["Multiattack"], opensInClass: true, steps: [[11, 1]] },
  { kind: "superior_hunters_defense", classId: "ranger", subclass: "Hunter", opens: ["Superior Hunter's Defense"], steps: [[15, 1]] },
  // A Draconic Bloodline sorcerer's dragon, chosen at 1st level. Elemental
  // Affinity reads it by name for its damage type
  // (src/lib/srd/spell-damage-riders.ts dragonAncestorType), and nothing let a
  // player choose it, so the feature never did anything.
  { kind: "dragon_ancestor", classId: "sorcerer", subclass: "Draconic Bloodline", opens: ["Dragon Ancestor"], steps: [[1, 1]] },
  // A ranger's favored enemies (1st, 6th, 14th) and favored terrains (1st,
  // 6th, 10th), read by the check riders (src/lib/srd/check-traits.ts) and
  // Foe Slayer (src/lib/dm/attack-features.ts). Nothing let a player name
  // them, so both features read nothing (issue #833).
  {
    kind: "favored_enemy",
    classId: "ranger",
    opens: ["Favored Enemy"],
    steps: [
      [14, 3],
      [6, 2],
      [1, 1],
    ],
  },
  {
    kind: "favored_terrain",
    classId: "ranger",
    opens: ["Natural Explorer"],
    steps: [
      [10, 3],
      [6, 2],
      [1, 1],
    ],
  },
  // A Circle of the Land druid's terrain at 2nd level: its circle spells
  // (src/lib/srd/features.ts featureChoiceOf). It was only chosen in play,
  // from the sheet, so a druid built at 3rd level started without them.
  { kind: "land_circle", classId: "druid", subclass: "Circle of the Land", steps: [[2, 1]] },
  // A wizard's Spell Mastery (18: a 1st- and a 2nd-level spell from the
  // spellbook, src/lib/dm/cast-slot-choice.ts) and Signature Spells (20: two
  // 3rd-level spells, src/lib/dm/caster-features.ts).
  { kind: "spell_mastery_1", classId: "wizard", opens: ["Spell Mastery"], steps: [[18, 1]] },
  { kind: "spell_mastery_2", classId: "wizard", opens: ["Spell Mastery"], steps: [[18, 1]] },
  { kind: "signature_spell", classId: "wizard", opens: ["Signature Spells"], steps: [[20, 2]] },
  {
    kind: "discipline",
    classId: "monk",
    subclass: "Way of the Four Elements",
    opens: ["Disciple of the Elements"],
    steps: [
      [17, 5],
      [11, 4],
      [6, 3],
      [3, 2],
    ],
  },
];

// The subclass a grant belongs to, named by the sheet: exactly, by an alias,
// or with the titles off both sides (src/lib/srd/subclass-name.ts, the rule
// features.ts grants by). A fragment ("Master", "Elements") opens nothing.
const SUBCLASS_ALIASES: Record<string, string[]> = Object.fromEntries(
  Object.values(
    (subclassesJson as unknown as { classes: Record<string, Array<{ name: string; aliases?: string[] }>> }).classes,
  )
    .flat()
    .map((entry) => [entry.name, entry.aliases ?? []]),
);

function subclassMatches(stored: string, wanted: string): boolean {
  return subclassNamed(stored, wanted, SUBCLASS_ALIASES[wanted] ?? []);
}

// `held`: the features this class has granted the character (its own and
// its subclass's, never another class's), for the grants a feature opens.
export function optionSlotsFor(
  classId: string,
  subclass: string,
  level: number,
  kind: OptionKind,
  held: ReadonlyArray<{ name: string }> = [],
): number {
  const heldKeys = new Set(held.map((feature) => textKey(feature.name)));
  const grant = GRANTS.find(
    (entry) =>
      entry.kind === kind &&
      ((entry.classId === textKey(classId) && (!entry.subclass || subclassMatches(subclass, entry.subclass))) ||
        (Boolean(entry.opens?.some((name) => heldKeys.has(textKey(name)))) &&
          (!entry.opensInClass || entry.classId === textKey(classId)))),
  );
  if (!grant) {
    return 0;
  }
  const step = grant.steps.find(([atLevel]) => level >= atLevel);
  return step ? step[1] : 0;
}

// "fighter::Rune: Stone Rune" for every option a class's grant hands out: the
// authored table keys a pick's own row by its held name (authored-coverage.ts
// counts them as features).
export function optionFeatureKeys(): string[] {
  return GRANTS.flatMap((grant) => optionsOfKind(grant.kind).map((option) => `${grant.classId}::${optionFeatureName(grant.kind, option.n)}`));
}

// Every option a grant hands out, held as a feature, with the class (and
// subclass) and the first level the grant opens at: the sweeps build holders
// of the picks that carry their own authored row from it.
export function optionGrantFeatures(): Array<{ classId: string; subclass?: string; level: number; name: string }> {
  return GRANTS.flatMap((grant) => {
    const level = Math.min(...grant.steps.map(([atLevel]) => atLevel));
    return optionsOfKind(grant.kind).map((option) => ({ classId: grant.classId, ...(grant.subclass ? { subclass: grant.subclass } : {}), level, name: optionFeatureName(grant.kind, option.n) }));
  });
}

// The pick-lists a subclass feature of this name opens in a class, by their
// labels: the workshop's subclass editor says so beside a borrowed Combat
// Superiority.
export function optionLabelsOpenedBy(classId: string, name: string): string[] {
  const key = textKey(name);
  return GRANTS.filter(
    (grant) =>
      Boolean(grant.opens?.some((opening) => textKey(opening) === key)) &&
      (!grant.opensInClass || grant.classId === textKey(classId)),
  ).map((grant) => KINDS[grant.kind].label);
}

// Every pick-list this character currently has open, with how many are still
// unspent. The builder and the level-up dialog both render straight from this.
// `remaining` may be a half: one humanoid race taken of a favored enemy pick.
export type OptionSlot = {
  kind: OptionKind;
  label: string;
  total: number;
  chosen: string[];
  remaining: number;
  options: OptionDef[];
};

// Whether one more pick of this option fits the slot.
export function slotTakes(slot: Pick<OptionSlot, "remaining">, option: Pick<OptionDef, "half">): boolean {
  return slot.remaining >= optionCost(option);
}

// "1 still to choose", or "one more humanoid race" when half a pick is left.
export function remainingWords(slot: Pick<OptionSlot, "remaining">): string {
  const whole = Math.floor(slot.remaining);
  const half = slot.remaining - whole >= 0.5;
  return [whole ? `${whole} still to choose` : "", half ? `${whole ? "and " : ""}one more humanoid race to pair` : ""].filter(Boolean).join(" ");
}

// The spells a spellbook holds, for the kinds that pick from it. Undefined:
// the book is not known yet (a builder before its spell step), and every
// spell of the level is offered; an empty book offers none.
function optionsFor(kind: OptionKind, spellbook: readonly string[] | undefined): OptionDef[] {
  const options = optionsOfKind(kind);
  // A known book filters even when it is empty (no spell to master yet), as
  // the route, the level-up and the save judge it (pickInSpellbook).
  if (KINDS[kind].spellLevel === undefined || spellbook === undefined) {
    return options;
  }
  const book = new Set(spellbook.map(textKey));
  return options.filter((option) => book.has(textKey(option.n)));
}

export function openOptionSlots(input: {
  classId: string;
  subclass: string;
  level: number;
  features: Array<{ name: string }>;
  // The feats on the sheet: Martial Adept, Eldritch Adept and Metamagic
  // Adept open picks of their own (src/lib/srd/feat-combat.ts).
  feats?: string[];
  // The wizard's spellbook: Spell Mastery and Signature Spells pick from it.
  spellbook?: readonly string[];
}): OptionSlot[] {
  const slots: OptionSlot[] = [];
  // This class's own features: a feature another class granted opens no
  // picks here.
  const ownFeatures = input.features.filter(
    (feature) => !(feature as { classId?: string }).classId || textKey((feature as { classId?: string }).classId ?? "") === textKey(input.classId),
  );
  for (const kind of Object.keys(KINDS) as OptionKind[]) {
    const total = optionSlotsFor(input.classId, input.subclass, input.level, kind, ownFeatures) + featOptionSlots(input.feats, kind);
    if (total <= 0) {
      continue;
    }
    const chosen = chosenOptions(input.features, kind);
    slots.push({
      kind,
      label: KINDS[kind].label,
      total,
      chosen,
      remaining: Math.max(0, total - usedOf(chosen, kind)),
      options: optionsFor(kind, input.spellbook),
    });
  }
  return slots;
}

// Whether a pick of this option may be made from this spellbook: a spell
// kind's option must be written in it (SRD 5.1, Spell Mastery: "a spell in
// your spellbook"). True for every other kind, and when the book is unknown.
export function pickInSpellbook(option: OptionDef, spellbook: readonly string[] | undefined): boolean {
  if (KINDS[option.k]?.spellLevel === undefined || spellbook === undefined) {
    return true;
  }
  return spellbook.some((name) => textKey(name) === textKey(option.n));
}

// The pick-list a feature of this name opens, by the kinds' grantedBy
// ("Circle Spells" opens the Land druid's terrain), or null.
export function optionKindOpenedBy(feature: string): OptionKind | null {
  const key = textKey(feature);
  return (Object.entries(KINDS) as Array<[OptionKind, KindMeta]>).find(([, meta]) => textKey(meta.grantedBy) === key)?.[0] ?? null;
}

// Whether a kind picks spells from the spellbook (Spell Mastery, Signature
// Spells), so a caller that fills picks waits for the book.
export function picksFromSpellbook(kind: OptionKind): boolean {
  return KINDS[kind]?.spellLevel !== undefined;
}

// What an option's prerequisite ("level 5, Pact of the Blade", "Eldritch
// Blast cantrip") asks that the character does not have, or null. The level
// is the one of the class whose feature opens the kind (a warlock's for an
// invocation, so Eldritch Adept takes none with a level). A requirement the
// table judges ("hex or a curse feature") is met here. The owed picks and the
// level-up both ask (issue #833 review).
export function optionReqProblem(
  option: Pick<OptionDef, "k" | "n" | "req">,
  facts: { classLevel: (classId: string) => number; features: Array<{ name: string }>; cantrips: readonly string[] },
): string | null {
  const req = (option.req ?? "").trim();
  if (!req) {
    return null;
  }
  const classId = GRANTS.find((grant) => grant.kind === option.k)?.classId ?? "";
  for (const part of req.split(",").map((piece) => piece.trim()).filter(Boolean)) {
    const level = /^level (\d+)$/i.exec(part);
    if (level) {
      if (facts.classLevel(classId) < Number(level[1])) {
        return `${option.n} needs ${classId} level ${level[1]}.`;
      }
      continue;
    }
    if (/^pact of the /i.test(part)) {
      if (!chosenOptions(facts.features, "pact_boon").some((boon) => textKey(boon) === textKey(part))) {
        return `${option.n} needs the ${part}.`;
      }
      continue;
    }
    const cantrip = /^(.+) cantrip$/i.exec(part);
    if (cantrip && !facts.cantrips.some((name) => textKey(name) === textKey(cantrip[1]))) {
      return `${option.n} needs the ${cantrip[1]} cantrip.`;
    }
  }
  return null;
}
