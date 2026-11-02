// A lair's own readers (SRD 5.1, Lair Actions): when initiative count 20
// falls in a pointer move, the printed option a GM names, the save an option
// forces as aoe_damage takes it, and the rule against the same effect two
// rounds in a row. Split from legendary-logic.ts, which re-exports them and
// keeps the lines a fight's creatures print (legendaryLairLines). Pure.

import type { EnemyStats } from "@/lib/bestiary/statblock";
import { ABILITY_WORDS, parseSaveEffect } from "@/lib/dm/save-effect";
import { textKey } from "@/lib/language/text-logic";
import type { LegendaryState } from "@/lib/dm/legendary-logic";

export type LairHolder = { id: string; stats: Pick<EnemyStats, "traits" | "lairOptions"> };

// Lair actions happen on initiative count 20, losing ties: once every
// combatant at 20 or above has had its turn, before anyone below. Whether a
// pointer move from `from` (exclusive; -1 is the top of round 1) to `to`
// (inclusive) passes that count, and on which side of the round's end:
// "before" the order wraps (the round that is ending) or "after" (the new
// one). When every combatant is at 20 or above, the count falls as the round
// ends.
export function lairCountPassed(order: Array<{ initiative?: number | null }>, from: number, to: number): "before" | "after" | null {
  if (!order.length) {
    return null;
  }
  const first = order.findIndex((entry) => (entry.initiative ?? 0) < 20);
  let wrapped = false;
  let index = from;
  for (let steps = 0; steps < order.length; steps += 1) {
    if (index + 1 >= order.length) {
      if (first === -1) {
        return "before";
      }
      wrapped = true;
    }
    index = (index + 1) % order.length;
    if (index === first) {
      return wrapped ? "after" : "before";
    }
    if (index === to) {
      return null;
    }
  }
  return null;
}

// The printed lair option a DM names: its number in the list, or the whole
// line. Null when none is, never the line that shares a word with it.
export function pickLairOption(options: string[], wanted: string): string | null {
  const text = textKey(wanted);
  const numbered = /^(\d{1,2})$/.exec(text);
  if (numbered) {
    return options[Number(numbered[1]) - 1] ?? null;
  }
  return options.find((line) => textKey(line) === text) ?? null;
}

// The save a printed lair option forces, as aoe_damage takes it: the DC, the
// ability and the dice the line prints, and what a failure lays as the save
// reader finds it (src/lib/dm/save-effect.ts). `laid` lists every condition;
// aoe_damage lays one, so `condition` is set only when there is one. Null for
// an option with no save. Read by the tool's next step (lairResolution) and
// by the GM's lair card (src/lib/battlemap/monster-hand-legendary.ts), which makes the
// same aoe_damage call.
export type LairSave = {
  dc: number;
  saveAbility: string;
  damage?: string;
  type?: string;
  halfOnSave?: boolean;
  condition?: string;
  rounds?: number;
  laid: string[];
};

export function lairSave(line: string): LairSave | null {
  const save = /DC\s*(\d+)\s+(str|dex|con|int|wis|cha)[a-z]*\s+sav(?:e|ing throw)/i.exec(line);
  if (!save) {
    return null;
  }
  const damage = /(\d+d\d+(?:\s*[+-]\s*\d+)?)\)?\s+([a-z]+)\s+damage/i.exec(line);
  const ability = save[2].slice(0, 3).toLowerCase();
  const word = Object.keys(ABILITY_WORDS).find((name) => ABILITY_WORDS[name] === ability) ?? "";
  const effect = parseSaveEffect(line.replace(save[0], `DC ${save[1]} ${word} saving throw`));
  const laid = effect.condition ? [effect.condition, ...(effect.also ?? [])] : [];
  return {
    dc: Number(save[1]),
    saveAbility: ability,
    ...(damage ? { damage: damage[1].replace(/\s+/g, ""), type: damage[2].toLowerCase() } : {}),
    // "or half as much damage on a successful one", as the save reader finds
    // it; a line without it deals nothing on a success, where aoe_damage
    // would otherwise halve.
    ...(damage ? { halfOnSave: Boolean(effect.halfOnSave) } : {}),
    ...(laid.length === 1 ? { condition: laid[0], ...(effect.rounds ? { rounds: effect.rounds } : {}) } : {}),
    ...(laid.length > 1 && effect.rounds ? { rounds: effect.rounds } : {}),
    laid,
  };
}

// How a printed lair option resolves through the engine: a save the server
// rolls for each creature it reaches (aoe_damage). Null for an option with
// no save.
export function lairResolution(line: string): string | null {
  const save = lairSave(line);
  if (!save) {
    return null;
  }
  // aoe_damage lays one condition on a failed save; a line that lays more
  // leaves the rest to set_condition on each creature that failed.
  const one = save.condition ? `, condition "${save.condition}"${save.rounds ? `, rounds ${save.rounds}` : ""}` : "";
  return `Resolve it now with aoe_damage: dc ${save.dc}, saveAbility "${save.saveAbility}"${
    save.damage ? `, damage "${save.damage}", type "${save.type}"${save.halfOnSave ? "" : ", halfOnSave false"}` : ""
  }${one}, and the enemyIds and characterIds of the creatures it reaches; the server rolls every save${one ? " and lays the condition on a failure." : "."} ${
    save.laid.length > 1
      ? `A failure lays ${save.laid.join(" and ")}${save.rounds ? ` for ${save.rounds} round${save.rounds === 1 ? "" : "s"}` : ""}: set it on each creature that failed with set_condition.`
      : one
        ? ""
        : "Lay what a failure brings as the line says."
  }`.trim();
}

// A block that says its lair "can't use the same effect two rounds in a row".
export function lairForbidsRepeat(enemies: LairHolder[]): boolean {
  return enemies.some((enemy) => (enemy.stats.traits ?? []).some((line) => /same (?:lair )?(?:effect|action) two rounds in a row/i.test(line)));
}

// The refusal of the option the lair took last round, where its block
// forbids that, or null.
export function lairRepeatRefusal(
  options: string[],
  picked: string,
  legendary: Pick<LegendaryState, "lairLast" | "lairUsedRound">,
  due: number,
  noRepeat: boolean,
): string | null {
  if (options.length > 1 && noRepeat && legendary.lairLast === picked && legendary.lairUsedRound === due - 1) {
    return `The lair cannot use the same effect two rounds in a row; it used this one last round. Choose another: ${options.filter((line) => line !== picked).join(" ")}`;
  }
  return null;
}
