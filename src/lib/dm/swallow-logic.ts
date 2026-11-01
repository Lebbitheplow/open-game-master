// What a creature that swallows prints about it (SRD 5.1: the behir, the
// kraken, the purple worm, the remorhaz, the tarrasque, the giant frog and
// the giant toad), read off its line as the engine plays it
// (src/lib/dm/swallow.ts): which creature it can swallow, the save that
// keeps one out, the acid each of its turns, the damage from inside that
// makes it regurgitate, and the feet of movement out of its corpse.
//
// A swallow is printed two ways: a Swallow action ("makes one bite attack
// against a Medium or smaller target it is grappling. If the attack hits,
// the target is also swallowed") and a bite that swallows on a hit (the
// kraken's) or on a failed save (the purple worm's). Either reads to one
// rule. scripts/test-swallow.mjs reads every SRD 5.1 swallower.
//
// Pure: the stat block's lines in, the rule out.

import type { EnemyStats } from "@/lib/bestiary/statblock";
import { abilityKey } from "@/lib/dm/monster-abilities";
import { ABILITY_WORDS } from "@/lib/dm/save-effect";

export type SwallowRule = {
  // The entry that swallows, as printed: "Swallow", or the "Bite" that does.
  entry: string;
  // A Swallow action's attack ("bite"), made at a creature it grapples.
  attack: string | null;
  maxSize: string | null;
  grappledOnly: boolean;
  // The purple worm's: a creature that makes the save is not swallowed.
  save: { ability: string; dc: number } | null;
  acid: { dice: string; type: string } | null;
  // "A behir can have only one creature swallowed at a time."
  onlyOne: boolean;
  // Damage from inside on a single turn, and the Constitution save at the
  // end of it that keeps them in.
  regurgitate: { damage: number; dc: number } | null;
  // The feet of movement out of the corpse once it dies.
  escapeFeet: number | null;
};

export function readSwallowRule(entry: string, text: string): SwallowRule | null {
  if (!/\b(?:is|be|also) swallowed\b/i.test(text)) {
    return null;
  }
  const bite = /\bmakes one (\w[\w ]*?) attack against an? (\w+) or smaller (?:creature|target)\b/i.exec(text);
  const size = bite?.[2] ?? /\bif the target is an? (\w+) or smaller creature\b/i.exec(text)?.[1] ?? null;
  const save = /\bDC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw or be swallowed\b/i.exec(text);
  const acid = /\((\d+d\d+(?:\s*[+-]\s*\d+)?)\) (\w+) damage at the start of each of\b/i.exec(text);
  const regurgitate = /\btakes (\d+) damage or more on a single turn from (?:a creature inside it|the swallowed creature)\b[^.]*?\bDC (\d+) Constitution saving throw\b/i.exec(text);
  const escape = /\bescape from the corpse (?:by )?using (\d+) feet of movement\b/i.exec(text);
  return {
    entry,
    attack: bite ? bite[1].toLowerCase() : null,
    maxSize: size ? size.toLowerCase() : null,
    grappledOnly: /\b(?:it is grappling|grappled by)\b/i.test(text),
    save: save ? { ability: ABILITY_WORDS[save[2].toLowerCase()], dc: Number(save[1]) } : null,
    acid: acid ? { dice: acid[1].replace(/\s+/g, ""), type: acid[2].toLowerCase() } : null,
    onlyOne: /\bonly one (?:creature|target) swallowed at a time\b/i.test(text),
    regurgitate: regurgitate ? { damage: Number(regurgitate[1]), dc: Number(regurgitate[2]) } : null,
    escapeFeet: escape ? Number(escape[1]) : null,
  };
}

type SwallowStats = Pick<EnemyStats, "printed" | "fullTraits">;

// The block's lines whole: the printed actions first, then the uncut trait
// lines ("Swallow: The behir ...") a block without its printed copy keeps.
function entryLines(stats: SwallowStats): Array<{ name: string; text: string }> {
  const lines = (stats.printed?.actions ?? []).map((action) => ({ name: action.name, text: action.desc }));
  for (const line of stats.fullTraits ?? []) {
    const split = /^([^:]{2,80}?):\s+([\s\S]*)$/.exec(line.trim());
    if (split && !lines.some((entry) => abilityKey(entry.name) === abilityKey(split[1]))) {
      lines.push({ name: split[1], text: split[2] });
    }
  }
  return lines;
}

// The block's swallow: the entry named (a bite that swallows, or a Swallow
// action), or else the first line that swallows (a tarrasque's bite swallows
// only as its Swallow, whose line holds the numbers).
export function swallowRuleOf(stats: SwallowStats, entry?: string | null): SwallowRule | null {
  const lines = entryLines(stats);
  const named = entry ? lines.find((line) => abilityKey(line.name) === abilityKey(entry)) : null;
  const own = named ? readSwallowRule(named.name, named.text) : null;
  if (own) {
    return own;
  }
  for (const line of lines) {
    const rule = readSwallowRule(line.name, line.text);
    if (rule) {
      return rule;
    }
  }
  return null;
}

// A Swallow action by name: its rule, which names the attack it makes.
export function swallowActionOf(stats: SwallowStats, name: string): SwallowRule | null {
  const rule = swallowRuleOf(stats, name);
  return rule?.attack && abilityKey(rule.entry) === abilityKey(name) ? rule : null;
}
