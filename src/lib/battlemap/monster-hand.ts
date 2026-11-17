import { signed, type HandCard, type MonsterAbilityUse, type MonsterMove } from "@/lib/battlemap/hand-core";
import type { PublicEnemyAbility, PublicEnemyActions, PublicEnemyAttack } from "@/lib/dm/enemy-actions-view";
import { BASE, cardKey, saveWord, type MonsterHandEnemy } from "@/lib/battlemap/monster-hand-parts";
import { lairCard, legendaryCard } from "@/lib/battlemap/monster-hand-legendary";

export type { MonsterHandEnemy } from "@/lib/battlemap/monster-hand-parts";
export { lairTitle } from "@/lib/battlemap/monster-hand-legendary";
import { monsterAttackIcon } from "@/lib/battlemap/attack-art";
import { translate } from "@/lib/messages-logic";
import { pluralOf } from "@/lib/messages-logic";

// The DM's hand: a monster's turn as cards (issue #108). A person running
// the table used to play every goblin through the console's form; the
// players had cards. This derives the same HandCard shape the players' fan
// draws from the DM projection's `actions` (src/lib/dm/enemy-actions-view.ts),
// and turns a played card into the console's own invoke call, so the dice,
// the reach, the conditions and the audit trail are the engine's exactly as
// they are when the form is used.
//
// Like composerGate, the cards' own words (names, rules, refusal reasons,
// the aim bar's sentence; table.hand.monster.*) are read with the translator
// of the component that draws the hand. Pure and database-free otherwise:
// scripts/test-monster-hand.mjs drives every branch.

export type MonsterAdvantage = "none" | "advantage" | "disadvantage";

type Translator = (key: string, vars?: Record<string, string | number>) => string;
const enT: Translator = (key, vars) => translate("en", key, vars);

// Both call shapes read: the t-first one (the components pass the hand's
// translator) and the plain one, which reads English (enT).

// "Multiattack: 2 Claw, 1 Bite" from the swings one call makes.
export function swingsLine(arg: Translator | string[], maybeSwings?: string[]): string {
  const t = typeof arg === "function" ? arg : enT;
  const swings = typeof arg === "function" ? maybeSwings! : arg;
  if (swings.length <= 1) {
    return "";
  }
  const counts = new Map<string, number>();
  for (const name of swings) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return t("Multiattack: {swings}. One card plays the whole routine.", { swings: [...counts.entries()].map(([name, count]) => `${count} ${name}`).join(", ") });
}

function attackCard(t: Translator, enemy: MonsterHandEnemy, actions: PublicEnemyActions, attack: PublicEnemyAttack): HandCard {
  return {
    ...BASE,
    id: `monster:${enemy.id}:attack:${cardKey(attack.name)}`,
    type: "attack",
    name: attack.name,
    range: attack.range,
    dice: `${attack.damage} ${attack.type}`.trim(),
    roll: t("{bonus} to hit", { bonus: signed(attack.toHit) }),
    rules: [swingsLine(t, attack.swings), attack.spellAttack ? t("A spell attack.") : ""].filter(Boolean).join(" "),
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

function abilityCard(t: Translator, enemy: MonsterHandEnemy, actions: PublicEnemyActions, ability: PublicEnemyAbility): HandCard {
  const tp = pluralOf(t);
  const use = abilityUse(ability);
  const rules = [
    ability.halfOnSave ? t("Half damage on a save.") : "",
    ability.rounds ? tp("Lasts {count} round.", "Lasts {count} rounds.", { count: ability.rounds }) : "",
    t("Pick everyone caught in it."),
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
    roll: t("{ability} save DC {dc}", { ability: saveWord(ability.save), dc: ability.dc, context: "table.hand.monster.saveRoll" }),
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

function fleeCard(t: Translator, enemy: MonsterHandEnemy): HandCard {

  return {
    ...BASE,
    id: `monster:${enemy.id}:flee`,
    type: "basic",
    name: t("Flee"),
    cost: "free",
    range: "",
    dice: "",
    roll: t("no roll", { context: "table.hand.react.noRoll" }),
    rules: t("Leaves the fight alive. The party still earns it."),
    icon: { kind: "action", key: "escape" },
    target: "none",
    toHit: null,
    damage: null,
    damageType: "",
    save: null,
    melee: false,
    disabled: enemy.status === "alive" ? null : t("{name} is {status}.", { name: enemy.name, status: enemy.status }),
    spent: false,
    intent: { card: "monster", enemyId: enemy.id, action: "flee" },
  };
}

const MOVE_CARDS: Array<{ move: MonsterMove; nameKey: string; rulesKey: string }> = [
  { move: "dash", nameKey: "Dash", rulesKey: "Adds its speed to its movement this turn ({left} ft left now). Then move its token." },
  { move: "disengage", nameKey: "Disengage", rulesKey: "Its moves this turn draw no opportunity attacks. A bonus action with Nimble Escape." },
  { move: "dodge", nameKey: "Dodge", rulesKey: "Attacks against it have disadvantage and it has advantage on DEX saves until its next turn." },
];

// Dash, Disengage and Dodge (issue #621): its action, played with no target,
// as take_action with its enemyId. Only from a host that resolves them and
// says how far the creature may still walk.
function moveCards(t: Translator, enemy: MonsterHandEnemy, actions: PublicEnemyActions): HandCard[] {
  const movement = actions.movement;
  if (!movement) {
    return [];
  }
  return MOVE_CARDS.map(({ move, nameKey, rulesKey }) => {
    const disabled =
      move === "dash" && movement.speedFeet === 0
        ? t("{name}'s speed is 0 right now.", { name: enemy.name })
        : move === "disengage" && movement.disengaged
          ? t("{name} already Disengaged this turn.", { name: enemy.name })
          : move === "disengage"
            ? null
            : actions.refusal;
    return {
      ...BASE,
      id: `monster:${enemy.id}:${move}`,
      type: "basic",
      name: t(nameKey),
      range: "",
      dice: "",
      roll: t("no roll", { context: "table.hand.react.noRoll" }),
      rules: t(rulesKey, { left: movement.leftFeet }),
      icon: { kind: "action", key: move },
      target: "none",
      toHit: null,
      damage: null,
      damageType: "",
      save: null,
      melee: false,
      // Disengage may still be its bonus action (Nimble Escape): the server
      // says no if neither is left.
      disabled: enemy.status === "alive" ? disabled : t("{name} is {status}.", { name: enemy.name, status: enemy.status }),
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
export function deriveMonsterHand(
  tArg: Translator | MonsterHandEnemy,
  enemyArg?: MonsterHandEnemy,
  maybeOptions: { enemyActions?: boolean; legendaryCards?: boolean } = {},
): HandCard[] {
  const t = typeof tArg === "function" ? tArg : enT;
  const enemy = (typeof tArg === "function" ? enemyArg : tArg)!;
  const options = typeof tArg === "function" ? maybeOptions : ((enemyArg as { enemyActions?: boolean; legendaryCards?: boolean } | undefined) ?? {});
  const actions = enemy.actions;
  if (!actions) {
    return [];
  }
  const legendary = options.legendaryCards ? actions.legendary : undefined;
  return [
    ...actions.attacks.map((attack) => attackCard(t, enemy, actions, attack)),
    ...actions.abilities.map((ability) => abilityCard(t, enemy, actions, ability)),
    ...(options.enemyActions ? moveCards(t, enemy, actions) : []),
    ...(legendary
      ? legendary.options.flatMap((option) => (option.routes.length ? option.routes.map((route) => legendaryCard(enemy, legendary, option, route, t)) : [legendaryCard(enemy, legendary, option, null, t)]))
      : []),
    ...(options.legendaryCards ? (actions.lair ?? []).map((option) => lairCard(enemy, option, t)) : []),
    fleeCard(t, enemy),
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

function listNames(t: Translator, names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  // The joiner's own spaces come with the key's value (" and " / " et ").
  return `${names.slice(0, -1).join(", ")}${t(" and ", { context: "table.hand.join.and" })}${names[names.length - 1]}`;
}

// The line the aim bar shows for the raised card.
export function monsterSentence(
  tArg: Translator | string,
  enemyNameArg?: string | HandCard,
  cardArg?: HandCard | string[],
  targetNames: string[] = [],
): string {
  const t = typeof tArg === "function" ? tArg : enT;
  const enemyName = (typeof tArg === "function" ? enemyNameArg : tArg) as string;
  const card = (typeof tArg === "function" ? cardArg : enemyNameArg) as HandCard;
  const targets = (typeof tArg === "function" ? targetNames : (cardArg as string[])) ?? [];
  const intent = card.intent;
  if (intent.card !== "monster") {
    return "";
  }
  const who = listNames(t, targets);
  if (intent.action === "attack") {
    return who
      ? t("{name} attacks {who} with its {attack}.", { name: enemyName, who, attack: card.name })
      : t("{name} attacks with its {attack}.", { name: enemyName, attack: card.name });
  }
  if (intent.action === "ability") {
    return who
      ? t("{name} uses {ability} on {who}.", { name: enemyName, who, ability: card.name })
      : t("{name} uses {ability}.", { name: enemyName, ability: card.name });
  }
  if (intent.action === "dash") {
    return t("{name} takes the Dash action.", { name: enemyName });
  }
  if (intent.action === "disengage") {
    return t("{name} disengages.", { name: enemyName });
  }
  if (intent.action === "dodge") {
    return t("{name} takes the Dodge action.", { name: enemyName });
  }
  if (intent.action === "legendary") {
    return who
      ? t("{name} spends a legendary action: {card} on {who}.", { name: enemyName, card: card.name, who })
      : t("{name} spends a legendary action: {card}.", { name: enemyName, card: card.name });
  }
  if (intent.action === "lair") {
    return who ? t("The lair acts on {who}.", { who }) : t("The lair acts.");
  }
  return t("{name} breaks off and flees.", { name: enemyName });
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
