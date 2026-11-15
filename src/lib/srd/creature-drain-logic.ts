// A creature's own numbers with what a touch drained from its scores (a
// shadow's Strength Drain: ability-drain-logic.ts keeps the drain as one
// condition per score, "strength reduced (-3)"). A character's sheet builds
// every number from its scores, so the drain reaches it there
// (magic-items.ts effectiveAbilities). A stat block prints its numbers
// instead, and before this a creature's row hit by a shadow, and a summoned
// creature's or a worn form's attacks, kept the block's numbers: a drained
// ogre swung and saved as before and nothing died at Strength 0.
//
// SRD 5.1, Shadow: "the target's Strength score is reduced by 1d4. The
// target dies if this reduces its Strength to 0." What reads the score
// moves with its modifier: the saving throw and the skills of that score,
// and the attacks whose printed bonus is built on it, to hit and damage.
//
// A block's numbers are derived here from the block it keeps and the drain
// conditions it holds (encounters.ts reads every row through drainedBlock),
// so a drain that ends gives the numbers back with it. `scoreFrom` on the
// drain's instance is the score before the first drain, so a block written back
// already lowered (a Polymorph's own form, restored) is not lowered twice.
//
// Pure.

import type { EnemySaveMods, EnemyStats } from "@/lib/bestiary/statblock";
import { saveModFor } from "@/lib/bestiary/enemy-numbers";
import { ABILITY_DRAIN, type DrainAbility } from "@/lib/srd/ability-drain-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";

const mod = (score: number) => Math.floor((score - 10) / 2);
const SCORES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const ABILITY_OF: Record<string, DrainAbility> = { strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha" };

// The skills each score's checks are, as a block files them.
const SKILLS: Record<DrainAbility, string[]> = {
  str: ["athletics"],
  dex: ["acrobatics", "sleight of hand", "stealth"],
  con: [],
  int: ["arcana", "history", "investigation", "nature", "religion"],
  wis: ["animal handling", "insight", "medicine", "perception", "survival"],
  cha: ["deception", "intimidation", "performance", "persuasion"],
};

// SRD 5.1: a creature's proficiency bonus by its challenge rating.
export function proficiencyForCr(cr: number): number {
  return 2 + Math.floor((Math.max(1, cr) - 1) / 4);
}

// The score an attack's printed bonus is built on: the one whose modifier
// with the proficiency bonus makes it (a wolf's bite, +4, is its
// Dexterity's), else Dexterity for a ranged attack and the better of the two
// for a melee one. A spell attack is neither.
export function attackScore(attack: { toHit: number; ranged: boolean; spell?: boolean }, scores: Partial<Record<DrainAbility, number>>, pb: number): "str" | "dex" | null {
  if (attack.spell) {
    return null;
  }
  const { str, dex } = scores;
  if (str === undefined || dex === undefined) {
    return attack.ranged ? "dex" : "str";
  }
  const order: Array<"str" | "dex"> = attack.ranged ? ["dex", "str"] : ["str", "dex"];
  const built = order.find((ability) => attack.toHit === pb + mod(ability === "str" ? str : dex));
  return built ?? (attack.ranged ? "dex" : str >= dex ? "str" : "dex");
}

type DrainMeta = Record<string, { scoreFrom?: number } | undefined>;

// Each drained score: what it now is, and what its modifier lost against
// the score `scores` holds (0 when they already hold the lowered one).
export function drainLoss(scores: Partial<Record<DrainAbility, number>>, conditions: readonly string[], meta?: DrainMeta): Map<DrainAbility, { score: number; delta: number }> {
  const out = new Map<DrainAbility, { score: number; delta: number }>();
  for (const name of conditions) {
    const found = ABILITY_DRAIN.exec(name.trim());
    const ability = found ? ABILITY_OF[found[1].toLowerCase()] : undefined;
    const held = ability ? scores[ability] : undefined;
    if (!ability || typeof held !== "number") {
      continue;
    }
    const from = meta?.[name]?.scoreFrom ?? held;
    const score = Math.max(0, from - Number(found![2]));
    out.set(ability, { score, delta: mod(score) - mod(held) });
  }
  return out;
}

// A dice expression with a flat amount added (negative takes it away).
export function withFlat(expression: string, amount: number): string {
  return amount === 0 ? expression : `${expression}${amount < 0 ? amount : `+${amount}`}`;
}

// The block as a drained creature fights with it. A creature wearing another
// form (polymorphed) has that form's numbers, which the drain never touched.
export function drainedBlock(stats: EnemyStats, conditions: readonly string[], meta?: DrainMeta): EnemyStats {
  if (!stats.abilities || !conditions.some((name) => ABILITY_DRAIN.test(name.trim())) || conditions.some((name) => isConditionNamed(name, "polymorphed"))) {
    return stats;
  }
  const loss = drainLoss(stats.abilities, conditions, meta);
  if (!loss.size) {
    return stats;
  }
  const pb = proficiencyForCr(stats.cr);
  const abilities = { ...stats.abilities };
  const saveMods: EnemySaveMods = stats.saveMods ? { ...stats.saveMods } : (Object.fromEntries(SCORES.map((ability) => [ability, saveModFor(stats, ability)])) as EnemySaveMods);
  const skills = stats.skills ? { ...stats.skills } : undefined;
  let dexMod = stats.dexMod;
  for (const [ability, { score, delta }] of loss) {
    abilities[ability] = score;
    saveMods[ability] = saveModFor(stats, ability) + delta;
    for (const skill of SKILLS[ability]) {
      if (skills && typeof skills[skill] === "number") {
        skills[skill] += delta;
      }
    }
    if (ability === "dex") {
      dexMod += delta;
    }
  }
  const attacks = stats.attacks.map((attack) => {
    const ranged = attack.mode === "ranged" || (!attack.mode && Boolean(attack.range) && !attack.reach);
    const built = attackScore({ toHit: attack.toHit, ranged, spell: attack.spellAttack }, stats.abilities!, pb);
    const delta = built ? (loss.get(built)?.delta ?? 0) : 0;
    return delta ? { ...attack, toHit: attack.toHit + delta, damage: withFlat(attack.damage, delta) } : attack;
  });
  return { ...stats, abilities, saveMods, ...(skills ? { skills } : {}), dexMod, attacks };
}

// A summoned creature's or a worn form's natural attack with the drain on
// its sheet: the scores are the block's (its sheet's, or the form's), and
// the attack's printed bonus moves with the score it is built on.
export function drainedNaturalAttack<A extends { toHit: number; damageExpression: string; ranged: boolean }>(
  profile: A,
  scores: Partial<Record<DrainAbility, number>>,
  conditions: readonly string[],
  cr: number,
): A {
  const loss = drainLoss(scores, conditions);
  const built = loss.size ? attackScore({ toHit: profile.toHit, ranged: profile.ranged }, scores, proficiencyForCr(cr)) : null;
  const delta = built ? (loss.get(built)?.delta ?? 0) : 0;
  return delta ? { ...profile, toHit: profile.toHit + delta, damageExpression: withFlat(profile.damageExpression, delta) } : profile;
}
