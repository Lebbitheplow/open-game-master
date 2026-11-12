// Arcane Shot's eight options (XGtE, Arcane Archer), resolved by the engine.
// Six ride an arrow from a shortbow or longbow that hit this turn
// (src/lib/srd/mt-fb-arcane-shot.ts BOW_HIT): their dice land on the creature
// hit and it saves against the option's effect, DC 8 + proficiency +
// Intelligence. Piercing and Seeking are loosed with no attack roll: each
// takes one attack of the Attack action, and the creatures caught make a
// Dexterity save against the arrow's own damage and the option's dice, half on
// a success. It refuses before it writes, as every resolver of
// src/lib/dm/authored-spend-effects.ts does.
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getActiveEncounter, getEnemy, listEnemies, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { spendAttack } from "@/lib/dm/action-budget";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { damageEnemy, enemyCondition, type SpendContext } from "@/lib/dm/authored-spend-effects";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { buildAttackProfile } from "@/lib/dm/pc-attack-profile";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import type { ToolError } from "@/lib/dm/tool-errors";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { computeSheetDerived } from "@/lib/srd";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { BEGUILED, BOW_HIT, ENFEEBLING, GRASPING, NO_ROLL, SHADOWED, SHOT_LABEL, isBow, lastBowHit, shotDamage, shotsKnown, type Shot } from "@/lib/srd/mt-fb-arcane-shot";
import { spendAmmo, withAmmoCount } from "@/lib/srd/ammunition";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";

type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };
type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

export { ENFEEBLING, GRASPING, SHADOWED };

const refuse = (text: string): ToolError => ({ error: `${text} Nothing was spent.`, refused: "rules" });

// The other creatures on a line 1 foot wide and 30 feet long from the archer
// through the creature named. With no board only the one named is caught.
function onTheLine(encounter: Encounter, archerId: string, target: EncounterEnemy): EncounterEnemy[] {
  const map = getBattleMapForEncounter(encounter.id);
  const from = map ? getTokenByRef(map.id, archerId) : null;
  const to = map ? getTokenByRef(map.id, target.id) : null;
  if (!map || !from || !to) {
    return [];
  }
  const along = { x: to.x - from.x, y: to.y - from.y };
  const length = Math.hypot(along.x, along.y);
  if (!length) {
    return [];
  }
  return listEnemies(encounter.id).filter((enemy) => {
    const token = enemy.id !== target.id && enemy.status === "alive" ? getTokenByRef(map.id, enemy.id) : null;
    if (!token) {
      return false;
    }
    const at = { x: token.x - from.x, y: token.y - from.y };
    const forward = (at.x * along.x + at.y * along.y) / length;
    const aside = Math.abs(at.x * along.y - at.y * along.x) / length;
    return forward > 0 && forward <= 6 && aside < 0.5;
  });
}

export function arcaneShot(ctx: SpendContext, shot: Shot): Resolution {
  const { campaign, sheet } = ctx;
  const label = SHOT_LABEL[shot];
  const known = shotsKnown(sheet.features);
  if (!known.includes(shot)) {
    return refuse(`${sheet.name} does not know the ${label}: the Arcane Shot options they know are ${known.map((entry) => SHOT_LABEL[entry]).join(", ") || "not chosen yet"}.`);
  }
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || !ctx.marks) {
    return refuse(`${label} goes with an arrow fired with the Attack action on ${sheet.name}'s own turn in a fight.`);
  }
  const ref = ctx.args.targetEnemyId ?? (NO_ROLL.includes(shot) ? null : lastBowHit(ctx.marks));
  const target = ref ? resolveTargetFoe(campaign.id, encounter, ref) : null;
  if (!target || target.status !== "alive") {
    return NO_ROLL.includes(shot)
      ? { error: `${label} is loosed at a creature: pass targetEnemyId. Nothing was spent.`, retry: true }
      : refuse(`${label} rides an arrow from a shortbow or longbow that hit a creature this turn, and none has.`);
  }
  const derived = computeSheetDerived(sheet);
  const dc = 8 + derived.proficiencyBonus + derived.abilityMods.int;
  const extra = shotDamage(shot, ctx.held.level);
  const lines: string[] = [];
  const roll = (what: string, dice: string) => Number(rollCard(campaign, ctx.turn, sheet.id, "custom", `${sheet.name}: ${what}`, dice, sheetAttacker(sheet)).total);
  const alive = (enemy: EncounterEnemy) => {
    const fresh = getEnemy(enemy.id);
    return fresh && fresh.status === "alive" ? fresh : null;
  };
  const hurt = (enemy: EncounterEnemy, amount: number, type: string) => {
    const fresh = alive(enemy);
    if (fresh && amount > 0) {
      damageEnemy(ctx, fresh, amount, type);
      lines.push(`${enemy.displayName} takes ${amount} ${type} damage.`);
    }
  };
  const fails = (enemy: EncounterEnemy, ability: Ability, condition?: string) =>
    !rollEnemySave(campaign.id, enemy, ability, dc, {
      magical: true,
      ...(condition ? { resist: true, against: condition } : {}),
      record: { turn: ctx.turn ?? undefined, detail: `${enemy.displayName}: save against the ${label}` },
    }).success;
  const lay = (enemy: EncounterEnemy, condition: string, meta: Record<string, unknown>, said: string) => {
    lines.push(enemyCondition(ctx, enemy, condition, meta) ? said : `${enemy.displayName} cannot be ${condition}.`);
  };
  const untilMine = { untilTurnOf: sheet.id };

  if (NO_ROLL.includes(shot)) {
    const bow = sheet.equipment.find((item) => isBow(item.name));
    if (!bow) {
      return refuse(`${label} is an arrow from a shortbow or longbow, and ${sheet.name} carries neither.`);
    }
    const built = buildAttackProfile(campaign.id, sheet, { weapon: bow.name });
    if ("error" in built) {
      return built;
    }
    // The arrow is one from the quiver, as any shot's is (pc-attack-plan.ts).
    const ammo = spendAmmo(sheet.equipment, { base: built.profile.base, name: built.profile.weapon }, sheet.name);
    if (ammo && !ammo.ok) {
      return refuse(ammo.error);
    }
    const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
    const spent = budget ? spendAttack(budget, sheet.name) : null;
    if (!spent || !spent.ok) {
      return refuse(`${label} takes one attack of the Attack action, with no attack roll, and ${sheet.name} has none left this turn.`);
    }
    storeBudget(encounter, spent.budget);
    const caught = shot === "piercing" ? [target, ...onTheLine(encounter, sheet.id, target)] : [target];
    const arrow = roll(`${label}, the arrow`, built.profile.damageExpression);
    const more = roll(label, extra.dice ?? "1d6");
    for (const enemy of caught) {
      const failed = fails(enemy, "dex");
      lines.push(`${enemy.displayName} ${failed ? "fails" : "makes"} the Dexterity save (DC ${dc}).`);
      hurt(enemy, failed ? arrow : Math.floor(arrow / 2), built.profile.damageType);
      hurt(enemy, failed ? more : Math.floor(more / 2), extra.type);
    }
    publishEncounter(campaign.id);
    return {
      ...(ammo ? { patch: { equipment: withAmmoCount(sheet.equipment, ammo.index, ammo.remaining) } } : {}),
      result: {
        ...(ammo ? { ammunition: `${ammo.name}: ${ammo.remaining} left.` } : {}),
        shot: `${label}: no attack roll, one attack of the Attack action. ${shot === "piercing" ? "Each creature in a line 30 feet long" : "The creature named, wherever it hides,"} makes a Dexterity save (DC ${dc}) against the arrow's damage (${arrow}) and ${extra.dice} ${extra.type} (${more}), half on a success.${shot === "seeking" ? ` ${sheet.name} learns where it is.` : ""}`,
        struck: lines,
      },
    };
  }

  if (!ctx.marks.includes(`${BOW_HIT}${target.id}`)) {
    return refuse(`${label} rides an arrow from a shortbow or longbow that hit ${target.displayName} this turn, and none has.`);
  }
  const amount = extra.dice ? roll(label, extra.dice) : 0;
  hurt(target, amount, extra.type);
  const fresh = alive(target);
  switch (shot) {
    case "banishing":
      if (fresh && fails(fresh, "cha", "banished")) {
        lay(fresh, "banished", { rounds: 1 }, `${target.displayName} is banished to the Feywild until the end of its next turn: its speed is 0 and it is incapacitated there, then it comes back to the space it left or the nearest open one.`);
      } else if (fresh) {
        lines.push(`${target.displayName} makes the Charisma save (DC ${dc}) and stays.`);
      }
      break;
    case "beguiling": {
      const within = (id: string) => ((tilesBetween(encounter.id, target.id, id) ?? 0) * 5) <= 30;
      const party = listSheets(campaign.id).filter((entry) => entry.id !== sheet.id && entry.currentHp > 0 && within(entry.id));
      const named = ctx.args.targetCharacterId ? getSheetById(ctx.args.targetCharacterId) : null;
      const ally = named ? (party.find((entry) => entry.id === named.id) ?? null) : (party[0] ?? null);
      if (!ally) {
        lines.push(named ? `${named.name} is not an ally within 30 feet of ${target.displayName}: no one charms it.` : `No ally stands within 30 feet of ${target.displayName}: no one charms it.`);
      } else if (fresh && fails(fresh, "wis", "charmed")) {
        lay(fresh, "charmed", { source: ally.id, [BEGUILED]: true, ...untilMine }, `${target.displayName} is charmed by ${ally.name} until the start of ${sheet.name}'s next turn, or until ${ally.name} attacks it, damages it or forces a save on it.`);
      } else if (fresh) {
        lines.push(`${target.displayName} makes the Wisdom save (DC ${dc}) and is not charmed.`);
      }
      break;
    }
    case "bursting": {
      const near = (id: string) => {
        const tiles = tilesBetween(encounter.id, target.id, id);
        return tiles !== null && tiles * 5 <= 10;
      };
      for (const other of listEnemies(encounter.id).filter((enemy) => enemy.id !== target.id && enemy.status === "alive" && near(enemy.id))) {
        hurt(other, amount, extra.type);
      }
      for (const caught of listSheets(campaign.id).filter((entry) => entry.currentHp > 0 && near(entry.id))) {
        applyPcDamage(campaign, ctx.turnId, getSheetById(caught.id) ?? caught, { amount, type: extra.type, magical: true, reason: label });
        lines.push(`${caught.name} is within 10 feet and takes ${amount} ${extra.type} damage.`);
      }
      break;
    }
    case "enfeebling":
      if (fresh && fails(fresh, "con")) {
        lay(fresh, ENFEEBLING, untilMine, `${target.displayName}'s weapon attacks deal half damage until the start of ${sheet.name}'s next turn.`);
      } else if (fresh) {
        lines.push(`${target.displayName} makes the Constitution save (DC ${dc}) and is not weakened.`);
      }
      break;
    case "grasping":
      if (fresh) {
        lay(fresh, GRASPING, { rounds: 10 }, `Brambles wrap ${target.displayName} for 1 minute: its speed is 10 feet lower, and the first time on each turn it moves 1 foot or more it takes 2d6 slashing damage. It or a creature that can reach it may use an action on a Strength (Athletics) check, DC ${dc}, to pull them off.`);
      }
      break;
    default:
      if (fresh && fails(fresh, "wis")) {
        lay(fresh, SHADOWED, untilMine, `${target.displayName} cannot see anything farther than 5 feet away until the start of ${sheet.name}'s next turn.`);
      } else if (fresh) {
        lines.push(`${target.displayName} makes the Wisdom save (DC ${dc}) and sees as before.`);
      }
  }
  publishEncounter(campaign.id);
  return { result: { shot: `${label}${extra.dice ? `: ${extra.dice} ${extra.type} (${amount}) on the arrow that hit ${target.displayName}` : `, on the arrow that hit ${target.displayName}`}.`, struck: lines } };
}
