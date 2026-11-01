// The legendary and lair cards of the GM's monsters' hand (issue 685 audit,
// 4.G), split from monster-hand.ts, which deals them. Pure.

import { signed, type HandCard } from "@/lib/battlemap/hand-core";
import type { PublicLairOption, PublicLegendaryActions, PublicLegendaryOption, PublicLegendaryRoute } from "@/lib/dm/enemy-actions-view";
import { monsterAttackIcon } from "@/lib/battlemap/attack-art";
import { BASE, cardKey, saveWord, type MonsterHandEnemy } from "@/lib/battlemap/monster-hand-parts";

// A legendary action's option (issue 685 audit, 4.G): offered only while the
// projection says one can be taken now (enemy-actions-view.ts
// PublicLegendaryActions), one card for each way to play it ("Attack: Claw",
// "Attack: Tail"), its cost and what is left on the card, and a cost above
// what is left held with legendary_action's own sentence. A card is one call:
// the spend and what it buys together (src/lib/dm/legendary-play.ts).
export function legendaryCard(enemy: MonsterHandEnemy, legendary: PublicLegendaryActions, option: PublicLegendaryOption, route: PublicLegendaryRoute | null): HandCard {
  const attack = route?.attack;
  const ability = route?.ability;
  const many = option.routes.length > 1;
  const refusal = option.refusal ?? route?.refusal ?? null;
  const target = route?.target === "none" || !route ? "none" : "enemy";
  const shared = {
    ...BASE,
    id: `monster:${enemy.id}:legendary:${cardKey(option.name)}${many && route ? `:${cardKey(route.use)}` : ""}`,
    name: many && route ? `${option.name}: ${route.use}` : option.name,
    cost: "legendary" as const,
    // Two short parts the card shows on two lines at its left edge, which a
    // fan never covers (HandCardFace.tsx): "· 3 of 3 left" lay under the next
    // card.
    resource: `Costs ${option.cost} · ${legendary.left}/${legendary.max} left`,
    description: option.text,
    // An option the server cannot read is spent, and the rest is the GM's.
    rules: route ? `${route.how}.` : "The server cannot read this option: playing it spends the action, and you resolve the rest by hand from its line.",
    target,
    disabled: refusal,
    spent: Boolean(refusal),
  } satisfies Partial<HandCard>;
  const intent = {
    card: "monster" as const,
    enemyId: enemy.id,
    action: "legendary" as const,
    legendary: option.name,
    ...(many && route ? { use: route.use } : {}),
    ...(route?.square ? { square: route.square } : {}),
    ...(route?.spells ? { spells: route.spells } : {}),
    ...(route?.target === "one" ? { aim: "one" as const } : route?.target === "many" ? { aim: "many" as const } : {}),
    ...(route?.rows ? { rows: true } : {}),
    ...(route && route.pick !== "foes" ? { pick: route.pick } : {}),
    ...(route?.most ? { most: route.most } : {}),
  };
  if (attack) {
    return {
      ...shared,
      type: "attack",
      range: attack.range,
      dice: `${attack.damage} ${attack.type}`.trim(),
      roll: `${signed(attack.toHit)} to hit`,
      condition: attack.onHit ?? "",
      icon: monsterAttackIcon(enemy.name, attack.name, Boolean(attack.spellAttack)),
      toHit: attack.toHit,
      damage: attack.damage || null,
      damageType: attack.type.split("/")[0] ?? "",
      save: null,
      melee: attack.melee,
      intent: { ...intent, attackName: attack.name },
    };
  }
  if (ability) {
    return {
      ...shared,
      type: ability.damage ? "spell" : "control",
      range: "",
      dice: ability.damage ? `${ability.damage} ${ability.damageType ?? ""}`.trim() : (ability.condition ?? ""),
      roll: `${saveWord(ability.save)} save DC ${ability.dc}`,
      condition: ability.condition ?? "",
      icon: { kind: "action", key: "cast" },
      toHit: null,
      damage: ability.damage ?? null,
      damageType: ability.damageType ?? "",
      save: { ability: saveWord(ability.save), dc: ability.dc },
      melee: false,
      intent,
    };
  }
  return {
    ...shared,
    type: route?.spells ? "spell" : "feature",
    range: route?.square ? `${route.square.feet} ft` : "",
    dice: "",
    roll: "no roll",
    icon: { kind: "action", key: route?.square ? "dash" : "cast" },
    toHit: null,
    damage: null,
    damageType: "",
    save: null,
    melee: false,
    intent,
  };
}

// A lair option's card name: its opening words ("The ground shakes"), the
// whole line on the card's face and in its hover text.
export function lairTitle(line: string): string {
  const clause = line.split(/[.;:,]/)[0]?.trim() ?? "";
  const words = clause.split(/\s+/).filter(Boolean);
  return words.length > 5 ? `${words.slice(0, 4).join(" ")}…` : clause || "Lair action";
}

// The lair's own action on initiative count 20 (losing ties), on the card of
// the creature whose block prints it: offered only while the lair may act
// this round, an option with a save played on everyone caught in it.
export function lairCard(enemy: MonsterHandEnemy, option: PublicLairOption): HandCard {
  const save = option.save;
  return {
    ...BASE,
    id: `monster:${enemy.id}:lair:${option.number}`,
    type: save ? (save.damage ? "spell" : "control") : "feature",
    name: `Lair: ${lairTitle(option.line)}`,
    cost: "lair",
    range: "",
    dice: save?.damage ? `${save.damage} ${save.type ?? ""}`.trim() : (save?.laid.join(", ") ?? ""),
    roll: save ? `${saveWord(save.saveAbility)} save DC ${save.dc}` : "no roll",
    rules: [option.line, save ? "Pick everyone caught in it." : "", save && save.laid.length > 1 ? `Set ${save.laid.slice(1).join(" and ")} on each who failed from the console.` : ""]
      .filter(Boolean)
      .join(" "),
    description: option.line,
    resource: "Initiative 20",
    condition: save?.condition ?? "",
    icon: { kind: "action", key: "cast" },
    target: save ? "enemy" : "none",
    toHit: null,
    damage: save?.damage ?? null,
    damageType: save?.type ?? "",
    save: save ? { ability: saveWord(save.saveAbility), dc: save.dc } : null,
    melee: false,
    disabled: option.refusal,
    spent: Boolean(option.refusal),
    intent: {
      card: "monster",
      enemyId: enemy.id,
      action: "lair",
      lair: {
        number: option.number,
        ...(save
          ? {
              save: {
                dc: save.dc,
                saveAbility: save.saveAbility,
                ...(save.damage ? { damage: save.damage } : {}),
                ...(save.type ? { type: save.type } : {}),
                ...(save.halfOnSave !== undefined ? { halfOnSave: save.halfOnSave } : {}),
                ...(save.condition ? { condition: save.condition } : {}),
                ...(save.rounds ? { rounds: save.rounds } : {}),
              },
            }
          : {}),
      },
    },
  };
}
