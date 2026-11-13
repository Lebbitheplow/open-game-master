// Mystic Arcanum (SRD 5.1, Warlock, 11th, 13th, 15th and 17th level):
// "Your patron bestows upon you a magical secret called an arcanum. Choose
// one 6th-level spell from the warlock spell list as this arcanum", then a
// 7th, an 8th and a 9th. The Spells Known column stops at spells the pact
// slots reach (5th level), so an arcanum is held beside that count, never
// inside it: a level 20 warlock knows fifteen spells and four arcana.
//
// A spell of 6th level or higher a warlock knows IS an arcanum: nothing else
// lets a warlock learn one. The counts read it that way, so the sheet needs
// no field of its own for which spell is the arcanum.
//
// Pure and import-free, read by the creation check, the level-up, the
// level-up dialog and the builder.

const ARCANUM_AT: ReadonlyArray<[number, number]> = [
  [11, 6],
  [13, 7],
  [15, 8],
  [17, 9],
];

// The arcanum spell levels a class of these spell rules has at its level:
// [6] at warlock 11, [6, 7, 8, 9] from 17. Empty for any other class.
export function arcanumLevelsFor(rules: string, level: number): number[] {
  if (rules.trim().toLowerCase() !== "warlock") {
    return [];
  }
  return ARCANUM_AT.filter(([at]) => level >= at).map(([, spellLevel]) => spellLevel);
}

// The highest spell level an arcanum reaches, 0 before 11th level.
export function arcanumTopFor(rules: string, level: number): number {
  return Math.max(0, ...arcanumLevelsFor(rules, level));
}

const ORDINAL: Record<number, string> = { 6: "6th", 7: "7th", 8: "8th", 9: "9th" };

// Why the arcana in a warlock's list break the rule, empty when they keep
// it: one spell of each arcanum level, no more. `spells` are the levelled
// spells held, with their levels (null for a name no list knows).
export function arcanumProblems(
  rules: string,
  level: number,
  spells: ReadonlyArray<{ name: string; level: number | null }>,
): string[] {
  const levels = arcanumLevelsFor(rules, level);
  if (!levels.length) {
    return [];
  }
  const problems: string[] = [];
  for (const spellLevel of levels) {
    const held = spells.filter((spell) => spell.level === spellLevel).map((spell) => spell.name);
    if (held.length > 1) {
      problems.push(
        `Mystic Arcanum is one ${ORDINAL[spellLevel]}-level spell; ${held.join(" and ")} are both ${ORDINAL[spellLevel]} level. Keep one.`,
      );
    }
  }
  return problems;
}

// How many of these spells are arcana: those of an arcanum level, one per
// level at most (a second is a problem arcanumProblems names, and counts as
// a spell known so the count refuses it too).
export function arcanaHeld(rules: string, level: number, spells: ReadonlyArray<{ level: number | null }>): number {
  return arcanumLevelsFor(rules, level).filter((spellLevel) => spells.some((spell) => spell.level === spellLevel)).length;
}

// Why a pick in a level-up's spell list would break the arcanum rule, or
// null when it is fine: a second spell of an arcanum level, or a spell of
// 5th level or lower that would take the room an open arcanum still needs.
// `held`: the levels of the spells known before the level; `picked`: the
// levels of the new picks so far; `room`: how many new spells the level
// gives, the arcana with them.
export function arcanumPickRefusal(input: {
  classId: string;
  level: number;
  held: ReadonlyArray<number | null>;
  picked: ReadonlyArray<number | null>;
  adding: number;
  room: number;
}): string | null {
  const levels = arcanumLevelsFor(input.classId, input.level);
  if (!levels.length) {
    return null;
  }
  const taken = (spellLevel: number) => [...input.held, ...input.picked].includes(spellLevel);
  if (levels.includes(input.adding)) {
    return taken(input.adding) ? `Mystic Arcanum is one ${ORDINAL[input.adding]}-level spell, and you have it. Untick it to choose another.` : null;
  }
  const open = levels.filter((spellLevel) => !taken(spellLevel)).length;
  return input.picked.length + 1 > input.room - open
    ? `Leave room for your Mystic Arcanum: one spell of each arcanum level you have not chosen yet.`
    : null;
}
