// What a spell on either side of an enemy's swing does to it (SRD 5.1),
// called from the enemy attack (src/lib/dm/enemy-attack.ts):
//   - a one-shot rider on the attacker is spent by the roll it rode
//     (Vicious Mockery's disadvantage on "the next attack roll");
//   - Ray of Enfeeblement halves the damage of the attacker's Strength
//     weapon attacks;
//   - Fire Shield answers a melee hit from within 5 feet with 2d8 of the
//     shield's element, Armor of Agathys any melee hit with its cold, and
//     Holy Aura a fiend's or an undead's with a Constitution save against
//     blindness.
// Ray of Enfeeblement's hit is laid by the spell attack's riders
// (src/lib/dm/spell-attack-riders.ts) through layEnfeeblement. What the
// answers to a blow do is read around them (measureRetort), kept with the
// swing, and taken back when a reaction turns the swing into a miss
// (takeRetortBack, retort-logic.ts).

import { spellKill } from "@/lib/dm/ar-ws-harvest";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, patchEnemyConditions, patchEnemyHp, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { spellSaveDcFor } from "@/lib/srd";
import type { EnemyAttack } from "@/lib/bestiary/statblock";
import { conditionRollRiders, type ConditionRollRiders } from "@/lib/srd/condition-effects";
import { instancesOf, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { retortBack, retortOf, type Retort, type RetortCreature } from "@/lib/dm/retort-logic";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { rollAgainst } from "@/lib/roll-labels";
import { isConditionNamed, nameChoice } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";

// The riders of the attacker's next swing, with what this one spent taken
// off the creature (the spent condition leaves its row).
export function spendEnemyRiders(enemy: EncounterEnemy, riders: ConditionRollRiders): ConditionRollRiders {
  if (!riders.spent.length) {
    return riders;
  }
  const live = getEnemy(enemy.id) ?? enemy;
  const cleared = removeConditions(live.conditions, live.conditionMeta, riders.spent);
  patchEnemyConditions(live.id, cleared.conditions, cleared.meta);
  return conditionRollRiders(cleared.conditions, "attack");
}

// Ray of Enfeeblement's hit: enfeebled, a Constitution save at the end of
// each of the creature's turns against the caster's DC ending it, and the
// spell's concentration holding it (the meta records the spell and caster).
export function layEnfeeblement(
  campaign: Campaign,
  rule: { condition: string; ability: "con" },
  enemyId: string,
  casterId: string,
): string | null {
  const enemy = getEnemy(enemyId);
  const caster = getSheetById(casterId);
  if (!enemy || enemy.status !== "alive" || !caster) {
    return null;
  }
  const dc = spellSaveDcFor(caster, "Ray of Enfeeblement") ?? 13;
  const meta: ConditionMetaMap = {
    ...(enemy.conditionMeta as ConditionMetaMap),
    [rule.condition]: { spell: "Ray of Enfeeblement", source: casterId, saveEnds: { ability: rule.ability, dc } },
  };
  const conditions = enemy.conditions.includes(rule.condition) ? enemy.conditions : [...enemy.conditions, rule.condition];
  patchEnemyConditions(enemy.id, conditions, meta);
  publishEncounter(campaign.id);
  return `${enemy.displayName} is enfeebled: its Strength weapon attacks deal half damage until it makes a ${rule.ability.toUpperCase()} save (DC ${dc}) at the end of one of its turns.`;
}

// Whether a creature's weapon attack uses Strength: a melee weapon attack
// whose attacker is no nimbler than strong (a block with no scores counts
// as Strength).
function usesStrength(enemy: EncounterEnemy, attack: EnemyAttack, ranged: boolean): boolean {
  if (ranged || attack.spellAttack) {
    return false;
  }
  const str = enemy.stats.abilities?.str;
  const dex = enemy.stats.abilities?.dex;
  return str === undefined || dex === undefined || str >= dex;
}

// The damage an enfeebled creature's blow deals.
export function enfeebledBlow(enemy: EncounterEnemy, attack: EnemyAttack, ranged: boolean, amount: number): number {
  // An Enfeebling Arrow halves every weapon attack's damage, not only the
  // Strength ones (src/lib/dm/mt-fb-arcane-shot.ts lays the condition).
  if (enemy.conditions.includes("enfeebling arrow")) {
    return Math.floor(amount / 2);
  }
  return enemy.conditions.includes("enfeebled") && usesStrength(enemy, attack, ranged) ? Math.floor(amount / 2) : amount;
}

// The creature as an answer finds or leaves it, for retortOf.
function creatureNow(enemyId: string): RetortCreature | null {
  const enemy = getEnemy(enemyId);
  return enemy ? { currentHp: enemy.currentHp, maxHp: enemy.maxHp, status: enemy.status, conditions: [...enemy.conditions], conditionMeta: { ...(enemy.conditionMeta as Record<string, unknown>) } } : null;
}

// Runs an answer to a blow and reads what it did to the creature that struck
// (`by` names the answers that fired, from what it returned).
export function measureRetort<T>(enemyId: string, run: () => T, by: (result: T) => string[]): { result: T; retort: Retort | null } {
  const before = creatureNow(enemyId);
  const result = run();
  const after = creatureNow(enemyId);
  const fired = by(result);
  return { result, retort: before && after && fired.length ? retortOf(enemyId, before, after, fired) : null };
}

// A reaction turned the swing that set the answer off into a miss: the
// creature gets back what it took (retort-logic.ts retortBack). Returns the
// line for the reaction's result, or null when nothing came back.
export function takeRetortBack(campaign: Campaign, retort: Retort): string | null {
  const enemy = getEnemy(retort.enemyId);
  if (!enemy) {
    return null;
  }
  const what = retort.by.length ? retort.by.join(" and ") : "A retaliation";
  const now = creatureNow(enemy.id)!;
  const back = retortBack(now, retort);
  if (!back) {
    return retort.fell && enemy.status !== "alive" ? `${what} slew ${enemy.displayName} on a blow that now misses; a slain creature is not raised, so it stays dead.` : null;
  }
  if (back.currentHp !== now.currentHp) {
    patchEnemyHp(enemy.id, back.currentHp, "alive");
  }
  // Written from the creature as the answer is taken back, after the hit
  // points: a condition a regained hit point ends (a caltrops wound) was
  // never lost, since the hit points never were.
  patchEnemyConditions(enemy.id, back.conditions, back.conditionMeta as ConditionMetaMap);
  publishEncounter(campaign.id);
  const healed = back.hp > 0 ? ` gets back the ${back.hp} hit points it took` : back.hp < 0 ? ` loses the ${-back.hp} hit points it drank` : "";
  const freed = retort.laid.length ? `${healed ? " and" : ""} is no longer ${retort.laid.join(" or ")}` : "";
  return `${what} answered a blow that now misses, so it never came: ${enemy.displayName}${healed || freed ? `${healed}${freed}` : " is as it was"}.`;
}

// Fire Shield and Holy Aura answering a melee hit on the character. Returns
// the line for the swing (or null) and the answers that fired.
export function spellRetort(
  campaign: Campaign,
  turn: DmTurn,
  attacker: EncounterEnemy,
  targetId: string,
  melee: boolean,
  withinFive: boolean,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  // The temporary hit points the character held as the blow landed.
  tempHpBefore = 0,
): { line: string | null; by: string[] } {
  const target = getSheetById(targetId);
  const encounter = getActiveEncounter(campaign.id);
  if (!target || !encounter || !melee) {
    return { line: null, by: [] };
  }
  const lines: string[] = [];
  const by: string[] = [];
  // Armor of Agathys: "If a creature hits you with a melee attack while you
  // have these hit points, the creature takes 5 cold damage", 5 more for each
  // slot level above 1st (SRD 5.1). The spell's hour outlasts its temporary
  // hit points, so the ones held as the blow landed decide it. The line told
  // the GM to deal it with apply_damage, which refuses a spell's harm to a
  // foe, so the frost never bit.
  const frost = target.conditions.find((entry) => isConditionNamed(entry, "armor of agathys"));
  if (frost && tempHpBefore > 0) {
    const live = getEnemy(attacker.id);
    const slot = Math.max(1, ...instancesOf((target.conditionMeta as ConditionMetaMap)[frost]).map((instance) => instance.slotLevel ?? 1));
    if (live?.status === "alive") {
      const cold = 5 * slot;
      const applied = applyEnemyDamage(campaign, turn, encounter, live, cold, sheets, sheetsById, "cold", { magical: true, spell: true });
      by.push("Armor of Agathys");
      lines.push(`${target.name}'s Armor of Agathys freezes ${live.displayName} for ${applied.damageApplied ?? cold} cold damage.`);
      lines.push(...(applied.dead ? spellKill(campaign, encounter, live, target.id, { spell: "Armor of Agathys" }) : []));
    }
  }
  const shield = target.conditions.find((entry) => isConditionNamed(entry, "fire shield"));
  if (shield && withinFive) {
    // The warm shield resists cold and burns; the chill shield resists fire
    // and freezes.
    const type = textKey(nameChoice(shield) ?? "") === "fire" ? "cold" : "fire";
    const live = getEnemy(attacker.id);
    if (live?.status === "alive") {
      // The shield's bearer deals it.
      const rolled = rollCard(campaign, turn, target.id, "damage", rollAgainst("Fire Shield", live.displayName), "2d8", sheetAttacker(target)).total;
      const applied = applyEnemyDamage(campaign, turn, encounter, live, rolled, sheets, sheetsById, type, { magical: true, spell: true });
      by.push("Fire Shield");
      lines.push(`${target.name}'s Fire Shield sears ${live.displayName} for ${applied.damageApplied ?? rolled} ${type} damage.`);
      // The shield killed it: Grim Harvest for its bearer (ar-ws-harvest.ts).
      lines.push(...(applied.dead ? spellKill(campaign, encounter, live, target.id, { spell: "Fire Shield" }) : []));
    }
  }
  const aura = target.conditions.find((entry) => entry.toLowerCase() === "holy aura");
  if (aura && /fiend|undead/i.test(attacker.stats.type ?? "")) {
    const live = getEnemy(attacker.id);
    const casterId = (target.conditionMeta as ConditionMetaMap)[aura]?.source ?? target.id;
    const caster = getSheetById(casterId) ?? target;
    const dc = spellSaveDcFor(caster, "Holy Aura") ?? 13;
    if (live?.status === "alive") {
      const save = rollEnemySave(campaign.id, live, "con", dc, {
        magical: true,
        resist: true,
        against: "blinded",
        record: { turn, detail: `${live.displayName}: CON save against Holy Aura` },
      });
      by.push("Holy Aura");
      if (!save.success && !live.conditions.includes("blinded")) {
        const meta: ConditionMetaMap = { ...(live.conditionMeta as ConditionMetaMap), blinded: { spell: "Holy Aura", source: caster.id } };
        patchEnemyConditions(live.id, [...live.conditions, "blinded"], meta);
        publishEncounter(campaign.id);
        lines.push(`Holy Aura flares: ${live.displayName} is blinded until the spell ends.`);
      }
    }
  }
  return { line: lines.length ? lines.join(" ") : null, by };
}

// ---- Bestow Curse ----

// Whether the creature attacks under Bestow Curse's attack curse laid by
// this character: disadvantage against them, and only them.
export function cursedAgainst(enemy: EncounterEnemy, targetId: string): boolean {
  const meta = enemy.conditionMeta as ConditionMetaMap;
  return enemy.conditions.includes("cursed (attacks)") && meta["cursed (attacks)"]?.source === targetId;
}

// The necrotic curse's die on a hit by the one who laid it, or null.
export function curseRider(enemy: EncounterEnemy, attackerId: string): { dice: string; type: string } | null {
  const meta = enemy.conditionMeta as ConditionMetaMap;
  return enemy.conditions.includes("cursed (necrotic)") && meta["cursed (necrotic)"]?.source === attackerId
    ? { dice: "1d8", type: "necrotic" }
    : null;
}

// The same die when the curser's spell harms the creature (cast_at_enemy,
// aoe_damage). Returns the line for the result, or null.
export function curseBurn(
  campaign: Campaign,
  turn: DmTurn,
  enemyId: string,
  casterId: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): string | null {
  const encounter = getActiveEncounter(campaign.id);
  const enemy = getEnemy(enemyId);
  const rider = enemy && enemy.status === "alive" ? curseRider(enemy, casterId) : null;
  if (!encounter || !enemy || !rider) {
    return null;
  }
  const caster = getSheetById(casterId);
  const rolled = rollCard(campaign, turn, caster?.id ?? null, "damage", rollAgainst("Bestow Curse", enemy.displayName), rider.dice, caster ? sheetAttacker(caster) : null).total;
  const applied = applyEnemyDamage(campaign, turn, encounter, enemy, rolled, sheets, sheetsById, rider.type, { magical: true, spell: true });
  // The curse's own necrotic killed it (ar-ws-harvest.ts).
  const onKill = applied.dead ? spellKill(campaign, encounter, enemy, casterId, { spell: "Bestow Curse" }) : [];
  return [`Bestow Curse: ${rolled} necrotic more to ${enemy.displayName}.`, ...onKill].join(" ");
}
