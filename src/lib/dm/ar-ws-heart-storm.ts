// Heart of the Storm (Storm Sorcery 6): "Resistance to lightning and thunder
// damage, and casting a spell of those types deals half your sorcerer level in
// damage to creatures within 10 feet." The resistance was typed and the second
// half of the sentence was the feature's guidance: nothing dealt it, and at a
// person's table nobody remembered to.
//
// When the holder casts a spell of 1st level or higher that deals lightning or
// thunder damage, the storm erupts from them: every creature of the other side
// within 10 feet that the holder can see takes lightning or thunder damage
// equal to half the sorcerer level, with no save and no roll.
//
// Rulings (the fifth round of the arcane repair):
//   - "creatures of your choice": the holder chooses, and the engine chooses
//     for them every hostile creature in reach they can see and no ally,
//     which is what a player would choose.
//   - Lightning or thunder: the one more of which gets through to the
//     creatures struck, and the spell's own type when it is the same either
//     way (as Wrath of the Storm's choice is made, authored-reactions.ts).
//   - Who is struck is settled as the spell is cast, where everyone stands
//     then: a Thunderwave that throws a creature back was cast beside it.
//   - Once per casting: the cast door calls this for the casting itself, not
//     for a later ray, dart or target of it, nor for a running spell's effect
//     coming again on a later turn. A cantrip erupts nothing ("a spell of 1st
//     level or higher" in the feature this text condenses), nor does a
//     casting that was countered, held back by Slow, or stored in a ring.
//   - Off a battle map there are no 10 feet to measure: the line tells the GM
//     the damage and leaves the creatures to them.
//
// Called by cast-guard.ts castSpell, the one door every casting passes, so a
// spell cast through cast_at_enemy, aoe_damage, pc_attack, cast_buff or
// use_spell_slot erupts alike. The damage lands at the end of the tool call
// (ar-ws-after-call.ts): the cast tools hold their targets' rows across the
// door, and a creature hurt in between would have the burst overwritten by the
// spell's own damage.

import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import type { Campaign } from "@/lib/db/campaigns";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { afterThisCall } from "@/lib/dm/ar-ws-after-call";
import { unseenBecause, withinFeet } from "@/lib/dm/authored-saves";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { meetEnemyPart } from "@/lib/dm/enemy-defenses";
import { foesOfSheet, resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { swallowCoverBetween } from "@/lib/dm/swallow";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { activeAuthored, resolveFormula } from "@/lib/srd/authored-effects";
import { isSheetFoe } from "@/lib/dm/combat-sides-logic";

export type CastOfBurst = {
  spell: string;
  // The spell's own level: a cantrip is 0.
  level: number;
  // The damage types the spell deals (its first and, for a blast of two, its second).
  types: Array<string | null | undefined>;
};

// The storm a casting sets off around its caster, or null when it sets off
// none. What it answers joins the cast's result when it lands at once, and
// the tool call's result when it lands at the call's end.
export function eruptOnCast(campaign: Campaign, turnId: string | null, caster: CharacterSheet, cast: CastOfBurst): Record<string, unknown> | null {
  if (cast.level < 1) {
    return null;
  }
  const dealt = cast.types.map((type) => textKey(type ?? "")).filter(Boolean);
  const row = activeAuthored(caster, "cast_burst").find(({ effect }) => effect.types.some((type) => dealt.includes(textKey(type))));
  if (!row) {
    return null;
  }
  const { effect, held } = row;
  const amount = Math.floor(Number(resolveFormula(effect.amount, held.level)) || 0);
  if (amount <= 0) {
    return null;
  }
  const own = effect.types.find((type) => dealt.includes(textKey(type))) ?? effect.types[0];
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return null;
  }
  if (!getBattleMapForEncounter(encounter.id)) {
    // Nothing to measure the 10 feet on: the GM lands it, told in the call's result.
    const line = `${held.feature}: ${caster.name}'s ${cast.spell} sets it off. Creatures of ${caster.name}'s choice within ${effect.feet} feet that they can see each take ${amount} ${effect.types.join(" or ")} damage (apply_damage): no board is live to measure it on.`;
    return afterThisCall(() => ({ castBurst: line }));
  }
  // Who stands in it now, as the spell is cast.
  const struck = foesOfSheet(campaign.id, encounter, caster.id)
    .filter(
      (enemy) =>
        enemy.status === "alive" &&
        enemy.currentHp > 0 &&
        withinFeet(encounter.id, caster.id, enemy.id, effect.feet) &&
        !unseenBecause(encounter.id, caster, enemy) &&
        !swallowCoverBetween(caster.id, enemy.id),
    )
    .map((enemy) => enemy.id);
  if (!struck.length) {
    return null;
  }
  return afterThisCall(() => land(campaign, turnId, caster.id, { feature: held.feature, spell: cast.spell, amount, types: effect.types, own, feet: effect.feet, struck }));
}

type Burst = { feature: string; spell: string; amount: number; types: string[]; own: string; feet: number; struck: string[] };

function land(campaign: Campaign, turnId: string | null, casterId: string, burst: Burst): Record<string, unknown> | null {
  const encounter = getActiveEncounter(campaign.id);
  const caster = getSheetById(casterId);
  if (!encounter || !caster) {
    return null;
  }
  // Whoever of them the call left standing.
  const standing = burst.struck
    .map((id) => resolveTargetFoe(campaign.id, encounter, id))
    .filter((enemy): enemy is EncounterEnemy => Boolean(enemy && enemy.status === "alive" && enemy.currentHp > 0));
  if (!standing.length) {
    return null;
  }
  const type = typeChosen(campaign.id, standing, burst);
  const turn = turnId ? getDmTurn(turnId) : null;
  const lines: string[] = [];
  for (const stale of standing) {
    // Each from its own row as it is now: one that fell to an earlier
    // creature's death in this burst is not struck again.
    const enemy = resolveTargetFoe(campaign.id, encounter, stale.id);
    if (!enemy || enemy.status !== "alive" || enemy.currentHp <= 0) {
      continue;
    }
    lines.push(strike(campaign, turn, encounter, enemy, burst, type));
  }
  publishEncounter(campaign.id);
  return lines.length
    ? { castBurst: `${burst.feature}: ${caster.name}'s ${burst.spell} sets it off, ${burst.amount} ${type} damage to each creature within ${burst.feet} feet they chose. ${lines.join(" ")} The server applied it.` }
    : null;
}

function strike(campaign: Campaign, turn: ReturnType<typeof getDmTurn>, encounter: Encounter, enemy: EncounterEnemy, burst: Burst, type: string): string {
  if (!turn) {
    // No GM turn behind the call (a casting the server completed): the plain
    // write, on an enemy's own row only.
    return isSheetFoe(enemy) ? `${enemy.displayName} is left to the GM (${burst.amount} ${type}).` : hurtEnemy(campaign, encounter, enemy, burst.amount, type, burst.feature);
  }
  const before = enemy.currentHp;
  const sheets = listSheets(campaign.id);
  const out = applyEnemyDamage(campaign, turn, encounter, enemy, burst.amount, sheets, new Map(sheets.map((entry) => [entry.id, entry])), type, { magical: true });
  const after = resolveTargetFoe(campaign.id, encounter, enemy.id);
  const taken = Math.max(0, before - (after?.currentHp ?? 0));
  const fell = !after || after.status !== "alive" || after.currentHp <= 0;
  return `${enemy.displayName} takes ${taken}${fell ? " and falls" : typeof out.hp === "string" ? ` (${out.hp})` : ""}.`;
}

// Lightning or thunder: the type more of which gets through to the creatures
// struck, the spell's own on a tie.
function typeChosen(campaignId: string, enemies: EncounterEnemy[], burst: Burst): string {
  const through = (type: string) => enemies.reduce((sum, enemy) => sum + (isSheetFoe(enemy) ? burst.amount : meetEnemyPart(campaignId, enemy, burst.amount, type, { magical: true }).amount), 0);
  let best = burst.own;
  for (const type of burst.types) {
    if (through(type) > through(best)) {
      best = type;
    }
  }
  return best;
}
