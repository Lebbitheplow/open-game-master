// Mystic Arcanum (SRD 5.1, Warlock, 11th, 13th, 15th and 17th level):
// "Your patron bestows upon you a magical secret called an arcanum. Choose
// one 6th-level spell from the warlock spell list as this arcanum", then a
// 7th, an 8th and a 9th. The Spells Known column stops at spells the pact
// slots reach (5th level), so an arcanum is held beside that count, never
// inside it: a level 20 warlock knows fifteen spells and four arcana.
//
// A spell of an arcanum level a warlock knows IS an arcanum: nothing else
// lets a warlock learn one. The counts read it that way, so the sheet needs
// no field of its own for which spell is the arcanum. Before this the
// level-up and the creation check counted the arcanum as a spell known (a
// warlock reaching 11th level gave up the level's new spell to take it) and
// let two 6th level spells in.
//
// The one rule, read by the creation check, the level-up and its offer and
// dialog, learn_spell, the builder and its quick fill, a companion's build
// and a library sheet's trim to a lower table.

import { classFeaturesFor } from "@/lib/srd/features";
import { isNamed } from "@/lib/srd/feature-names";
import { spellLevelOf } from "@/lib/srd/spell-lists";
import { textKey } from "@/lib/language/text-logic";

// The features that teach one spell of a level past the slots, each held
// beside the count as an arcanum is: the warlock's Mystic Arcanum (6th at
// 11th level up to 9th at 17th), and the occultist's Apocrypha (13th) and
// Seventh Seal (17th), src/lib/classes/horror-features.json: "Learn one
// 6th-level (7th-level) warlock spell; cast it 1/long rest without a slot"
// (src/lib/dm/genre-a-casts.ts genreFreeCast pays the cast).
const ARCANUM_FEATURES: ReadonlyArray<{ feature: string; at: ReadonlyArray<[number, number]> }> = [
  {
    feature: "Mystic Arcanum",
    at: [
      [11, 6],
      [13, 7],
      [15, 8],
      [17, 9],
    ],
  },
  { feature: "Apocrypha", at: [[13, 6]] },
  { feature: "Seventh Seal", at: [[17, 7]] },
];

type ArcanumView = { classId: string; level: number };

// Only a class whose own table holds one of these features has an arcanum:
// the warlock, or a class that lists Mystic Arcanum, Apocrypha or Seventh
// Seal. A setting pact caster on the warlock's tables without one (Grave
// Knight) has no slot above 5th, so it never learns a 6th to 9th level
// spell; issue #833 had let every class on those tables reach past its slots.
function arcanumFeaturesOf(classId: string): typeof ARCANUM_FEATURES {
  const id = textKey(classId);
  if (!id) {
    return [];
  }
  const own = classFeaturesFor(classId, "", 20);
  return ARCANUM_FEATURES.filter(
    (entry) => (entry.feature === "Mystic Arcanum" && id === "warlock") || own.some((feature) => isNamed(feature.name, entry.feature)),
  );
}

export function holdsMysticArcanum(classId: string): boolean {
  return arcanumFeaturesOf(classId).length > 0;
}

// The arcanum spell levels a class has at its level: [6] at warlock 11,
// [6, 7, 8, 9] from 17, [6, 7] for an occultist from 17. Empty for a class
// without one.
export function mysticArcanumLevels(view: ArcanumView): number[] {
  const levels = new Set<number>();
  for (const entry of arcanumFeaturesOf(view.classId)) {
    for (const [at, spellLevel] of entry.at) {
      if (view.level >= at) {
        levels.add(spellLevel);
      }
    }
  }
  return [...levels].sort((a, b) => a - b);
}

// The feature a class's arcanum of `spellLevel` comes from, for the words a
// player reads ("Mystic Arcanum", "Apocrypha"); with no level, every one the
// class holds ("Apocrypha and Seventh Seal").
export function arcanumName(classId: string, spellLevel?: number | null): string {
  const held = arcanumFeaturesOf(classId);
  const of = typeof spellLevel === "number" ? held.filter((entry) => entry.at.some(([, level]) => level === spellLevel)) : held;
  return of.length ? of.map((entry) => entry.feature).join(" and ") : "Mystic Arcanum";
}

// The highest spell level an arcanum reaches, 0 before 11th level or for a
// class without one.
export function mysticArcanumTop(classId: string, level: number): number {
  return Math.max(0, ...mysticArcanumLevels({ classId, level }));
}

// Which of `names` are the arcana: the first spell of each arcanum level.
// `extra` are further spells of a level whose arcanum is already taken, which
// no feature lets a warlock hold; `open` the arcanum levels with no spell
// yet. `levelOf` reads a content pack's or the table's spells too; a name
// of no known level is never an arcanum, so it counts as a spell known.
export function arcanumSplit(
  view: ArcanumView,
  names: ReadonlyArray<string>,
  levelOf: (name: string) => number | null = spellLevelOf,
): { arcanum: string[]; extra: string[]; open: number[] } {
  const levels = mysticArcanumLevels(view);
  if (!levels.length) {
    return { arcanum: [], extra: [], open: [] };
  }
  const taken = new Map<number, string>();
  const extra: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const key = textKey(name);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const level = levelOf(name) ?? spellLevelOf(name);
    if (level === null || !levels.includes(level)) {
      continue;
    }
    if (taken.has(level)) {
      extra.push(name);
    } else {
      taken.set(level, name);
    }
  }
  return { arcanum: [...taken.values()], extra, open: levels.filter((level) => !taken.has(level)) };
}

// The refusal for a second spell of an arcanum level, or null. `classId`
// names the feature (Mystic Arcanum, Apocrypha).
export function arcanumExtraProblem(
  split: { arcanum: string[]; extra: string[] },
  levelOf: (name: string) => number | null = spellLevelOf,
  classId = "warlock",
): string | null {
  const [extra] = split.extra;
  if (!extra) {
    return null;
  }
  const level = levelOf(extra) ?? spellLevelOf(extra);
  const held = split.arcanum.find((name) => (levelOf(name) ?? spellLevelOf(name)) === level);
  return `${arcanumName(classId, level)} teaches one spell of level ${level}: ${held} is already that arcanum, so ${extra} cannot be learned too.`;
}
