import type { EnemyAttack, EnemyStats, RoutineStep } from "@/lib/bestiary/statblock";
import { textKey } from "@/lib/language/text-logic";
import { pluralForms } from "@/lib/srd/name-forms";

// How an enemy's attack reaches (SRD 5.1, Monsters: melee or ranged, reach,
// normal and long range) and which attacks a turn of it makes (its
// Multiattack routine). Pure: enemy-attack.ts and enemy-approach.ts read it,
// and opportunity.ts asks it for an enemy's reach.
//
// A block parsed from its printed text carries mode, reach and range. One
// written by hand or snapshotted before those fields keeps the old reading:
// ranged by the attack's name, 60 feet, reach from a "reach 10 ft" anywhere
// in its name or traits.

const TILE_FEET = 5;

const RANGED_ATTACK_RE =
  /bow|crossbow|sling|dart|javelin|thrown|spit|spine|rifle|pistol|gun|blast|bolt|ray|breath|web|rock|spear of|longarm/i;
const FALLBACK_RANGE_TILES = 12;

// Whether an enemy attack name reads as a ranged attack: the reading for a
// block that does not say.
export function isRangedAttackName(attackName: string): boolean {
  return RANGED_ATTACK_RE.test(attackName);
}

export type EnemyAttackProfile = {
  melee: boolean;
  ranged: boolean;
  reachTiles: number;
  rangeTiles: number;
  longRangeTiles: number;
};

export function enemyAttackProfile(attack: EnemyAttack, traits: string[] = []): EnemyAttackProfile {
  if (!attack.mode) {
    const ranged = isRangedAttackName(attack.name);
    const reach = /reach 1[05] ft/i.test(`${attack.name} ${traits.join(" ")}`) ? 2 : 1;
    return {
      melee: !ranged,
      ranged,
      reachTiles: reach,
      rangeTiles: FALLBACK_RANGE_TILES,
      longRangeTiles: FALLBACK_RANGE_TILES,
    };
  }
  const melee = attack.mode !== "ranged";
  const ranged = attack.mode !== "melee";
  const normal = attack.range ? Math.max(1, Math.floor(attack.range.normal / TILE_FEET)) : FALLBACK_RANGE_TILES;
  const long = attack.range ? Math.max(normal, Math.floor(attack.range.long / TILE_FEET)) : normal;
  return {
    melee,
    ranged,
    reachTiles: melee ? Math.max(1, Math.floor((attack.reach ?? TILE_FEET) / TILE_FEET)) : 0,
    rangeTiles: ranged ? normal : 0,
    longRangeTiles: ranged ? long : 0,
  };
}

// The first melee attack of a block, the one an opportunity attack is made
// with, and its reach in squares. Null when the block has no melee attack.
export function opportunityWeapon(stats: Pick<EnemyStats, "attacks" | "traits">): { attack: EnemyAttack; reachTiles: number } | null {
  for (const attack of stats.attacks ?? []) {
    const profile = enemyAttackProfile(attack, stats.traits ?? []);
    if (profile.melee) {
      return { attack, reachTiles: profile.reachTiles };
    }
  }
  return null;
}

// How one swing is made from `distance` squares away: in melee within
// reach, ranged within long range (at disadvantage past normal range), or
// not at all. Null distance means no board: the attack's own kind decides.
export function swingMode(
  profile: EnemyAttackProfile,
  distance: number | null,
): { ranged: boolean; longRange: boolean } | null {
  if (distance === null) {
    return { ranged: !profile.melee, longRange: false };
  }
  if (profile.melee && distance <= profile.reachTiles) {
    return { ranged: false, longRange: false };
  }
  if (profile.ranged && distance <= profile.longRangeTiles) {
    return { ranged: true, longRange: distance > profile.rangeTiles };
  }
  return null;
}

const attackKey = (name: string) => textKey(name.replace(/\([^)]*\)/g, ""));

// The attack a name is, whole, with or without a tag in brackets ("Fire
// Breath (Recharge 5-6)"). Null for any other name: never the attack whose
// name holds it, nor the first.
export function attackNamed(attacks: EnemyAttack[], wanted: string): EnemyAttack | null {
  const key = textKey(wanted);
  if (!key) {
    return null;
  }
  return attacks.find((attack) => textKey(attack.name) === key || attackKey(attack.name) === attackKey(wanted)) ?? null;
}

// A step that follows only a hit (the grick's beak) is marked on the swing,
// and enemy-attack.ts skips it after a miss. A step whose count is rolled
// (a violet fungus's 1d4 Rotting Touches) is rolled by `rollCount` when the
// caller makes the swings, and is its average count for a caller that only
// shows them.
function expand(routine: RoutineStep[], attacks: EnemyAttack[], rollCount?: (dice: string) => number): EnemyAttack[] {
  return routine.flatMap((step) => {
    const found = attackNamed(attacks, step.attack);
    const attack = found && step.ifHit ? { ...found, onlyIfHit: true } : found;
    const count = step.dice && rollCount ? rollCount(step.dice) : step.count;
    return attack ? new Array<EnemyAttack>(Math.max(1, Math.min(10, count))).fill(attack) : [];
  });
}

// The attacks one enemy_attack call makes, in order, for the attack asked
// for (attackNamed: the caller refuses a name it is not). A block with a
// routine walks the routine that holds the attack asked for (the first when
// none is asked for); an attack no routine names is one swing of it, as a
// legendary action's attack is. A block with only a count repeats the
// attack asked for (or its first) that many times. A single swing is the
// one asked for, which the caller requires of a block with several.
// The blow a swing deals: the block's own, or what it prints instead at half
// its hit points or fewer ("or 5 (2d4) piercing damage if the swarm has half
// of its hit points or fewer") or at range ("in melee or 5 (1d6 + 2)
// piercing damage at range"). The bloodied blow wins when both apply.
export function alternativeBlow(attack: EnemyAttack, when: { ranged: boolean; bloodied: boolean }): EnemyAttack {
  const alternatives = attack.alternatives ?? [];
  const chosen =
    (when.bloodied ? alternatives.find((entry) => entry.when === "bloodied") : undefined) ??
    (when.ranged ? alternatives.find((entry) => entry.when === "ranged") : undefined);
  if (!chosen) {
    return attack;
  }
  const blow: EnemyAttack = { ...attack, damage: chosen.damage, type: chosen.type };
  if (chosen.riders?.length) {
    blow.riders = chosen.riders;
  } else {
    delete blow.riders;
  }
  return blow;
}

// A crossbow or a blowgun: a Loading weapon (SRD 5.1, Weapons), which fires
// once per action however many attacks the creature has. A stat block does
// not print the property, so the weapon's name tells it.
const LOADING_WEAPON_RE = /\b(?:crossbow|blowgun)\b/i;

// Whether a Multiattack's words name the attack, whole, either side plural:
// "spike attacks" names Spike, "two heavy crossbow attacks" Heavy Crossbow.
function multiattackNames(multiattack: string, attack: EnemyAttack): boolean {
  const said = ` ${textKey(multiattack)} `;
  const bare = attackKey(attack.name);
  return Boolean(bare) && [bare, ...pluralForms(bare)].some((form) => said.includes(` ${form} `));
}

// Whether a Multiattack that prints only a count ("The thug makes two melee
// attacks") leaves `attack` out, so a turn of it is one attack: a Loading
// weapon, or an attack made only at range when the Multiattack's attacks
// are melee ones. A thug's Heavy Crossbow is one shot, not two (SRD 5.1,
// Thug); a scout's "two ranged attacks" are still two. A Multiattack that
// names the attack counts it, its own words over the general rule: a
// mordant snare's "four melee attacks, using any combination of tentacle
// attacks, spike attacks, and filament attacks" throws four Spikes.
function outsideMultiattackCount(stats: { traits?: string[] }, attack: EnemyAttack): boolean {
  const traits = stats.traits ?? [];
  const multiattack = traits.find((trait) => /^multiattack\b/i.test(trait)) ?? "";
  if (multiattack && multiattackNames(multiattack, attack)) {
    return false;
  }
  if (LOADING_WEAPON_RE.test(attack.name)) {
    return true;
  }
  const meleeOnly = /\bmelee attacks?\b/i.test(multiattack) && !/\branged attacks?\b/i.test(multiattack);
  return meleeOnly && !enemyAttackProfile(attack, traits).melee;
}

const RANGED_COUNT_RE = /\b(one|two|three|four|five|six|\d)\s+ranged attacks?\b/i;
const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

// How many of a turn's swings may be made at range when its Multiattack
// counts melee attacks, or null when it sets no such limit. "The cult
// fanatic makes two melee attacks" counts no thrown dagger, so a turn of
// throws is one, as the Attack action's; "three melee attacks or two ranged
// attacks" throws two (SRD 5.1, Gladiator). plannedSwings cannot tell: a
// dagger or a spear is melee or thrown by where the target stands, which the
// caller learns after the walk. An attack the Multiattack names is its own.
export function rangedSwingsAllowed(traits: string[] | undefined, attack: EnemyAttack): number | null {
  const multiattack = (traits ?? []).find((trait) => /^multiattack\b/i.test(trait)) ?? "";
  if (!/\bmelee attacks?\b/i.test(multiattack) || multiattackNames(multiattack, attack)) {
    return null;
  }
  const ranged = RANGED_COUNT_RE.exec(multiattack);
  if (ranged) {
    return COUNT_WORDS[ranged[1].toLowerCase()] ?? Number(ranged[1]);
  }
  return /\branged attacks?\b/i.test(multiattack) ? null : 1;
}

// Why a swing at range is not made, when the turn has already made the
// ranged attacks its Multiattack leaves room for; null to make it.
export function pastRangedLimit(traits: string[] | undefined, attack: EnemyAttack, made: number): string | null {
  const allowed = rangedSwingsAllowed(traits, attack);
  if (allowed === null || made < allowed) {
    return null;
  }
  return `its Multiattack's melee attacks leave ${allowed === 1 ? "one attack" : `${allowed} attacks`} at range a turn`;
}

// The count a Multiattack prints for this attack ("two hand crossbow
// attacks"), or null. A Multiattack whose routine was not read (the Tome of
// Beasts scheznyki's "four war pick attacks or two hand crossbow attacks"
// names a war pick its block calls Heavy Pick) still says how many of a
// named attack a turn is: the crossbow shot four times for the count of the
// first group.
function printedCount(multiattack: string, attack: EnemyAttack): number | null {
  const words = textKey(multiattack).split(" ");
  const bare = attackKey(attack.name);
  for (const form of bare ? [bare, ...pluralForms(bare)] : []) {
    const parts = form.split(" ");
    for (let index = 1; index + parts.length < words.length; index += 1) {
      const said = parts.every((part, offset) => words[index + offset] === part) && /^attacks?$/.test(words[index + parts.length]);
      const count = said ? (COUNT_WORDS[words[index - 1]] ?? Number(words[index - 1])) : NaN;
      if (count >= 1) {
        return count;
      }
    }
  }
  return null;
}

// A routine's swings with a Loading weapon the Multiattack does not name
// made once: the wererat's "two attacks, only one of which can be a bite"
// is read as routines of any two of its attacks, and its Hand Crossbow
// still fires once per action (SRD 5.1, Weapons: Loading).
function loadedOnce(stats: { traits?: string[] }, swings: EnemyAttack[]): EnemyAttack[] {
  return swings.filter(
    (swing, index) =>
      swings.indexOf(swing) === index ||
      !LOADING_WEAPON_RE.test(swing.name) ||
      !outsideMultiattackCount(stats, swing),
  );
}

export function plannedSwings(
  stats: Pick<EnemyStats, "attacks" | "attacksPerTurn" | "routines"> & { traits?: string[] },
  attacks: EnemyAttack[],
  asked: EnemyAttack | null,
  // `reaches`: whether a swing can land on the target this turn, walk and
  // all. Of several routines that could be the turn, the first whose every
  // swing reaches: a bandit captain out of melee reach throws "two ranged
  // attacks with its daggers" (SRD 5.1), where its first routine, "two with
  // its scimitar and one with its dagger", left it nothing to land.
  options: { single?: boolean; rollCount?: (dice: string) => number; reaches?: (attack: EnemyAttack) => boolean } = {},
): EnemyAttack[] {
  if (!attacks.length) {
    return [];
  }
  if (options.single) {
    return [asked ?? attacks[0]];
  }
  const routines = (stats.routines ?? []).map((routine) => expand(routine, attacks, options.rollCount)).filter((swings) => swings.length);
  if (routines.length) {
    const holding = asked ? routines.filter((swings) => swings.includes(asked)) : routines;
    const reaches = options.reaches;
    const landing = reaches && holding.length > 1 ? holding.find((swings) => swings.every(reaches)) : undefined;
    const chosen = landing ?? holding[0];
    return chosen ? loadedOnce(stats, chosen) : [asked ?? attacks[0]];
  }
  const swing = asked ?? attacks[0];
  const multiattack = (stats.traits ?? []).find((trait) => /^multiattack\b/i.test(trait)) ?? "";
  // Only for an attack asked for: the turn no attack is named for keeps the
  // whole count, its first attack the one swung.
  const printed = asked && multiattack ? printedCount(multiattack, asked) : null;
  const count = Math.max(1, Math.min(10, printed ?? Math.floor(stats.attacksPerTurn ?? 1)));
  return new Array<EnemyAttack>(outsideMultiattackCount(stats, swing) ? 1 : count).fill(swing);
}

// Whether a creature is charmed by `sourceId`: a charmed creature cannot
// attack its charmer or target it with harmful abilities or magic (SRD 5.1,
// Charmed). Only a charm that names its source binds.
export function charmedBy(
  conditions: string[],
  meta: Record<string, { source?: string } | undefined> | undefined,
  sourceId: string,
): boolean {
  const charmed = conditions.find((entry) => entry.toLowerCase() === "charmed");
  return Boolean(charmed && meta?.[charmed]?.source && meta[charmed]?.source === sourceId);
}
