// A hit that was no critical made into one, when a reaction rolls its d20
// again and the new roll is a natural 20 (Runic Shield: "reroll the d20 and
// use the new roll"; SRD 5.1, Critical Hits: roll the attack's damage dice
// twice). The dice already rolled stand; the critical's copy of each die is
// rolled now (its maximum under Powerful Critical, with each flat modifier
// again under Critical Damage Modifiers), laid out as a critical roll would
// have been, and read into typed parts as enemy_attack reads one
// (enemy-hit.ts blowByType). What shrank the blow as it landed, and what
// reactions have since taken off it, come off the critical too. A swing that
// kept no recipe (an older record, another kind of attacker) is not raised:
// the caller says so and the damage stands.
import { getEnemy } from "@/lib/db/encounters";
import type { RollResult } from "@/lib/dice";
import type { DmTurn } from "@/lib/db/dm-turns";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { blowByType, scaledParts } from "@/lib/dm/enemy-hit";
import { carryCuts, type LastHit, type SwingRecord } from "@/lib/dm/last-hit";
import { rollCard } from "@/lib/dm/roll-card";

const DICE = /^(\d+)d(\d+)$/i;
const FLAT = /^\d+$/;

export function raiseToCritical(campaign: { id: string }, turn: DmTurn | null, record: LastHit, swing: SwingRecord, label: string): SwingRecord | null {
  const recipe = swing.critical;
  if (!recipe || swing.crit || record.attacker.kind !== "enemy" || !record.attacker.id) {
    return null;
  }
  const enemy = getEnemy(record.attacker.id);
  const attack = enemy?.stats.attacks?.find((entry) => entry.name === recipe.attack);
  const terms = recipe.expression.replace(/\s+/g, "").match(/[+-]?[^+-]+/g);
  if (!enemy || !attack || !terms || terms.length !== recipe.terms.length) {
    return null;
  }
  const doubled = (body: string) => DICE.test(body) || (Boolean(recipe.doubleFlat) && FLAT.test(body));
  const extras = terms.flatMap((term) => {
    const sign = term.startsWith("-") ? "-" : "+";
    const body = term.replace(/^[+-]/, "");
    const dice = DICE.exec(body);
    if (dice) return [sign + (recipe.powerful ? String(Number(dice[1]) * Number(dice[2])) : body)];
    return doubled(body) ? [sign + body] : [];
  });
  if (!extras.length) {
    return null;
  }
  const extra = rollCard(campaign, turn, record.characterId, "damage", `${recipe.attack}: the critical's dice (${label})`, extras.join("").replace(/^\+/, ""), {
    kind: "enemy",
    id: enemy.id,
    name: enemy.displayName,
  });
  // The roll a critical would have made: each term, then its copy.
  const combined: RollResult["terms"] = [];
  let next = 0;
  terms.forEach((term, index) => {
    combined.push(recipe.terms[index]);
    if (doubled(term.replace(/^[+-]/, ""))) {
      const copy = extra.terms[next];
      next += 1;
      if (copy) combined.push(copy);
    }
  });
  const total = combined.reduce((sum, term) => sum + term.sign * (term.kind === "dice" ? term.subtotal : term.value), 0);
  const expression = critDamageExpression(recipe.expression, 0, { powerfulCritical: recipe.powerful, multiplyNumeric: recipe.doubleFlat });
  const blow = blowByType(attack, { expression, total, terms: combined }, true);
  const uncut = Math.floor(Math.max(0, blow.amount) * recipe.scale);
  const raw = carryCuts(swing, uncut, recipe.from) ?? Math.max(0, uncut - Math.max(0, recipe.from - swing.raw));
  const raised: SwingRecord = {
    ...swing,
    crit: true,
    raw,
    // The blow it was, for Sentinel at Death's Door to turn it back.
    normal: { raw: recipe.from, ...(swing.type !== undefined ? { type: swing.type } : {}), ...(swing.parts ? { parts: swing.parts } : {}), from: uncut },
    // And for a reroll that rolls the 20 away (Lucky, a second Runic Shield): only
    // the natural 20 made this critical.
    plain: { raw: recipe.from, ...(swing.parts ? { parts: swing.parts } : {}), from: uncut },
  };
  delete raised.critical;
  delete raised.parts;
  return blow.parts ? { ...raised, parts: scaledParts(blow.parts, uncut) } : raised;
}
