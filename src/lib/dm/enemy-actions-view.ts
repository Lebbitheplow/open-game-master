import type { EnemyAttack, EnemyStats } from "@/lib/bestiary/statblock";
import { manualTraits } from "@/lib/dm/monster-traits";
import { sectionOfLine } from "@/lib/bestiary/block-sections";
import { synthesizeStats } from "@/lib/bestiary/synthesize";
import { orderEntryId, turnKey, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { canEnemyAct, enemyActedThisRound } from "@/lib/dm/can-act";
import { plannedSwings } from "@/lib/dm/enemy-profile";
import { abilityFromLine, abilityRefusal, type MonsterAbility } from "@/lib/dm/monster-abilities";
import {
  freshPool,
  lairSave,
  legendaryOpening,
  legendaryProfile,
  spendLegendaryAction,
  type LairChoice,
  type LairSave,
} from "@/lib/dm/legendary-logic";
import { legendaryRoutes, routeNeeds, type LegendaryRoute, type LegendaryStep } from "@/lib/dm/legendary-route-logic";
import { legendaryMoveFor } from "@/lib/dm/legendary-move";
import { findMonsterAbility } from "@/lib/dm/monster-abilities";
import { regainBlockedBy } from "@/lib/dm/vitals-logic";
import { zoneRowFor } from "@/lib/battlemap/zones-spells";
import { textKey } from "@/lib/language/text-logic";

// What an enemy can do on its turn, for the person running it (issue #108).
//
// A human DM used to play a goblin from a form: pick the attacker, pick the
// target, type the attack's name. The players meanwhile had cards. This is
// the DM's side of the same projection: every attack the block lists with
// the numbers the engine will roll, every save ability with its DC and what
// stops it right now, and the engine's own answer to "may it act". Only the
// DM view carries it (encounter-view.ts adds it under enemyNumbers), and
// every number is read from the same stat block enemy_attack, cast_at_player
// and aoe_damage read, so a card never promises what the engine refuses.
//
// Pure: scripts/test-monster-hand.mjs drives it with no database.

export type PublicEnemyAttack = {
  name: string;
  toHit: number;
  // A dice expression ("1d6+2"), as enemy_attack rolls it.
  damage: string;
  // Every damage type, "/" joined; the first is the hit's own.
  type: string;
  // "5 ft", "80/320 ft", or "5 ft / 20/60 ft" for a thrown weapon.
  range: string;
  melee: boolean;
  spellAttack?: boolean;
  // What a hit does besides its damage, in a few words.
  onHit?: string;
  // The swings one enemy_attack naming this attack makes, by name: the
  // Multiattack routine it sits in (plannedSwings), or just itself.
  swings: string[];
};

export type PublicEnemyAbility = {
  name: string;
  // The save's ability code ("dex") and DC, always present: an ability with
  // neither is a trait, not an action card.
  save: string;
  dc: number;
  damage?: string;
  damageType?: string;
  halfOnSave?: boolean;
  condition?: string;
  rounds?: number;
  // "Recharge 5-6", "1/day", "Once a fight"; "" when unlimited.
  resource: string;
  // Why it cannot be used now (not recharged, used up), or null.
  refusal: string | null;
};

// How far it may still walk this turn, as its own walks count it
// (src/lib/dm/enemy-speed.ts enemyMoveBudget, issue #621): the roster's
// "25 ft left · Dashed" and the Dash card's line. Absent with no board, and
// from a server older than the enemyActions feature.
export type PublicEnemyMovement = { speedFeet: number; leftFeet: number; dashes: number; disengaged: boolean };

// One way to play a legendary option (src/lib/dm/legendary-route-logic.ts),
// as the GM's card plays it in one call (src/lib/dm/legendary-play.ts): what
// it does in a few words, and what the card asks for before it goes: its
// target or everyone caught, the square a move or a jump goes to, the spell
// it casts. `use` names it when the option offers more than one way.
export type PublicLegendaryRoute = {
  use: string;
  how: string;
  target: "none" | "one" | "many";
  // The most creatures it reaches (Lightning Storm's three bolts).
  most?: number;
  // An enemy row may be among them (a creature the party dominates).
  rows: boolean;
  // Whom it is aimed at: the other side (an attack, a save), its own side
  // (a shield on itself or an ally), or anyone in reach (negative energy).
  pick: "foes" | "allies" | "anyone";
  square?: { feet: number; optional: boolean };
  spells?: string[];
  attack?: PublicEnemyAttack;
  ability?: Omit<PublicEnemyAbility, "resource" | "refusal">;
  // Why this way cannot be played now (its ability has not recharged, it
  // cannot regain hit points, it stands on no board), or absent.
  refusal?: string;
};

// A legendary action's option, every way it can be played; none when the
// server cannot read the line, which the card then spends and leaves the
// rest to the GM.
export type PublicLegendaryOption = {
  name: string;
  cost: number;
  // What the block says it does.
  text: string;
  routes: PublicLegendaryRoute[];
  // The tool's own refusal: it costs more than is left this round. Null
  // when it can be taken.
  refusal: string | null;
};

// Present only while a legendary action can be taken now (SRD 5.1: one at a
// time, at the end of another creature's turn, from the actions it has left
// this round; they come back at the start of its own turn): never on its own
// turn, never twice at the end of one turn, never with none left.
export type PublicLegendaryActions = { left: number; max: number; options: PublicLegendaryOption[] };

// A lair option this creature's block prints, while the lair's moment is
// open (initiative count 20, losing ties, and the lair has not acted this
// round): numbered as lair_action takes it, with the save it forces as
// aoe_damage takes it, and the tool's refusal of an effect the block forbids
// two rounds in a row.
export type PublicLairOption = { number: number; line: string; save?: LairSave; refusal: string | null };

export type PublicEnemyActions = {
  speed: string;
  movement?: PublicEnemyMovement;
  attacks: PublicEnemyAttack[];
  abilities: PublicEnemyAbility[];
  // The engine's own reason it may not take an action now (dead,
  // incapacitated, surprised, already acted), or null when it may.
  refusal: string | null;
  // It has taken its action this round.
  acted: boolean;
  // The traits on its block the engine does not resolve: the DM applies
  // them by hand (src/lib/dm/monster-traits.ts manualTraits).
  manual: string[];
  // Absent from a server older than the legendaryCards feature, and
  // whenever none can be taken now.
  legendary?: PublicLegendaryActions;
  lair?: PublicLairOption[];
};

type ActingEncounter = Pick<
  Encounter,
  "orderReady" | "order" | "turnIndex" | "round" | "surprisedIds" | "kind" | "status" | "legendary"
>;

function attackRange(attack: EnemyAttack): string {
  const reach = `${attack.reach ?? 5} ft`;
  const range = attack.range ? `${attack.range.normal}/${attack.range.long} ft` : "";
  const mode = attack.mode ?? (attack.range && !attack.reach ? "ranged" : "melee");
  if (mode === "ranged") {
    return range || reach;
  }
  if (mode === "both" && range) {
    return `${reach} / ${range}`;
  }
  return reach;
}

function onHitLine(attack: EnemyAttack): string | undefined {
  const rider = attack.onHit;
  if (!rider) {
    return undefined;
  }
  const parts = [
    rider.condition ? (rider.save && rider.dc ? `${rider.condition} on a failed ${rider.save.toUpperCase()} ${rider.dc}` : rider.condition) : "",
    rider.alsoCondition ?? "",
    rider.unconsciousFailBy ? `unconscious too on a fail by ${rider.unconsciousFailBy}` : "",
    rider.unconsciousAtMost ? `unconscious too on ${rider.unconsciousAtMost} or lower` : "",
    rider.damage ? `${rider.damage} ${rider.damageType ?? ""}`.trim() : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

function abilityResource(ability: MonsterAbility): string {
  // Two breaths share the one recharge their entry prints.
  const shared = ability.group ? `, shared as ${ability.group}` : "";
  if (ability.recharge) {
    return `${ability.recharge === 6 ? "Recharge 6" : `Recharge ${ability.recharge}-6`}${shared}`;
  }
  if (ability.perDay) {
    return `${ability.perDay}/${ability.perRest ? "rest" : "day"}${shared}`;
  }
  if (ability.perRest || ability.rechargeSpecial) {
    return `Once a fight${shared}`;
  }
  if (ability.oncePer) {
    return `Once a ${ability.oncePer}`;
  }
  if (ability.partOf) {
    return `With ${ability.partOf}`;
  }
  return "";
}

// The block's abilities with numbers the engine runs: the parsed specials,
// else the trait lines read the same way findMonsterAbility reads them. A
// lair option is the lair's, on initiative count 20 (its card below), not an
// action of the creature's turn, which this offered it as.
function abilitiesOf(enemy: EncounterEnemy): MonsterAbility[] {
  const stats = enemy.stats;
  const parsed = stats.specials?.length
    ? stats.specials
    : (stats.traits ?? [])
        .filter((line) => sectionOfLine(line).section !== "lair")
        .map(abilityFromLine)
        .filter((entry): entry is MonsterAbility => entry !== null);
  const seen = new Set<string>();
  return parsed.filter((ability) => {
    const key = textKey(ability.name);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function attackView(stats: EnemyStats, attacks: EnemyAttack[], attack: EnemyAttack, swings?: string[]): PublicEnemyAttack {
  const onHit = onHitLine(attack);
  return {
    name: attack.name,
    toHit: attack.toHit,
    damage: attack.damage,
    type: attack.type,
    range: attackRange(attack),
    melee: (attack.mode ?? (attack.range && !attack.reach ? "ranged" : "melee")) !== "ranged",
    ...(attack.spellAttack ? { spellAttack: true } : {}),
    ...(onHit ? { onHit } : {}),
    swings: swings ?? plannedSwings(stats, attacks, attack).map((swing) => swing.name),
  };
}

function abilityNumbers(ability: MonsterAbility): Omit<PublicEnemyAbility, "resource" | "refusal"> {
  return {
    name: ability.name,
    save: ability.save as string,
    dc: ability.dc as number,
    ...(ability.damage ? { damage: ability.damage } : {}),
    ...(ability.damageType ? { damageType: ability.damageType } : {}),
    ...(ability.halfOnSave !== undefined ? { halfOnSave: ability.halfOnSave } : {}),
    ...(ability.condition ? { condition: ability.condition } : {}),
    ...(ability.rounds ? { rounds: ability.rounds } : {}),
  };
}

// The options a legendary creature may take now, read by the same rules
// legendary_action holds the call to (legendary-logic.ts legendaryOpening,
// spendLegendaryAction), or null when it may take none: the console's form
// was the only way, and it offered the action on the creature's own turn and
// after one was already taken at this turn's end.
function legendaryView(encounter: ActingEncounter, enemy: EncounterEnemy): PublicLegendaryActions | null {
  const profile = legendaryProfile(enemy.stats);
  if (!profile?.actions.length || !canEnemyAct({ enemy, encounter, kind: "legendary" }).ok) {
    return null;
  }
  const current = encounter.order[encounter.turnIndex];
  const opening = legendaryOpening(
    {
      turn: turnKey(encounter),
      round: encounter.round,
      onPointer: Boolean(current && orderEntryId(current) === enemy.id),
      actedThisRound: enemyActedThisRound(encounter, enemy.id),
      legendary: encounter.legendary,
    },
    enemy,
  );
  const pool = encounter.legendary.pools[enemy.id] ?? freshPool(profile);
  if (opening.refusal || pool.actions <= 0) {
    return null;
  }
  const stats = enemy.stats;
  const attacks = stats.attacks?.length ? stats.attacks : synthesizeStats(enemy.cr).attacks;
  const ledger = encounter.legendary.abilities?.[enemy.id];
  return {
    left: pool.actions,
    max: profile.actionsPerRound,
    options: profile.actions.map((action) => {
      const spend = spendLegendaryAction(pool, profile, action.name);
      return {
        name: action.name,
        cost: action.cost,
        text: action.text,
        routes: legendaryRoutes(stats, action).map((route) => routeView(enemy, stats, attacks, ledger, encounter, route)),
        refusal: spend.ok ? null : spend.error,
      };
    }),
  };
}

const ABILITY_WORDS: Record<string, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

// One step in a few words, for the card.
function stepWords(enemy: EncounterEnemy, step: LegendaryStep): string {
  switch (step.kind) {
    case "attack":
      return `One ${step.attack} attack`;
    case "swallow":
      return `A ${step.attack} attack on a ${step.maxSize} or smaller creature it grapples, swallowing it on a hit`;
    case "save": {
      const ability = findMonsterAbility(enemy.stats, step.ability);
      const reach = step.most === 1 ? "one creature" : step.most ? `up to ${step.most} creatures` : "everyone caught";
      return `${ability?.save ? ability.save.toUpperCase() : ""} save DC ${ability?.dc ?? "?"} on ${reach}`.trim();
    }
    case "check":
      return `A ${ABILITY_WORDS[step.ability] ?? step.ability}${step.skill ? ` (${step.skill})` : ""} check the server rolls`;
    case "move": {
      const feet = legendaryMoveFor(enemy, step).tiles * 5;
      return `${step.optional ? "Then it may fly" : step.mode === "fly" ? "Flies" : "Moves"} up to ${feet} ft${step.provokes ? "" : " without opportunity attacks"}`;
    }
    case "teleport":
      return `Teleports up to ${step.feet} ft`;
    case "spell":
      return step.cantrip ? "Casts a cantrip from its list" : "Casts a spell from its list, spending its slot as normal";
    case "heal":
      return `Regains ${step.dice} hit points`;
    case "ward":
      return `+${step.ac} AC for a round, on itself or a creature within ${step.feet} ft`;
    case "noRegain":
      return `Creatures within ${step.feet} ft cannot regain hit points for a round`;
    case "drain":
      return `${step.dice} ${step.type} to a creature it charms, and it regains as much`;
    case "cloud":
      return `A cloud around it: ${zoneRowFor({ spell: step.zone })?.summary ?? "laid on the board"}`;
    case "fling":
      return `Throws a creature it grapples up to ${step.feet} ft in a random direction, prone`;
  }
}

function routeView(
  enemy: EncounterEnemy,
  stats: EnemyStats,
  attacks: EnemyAttack[],
  ledger: Parameters<typeof abilityRefusal>[2],
  encounter: ActingEncounter,
  route: LegendaryRoute,
): PublicLegendaryRoute {
  const needs = routeNeeds(route);
  const first = route.steps[0];
  const attackStep = route.steps.find((step) => step.kind === "attack" || step.kind === "swallow") as Extract<LegendaryStep, { attack: string }> | undefined;
  const attack = attackStep ? [...attacks, ...(stats.legendaryAttacks ?? [])].find((entry) => entry.name === attackStep.attack) : undefined;
  const saveStep = route.steps.find((step): step is Extract<LegendaryStep, { kind: "save" }> => step.kind === "save");
  const ability = saveStep ? findMonsterAbility(stats, saveStep.ability) : null;
  const moveStep = route.steps.find((step): step is Extract<LegendaryStep, { kind: "move" }> => step.kind === "move");
  const spellStep = route.steps.find((step): step is Extract<LegendaryStep, { kind: "spell" }> => step.kind === "spell");
  const spells = spellStep ? spellChoices(stats, spellStep.cantrip) : undefined;
  // Its ability keeps its own limits (a recharge), which the call after the
  // spend would refuse with the action already gone.
  const held = ability ? (abilityRefusal(enemy.displayName, ability, ledger, { turn: turnKey(encounter), round: encounter.round })?.error ?? null) : null;
  const blocked = first?.kind === "heal" ? regainBlockedBy({ conditions: enemy.conditions, currentHp: enemy.currentHp }) : null;
  const refusal =
    held ??
    (blocked ? `${enemy.displayName} cannot regain hit points while ${blocked} holds it.` : null) ??
    (spells && !spells.length ? `${enemy.displayName} has no ${spellStep?.cantrip ? "cantrip" : "spell"} on its list to cast.` : null);
  return {
    use: route.use,
    how: route.steps.map((step) => stepWords(enemy, step)).join("; "),
    target: needs.target,
    ...(saveStep?.most ? { most: saveStep.most } : {}),
    rows: needs.rows,
    pick: route.steps.some((step) => step.kind === "ward") ? "allies" : route.steps.some((step) => step.kind === "noRegain") ? "anyone" : "foes",
    ...(moveStep ? { square: { feet: legendaryMoveFor(enemy, moveStep).tiles * 5, optional: moveStep.optional } } : {}),
    ...(first?.kind === "teleport" ? { square: { feet: first.feet, optional: false } } : {}),
    ...(spells ? { spells } : {}),
    // One swing: the attack a legendary action buys is never the routine.
    ...(attack ? { attack: attackView(stats, attacks, attack, [attack.name]) } : {}),
    ...(ability?.save && ability.dc ? { ability: abilityNumbers(ability) } : {}),
    ...(refusal ? { refusal } : {}),
  };
}

// The spells a legendary option may cast: the block's list, cantrips alone
// for an option that casts a cantrip.
function spellChoices(stats: EnemyStats, cantrip: boolean): string[] {
  const listed = stats.spellcasting?.spells ?? [];
  if (listed.length) {
    return listed.filter((spell) => !cantrip || spell.level === 0).map((spell) => spell.name);
  }
  return cantrip ? [] : (stats.spells ?? []);
}

// lair: the lair's options this creature's block prints, while the lair may
// act (legendary-logic.ts lairChoices, which the encounter's projection
// works out once for the whole fight, numbered across every creature).
export function enemyActionsView(
  encounter: ActingEncounter,
  enemy: EncounterEnemy,
  movement?: PublicEnemyMovement,
  lair?: LairChoice[],
): PublicEnemyActions {
  const stats = enemy.stats;
  // The same fallback enemy_attack makes for a block with no attack lines.
  const attacks = stats.attacks?.length ? stats.attacks : synthesizeStats(enemy.cr).attacks;
  const seen = new Set<string>();
  const attackViews: PublicEnemyAttack[] = [];
  for (const attack of attacks) {
    const key = textKey(attack.name);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    attackViews.push(attackView(stats, attacks, attack));
  }

  const ledger = encounter.legendary.abilities?.[enemy.id];
  const abilityViews: PublicEnemyAbility[] = abilitiesOf(enemy)
    // A legendary action is spent at the end of another creature's turn,
    // through legendary_action: it is a card of the legendary group below,
    // not one of the turn's.
    .filter((ability) => ability.save && ability.dc && !ability.legendaryCost)
    .map((ability) => ({
      ...abilityNumbers(ability),
      resource: abilityResource(ability),
      refusal: abilityRefusal(enemy.displayName, ability, ledger, { turn: turnKey(encounter), round: encounter.round })?.error ?? null,
    }));

  const allowed = canEnemyAct({ enemy, encounter, kind: "action" });
  const legendary = legendaryView(encounter, enemy);
  const lairOptions: PublicLairOption[] =
    enemy.status === "alive"
      ? (lair ?? [])
          .filter((choice) => choice.enemyId === enemy.id)
          .map((choice) => {
            const save = lairSave(choice.line);
            return { number: choice.number, line: choice.line, ...(save ? { save } : {}), refusal: choice.refusal };
          })
      : [];
  return {
    speed: stats.speed || "30 ft.",
    ...(movement ? { movement } : {}),
    attacks: attackViews,
    abilities: abilityViews,
    refusal: allowed.ok ? null : allowed.error,
    acted: enemyActedThisRound(encounter, enemy.id),
    manual: manualTraits(stats),
    ...(legendary ? { legendary } : {}),
    ...(lairOptions.length ? { lair: lairOptions } : {}),
  };
}
