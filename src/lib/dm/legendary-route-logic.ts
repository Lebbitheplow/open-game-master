// What each legendary option does, read off its line as the engine plays it
// (issue 685 audit, 4.G): the GM's monsters' Hand plays every option of the
// SRD 5.1 bestiary through the engine as a card, and the console and the AI
// spend it through legendary_action. An option is one or more ways to play
// it ("makes one claw attack or tail attack" is two), each a short list of
// steps by mechanism:
//
//   attack    one swing of a named attack (enemy_attack, a legendary strike)
//   swallow   that swing against a creature it grapples, which a hit swallows
//   save      an ability's save on one creature or on everyone caught
//             (cast_at_player or aoe_damage with enemyAbility)
//   check     an ability check the server rolls from the block's bonus
//   move      a walk or a flight, with or without opportunity attacks
//   teleport  a jump to a square in range (no path, nothing provoked)
//   spell     a cantrip or a spell from its own list, through the spell tools
//   heal      hit points it regains
//   ward      an Armor Class bonus on itself or a creature in range
//   noRegain  creatures in range who cannot regain hit points for a round
//   drain     damage to a creature it charms, healing it by as much
//   cloud     a lasting area laid around it (a zone row of its own)
//   fling     a creature it grapples thrown, knocked prone and hurt
//
// An option the reader finds no way to play (a homebrew line, a line in
// another language) has no route: it stays a spend and a line for the GM,
// and the card says so. scripts/test-legendary-routes.mjs walks every
// legendary option of the SRD 5.1 bestiary and fails on one left unrouted.
//
// Pure: the stat block in, the routes out.

import type { EnemyAttack, EnemyStats } from "@/lib/bestiary/statblock";
import { sectionOfLine } from "@/lib/bestiary/block-sections";
import { abilityKey, findMonsterAbility, type MonsterAbility } from "@/lib/dm/monster-abilities";
import { ABILITY_WORDS } from "@/lib/dm/save-effect";
import { containsPhrase, textKey } from "@/lib/language/text-logic";

export type LegendaryLine = { name: string; cost: number; text: string };

export type LegendaryStep =
  | { kind: "attack"; attack: string }
  // entry: the block's Swallow, which enemy_attack plays by name.
  | { kind: "swallow"; attack: string; maxSize: string; entry: string }
  | { kind: "save"; ability: string; most: number | null }
  | { kind: "check"; ability: string; skill: string | null }
  // feet: a count of feet, else its speed (`fraction` of it, flying for "fly").
  | { kind: "move"; feet: number | null; fraction: number; mode: "walk" | "fly"; provokes: boolean; optional: boolean }
  | { kind: "teleport"; feet: number }
  | { kind: "spell"; cantrip: boolean }
  | { kind: "heal"; dice: string }
  | { kind: "ward"; ac: number; feet: number }
  | { kind: "noRegain"; feet: number }
  | { kind: "drain"; dice: string; type: string }
  | { kind: "cloud"; zone: string }
  | { kind: "fling"; feet: number; dice: string; dc: number | null; maxSize: string | null };

// One way to play an option: `use` is what the GM picks it by when the
// option offers more than one (an attack's or an ability's name).
export type LegendaryRoute = { use: string; steps: LegendaryStep[] };

type RouteStats = Pick<EnemyStats, "attacks" | "legendaryAttacks" | "traits" | "specials" | "fullTraits" | "fullLegendary">;

const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
// The name an attack goes by without its tags ("Bite (Bat or Vampire Form
// Only)" is a bite).
function bareKey(name: string): string {
  return textKey(name.replace(/\([^)]*\)/g, ""));
}

// The line the block prints for one of its own entries, by name: what its
// action or trait says beyond the numbers the parser kept, uncut where the
// block keeps it so (a pack row's trait lines cut a long one short).
function entryLine(stats: RouteStats, name: string): string {
  const key = abilityKey(name);
  for (const line of [...(stats.fullTraits ?? []), ...(stats.fullLegendary ?? []), ...(stats.traits ?? [])]) {
    const { text } = sectionOfLine(line);
    const split = /^([^.:]{2,80}?)\s*[.:]\s+([\s\S]*)$/.exec(text.trim());
    if (split && abilityKey(split[1]) === key) {
      return split[2];
    }
  }
  return "";
}

// How many creatures one use reaches: "one creature", "three bolts ...
// each of which can strike a target". Null: everyone caught.
function mostReached(text: string): number | null {
  const counted = /\b(one|two|three|four|five|six) (?:bolts?|rays?|beams?|targets?|creatures?)\b/i.exec(text);
  if (counted) {
    return NUMBERS[counted[1].toLowerCase()] ?? null;
  }
  return /\btargets? one\b|\bon one creature\b/i.test(text) ? 1 : null;
}

// The attacks the line makes, longest name first, so "its tail spike" is the
// Tail Spike and not the Tail.
function attacksNamed(stats: RouteStats, line: LegendaryLine): EnemyAttack[] {
  const named = textKey(line.name);
  const found: EnemyAttack[] = [];
  const attacks = [...(stats.attacks ?? []), ...(stats.legendaryAttacks ?? [])].sort((a, b) => b.name.length - a.name.length);
  for (const attack of attacks) {
    const name = bareKey(attack.name);
    if (!name || found.some((entry) => bareKey(entry.name).includes(name))) {
      continue;
    }
    const hit =
      named === name ||
      named === `${name} attack` ||
      [`${name} attack`, `${name} attacks`, `its ${name}`, `makes one ${name}`].some((phrase) => containsPhrase(line.text, phrase));
    if (hit) {
      found.push(attack);
    }
  }
  return found;
}

// The block's own entries the line uses by name ("uses its Fling", "uses
// Lightning Storm"): the capitalised name after "uses".
function usesNamed(line: LegendaryLine): string[] {
  const out: string[] = [];
  const pattern = /\buses (?:its )?((?:[A-Z][\w'-]*)(?: (?:of |the )?[A-Z][\w'-]*)*)/g;
  for (let match = pattern.exec(line.text); match; match = pattern.exec(line.text)) {
    out.push(match[1]);
  }
  return out;
}

function saveStep(ability: MonsterAbility, text: string): LegendaryStep | null {
  return ability.save && ability.dc ? { kind: "save", ability: ability.name, most: mostReached(text) } : null;
}

// One of the block's entries, as a way to play: its attack, the swallow or
// throw it describes, or its save.
function entryRoute(stats: RouteStats, name: string): LegendaryRoute | null {
  const attack = [...(stats.attacks ?? []), ...(stats.legendaryAttacks ?? [])].find((entry) => bareKey(entry.name) === textKey(name));
  if (attack) {
    return { use: attack.name, steps: [{ kind: "attack", attack: attack.name }] };
  }
  const text = entryLine(stats, name);
  // "makes one bite attack against a Medium or smaller creature it is
  // grappling. If the attack hits, ... the target is swallowed".
  const swallowed = /\bswallowed\b/i.test(text) ? /makes one (\w[\w ]*?) attack against an? (\w+) or smaller creature/i.exec(text) : null;
  if (swallowed) {
    const bite = (stats.attacks ?? []).find((entry) => bareKey(entry.name) === textKey(swallowed[1]));
    if (bite) {
      return { use: name, steps: [{ kind: "swallow", attack: bite.name, maxSize: swallowed[2].toLowerCase(), entry: name }] };
    }
  }
  // "is thrown up to 60 feet ... takes 3 (1d6) bludgeoning damage for every
  // 10 feet it was thrown".
  const thrown = /\bthrown up to (\d+) feet\b/i.exec(text);
  if (thrown) {
    const dice = /\((\d+d\d+)\) \w+ damage for every 10 feet/i.exec(text);
    const dc = /DC (\d+) Dexterity saving throw/i.exec(text);
    const size = /\bOne (\w+) or smaller\b/i.exec(text);
    return {
      use: name,
      steps: [{ kind: "fling", feet: Number(thrown[1]), dice: dice?.[1] ?? "1d6", dc: dc ? Number(dc[1]) : null, maxSize: size ? size[1].toLowerCase() : null }],
    };
  }
  const ability = findMonsterAbility(stats, name);
  const save = ability ? saveStep(ability, text) : null;
  return save ? { use: ability?.name ?? name, steps: [save] } : null;
}

// What the option's own line does when it names no attack and uses no
// entry of the block's.
function ownSteps(stats: RouteStats, line: LegendaryLine): LegendaryStep[] {
  const text = line.text;
  const check = /\bmakes an? (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)(?: \(([A-Za-z ]+)\))? check\b/i.exec(text);
  if (check) {
    return [{ kind: "check", ability: ABILITY_WORDS[check[1].toLowerCase()], skill: check[2] ? check[2].toLowerCase() : null }];
  }
  const teleport = /\bteleports?\b[^.]*?\bup to (\d+) feet\b/i.exec(text);
  if (teleport) {
    return [{ kind: "teleport", feet: Number(teleport[1]) }];
  }
  if (/\bcasts? a cantrip\b/i.test(text)) {
    return [{ kind: "spell", cantrip: true }];
  }
  if (/\bcasts? a spell\b/i.test(text)) {
    return [{ kind: "spell", cantrip: false }];
  }
  // A whirlwind "immune to all damage" that "can't be grappled ... knocked
  // prone, restrained, or stunned" while it moves: an opportunity attack has
  // nothing left to do to it, so none is rolled, as for "without provoking".
  const unharmed = /\bwithout provoking opportunity attacks\b|\bimmune to all damage\b/i.test(text);
  const speed = /\bmoves? up to (half )?its (flying |swimming )?speed\b/i.exec(text);
  if (speed) {
    return [{ kind: "move", feet: null, fraction: speed[1] ? 0.5 : 1, mode: speed[2]?.trim().toLowerCase() === "flying" ? "fly" : "walk", provokes: !unharmed, optional: false }];
  }
  const feet = /\bmoves? up to (\d+) feet\b/i.exec(text);
  if (feet) {
    return [{ kind: "move", feet: Number(feet[1]), fraction: 1, mode: "walk", provokes: !unharmed, optional: false }];
  }
  const ward = /\+(\d+) bonus to AC\b/i.exec(text);
  if (ward) {
    const range = /\bwithin (\d+) feet\b/i.exec(text);
    return [{ kind: "ward", ac: Number(ward[1]), feet: range ? Number(range[1]) : 0 }];
  }
  if (/\bcan't regain hit points\b/i.test(text)) {
    const range = /\bwithin (\d+) feet\b/i.exec(text);
    return [{ kind: "noRegain", feet: range ? Number(range[1]) : 0 }];
  }
  const ability = findMonsterAbility(stats, line.name);
  if (ability?.damage && !ability.save && /\bregains? hit points equal to the damage\b/i.test(text)) {
    return [{ kind: "drain", dice: ability.damage, type: ability.damageType ?? "" }];
  }
  const regains = /\bregains? \d+ \((\d+d\d+(?:\s*[+-]\s*\d+)?)\) hit points\b/i.exec(text);
  if (regains) {
    return [{ kind: "heal", dice: regains[1].replace(/\s+/g, "") }];
  }
  // A cloud it leaves in place, which strikes whoever ends a turn in it.
  if (/\bcloud\b/i.test(text) && /\bends its turn there\b/i.test(text)) {
    return [{ kind: "cloud", zone: textKey(line.name) }];
  }
  const save = ability ? saveStep(ability, text) : null;
  if (!save) {
    return [];
  }
  // Wing Attack: "The dragon can then fly up to half its flying speed."
  const then = /\bcan then fly up to (half )?its flying speed\b/i.exec(text);
  return then ? [save, { kind: "move", feet: null, fraction: then[1] ? 0.5 : 1, mode: "fly", provokes: true, optional: true }] : [save];
}

export function legendaryRoutes(stats: RouteStats, cut: LegendaryLine): LegendaryRoute[] {
  // The option's whole line: the profile reads the trait lines, which cut a
  // long one short ("... The dragon can then fly ..." lost).
  const whole = entryLine(stats, cut.name);
  const line = whole.length > cut.text.length ? { ...cut, text: whole } : cut;
  const routes: LegendaryRoute[] = attacksNamed(stats, line).map((attack) => ({ use: attack.name, steps: [{ kind: "attack", attack: attack.name }] }));
  for (const name of usesNamed(line)) {
    const route = entryRoute(stats, name);
    if (route && !routes.some((entry) => textKey(entry.use) === textKey(route.use))) {
      routes.push(route);
    }
  }
  if (routes.length) {
    return routes;
  }
  const steps = ownSteps(stats, line);
  return steps.length ? [{ use: line.name, steps }] : [];
}

// The route the GM picked, by what it is called; the first when the option
// has one way, or when none is named.
export function routeNamed(routes: LegendaryRoute[], use: string | undefined | null): LegendaryRoute | null {
  if (!use) {
    return routes[0] ?? null;
  }
  return routes.find((route) => textKey(route.use) === textKey(use)) ?? null;
}

// What the step needs from whoever plays it.
export type StepNeeds = { target: "none" | "one" | "many"; rows: boolean; square: "none" | "required" | "optional"; spell: boolean };

export function stepNeeds(step: LegendaryStep): StepNeeds {
  const none: StepNeeds = { target: "none", rows: false, square: "none", spell: false };
  switch (step.kind) {
    case "attack":
      return { ...none, target: "one", rows: true };
    case "swallow":
    case "fling":
    case "drain":
      return { ...none, target: "one" };
    case "save":
      return { ...none, target: step.most === 1 ? "one" : "many", rows: true };
    case "spell":
      return { ...none, target: "many", rows: true, spell: true };
    case "ward":
      return { ...none, target: "one", rows: true };
    case "noRegain":
      return { ...none, target: "many", rows: true };
    case "move":
      return { ...none, square: step.optional ? "optional" : "required" };
    case "teleport":
      return { ...none, square: "required" };
    default:
      return none;
  }
}

// What a route needs, all its steps together.
export function routeNeeds(route: LegendaryRoute): StepNeeds {
  return route.steps.map(stepNeeds).reduce<StepNeeds>(
    (all, needs) => ({
      target: all.target === "none" ? needs.target : all.target,
      rows: all.rows || needs.rows,
      square: all.square === "required" || needs.square === "required" ? "required" : all.square === "optional" || needs.square === "optional" ? "optional" : "none",
      spell: all.spell || needs.spell,
    }),
    { target: "none", rows: false, square: "none", spell: false },
  );
}
