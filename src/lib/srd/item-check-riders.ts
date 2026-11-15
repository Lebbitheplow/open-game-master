// What a worn magic item does to an ability check. magic-items.ts carries the
// AC, save, score and resistance riders; the SRD items whose numbers ride
// checks are listed here, authored from their SRD 5.1 text, and read by the
// roll resolver (src/lib/dm/rolls.ts) and the passive scores.
//
// The same rules as the other riders: the item is worn (or, where its text
// says so, carried), attuned if it asks for attunement, and a second copy
// adds nothing.

import { countsAsWorn } from "@/lib/srd/wear-slots";
import { textKey } from "@/lib/language/text-logic";
import { rowName, type RowItem } from "@/lib/srd/item-row";
import type { RollKey } from "@/lib/srd/roll-keys";

type Skill = string;

type CheckRiderRow = {
  names: string[];
  requiresAttunement: boolean;
  // Works from the pack ("while this polished agate is on your person").
  carried?: boolean;
  // Added to every ability check (Stone of Good Luck).
  bonus?: number;
  // Added to checks of these skills (Gloves of Thievery: Sleight of Hand).
  skillBonus?: Record<Skill, number>;
  // Added to a Dexterity check made to pick a lock (the check's about
  // 'locks', src/lib/dm/roll-about.ts), with thieves' tools or without.
  lockBonus?: number;
  // Advantage on checks of these skills. The SRD's narrower wording ("that
  // rely on sight", "to move silently") is the ordinary use of the skill,
  // which is how the table reads it.
  advantage?: Skill[];
  effect: string;
};

const ROWS: CheckRiderRow[] = [
  {
    names: ["stone of good luck", "luckstone", "stone of good luck (luckstone)"],
    requiresAttunement: true,
    carried: true,
    bonus: 1,
    effect: "Stone of Good Luck: +1 to ability checks",
  },
  {
    names: ["cloak of elvenkind"],
    requiresAttunement: true,
    advantage: ["stealth"],
    effect: "Cloak of Elvenkind: advantage on Stealth checks",
  },
  {
    names: ["boots of elvenkind"],
    requiresAttunement: false,
    advantage: ["stealth"],
    effect: "Boots of Elvenkind: advantage on Stealth checks to move silently",
  },
  {
    names: ["eyes of the eagle"],
    requiresAttunement: true,
    advantage: ["perception"],
    effect: "Eyes of the Eagle: advantage on Perception checks that rely on sight",
  },
  {
    names: ["robe of eyes"],
    requiresAttunement: true,
    advantage: ["perception"],
    effect: "Robe of Eyes: advantage on Perception checks that rely on sight",
  },
  {
    names: ["eyes of minute seeing"],
    requiresAttunement: false,
    advantage: ["investigation"],
    effect: "Eyes of Minute Seeing: advantage on Investigation checks that rely on sight",
  },
  {
    names: ["gloves of thievery"],
    requiresAttunement: false,
    skillBonus: { sleight_of_hand: 5 },
    lockBonus: 5,
    effect: "Gloves of Thievery: +5 to Sleight of Hand checks and Dexterity checks to pick locks",
  },
];

const keyOf = (name: string) => textKey(name.trim().replace(/^\+\d\s+/, ""));

type NamedRiders = {
  bonus?: number;
  skillBonus?: Record<string, number>;
  advantage?: string[];
  requiresAttunement: boolean;
  carried: boolean;
};

// What a carried item adds to checks, by its row (src/lib/srd/item-row.ts).
export function checkRidersOf(item: RowItem): NamedRiders | null {
  return checkRidersNamed(rowName(item));
}

// What a published item adds to checks, in the workshop's words, for a copy
// to start from (src/lib/workshop/catalog-mechanics.ts).
export function checkRidersNamed(name: string): NamedRiders | null {
  const row = rowFor(name);
  if (!row) {
    return null;
  }
  return {
    requiresAttunement: row.requiresAttunement,
    carried: row.carried === true,
    ...(row.bonus ? { bonus: row.bonus } : {}),
    ...(row.skillBonus ? { skillBonus: row.skillBonus } : {}),
    ...(row.advantage?.length ? { advantage: row.advantage } : {}),
  };
}

function rowFor(name: string): CheckRiderRow | null {
  const key = keyOf(name);
  const bare = keyOf(name.replace(/\s*\([^()]*\)\s*$/, ""));
  return ROWS.find((row) => row.names.some((entry) => textKey(entry) === key || textKey(entry) === bare)) ?? null;
}

type CarriedItem = { name: string; srdName?: string; equipped?: boolean; attuned?: boolean; gear?: unknown };

type RowGear = {
  checks?: { bonus?: number; skillBonus?: Record<string, number>; advantage?: string[] };
  magic?: { requiresAttunement?: boolean; carried?: boolean };
};

// A workshop item's own check riders, as a row of this table: what it adds
// to checks rides on its line (src/lib/homebrew/item-data.ts).
function homebrewRow(item: CarriedItem): CheckRiderRow | null {
  const gear = item.gear as RowGear | undefined;
  const checks = gear?.checks;
  if (!checks) {
    return null;
  }
  const bits = [
    checks.bonus ? `${checks.bonus >= 0 ? "+" : ""}${checks.bonus} to ability checks` : "",
    ...Object.entries(checks.skillBonus ?? {}).map(([skill, bonus]) => `${bonus >= 0 ? "+" : ""}${bonus} to ${skill.replace(/_/g, " ")} checks`),
    checks.advantage?.length ? `advantage on ${checks.advantage.map((skill) => skill.replace(/_/g, " ")).join(", ")} checks` : "",
  ].filter(Boolean);
  return {
    names: [keyOf(item.name)],
    requiresAttunement: gear?.magic?.requiresAttunement === true,
    ...(gear?.magic?.carried ? { carried: true } : {}),
    ...(checks.bonus ? { bonus: checks.bonus } : {}),
    ...(checks.skillBonus ? { skillBonus: checks.skillBonus } : {}),
    ...(checks.advantage?.length ? { advantage: checks.advantage } : {}),
    effect: `${item.name}: ${bits.join("; ")}`,
  };
}

export type ItemCheckRiders = {
  bonus: number;
  advantage: boolean;
  notes: string[];
};

// The rows of the items that count on this character, each once: worn, and
// in a place that lets it count (a second cloak's advantage is not a first
// cloak's, src/lib/srd/wear-slots.ts), attuned where it asks for it.
function countingRows(equipment: CarriedItem[] | undefined): CheckRiderRow[] {
  const rows: CheckRiderRow[] = [];
  for (const item of equipment ?? []) {
    const row = homebrewRow(item) ?? rowFor(rowName(item));
    if (!row || rows.includes(row) || rows.some((seen) => seen.names[0] === row.names[0] && seen.effect === row.effect)) {
      continue;
    }
    if (!row.carried && !countsAsWorn(item, equipment ?? [])) {
      continue;
    }
    if (row.requiresAttunement && !item.attuned) {
      continue;
    }
    rows.push(row);
  }
  return rows;
}

// What a worn item reads from a check's call, as a roll key: the gloves'
// lock bonus rides a raw Dexterity check (a thieves' tools check) about
// 'locks', so an AI GM's call that leaves `about` unnamed is asked for it
// (src/lib/dm/roll-feature-riders.ts unnamedTraitFields) and GAME STATE
// names it. `rawCheck`: a skill check is never asked (Sleight of Hand takes
// the +5 already).
export function itemCheckKeys(equipment: CarriedItem[] | undefined): Array<RollKey & { rawCheck: true }> {
  return countingRows(equipment).some((row) => row.lockBonus)
    ? [{ roll: "check", abilities: ["dex"], about: "locks", rawCheck: true }]
    : [];
}

// The riders the character's items put on one check. `skill` is the skill
// id for a skill check, absent for a raw ability check (which still takes the
// flat bonus of a Stone of Good Luck). `check`: the check's ability and what
// it is about, for a rider keyed to them (the gloves on a lock).
export function itemCheckRiders(
  equipment: CarriedItem[] | undefined,
  skill?: string,
  check: { ability?: string; about?: string } = {},
): ItemCheckRiders {
  const out: ItemCheckRiders = { bonus: 0, advantage: false, notes: [] };
  const picksLock = check.ability === "dex" && check.about === "locks";
  for (const row of countingRows(equipment)) {
    let applies = false;
    if (row.bonus) {
      out.bonus += row.bonus;
      applies = true;
    }
    // "+5 bonus to Dexterity (Sleight of Hand) checks and Dexterity checks
    // made to pick locks" (SRD 5.1, Gloves of Thievery): one bonus, so a
    // Sleight of Hand check that picks a lock takes it once.
    const skillPart = skill ? row.skillBonus?.[skill] ?? 0 : 0;
    const lockPart = picksLock ? row.lockBonus ?? 0 : 0;
    if (skillPart || lockPart) {
      out.bonus += Math.max(skillPart, lockPart);
      applies = true;
    }
    if (skill && row.advantage?.includes(skill)) {
      out.advantage = true;
      applies = true;
    }
    if (applies) {
      out.notes.push(row.effect);
    }
  }
  return out;
}
