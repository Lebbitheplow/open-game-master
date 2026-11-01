import { signed, type HandCard, type MonsterAbilityUse, type MonsterMove } from "@/lib/battlemap/hand-core";
import type { PublicEnemyAbility, PublicEnemyActions, PublicEnemyAttack } from "@/lib/dm/enemy-actions-view";
import { BASE, cardKey, saveWord, type MonsterHandEnemy } from "@/lib/battlemap/monster-hand-parts";
import { lairCard, legendaryCard } from "@/lib/battlemap/monster-hand-legendary";

export type { MonsterHandEnemy } from "@/lib/battlemap/monster-hand-parts";
export { lairTitle } from "@/lib/battlemap/monster-hand-legendary";
import { monsterAttackIcon } from "@/lib/battlemap/attack-art";

// The DM's hand: a monster's turn as cards (issue #108). A person running
// the table used to play every goblin through the console's form; the
// players had cards. This derives the same HandCard shape the players' fan
// draws from the DM projection's `actions` (src/lib/dm/enemy-actions-view.ts),
// and turns a played card into the console's own invoke call, so the dice,
// the reach, the conditions and the audit trail are the engine's exactly as
// they are when the form is used.
//
// Pure and database-free: scripts/test-monster-hand.mjs drives every branch.

export type MonsterAdvantage = "none" | "advantage" | "disadvantage";

// "Multiattack: 2 Claw, 1 Bite" from the swings one call makes.
export function swingsLine(swings: string[]): string {
  if (swings.length <= 1) {
    return "";
  }
  const counts = new Map<string, number>();
  for (const name of swings) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return `Multiattack: ${[...counts.entries()].map(([name, count]) => `${count} ${name}`).join(", ")}. One card plays the whole routine.`;
}

function attackCard(enemy: MonsterHandEnemy, actions: PublicEnemyActions, attack: PublicEnemyAttack): HandCard {
  return {
    ...BASE,
    id: `monster:${enemy.id}:attack:${cardKey(attack.name)}`,
    type: "attack",
    name: attack.name,
    range: attack.range,
    dice: `${attack.damage} ${attack.type}`.trim(),
    roll: `${signed(attack.toHit)} to hit`,
    rules: [swingsLine(attack.swings), attack.spellAttack ? "A spell attack." : ""].filter(Boolean).join(" "),
    condition: attack.onHit ?? "",
    icon: monsterAttackIcon(enemy.name, attack.name, Boolean(attack.spellAttack)),
    target: "enemy",
    toHit: attack.toHit,
    damage: attack.damage || null,
    damageType: attack.type.split("/")[0] ?? "",
    save: null,
    melee: attack.melee,
    disabled: actions.refusal,
    spent: actions.acted,
    intent: { card: "monster", enemyId: enemy.id, action: "attack", attackName: attack.name },
  };
}

function abilityUse(ability: Omit<PublicEnemyAbility, "resource" | "refusal">): MonsterAbilityUse {
  return {
    name: ability.name,
    save: ability.save,
    dc: ability.dc,
    ...(ability.damage ? { damage: ability.damage } : {}),
    ...(ability.damageType ? { damageType: ability.damageType } : {}),
    ...(ability.halfOnSave !== undefined ? { halfOnSave: ability.halfOnSave } : {}),
    ...(ability.condition ? { condition: ability.condition } : {}),
    ...(ability.rounds ? { rounds: ability.rounds } : {}),
  };
}

function abilityCard(enemy: MonsterHandEnemy, actions: PublicEnemyActions, ability: PublicEnemyAbility): HandCard {
  const use = abilityUse(ability);
  const rules = [
    ability.halfOnSave ? "Half damage on a save." : "",
    ability.rounds ? `Lasts ${ability.rounds} round${ability.rounds === 1 ? "" : "s"}.` : "",
    "Pick everyone caught in it.",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    ...BASE,
    id: `monster:${enemy.id}:ability:${cardKey(ability.name)}`,
    type: ability.damage ? "spell" : "control",
    name: ability.name,
    range: "",
    dice: ability.damage ? `${ability.damage} ${ability.damageType ?? ""}`.trim() : (ability.condition ?? ""),
    roll: `${saveWord(ability.save)} save DC ${ability.dc}`,
    rules,
    resource: ability.resource,
    condition: ability.condition ?? "",
    icon: { kind: "action", key: "cast" },
    target: "enemy",
    toHit: null,
    damage: ability.damage ?? null,
    damageType: ability.damageType ?? "",
    save: { ability: saveWord(ability.save), dc: ability.dc },
    melee: false,
    // The ability's own reason first (not recharged), then the turn's.
    disabled: ability.refusal ?? actions.refusal,
    spent: Boolean(ability.refusal) || actions.acted,
    intent: { card: "monster", enemyId: enemy.id, action: "ability", ability: use },
  };
}

function fleeCard(enemy: MonsterHandEnemy): HandCard {
  return {
    ...BASE,
    id: `monster:${enemy.id}:flee`,
    type: "basic",
    name: "Flee",
    cost: "free",
    range: "",
    dice: "",
    roll: "no roll",
    rules: "Leaves the fight alive. The party still earns it.",
    icon: { kind: "action", key: "escape" },
    target: "none",
    toHit: null,
    damage: null,
    damageType: "",
    save: null,
    melee: false,
    disabled: enemy.status === "alive" ? null : `${enemy.name} is ${enemy.status}.`,
    spent: false,
    intent: { card: "monster", enemyId: enemy.id, action: "flee" },
  };
}

const MOVE_CARDS: Array<{ move: MonsterMove; name: string; rules: (left: number) => string }> = [
  { move: "dash", name: "Dash", rules: (left) => `Adds its speed to its movement this turn (${left} ft left now). Then move its token.` },
  { move: "disengage", name: "Disengage", rules: () => "Its moves this turn draw no opportunity attacks. A bonus action with Nimble Escape." },
  { move: "dodge", name: "Dodge", rules: () => "Attacks against it have disadvantage and it has advantage on DEX saves until its next turn." },
];

// Dash, Disengage and Dodge (issue #621): its action, played with no target,
// as take_action with its enemyId. Only from a host that resolves them and
// says how far the creature may still walk.
function moveCards(enemy: MonsterHandEnemy, actions: PublicEnemyActions): HandCard[] {
  const movement = actions.movement;
  if (!movement) {
    return [];
  }
  return MOVE_CARDS.map(({ move, name, rules }) => {
    const disabled =
      move === "dash" && movement.speedFeet === 0
        ? `${enemy.name}'s speed is 0 right now.`
        : move === "disengage" && movement.disengaged
          ? `${enemy.name} already Disengaged this turn.`
          : move === "disengage"
            ? null
            : actions.refusal;
    return {
      ...BASE,
      id: `monster:${enemy.id}:${move}`,
      type: "basic",
      name,
      range: "",
      dice: "",
      roll: "no roll",
      rules: rules(movement.leftFeet),
      icon: { kind: "action", key: move },
      target: "none",
      toHit: null,
      damage: null,
      damageType: "",
      save: null,
      melee: false,
      // Disengage may still be its bonus action (Nimble Escape): the server
      // says no if neither is left.
      disabled: enemy.status === "alive" ? disabled : `${enemy.name} is ${enemy.status}.`,
      spent: move !== "disengage" && actions.acted,
      intent: { card: "monster", enemyId: enemy.id, action: move },
    };
  });
}

// The cards one enemy holds: its attacks, its save abilities, Dash, Disengage
// and Dodge when the host resolves them (`enemyActions`), its legendary and
// lair actions while they can be taken (`legendaryCards`), and breaking off.
// Empty for an enemy the projection carries no actions for (a player's view,
// or an older server).
export function deriveMonsterHand(enemy: MonsterHandEnemy, options: { enemyActions?: boolean; legendaryCards?: boolean } = {}): HandCard[] {
  const actions = enemy.actions;
  if (!actions) {
    return [];
  }
  const legendary = options.legendaryCards ? actions.legendary : undefined;
  return [
    ...actions.attacks.map((attack) => attackCard(enemy, actions, attack)),
    ...actions.abilities.map((ability) => abilityCard(enemy, actions, ability)),
    ...(options.enemyActions ? moveCards(enemy, actions) : []),
    ...(legendary
      ? legendary.options.flatMap((option) => (option.routes.length ? option.routes.map((route) => legendaryCard(enemy, legendary, option, route)) : [legendaryCard(enemy, legendary, option, null)]))
      : []),
    ...(options.legendaryCards ? (actions.lair ?? []).map((option) => lairCard(enemy, option)) : []),
    fleeCard(enemy),
  ];
}

// Whether the card takes several targets at once (a breath weapon catches
// everyone in its cone; one call spends one action): an ability, a
// legendary action's ability, a lair option's save.
export function takesManyTargets(card: HandCard): boolean {
  const intent = card.intent;
  if (intent.card !== "monster") {
    return false;
  }
  return intent.action === "ability" || (intent.action === "legendary" && intent.aim === "many") || (intent.action === "lair" && Boolean(intent.lair?.save));
}

// Whether the card rolls one of its attacks: the Roll pills (advantage) and
// a target that may be an enemy row (a creature the party dominates).
// Whether an enemy row may be among the card's targets (a creature the party
// dominates, a legendary option that reaches everyone caught): the target
// chips keep the rows.
export function monsterAimsAtRows(card: HandCard): boolean {
  const intent = card.intent;
  return intent.card === "monster" && (rollsMonsterAttack(card) || takesManyTargets(card) || (intent.action === "legendary" && Boolean(intent.rows)));
}

export function rollsMonsterAttack(card: HandCard): boolean {
  const intent = card.intent;
  return intent.card === "monster" && (intent.action === "attack" || (intent.action === "legendary" && Boolean(intent.attackName)));
}

function listNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// The line the aim bar shows for the raised card.
export function monsterSentence(enemyName: string, card: HandCard, targetNames: string[]): string {
  const intent = card.intent;
  if (intent.card !== "monster") {
    return "";
  }
  const who = listNames(targetNames);
  if (intent.action === "attack") {
    return who ? `${enemyName} attacks ${who} with its ${card.name}.` : `${enemyName} attacks with its ${card.name}.`;
  }
  if (intent.action === "ability") {
    return who ? `${enemyName} uses ${card.name} on ${who}.` : `${enemyName} uses ${card.name}.`;
  }
  if (intent.action === "dash") {
    return `${enemyName} takes the Dash action.`;
  }
  if (intent.action === "disengage") {
    return `${enemyName} disengages.`;
  }
  if (intent.action === "dodge") {
    return `${enemyName} takes the Dodge action.`;
  }
  if (intent.action === "legendary") {
    return who ? `${enemyName} spends a legendary action: ${card.name} on ${who}.` : `${enemyName} spends a legendary action: ${card.name}.`;
  }
  if (intent.action === "lair") {
    return who ? `The lair acts on ${who}.` : "The lair acts.";
  }
  return `${enemyName} breaks off and flees.`;
}

// The calls a played card makes, in order: one for most cards
// (monsterInvoke), and for a legendary or lair card the spend and then what
// it buys, each the call the console's form would send, so the tools' rules
// and sentences are the only ones. Null when the card still needs a target.
// The caller stops at the first refusal.
export function monsterCalls(
  card: HandCard,
  targetIds: string[],
  advantage: MonsterAdvantage = "none",
  rows: ReadonlySet<string> = new Set(),
  // A legendary move's or jump's square, a spell from its list.
  choices: { square?: { x: number; y: number } | null; spell?: string | null } = {},
): Array<{ name: string; args: Record<string, unknown> }> | null {
  const intent = card.intent;
  if (intent.card !== "monster") {
    return null;
  }
  if (intent.action === "legendary") {
    // One call: the spend and what it buys, played whole on the server
    // (src/lib/dm/legendary-play.ts), so a refused attack gives it back.
    if (intent.aim && !targetIds.length) {
      return null;
    }
    const characterIds = targetIds.filter((id) => !rows.has(id));
    const enemyIds = targetIds.filter((id) => rows.has(id));
    const args: Record<string, unknown> = {
      enemyId: intent.enemyId,
      action: intent.legendary ?? card.name,
      ...(intent.use ? { use: intent.use } : {}),
      ...(intent.aim === "one" && targetIds[0] ? { targetCharacterId: targetIds[0] } : {}),
      ...(intent.aim === "many" && characterIds.length ? { characterIds } : {}),
      ...(intent.aim === "many" && enemyIds.length ? { enemyIds } : {}),
      ...(choices.square ? { x: choices.square.x, y: choices.square.y } : {}),
      ...(choices.spell ? { spell: choices.spell } : {}),
      ...(intent.attackName && advantage !== "none" ? { advantage } : {}),
    };
    return [{ name: "legendary_action", args }];
  }
  if (intent.action === "lair") {
    const lair = intent.lair;
    if (!lair) {
      return null;
    }
    const act = { name: "lair_action", args: { action: String(lair.number) } };
    if (!lair.save) {
      return [act];
    }
    if (!targetIds.length) {
      return null;
    }
    const characterIds = targetIds.filter((id) => !rows.has(id));
    const enemyIds = targetIds.filter((id) => rows.has(id));
    return [
      act,
      {
        name: "aoe_damage",
        args: {
          ...(characterIds.length ? { characterIds } : {}),
          ...(enemyIds.length ? { enemyIds } : {}),
          ...lair.save,
          reason: "The lair acts",
        },
      },
    ];
  }
  const one = monsterInvoke(card, targetIds, advantage, rows);
  return one ? [one] : null;
}

// The console call a played card makes: the same adjudication the form
// would send, so the server's rules are the only rules. Null when the card
// still needs a target. rows: the targets that are enemy rows (a creature
// the party dominates strikes its own kind, issue 503).
export function monsterInvoke(
  card: HandCard,
  targetIds: string[],
  advantage: MonsterAdvantage = "none",
  rows: ReadonlySet<string> = new Set(),
): { name: string; args: Record<string, unknown> } | null {
  const intent = card.intent;
  if (intent.card !== "monster") {
    return null;
  }
  if (intent.action === "flee") {
    return { name: "enemy_flees", args: { enemyId: intent.enemyId, reason: "Breaks off and runs." } };
  }
  if (intent.action === "dash" || intent.action === "disengage" || intent.action === "dodge") {
    return { name: "take_action", args: { enemyId: intent.enemyId, action: intent.action } };
  }
  if (!targetIds.length) {
    return null;
  }
  if (intent.action === "attack") {
    return {
      name: "enemy_attack",
      args: {
        enemyId: intent.enemyId,
        targetCharacterId: targetIds[0],
        ...(intent.attackName ? { attack: intent.attackName } : {}),
        ...(advantage !== "none" ? { advantage } : {}),
      },
    };
  }
  const ability = intent.ability;
  if (!ability) {
    return null;
  }
  const numbers = {
    saveAbility: ability.save,
    dc: ability.dc,
    ...(ability.damage ? { damage: ability.damage } : {}),
    ...(ability.halfOnSave !== undefined ? { halfOnSave: ability.halfOnSave } : {}),
  };
  if (targetIds.length === 1) {
    return {
      name: "cast_at_player",
      args: {
        characterId: targetIds[0],
        casterEnemyId: intent.enemyId,
        enemyAbility: ability.name,
        ...numbers,
        ...(ability.damageType ? { damageType: ability.damageType } : {}),
        ...(ability.condition ? { condition: ability.condition } : {}),
        ...(ability.rounds ? { rounds: ability.rounds } : {}),
      },
    };
  }
  return {
    name: "aoe_damage",
    args: {
      casterEnemyId: intent.enemyId,
      enemyAbility: ability.name,
      characterIds: targetIds.filter((id) => !rows.has(id)),
      ...(targetIds.some((id) => rows.has(id)) ? { enemyIds: targetIds.filter((id) => rows.has(id)) } : {}),
      ...numbers,
      ...(ability.damageType ? { type: ability.damageType } : {}),
    },
  };
}
