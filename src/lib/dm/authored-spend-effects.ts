// What an authored spend does once it is paid for (src/lib/dm/authored-spends.ts
// has checked the gate, the pool and the turn). Each resolver refuses before
// it writes; the caller then spends the pool and the turn.

import { WEAPON_HIT } from "@/lib/dm/action-budget";
import { saveModFor } from "@/lib/bestiary/enemy-numbers";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { foesOfSheet, resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { chosenTargets } from "@/lib/dm/chosen-targets";
import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { resolveFormula, type AuthoredSpend, type HeldAuthored } from "@/lib/srd/authored-effects";
import type { Ability, SpendDoes } from "@/lib/srd/authored-effects-types";
import { STORM_AURA } from "@/lib/srd/authored-effects-data";
import { likelierSave, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { healArea } from "@/lib/dm/authored-heal-area";
import { canRegain, regainHitPoints } from "@/lib/dm/regain";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { commandCreature, commandedNote } from "@/lib/dm/command-undead";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { charmedBy } from "@/lib/dm/enemy-profile";
import { d20Expression } from "@/lib/dice";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { bindsWorthResisting } from "@/lib/dm/legendary-logic";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { unseenBecause, unseenByConditions, withinFeet } from "@/lib/dm/authored-saves";
import { darknessNear, dispelZones } from "@/lib/dm/zone-cast";
import { tilesBetween, wallBetween } from "@/lib/dm/attack-spatial";
import { rerollLastSave, swarmPush } from "@/lib/dm/authored-spend-more";
import { summonSteelDefender } from "@/lib/dm/summon-defender";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { rollAgainst } from "@/lib/roll-labels";
import { namedOption, type ToolError } from "@/lib/dm/tool-errors";
import { textKey, words } from "@/lib/language/text-logic";
import { creatureTypeOf } from "@/lib/bestiary/creature-type";
import { creditFeatureTeleport } from "@/lib/dm/feature-teleport";
import { isConditionNamed, isNamed, nameChoice } from "@/lib/srd/feature-names";
import { swallowCoverBetween, swallowCoverError } from "@/lib/dm/swallow";
import { resourceName } from "@/lib/srd/class-resources";
import { resolveCounterSave } from "@/lib/dm/counter-saves";
import { regainSlot } from "@/lib/dm/authored-spend-counters";

const DAMAGE_WORDS = new Set(["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"]);

// A spend's damage on one enemy, as the holder's dice card.
const damageDice = (ctx: SpendContext, enemy: EncounterEnemy, dice: string) =>
  rollCard(ctx.campaign, ctx.turn, ctx.sheet.id, "damage", rollAgainst(ctx.spend.name, enemy.displayName), dice, sheetAttacker(ctx.sheet)).total;

export type SpendContext = {
  // The once-per-turn marks of the holder's own turn; absent off it.
  marks?: string[];
  campaign: Campaign;
  turnId: string;
  turn: DmTurn | null;
  encounter: Encounter | null;
  sheet: CharacterSheet;
  held: HeldAuthored;
  spend: AuthoredSpend;
  args: { amount?: number; variant?: string; targetCharacterId?: string; targetEnemyId?: string; targetEnemyIds?: string[] };
  units: number;
  mods: Record<string, number>;
  reason: string;
};

type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };

function formula(ctx: SpendContext, value: Parameters<typeof resolveFormula>[0]): string {
  return resolveFormula(value, ctx.held.level, ctx.mods);
}

// The save DC a feature sets: the spell save DC, or 8 + proficiency + the
// named ability's modifier.
function saveDc(ctx: SpendContext, ability: Ability | "spell"): number {
  const derived = computeSheetDerived(ctx.sheet);
  if (ability === "spell") {
    return derived.spellSaveDc ?? 8 + derived.proficiencyBonus + Math.max(derived.abilityMods.int, derived.abilityMods.wis, derived.abilityMods.cha);
  }
  return 8 + derived.proficiencyBonus + derived.abilityMods[ability];
}

function bardicDie(level: number): string {
  return level >= 15 ? "d12" : level >= 10 ? "d10" : level >= 5 ? "d8" : "d6";
}

// The condition a buff lays: its variant's, named whole, when it has
// variants.
function conditionName(ctx: SpendContext, does: Extract<SpendDoes, { kind: "buff" }>): string | ToolError {
  const variant = does.variants ? namedOption(ctx.spend.name, ctx.args.variant, Object.keys(does.variants)) : null;
  if (variant !== null && typeof variant !== "string") {
    return variant;
  }
  const base = variant !== null && does.variants ? does.variants[variant] : Array.isArray(does.condition) ? resolveFormula(does.condition, ctx.held.level) : does.condition;
  return base.replace("{bardic}", bardicDie(ctx.held.level)).replace("{units}", String(ctx.units));
}

// The creature a spend aims at: the one named, else the one the character
// attacked last this round.
function targetEnemy(ctx: SpendContext): EncounterEnemy | ToolError {
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter) {
    return { error: `${ctx.spend.name} aims at a creature in a fight; there is no fight. Nothing was spent.`, refused: "rules" };
  }
  let ref = ctx.args.targetEnemyId;
  if (!ref) {
    const pairs = encounter.targets?.round === encounter.round ? encounter.targets.pairs[ctx.sheet.id] : undefined;
    ref = pairs?.[pairs.length - 1];
  }
  const enemy = ref ? resolveTargetFoe(encounter.campaignId, encounter, ref) : null;
  if (!enemy || enemy.status !== "alive") {
    return { error: `${ctx.spend.name} needs a living creature: pass targetEnemyId from GAME STATE. Nothing was spent.`, retry: true };
  }
  // Not across a swallower's wall, the creature attacked last included
  // (swallow.ts).
  return swallowCoverError(ctx.sheet.id, enemy.id) ?? enemy;
}

function damageEnemy(ctx: SpendContext, enemy: EncounterEnemy, amount: number, type: string): Record<string, unknown> {
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter || amount <= 0) {
    return { damage: 0 };
  }
  if (ctx.turn) {
    const sheets = listSheets(ctx.campaign.id);
    const applied = applyEnemyDamage(ctx.campaign, ctx.turn, encounter, enemy, amount, sheets, new Map(sheets.map((entry) => [entry.id, entry])), type, { magical: true });
    publishEncounter(ctx.campaign.id);
    return { damage: amount, ...applied };
  }
  const line = hurtEnemy(ctx.campaign, encounter, enemy, amount, type, ctx.spend.name);
  publishEncounter(ctx.campaign.id);
  return { damage: amount, applied: line };
}

// Whether it landed: not on a creature immune to it, stone's poison
// included (damage-logic.ts immuneToCondition).
function enemyCondition(ctx: SpendContext, enemy: EncounterEnemy, condition: string, meta: Record<string, unknown>): boolean {
  const fresh = getEnemy(enemy.id) ?? enemy;
  if (immuneToCondition(fresh, condition)) {
    return false;
  }
  const kept = fresh.conditions.filter((entry) => textKey(entry) !== textKey(condition));
  patchEnemyConditions(fresh.id, [...kept, condition], {
    ...(fresh.conditionMeta as ConditionMetaMap),
    [condition]: { source: ctx.sheet.id, ...meta },
  } as typeof fresh.conditionMeta);
  publishEncounter(ctx.campaign.id);
  return true;
}

function sheetCondition(campaign: Campaign, target: CharacterSheet, condition: string, rounds: number, extra: FullPatchSheetInput = {}) {
  const fresh = getSheetById(target.id) ?? target;
  const kept = fresh.conditions.filter((entry) => textKey(entry) !== textKey(condition));
  const updated = patchSheet(fresh.id, {
    conditions: [...kept, condition],
    conditionMeta: { ...fresh.conditionMeta, [condition]: { rounds } },
    ...extra,
  });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// The allies in reach of the holder, the holder first when `withSelf`.
function alliesInReach(ctx: SpendContext, rangeFt: number, withSelf: boolean): CharacterSheet[] {
  const encounter = getActiveEncounter(ctx.campaign.id);
  const party = listSheets(ctx.campaign.id)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((entry) => !entry.deathSaves?.dead && entry.id !== ctx.sheet.id)
    .filter((entry) => !encounter || withinFeet(encounter.id, ctx.sheet.id, entry.id, rangeFt))
    // Nobody across a swallower's wall is in reach (swallow.ts).
    .filter((entry) => !swallowCoverBetween(ctx.sheet.id, entry.id));
  return withSelf ? [ctx.sheet, ...party] : party;
}

function addUnits(base: string, per: string | undefined, units: number): string {
  if (!per || units <= 0) {
    return base;
  }
  const a = /^(\d+)d(\d+)$/.exec(base);
  const b = /^(\d+)d(\d+)$/.exec(per);
  if (a && b && a[2] === b[2]) {
    return `${Number(a[1]) + units * Number(b[1])}d${a[2]}`;
  }
  return `${base}+${units * Number(b?.[1] ?? 1)}d${b?.[2] ?? "6"}`;
}

export function resolveSpendEffect(ctx: SpendContext, does: SpendDoes): Resolution {
  const { sheet, campaign } = ctx;
  switch (does.kind) {
    case "choose": {
      const option = namedOption(ctx.spend.name, ctx.args.variant, does.options);
      if (typeof option !== "string") {
        return option;
      }
      const features = sheet.features.map((feature) =>
        feature.name === ctx.held.name ? { ...feature, name: `${ctx.held.feature} (${option})` } : feature,
      );
      return { patch: { features }, result: { chosen: `${ctx.held.feature}: ${option}. The server applies its effects from now on.` } };
    }
    case "buff": {
      const condition = conditionName(ctx, does);
      if (typeof condition !== "string") {
        return condition;
      }
      const lines: string[] = [];
      // Aimed at a creature with no fight on: it is not on the board, so the
      // use is paid and the DM narrates it on the creature named (Hexblade's
      // Curse laid at a parley).
      if ((does.target === "enemy" || does.quarry) && !getActiveEncounter(campaign.id)) {
        return { result: { applied: [`${ctx.spend.name}: ${condition}, on the creature the story names. There is no fight, so no creature on the board carries it.`] } };
      }
      const tempHp = does.tempHp ? Math.max(0, Number(rollCard(ctx.campaign, ctx.turn, sheet.id, "custom", `${ctx.spend.name}: temporary hit points`, formula(ctx, does.tempHp), null).total)) : 0;
      if (does.target === "enemy") {
        const enemy = targetEnemy(ctx);
        if ("error" in enemy) {
          return enemy;
        }
        const live = getActiveEncounter(campaign.id);
        if (live && does.rangeFt && !withinFeet(live.id, sheet.id, enemy.id, does.rangeFt)) {
          return { error: `${enemy.displayName} is beyond ${does.rangeFt} feet of ${sheet.name}; ${ctx.spend.name} reaches no further. Nothing was spent.`, refused: "rules" };
        }
        const landed = enemyCondition(ctx, enemy, condition, { rounds: does.rounds });
        lines.push(landed ? `${enemy.displayName} is ${condition} for ${does.rounds} rounds.` : `${enemy.displayName} cannot be ${condition}.`);
      } else if (does.target === "allies") {
        const count = does.count ? Number(formula(ctx, does.count)) : 5;
        // "Creatures you can see" (Watcher's Will): the conditions and the
        // board's line as every sight check reads them; an ally hides from
        // the foes, not from its friends.
        const encounter = getActiveEncounter(campaign.id);
        const unseen = (ally: CharacterSheet) =>
          ally.id !== sheet.id && does.sight ? (encounter ? unseenBecause(encounter.id, sheet, ally, { hidden: false }) : unseenByConditions(null, sheet, ally, { hidden: false })) : null;
        const named = ctx.args.targetCharacterId ? getSheetById(ctx.args.targetCharacterId) : null;
        const namedUnseen = named ? unseen(named) : null;
        if (named && namedUnseen) {
          return { error: `${sheet.name} cannot see ${named.name} (${namedUnseen}), and ${ctx.spend.name} takes creatures they can see. Nothing was spent.`, refused: "rules" };
        }
        const reach = alliesInReach(ctx, does.rangeFt ?? 30, true);
        const left = reach.filter((ally) => unseen(ally));
        const touched = reach.filter((ally) => !unseen(ally)).slice(0, count + 1);
        for (const ally of touched) {
          sheetCondition(campaign, ally, condition, does.rounds);
        }
        lines.push(`${touched.map((entry) => entry.name).join(", ")}: ${condition} for ${does.rounds} rounds.`);
        if (left.length) {
          lines.push(`${left.map((entry) => entry.name).join(", ")}: not seen by ${sheet.name}, so left out.`);
        }
      } else if (does.target === "ally") {
        // "Other than yourself": named or not, the holder is refused before
        // the use is paid, where it once landed on them.
        if (does.othersOnly && (!ctx.args.targetCharacterId || ctx.args.targetCharacterId === sheet.id)) {
          return { error: `${ctx.spend.name} goes to a willing creature other than ${sheet.name}: pass targetCharacterId of an ally. Nothing was spent.`, retry: true };
        }
        const ally = ctx.args.targetCharacterId ? getSheetById(ctx.args.targetCharacterId) : sheet;
        if (!ally || ally.campaignId !== campaign.id) {
          return { error: `${ctx.spend.name} goes to a creature at the table: pass targetCharacterId. Nothing was spent.`, retry: true };
        }
        if (ally.id !== sheet.id) {
          sheetCondition(campaign, ally, condition, does.rounds, tempHp > ally.tempHp ? { tempHp } : {});
          lines.push(`${ally.name} is ${condition} for ${does.rounds} rounds.`);
          return { result: { applied: lines } };
        }
      }
      // A mark on one creature: the holder's condition names it (quarry).
      const quarry = does.quarry ? targetEnemy(ctx) : null;
      if (quarry && "error" in quarry) {
        return quarry;
      }
      // "A creature you can see within 30 feet" (Hexblade's Curse): read only
      // for allies before, so an invisible creature or one across the field
      // was cursed and the use spent.
      if (quarry) {
        const live = getActiveEncounter(campaign.id)!;
        if (does.rangeFt && !withinFeet(live.id, sheet.id, quarry.id, does.rangeFt)) {
          return { error: `${quarry.displayName} is beyond ${does.rangeFt} feet of ${sheet.name}; ${ctx.spend.name} reaches no further. Nothing was spent.`, refused: "rules" };
        }
        const unseen = does.sight ? unseenBecause(live.id, sheet, quarry) : null;
        if (unseen) {
          return { error: `${sheet.name} cannot see ${quarry.displayName} (${unseen}), and ${ctx.spend.name} takes a creature they can see. Nothing was spent.`, refused: "rules" };
        }
      }
      let patch: FullPatchSheetInput | undefined;
      // An ally other than the holder has returned above, so "ally" here is the
      // holder, named or not. Aimed at themselves from the Hand's "(you)" chip, it
      // answered ok and landed nothing.
      if (!does.target || does.target === "self" || does.target === "ally") {
        const kept = sheet.conditions.filter((entry) => textKey(entry) !== textKey(condition));
        patch = {
          conditions: [...kept, condition],
          conditionMeta: { ...sheet.conditionMeta, [condition]: { ...(does.untilNextTurnEnds ? { untilTurnEndOf: sheet.id } : { rounds: does.rounds }), ...(quarry ? { quarry: quarry.id } : {}) } },
          ...(tempHp > sheet.tempHp ? { tempHp } : {}),
        };
        lines.push(
          quarry
            ? `${sheet.name}'s ${condition} is on ${quarry.displayName}: their attacks against it carry it.`
            : `${sheet.name} is ${condition} for ${does.rounds} rounds${tempHp ? `, with ${Math.max(tempHp, sheet.tempHp)} temporary hit points` : ""}.`,
        );
      }
      if (does.mark) {
        // The creature named (or last attacked) carries the holder's mark.
        const marked = targetEnemy(ctx);
        if (!("error" in marked)) {
          enemyCondition(ctx, marked, does.mark, { rounds: does.rounds });
          lines.push(`${marked.displayName} is marked (${does.mark}).`);
        }
      }
      if (does.teleportFeet) {
        creditFeatureTeleport(sheet.id, ctx.spend.name, does.teleportFeet);
        lines.push(`${sheet.name} teleports up to ${does.teleportFeet} feet: move their token with move_token, teleport true, spell "${ctx.spend.name}" and casterCharacterId ${sheet.id}.`);
      }
      if (does.burst) {
        lines.push(...burst(ctx, does.burst));
      }
      return { patch, result: { applied: lines } };
    }
    case "save_effect": {
      const enemy = targetEnemy(ctx);
      if ("error" in enemy) {
        return enemy;
      }
      const encounter = getActiveEncounter(campaign.id)!;
      if (does.rangeFt && !withinFeet(encounter.id, sheet.id, enemy.id, does.rangeFt)) {
        return { error: `${enemy.displayName} is beyond ${does.rangeFt} feet of ${sheet.name}; ${ctx.spend.name} reaches no further. Nothing was spent.`, refused: "rules" };
      }
      // "A creature you can see" (Nature's Wrath): one behind a wall, in a
      // heavily obscured space, invisible or hidden, or any while the holder
      // is blinded, is refused before the use is paid.
      const unseen = does.sight ? unseenBecause(encounter.id, sheet, enemy) : null;
      if (unseen) {
        return { error: `${sheet.name} cannot see ${enemy.displayName} (${unseen}), and ${ctx.spend.name} takes a creature they can see. Nothing was spent.`, refused: "rules" };
      }
      if (does.types && !does.types.includes(creatureTypeOf(enemy.stats))) {
        return { error: `${enemy.displayName} is not ${does.types.length === 1 && does.types[0] === "undead" ? "an undead" : `a creature of type ${does.types.join(" or ")}`} (${creatureTypeOf(enemy.stats)}); ${ctx.spend.name} takes one. Nothing was spent.`, refused: "rules" };
      }
      if (does.perUnit && ctx.units < 1) {
        return { error: `${ctx.spend.name} needs at least 1 point spent: pass amount. Nothing was spent.`, retry: true };
      }
      // A damage type the caster chooses is named whole in the variant.
      const type = does.typeFromVariant ? namedOption(ctx.spend.name, ctx.args.variant, does.typeFromVariant) : (does.type ?? "");
      if (typeof type !== "string") {
        return type;
      }
      const dc = saveDc(ctx, does.dcAbility);
      // The creature picks the save it is likelier to pass (condition-logic.ts).
      const ability = does.orSave ? likelierSave(enemy.conditions, does.save, does.orSave, dc, (each) => saveModFor(enemy.stats, each)) : does.save;
      const other = does.orSave ? (ability === does.save ? does.orSave : does.save) : undefined;
      const keen = does.advantageAt ? Number(enemy.stats.abilities?.[does.advantageAt.ability] ?? 10) >= does.advantageAt.atLeast : false;
      const save = rollEnemySave(campaign.id, enemy, ability, dc, {
        ...(keen ? { advantage: true } : {}),
        resist: Boolean(does.condition) && bindsWorthResisting([does.condition ?? ""]),
        against: does.condition,
        // A DEX save takes the cover between the character and it.
        origin: { ref: ctx.sheet.id },
        record: { turn: ctx.turn ?? undefined, detail: `${enemy.displayName}: ${ability.toUpperCase()} save against ${ctx.spend.name}` },
      });
      const result: Record<string, unknown> = { target: enemy.displayName, save: save.total, dc, saved: save.success };
      const dice = does.perUnit ? addUnits(does.perUnit, does.perUnit, ctx.units - 1) : does.dice ? formula(ctx, does.dice) : null;
      if (dice) {
        const rolled = damageDice(ctx, enemy, dice);
        const amount = save.success ? (does.half ? Math.floor(rolled / 2) : 0) : rolled;
        Object.assign(result, { rolled: `${dice}: ${rolled}` }, damageEnemy(ctx, getEnemy(enemy.id) ?? enemy, amount, type));
      }
      if (!save.success && does.condition && does.commands) {
        const placed = commandCreature(campaign, enemy, sheet.id, ctx.spend.name, does.rounds ?? null, (fresh) => immuneToCondition(fresh, does.condition!));
        result.condition = placed.commanded ? `${enemy.displayName} is ${does.condition}.` : `${enemy.displayName} cannot be ${does.condition}.`;
        if (placed.freed.length) {
          result.released = `${placed.freed.join(", ")} no longer obeys ${sheet.name}.`;
        }
        if (placed.commanded) {
          result.note = commandedNote(sheet.name, enemy.displayName);
        }
      } else if (!save.success && does.condition) {
        const landed = enemyCondition(ctx, enemy, does.condition, does.saveEnds ? { saveEnds: { ability, dc, ...(other ? { or: other } : {}) } } : does.rounds ? { rounds: does.rounds } : {});
        result.condition = landed ? `${enemy.displayName} is ${does.condition}.` : `${enemy.displayName} cannot be ${does.condition}.`;
      }
      if (!save.success && does.onFail) {
        result.onFail = `${enemy.displayName} ${does.onFail}.`;
      }
      return { result };
    }
    case "save_area":
      return saveArea(ctx, does);
    case "reroll_save":
      return rerollLastSave(ctx);
    case "temp_hp": {
      const amount = Math.max(1, Number(rollCard(ctx.campaign, ctx.turn, sheet.id, "custom", `${ctx.spend.name}: temporary hit points`, formula(ctx, does.formula), null).total));
      if (!does.allies) {
        return {
          patch: amount > sheet.tempHp ? { tempHp: amount } : {},
          result: { tempHp: amount > sheet.tempHp ? `${amount} temporary hit points to ${sheet.name}` : `${sheet.name} keeps their ${sheet.tempHp}` },
        };
      }
      const count = Number(formula(ctx, does.allies.count)) || 1;
      const given: string[] = [];
      for (const ally of alliesInReach(ctx, does.allies.rangeFt, false).slice(0, count)) {
        if (amount > ally.tempHp) {
          const updated = patchSheet(ally.id, { tempHp: amount });
          if (updated) {
            publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
          }
          given.push(`${ally.name} ${amount}`);
        }
      }
      return { result: { tempHp: given.length ? given : "nobody in reach gains more than they hold" } };
    }
    case "heal_area":
      return healArea(ctx, does);
    case "note":
      return { result: { applied: does.text } };
    case "aoe_report": {
      // Rolled in the spend on the creatures the call names, half on a save
      // (src/lib/dm/counter-saves.ts): it handed these numbers back for an
      // aoe_damage call a person's table never made.
      const extra = Math.max(0, ctx.units - (does.baseUnits ?? 0));
      const dice = addUnits(formula(ctx, does.dice), does.perUnit, extra);
      // A type the holder picks ("acid, cold, fire, lightning or poison") is
      // the one the variant names, else the first.
      const choices = words(does.type ?? "").filter((word) => DAMAGE_WORDS.has(textKey(word)));
      const type = choices.find((word) => textKey(word) === textKey(ctx.args.variant ?? "")) ?? choices[0] ?? "";
      const saved = resolveCounterSave(campaign, sheet, { name: ctx.spend.name, save: does.save, dc: saveDc(ctx, does.dcAbility), dice, type, half: true, magical: true }, { turnId: ctx.turnId, targetEnemyId: ctx.args.targetEnemyId, targetEnemyIds: ctx.args.targetEnemyIds });
      return "error" in saved ? saved : { result: { area: does.area, ...saved.result } };
    }
    case "teleport": {
      creditFeatureTeleport(sheet.id, ctx.spend.name, does.feet);
      const move = `move_token, teleport true, spell "${ctx.spend.name}" and casterCharacterId ${sheet.id}`;
      return {
        result: {
          teleport: does.touched
            ? `A willing creature ${sheet.name} touches moves up to ${does.feet} feet${does.note ? `, ${does.note}` : ""}: if a battle map is live, move its token with ${move}.`
            : `${sheet.name} moves up to ${does.feet} feet${does.note ? `, ${does.note}` : ""}: if a battle map is live, move their token with ${move}.`,
        },
      };
    }
    case "die_damage": {
      const enemy = targetEnemy(ctx);
      if ("error" in enemy) {
        return enemy;
      }
      const dice = formula(ctx, does.dice);
      const rolled = damageDice(ctx, enemy, dice);
      return { result: { rolled: `${dice}: ${rolled}`, ...damageEnemy(ctx, enemy, rolled, does.type) } };
    }
    case "flourish": {
      const enemy = targetEnemy(ctx);
      if ("error" in enemy) {
        return enemy;
      }
      const die = `1${bardicDie(ctx.held.level)}`;
      const rolled = damageDice(ctx, enemy, die);
      const result: Record<string, unknown> = { rolled: `${die}: ${rolled}`, ...damageEnemy(ctx, enemy, rolled, "") };
      if (isNamed(ctx.args.variant ?? "", "defensive flourish", "defensive")) {
        const condition = `defensive flourish (+${rolled})`;
        return {
          patch: {
            conditions: [...sheet.conditions.filter((entry) => !isConditionNamed(entry, "defensive flourish")), condition],
            conditionMeta: { ...sheet.conditionMeta, [condition]: { untilTurnOf: sheet.id } },
          },
          result: { ...result, applied: `${condition}: +${rolled} AC until ${sheet.name}'s next turn.` },
        };
      }
      return { result: { ...result, note: "A slashing or mobile flourish's second target or push is the GM's to resolve with its own tool." } };
    }
    case "storm_aura":
      return stormAura(ctx);
    case "restore": {
      const state = sheet.resources[does.pool];
      if (!state) {
        return { error: `${sheet.name} has no ${resourceName(does.pool)} to restore. Nothing was spent.`, refused: "rules" };
      }
      if (state.used <= 0) {
        return { error: `${sheet.name}'s ${resourceName(does.pool)} is full; ${ctx.spend.name} has nothing to bring back. Nothing was spent.`, refused: "rules" };
      }
      const back = Math.min(does.amount, state.used);
      const resources = { ...sheet.resources, [does.pool]: { max: state.max, used: state.used - back } };
      // The mark that opened the chance is spent by it (Wild Magic Surge's
      // SURGE_CHANCE), so one casting gives one use back.
      const cleared = does.clears ? removeConditions(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, [does.clears]) : null;
      return {
        patch: { resources, ...(cleared ? { conditions: cleared.conditions, conditionMeta: cleared.meta } : {}) },
        result: { restored: `${back} ${resourceName(does.pool)} back (${state.max - state.used + back}/${state.max}).` },
      };
    }
    case "flames": {
      const wanted = does.healOnly ? "heal" : textKey(ctx.args.variant ?? "");
      if (wanted === "heal") {
        const ally = ctx.args.targetCharacterId ? getSheetById(ctx.args.targetCharacterId) : sheet;
        if (!ally || ally.deathSaves?.dead) {
          return { error: `${ctx.spend.name} heals a living creature at the table: pass targetCharacterId. Nothing was spent.`, retry: true };
        }
        // Asked before the roll and the spend: Chill Touch, suffocation and
        // negative energy stop any healing (regain.ts).
        if (!canRegain(ally)) {
          return { error: `${ally.name} cannot regain hit points right now, so ${ctx.spend.name} would heal nothing. Nothing was spent.`, refused: "rules" };
        }
        const rolled = rollCard(ctx.campaign, ctx.turn, sheet.id, "custom", `${ctx.spend.name}: healing`, formula(ctx, does.formula), null).total;
        const gained = regainHitPoints(campaign, ctx.turnId, ally, rolled, `${ctx.spend.name} (${sheet.name})`);
        return { result: { healed: `${ally.name} regains ${gained} hit points (${rolled} rolled).` } };
      }
      if (wanted !== "burn") {
        return { error: `${ctx.spend.name} takes variant "heal" or "burn". Ask the player which, unless they named one. Nothing was spent.`, retry: true };
      }
      const enemy = targetEnemy(ctx);
      if ("error" in enemy) {
        return enemy;
      }
      if (ctx.spend.afterWeaponHit && ctx.marks && !ctx.marks.includes(`${WEAPON_HIT}${enemy.id}`)) {
        return { error: `${ctx.spend.name} burns the creature the hit landed on, and ${enemy.displayName} is not one ${sheet.name} has hit this turn. Nothing was spent.`, refused: "rules" };
      }
      // Rolled once the burn is sure to land: a refusal above spends nothing.
      const rolled = damageDice(ctx, enemy, formula(ctx, does.formula));
      return { result: { rolled, ...damageEnemy(ctx, enemy, rolled, does.type) } };
    }
    case "insight_contest": {
      const enemy = targetEnemy(ctx);
      if ("error" in enemy) {
        return enemy;
      }
      const insight = rollCharacterCheck(campaign, sheet, { skill: "insight" }, `${sheet.name}: Insight against ${enemy.displayName}'s Deception`);
      const skills = enemy.stats.skills as Record<string, number> | undefined;
      const deceptionMod = Number(skills?.deception ?? Math.floor(((enemy.stats.abilities?.cha ?? 10) - 10) / 2));
      // A contest the table sees, as every enemy's contest roll is
      // (action-common.ts). An enemy that charmed the character lies to them
      // with advantage (SRD 5.1, Charmed: the charmer's social checks).
      const charmer = charmedBy(sheet.conditions, sheet.conditionMeta as Parameters<typeof charmedBy>[1], enemy.id);
      const deception = rollCard(ctx.campaign, ctx.turn, null, "skill_check", `${enemy.displayName}: Deception against ${sheet.name}'s Insight`, d20Expression(deceptionMod, charmer ? "advantage" : "none"), null).total;
      if (insight.total <= deception) {
        return { result: { insight: insight.total, deception, read: `${enemy.displayName} gives nothing away; no Sneak Attack edge.` } };
      }
      enemyCondition(ctx, enemy, does.condition, { rounds: does.rounds });
      return { result: { insight: insight.total, deception, read: `${sheet.name} reads ${enemy.displayName}: ${does.condition} for a minute.` } };
    }
    case "variants":
      return { error: `${ctx.spend.name} needs a variant: ${Object.keys(does.options).join(" or ")}. Ask the player which, unless they named one. Nothing was spent.`, retry: true };
    // Gathered Swarm's push (src/lib/dm/authored-spend-more.ts).
    case "swarm_push":
      return swarmPush(ctx, does);
    case "summon":
      return summonSteelDefender(ctx.campaign, sheet, ctx.held.level);
    // Bolstering Magic's slot (src/lib/dm/authored-spend-counters.ts).
    case "regain_slot":
      return regainSlot(ctx, does);
  }
}

// A burst the spend sets off around the holder: each enemy in range saves
// or takes the dice, or the condition.
function burst(ctx: SpendContext, spec: NonNullable<Extract<SpendDoes, { kind: "buff" }>["burst"]>): string[] {
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter) {
    return [];
  }
  const lines: string[] = [];
  const dc = saveDc(ctx, spec.dcAbility);
  // Nobody across a swallower's wall is in the burst (swallow.ts).
  const enemies = (ctx.args.targetEnemyId ? [resolveTargetFoe(encounter.campaignId, encounter, ctx.args.targetEnemyId)] : listEnemiesNear(ctx, encounter, spec.rangeFt)).filter(
    (enemy): enemy is EncounterEnemy => Boolean(enemy && enemy.status === "alive" && !swallowCoverBetween(ctx.sheet.id, enemy.id)),
  );
  for (const enemy of enemies) {
    const save = rollEnemySave(ctx.campaign.id, enemy, spec.save, dc, {
      resist: Boolean(spec.condition) && bindsWorthResisting([spec.condition ?? ""]),
      against: spec.condition,
      origin: { ref: ctx.sheet.id },
      record: { turn: ctx.turn ?? undefined, detail: `${enemy.displayName}: ${spec.save.toUpperCase()} save against ${ctx.spend.name}` },
    });
    if (save.success) {
      lines.push(`${enemy.displayName} resists (${spec.save.toUpperCase()} ${save.total} vs DC ${dc}).`);
      continue;
    }
    if (spec.dice) {
      const rolled = damageDice(ctx, enemy, formula(ctx, spec.dice));
      damageEnemy(ctx, getEnemy(enemy.id) ?? enemy, rolled, spec.type ?? "");
      lines.push(`${enemy.displayName} takes ${rolled} ${spec.type ?? ""} damage.`.replace("  ", " "));
    }
    if (spec.condition) {
      const landed = enemyCondition(ctx, enemy, spec.condition, spec.rounds ? { rounds: spec.rounds } : {});
      lines.push(landed ? `${enemy.displayName} is ${spec.condition}.` : `${enemy.displayName} cannot be ${spec.condition}.`);
    }
    if (spec.mark) {
      enemyCondition(ctx, getEnemy(enemy.id) ?? enemy, spec.mark, spec.rounds ? { rounds: spec.rounds } : {});
    }
  }
  return lines;
}

function saveArea(ctx: SpendContext, does: Extract<SpendDoes, { kind: "save_area" }>): Resolution {
  const { campaign, sheet } = ctx;
  const encounter = getActiveEncounter(campaign.id);
  // No fight on, so no creature is on the board to save: the use is paid and the
  // GM narrates it (Charm Animals and Plants is used on a trail as often as in a
  // fight), as a buff aimed at a creature is.
  if (!encounter) {
    // A scene's board (a map with no fight on it) holds its darkness all the
    // same: Radiance of the Dawn ends what it reaches there, and says so of
    // any other only in the story.
    const dispelled = does.dispelsDarkness ? dispelZones(campaign, darknessNear(campaign, sheet.id, does.rangeFt), ctx.spend.name) : [];
    const dark = does.dispelsDarkness && !dispelled.length ? ` Any magical darkness within ${does.rangeFt} feet of ${sheet.name} is dispelled.` : "";
    return { result: { applied: [`${ctx.spend.name}: there is no fight, so no creature on the board saves; the GM resolves it in the story.${dark}`, ...dispelled] } };
  }
  let targets = foesOfSheet(campaign.id, encounter, sheet.id).filter(
    (enemy) =>
      enemy.status === "alive" &&
      enemy.currentHp > 0 &&
      withinFeet(encounter.id, sheet.id, enemy.id, does.rangeFt) &&
      (!does.sight || !(does.sight === "seesHolder" ? unseenBecause(encounter.id, enemy, sheet) : unseenBecause(encounter.id, sheet, enemy))) &&
      // Total cover: a wall of the board between them (as cast-reach.ts reads
      // it, past the squares beside the holder).
      (!does.coverShields || !((tilesBetween(encounter.id, sheet.id, enemy.id) ?? 0) > 1 && wallBetween(encounter.id, sheet.id, enemy.id))) &&
      !swallowCoverBetween(sheet.id, enemy.id) &&
      (!does.types || does.types.includes(creatureTypeOf(enemy.stats))),
  );
  const darkness = does.dispelsDarkness ? darknessNear(campaign, sheet.id, does.rangeFt) : [];
  if (!targets.length && !darkness.length) {
    return { error: `Nothing ${ctx.spend.name} affects is within ${does.rangeFt} feet of ${sheet.name}. Nothing was spent.`, refused: "rules" };
  }
  const chosen = targets.length
    ? chosenTargets(ctx.spend.name, Boolean(does.chosen), targets, ctx.args, (ref) => resolveTargetFoe(campaign.id, encounter, ref)?.id ?? null)
    : targets;
  if ("error" in chosen) {
    return chosen;
  }
  targets = chosen;
  // The darkness ends before the damage lands, so a caster hurt by the burst
  // makes no concentration save for a spell already gone.
  const lines: string[] = dispelZones(campaign, darkness, ctx.spend.name);
  if (!targets.length) {
    lines.push(`No creature ${ctx.spend.name} affects is within ${does.rangeFt} feet of ${sheet.name}.`);
  }
  const dc = saveDc(ctx, does.dcAbility);
  const rolled = does.dice && targets.length ? rollCard(campaign, ctx.turn, sheet.id, "damage", ctx.spend.name, formula(ctx, does.dice), sheetAttacker(sheet)).total : 0;
  for (const enemy of targets) {
    const save = rollEnemySave(campaign.id, enemy, does.save, dc, {
      magical: true,
      resist: Boolean(does.condition) && bindsWorthResisting([does.condition ?? ""]),
      against: does.condition,
      origin: { ref: sheet.id },
      record: { turn: ctx.turn ?? undefined, detail: `${enemy.displayName}: ${does.save.toUpperCase()} save against ${ctx.spend.name}` },
    });
    const resisted = save.legendaryResistance ? "with Legendary Resistance" : `(${does.save.toUpperCase()} ${save.total} vs DC ${dc})`;
    const fresh = () => resolveTargetFoe(campaign.id, encounter, enemy.id) ?? enemy;
    const amount = save.success ? (does.half ? Math.floor(rolled / 2) : 0) : rolled;
    if (amount > 0) {
      damageEnemy(ctx, fresh(), amount, does.type ?? "");
    }
    if (save.success) {
      lines.push(`${enemy.displayName} resists ${resisted}${amount ? ` and takes ${amount} ${does.type ?? ""} damage` : ""}.`);
      continue;
    }
    const parts = amount ? [`takes ${amount} ${does.type ?? ""} damage`] : [];
    if (does.condition) {
      if (immuneToCondition(fresh(), does.condition)) {
        parts.push(`cannot be ${does.condition}`);
      } else {
        layEnemyConditionInstance(campaign, fresh(), does.condition, {
          source: sheet.id,
          ...(does.untilNextTurnEnds ? { untilTurnEndOf: sheet.id } : does.rounds ? { rounds: does.rounds } : {}),
          ...(does.endsOnDamage ? { endsOnDamage: true } : {}),
          ...(does.leashFeet ? { leashFeet: does.leashFeet } : {}),
        });
        parts.push(`is ${does.condition}`);
      }
    }
    if (does.onFail) {
      parts.push(does.onFail);
    }
    lines.push(`${enemy.displayName} ${parts.join(", and ")} ${resisted}.`);
  }
  return { result: { applied: lines } };
}

function listEnemiesNear(ctx: SpendContext, encounter: Encounter, feet: number): EncounterEnemy[] {
  return listEnemiesOf(encounter).filter((enemy) => withinFeet(encounter.id, ctx.sheet.id, enemy.id, feet) && hasBoard(encounter));
}

function listEnemiesOf(encounter: Encounter): EncounterEnemy[] {
  return encounter.order
    .filter((entry): entry is Extract<typeof entry, { kind: "enemy" }> => entry.kind === "enemy")
    .map((entry) => getEnemy(entry.enemyId))
    .filter((enemy): enemy is EncounterEnemy => Boolean(enemy));
}

function hasBoard(encounter: Encounter): boolean {
  return getBattleMapForEncounter(encounter.id) !== null;
}

// Storm Aura: the barbarian's environment, chosen by the variant.
function stormAura(ctx: SpendContext): Resolution {
  const chosen = textKey(ctx.held.choice ?? "");
  const kind = (["desert", "sea", "tundra"] as const).find(
    (entry) => isNamed(ctx.args.variant ?? "", entry) || textKey(nameChoice(ctx.args.variant ?? "") ?? "") === entry || (!ctx.args.variant && chosen === entry),
  );
  if (!kind) {
    return { error: "Storm Aura takes the environment as the variant: desert, sea or tundra, the one chosen when the barbarian took Storm Aura (use_resource 'Storm Environment' sets it on the sheet). Nothing was spent.", retry: true };
  }
  const encounter = getActiveEncounter(ctx.campaign.id);
  const amount = formula(ctx, STORM_AURA[kind]);
  const condition = `storm aura (${kind})`;
  const patch: FullPatchSheetInput = {
    conditions: [...ctx.sheet.conditions.filter((entry) => !isConditionNamed(entry, "storm aura")), condition],
    conditionMeta: { ...ctx.sheet.conditionMeta, [condition]: { rounds: 10 } },
  };
  if (kind === "sea") {
    const enemy = targetEnemy(ctx);
    if ("error" in enemy) {
      return enemy;
    }
    const resolved = resolveSpendEffect(ctx, { kind: "save_effect", save: "dex", dcAbility: "con", dice: amount, type: "lightning", half: true, rangeFt: 10 });
    return "error" in resolved ? resolved : { patch, result: { aura: condition, ...resolved.result } };
  }
  if (kind === "desert") {
    const lines: string[] = [];
    for (const enemy of encounter ? listEnemiesNear(ctx, encounter, 10) : []) {
      if (enemy.status === "alive") {
        lines.push(hurtEnemy(ctx.campaign, encounter!, enemy, Number(amount), "fire", "Storm Aura"));
      }
    }
    if (encounter) {
      publishEncounter(ctx.campaign.id);
    }
    return { patch, result: { aura: condition, desert: lines.length ? lines : "no creature stands in the aura on the board" } };
  }
  // Raging Storm (14th): each activation of the tundra makes one creature
  // in the aura save on Strength or have speed 0 until the barbarian's next
  // turn.
  const frozen: Record<string, unknown> = {};
  if (ctx.args.targetEnemyId && ctx.sheet.features.some((feature) => textKey(feature.name) === "raging storm")) {
    const resolved = resolveSpendEffect(ctx, { kind: "save_effect", save: "str", dcAbility: "con", condition: "raging storm (tundra)", rounds: 1, rangeFt: 10 });
    if ("error" in resolved) {
      return resolved;
    }
    Object.assign(frozen, { ragingStorm: resolved.result });
  }
  const given: string[] = [];
  for (const ally of alliesInReach(ctx, 10, false)) {
    if (Number(amount) > ally.tempHp) {
      const updated = patchSheet(ally.id, { tempHp: Number(amount) });
      if (updated) {
        publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
      }
      given.push(ally.name);
    }
  }
  return { patch, result: { aura: condition, tundra: `${amount} temporary hit points to ${given.join(", ") || "nobody new"}`, ...frozen } };
}
