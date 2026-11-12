// What an authored spend does once it is paid for (src/lib/dm/authored-spends.ts
// has checked the gate, the pool and the turn). Each resolver refuses before
// it writes; the caller then spends the pool and the turn.

import { memoryOffBoard, stripMemory } from "@/lib/dm/ar-ws-alter-memories";
import { buffAim, otherOutcomes, strayBuffTarget } from "@/lib/dm/ar-ws-buff-aim";
import { scribeScroll } from "@/lib/dm/ar-ws-scrivener";
import { layWard } from "@/lib/dm/ar-ws-bastion";
import { rerollHealing } from "@/lib/dm/ar-ws-empowered-healing";
import { pickChaos, wildSurge } from "@/lib/dm/ar-ws-wild-surge";
import { moonlightEnds, toggleLight } from "@/lib/dm/ar-ws-lunar-empowerment";
import { markMantleStride } from "@/lib/dm/ar-wbf-bard-mantle";
import { WEAPON_HIT } from "@/lib/dm/action-budget";
import { spellHurt } from "@/lib/dm/spell-damage-logic";
import { saveModFor } from "@/lib/bestiary/enemy-numbers";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { extendsHeld, layWithExtras, markMet, saveEffectRefusal } from "@/lib/dm/authored-save-effect-extras";
import { foesOfSheet, resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { chosenTargets } from "@/lib/dm/chosen-targets";
import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { hasCondition, heldAuthored, resolveFormula, type AuthoredSpend, type HeldAuthored } from "@/lib/srd/authored-effects";
import type { Ability, SpendDoes } from "@/lib/srd/authored-effects-types";
import { STORM_AURA } from "@/lib/srd/authored-effects-data";
import { incapacitatedBy, likelierSave, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { healArea } from "@/lib/dm/authored-heal-area";
import { canRegain, regainHitPoints } from "@/lib/dm/regain";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { commandCreature, commandedNote } from "@/lib/dm/command-undead";
import { changeSpent } from "@/lib/dm/ar-ws-stone";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { charmedBy } from "@/lib/dm/enemy-profile";
import { d20Expression } from "@/lib/dice";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { bindsWorthResisting } from "@/lib/dm/legendary-logic";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { unseenBecause, unseenByConditions, withinFeet } from "@/lib/dm/authored-saves";
import { darknessNear, dispelZones, placeSpellZone } from "@/lib/dm/zone-cast";
import { tilesBetween, wallBetween } from "@/lib/dm/attack-spatial";
import { rerollLastSave, swarmPush } from "@/lib/dm/authored-spend-more";
import { summonSteelDefender } from "@/lib/dm/summon-defender";
import { DANCING_ITEM, summonDancingItem } from "@/lib/dm/summon-arcane";
import { createItem } from "@/lib/dm/authored-spend-arcane";
import { summonHound } from "@/lib/dm/ar-ws-hound";
import { jumpToSquare } from "@/lib/dm/ar-ws-shadow-walk";
import { companionGoes, companionOf, healOne, healRefusal, layLunarWard, veil } from "@/lib/dm/ar-ws-lunar-phenomenon";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { diceFor, rollOwnDice } from "@/lib/dm/character-roll";
import { rollAgainst } from "@/lib/roll-labels";
import { namedOption, type ToolError } from "@/lib/dm/tool-errors";
import { textKey, words } from "@/lib/language/text-logic";
import { creatureTypeOf } from "@/lib/bestiary/creature-type";
import { creditFeatureTeleport } from "@/lib/dm/feature-teleport";
import { arcaneShot } from "@/lib/dm/mt-fb-arcane-shot";
import { echoSpend } from "@/lib/dm/mt-fb-echo";
import { mindSpend } from "@/lib/dm/scribe-mind";
import { SPIRIT_TALES, drawTale, heldTale, tellTale } from "@/lib/dm/spirit-tales";
import { readySoul } from "@/lib/dm/soul-of-artifice";
import { magicAwareness, unerringEye } from "@/lib/dm/sense-magic";
import { isConditionNamed, isNamed, nameChoice } from "@/lib/srd/feature-names";
import { swallowCoverBetween, swallowCoverError } from "@/lib/dm/swallow";
import { resourceName } from "@/lib/srd/class-resources";
import { resolveCounterSave } from "@/lib/dm/counter-saves";
import { regainSlot } from "@/lib/dm/authored-spend-counters";
import { divineSpend } from "@/lib/dm/authored-spend-divine";
import { rangerSpend } from "@/lib/dm/authored-spend-divine-rng";
import { clericSpend } from "@/lib/dm/authored-spend-divine-clr";
import { draSpend, joltReachRefusal } from "@/lib/dm/authored-spend-divine-dra";
import { noteAuraAsked } from "@/lib/dm/aura-menace";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { surgeSpend } from "@/lib/dm/mt-fb-wild-surge";
import { sneakAnswerFor } from "@/lib/dm/sneak-answer";
import { martialSpend } from "@/lib/dm/authored-spend-martial";
import { mrSpend } from "@/lib/dm/mt-mr-spends";
import { beguilingBroken } from "@/lib/dm/mt-fb-arrow-riders";
import { cleanse, forcedStrike, forcedStrikePlan, meleeHitRefusal, pushFoe, sizeRefusal, throwFoe } from "@/lib/dm/mt-fb-spend";

const DAMAGE_WORDS = new Set(["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"]);

// A spend's damage on one enemy, as the holder's dice card.
export const damageDice = (ctx: SpendContext, enemy: EncounterEnemy, dice: string) =>
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
  args: { amount?: number; variant?: string; targetCharacterId?: string; targetEnemyId?: string; targetEnemyIds?: string[]; x?: number; y?: number };
  units: number;
  // The spell slot level that paid in place of the counter (pool.slot).
  paidBySlot?: number;
  mods: Record<string, number>;
  reason: string;
  // The die rolled in place of the pool's when none was left (pool.freeDie).
  freeDie?: string;
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
  // A Hand card's pick names the condition itself ("whispers of the dead
  // (arcana)"), a call the choice ("arcana"): both are the same variant.
  const named = does.variants && ctx.args.variant ? Object.entries(does.variants).find(([, condition]) => textKey(condition) === textKey(ctx.args.variant!))?.[0] : undefined;
  const variant = does.variants ? namedOption(ctx.spend.name, named ?? ctx.args.variant, Object.keys(does.variants)) : null;
  if (variant !== null && typeof variant !== "string") {
    return variant;
  }
  const base = variant !== null && does.variants ? does.variants[variant] : Array.isArray(does.condition) ? resolveFormula(does.condition, ctx.held.level) : does.condition;
  return base.replace("{bardic}", bardicDie(ctx.held.level)).replace("{units}", String(ctx.units));
}

// The creature a spend aims at: the one named, else the one the character
// attacked last this round.
export function targetEnemy(ctx: SpendContext): EncounterEnemy | ToolError {
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

export function damageEnemy(ctx: SpendContext, enemy: EncounterEnemy, amount: number, type: string): Record<string, unknown> {
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter || amount <= 0) {
    return { damage: 0 };
  }
  // A Beguiling Arrow's charm ends when its ally deals the creature damage.
  beguilingBroken(ctx.campaign.id, ctx.sheet.id, enemy.id);
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
// `replaces`: the buff's other outcomes, taken off as this one is laid.
export function enemyCondition(ctx: SpendContext, enemy: EncounterEnemy, condition: string, meta: Record<string, unknown>, replaces: string[] = []): boolean {
  const fresh = getEnemy(enemy.id) ?? enemy;
  if (immuneToCondition(fresh, condition)) {
    return false;
  }
  const cleared = removeConditions(fresh.conditions, fresh.conditionMeta as ConditionMetaMap, replaces);
  const kept = cleared.conditions.filter((entry) => textKey(entry) !== textKey(condition));
  patchEnemyConditions(fresh.id, [...kept, condition], {
    ...cleared.meta,
    [condition]: { source: ctx.sheet.id, ...meta },
  } as typeof fresh.conditionMeta);
  publishEncounter(ctx.campaign.id);
  return true;
}

// `source`: who laid it, for a reader that asks (Emboldening Bond's reach
// grows with the cleric who made the bond, emboldening-bond.ts).
// `replaces`: the buff's other outcomes, taken off as this one is laid.
function sheetCondition(campaign: Campaign, target: CharacterSheet, condition: string, rounds: number, extra: FullPatchSheetInput = {}, source?: string, untilRestEnds?: boolean, replaces: string[] = []) {
  const fresh = getSheetById(target.id) ?? target;
  const cleared = removeConditions(fresh.conditions, fresh.conditionMeta, replaces);
  const kept = cleared.conditions.filter((entry) => textKey(entry) !== textKey(condition));
  const updated = patchSheet(fresh.id, {
    conditions: [...kept, condition],
    conditionMeta: { ...cleared.meta, [condition]: { rounds, ...(source ? { source } : {}), ...(untilRestEnds ? { untilRestEnds: true } : {}) } },
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

export function resolveSpendEffect(ctx: SpendContext, spec: SpendDoes): Resolution {
  const { sheet, campaign } = ctx;
  // A length counted in the holder's proficiency bonus is read off their own
  // sheet: Bottled Respite was 2,400 rounds (4 hours) whatever the bonus, right
  // only at +2.
  const does: SpendDoes = spec.kind === "buff" && spec.roundsPerProf ? { ...spec, rounds: spec.roundsPerProf * computeSheetDerived(sheet).proficiencyBonus } : spec;
  switch (does.kind) {
    case "choose": {
      const option = namedOption(ctx.spend.name, ctx.args.variant, does.options);
      if (typeof option !== "string") {
        return option;
      }
      // Another feature's option (Waxing and Waning moves Lunar Embodiment's
      // phase): that feature as the sheet holds it.
      const owner = does.feature ? heldAuthored(sheet).find((entry) => textKey(entry.feature) === textKey(does.feature!)) : ctx.held;
      if (!owner) {
        return { error: `${sheet.name} does not hold ${does.feature}, whose option ${ctx.spend.name} changes. Nothing was spent.`, refused: "rules" };
      }
      // A change that pays (Waxing and Waning's sorcery point) to the option
      // already held changes nothing, so nothing is paid.
      if (does.feature && owner.choice && textKey(owner.choice) === textKey(option)) {
        return { error: `${sheet.name}'s ${owner.feature} is already ${option}; ${ctx.spend.name} would change nothing. Nothing was spent.`, refused: "rules" };
      }
      // A choice its rule changes only with a level (Storm Aura) is the
      // level-up dialog's to change (src/lib/srd/level-up-changes.ts).
      if (does.changeAt === "level" && ctx.held.choice && textKey(ctx.held.choice) !== textKey(option)) {
        return { error: `${sheet.name}'s ${ctx.held.feature} is ${ctx.held.choice}, and it changes only when they gain a ${ctx.held.classId} level: the level-up offers the change. Nothing was spent.`, refused: "rules" };
      }
      // The feature's own option already chosen changes nothing, and in a
      // fight would take its bonus action for it (Elemental Cleaver).
      if (!does.feature && ctx.held.choice && textKey(ctx.held.choice) === textKey(option)) {
        return { error: `${ctx.held.feature} is ${option} already; choosing it again changes nothing. Nothing was spent.`, refused: "rules" };
      }
      const features = sheet.features.map((feature) =>
        feature.name === owner.name ? { ...feature, name: `${owner.feature} (${option})` } : feature,
      );
      // A change a casting opened spends its opening (ar-ws-stone.ts); leaving
      // the Full Moon ends its light (ar-ws-lunar-empowerment.ts). A feature is
      // one or the other, so the two never write the same field.
      return { patch: { features, ...changeSpent(sheet, does), ...moonlightEnds(ctx, owner.feature, option) }, result: { chosen: `${owner.feature}: ${option}. The server applies its effects from now on.` } };
    }
    case "buff": {
      const condition = conditionName(ctx, does);
      if (typeof condition !== "string") {
        return condition;
      }
      const lines: string[] = [];
      // A target the buff cannot use is refused, never dropped for the holder,
      // and a buff for a creature of either side goes to the side the call
      // names (src/lib/dm/ar-ws-buff-aim.ts).
      const stray = strayBuffTarget(ctx.spend.name, sheet, does, ctx.args);
      if (stray) {
        return stray;
      }
      const aim = buffAim(does, ctx.args);
      // Aimed at a creature with no fight on: it is not on the board, so the
      // use is paid and the DM narrates it on the creature named (Hexblade's
      // Curse laid at a parley).
      if ((aim === "enemy" || does.quarry) && !getActiveEncounter(campaign.id)) {
        return { result: { applied: [`${ctx.spend.name}: ${condition}, on the creature the story names. There is no fight, so no creature on the board carries it.`] } };
      }
      // The holder's own dice (character-roll.ts rollOwnDice), rolled once the
      // use is known to land: a seat on physical dice is not asked for dice a
      // refusal would throw away.
      const rollTempHp = (ally: CharacterSheet) =>
        does.tempHp ? Math.max(0, Number(rollOwnDice(campaign, sheet, diceFor(`${ctx.spend.name}: temporary hit points`, sheet, ally), formula(ctx, does.tempHp), { turn: ctx.turn }).total)) : 0;
      if (aim === "enemy") {
        const enemy = targetEnemy(ctx);
        if ("error" in enemy) {
          return enemy;
        }
        const live = getActiveEncounter(campaign.id);
        if (live && does.rangeFt && !withinFeet(live.id, sheet.id, enemy.id, does.rangeFt)) {
          return { error: `${enemy.displayName} is beyond ${does.rangeFt} feet of ${sheet.name}; ${ctx.spend.name} reaches no further. Nothing was spent.`, refused: "rules" };
        }
        const barred = (does.maxSize ? sizeRefusal(ctx.spend.name, enemy, does.maxSize, ctx.held.level) : null) ?? (does.maxSize && ctx.spend.afterWeaponHit ? meleeHitRefusal(ctx, enemy) : null);
        if (barred) {
          return barred;
        }
        // "Until the end of your next turn" (Path to the Grave), or a count of rounds.
        const landed = enemyCondition(ctx, enemy, condition, does.untilNextTurnEnds ? { untilTurnEndOf: sheet.id } : { rounds: does.rounds }, otherOutcomes(does, condition));
        lines.push(landed ? `${enemy.displayName} is ${condition} for ${does.rounds} rounds.` : `${enemy.displayName} cannot be ${condition}.`);
        if (does.hound) {
          lines.push(summonHound(campaign, sheet, ctx.held.level, enemy));
        }
      } else if (aim === "allies") {
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
          sheetCondition(campaign, ally, condition, does.rounds, {}, sheet.id, does.untilRestEnds);
        }
        lines.push(`${touched.map((entry) => entry.name).join(", ")}: ${condition} for ${does.rounds} rounds.`);
        if (left.length) {
          lines.push(`${left.map((entry) => entry.name).join(", ")}: not seen by ${sheet.name}, so left out.`);
        }
      } else if (aim === "ally") {
        // "Other than yourself": named or not, the holder is refused before
        // the use is paid, where it once landed on them.
        if (does.othersOnly && (!ctx.args.targetCharacterId || ctx.args.targetCharacterId === sheet.id)) {
          return { error: `${ctx.spend.name} goes to a willing creature other than ${sheet.name}: pass targetCharacterId of an ally. Nothing was spent.`, retry: true };
        }
        const ally = ctx.args.targetCharacterId ? getSheetById(ctx.args.targetCharacterId) : sheet;
        if (!ally || ally.campaignId !== campaign.id) {
          return { error: `${ctx.spend.name} goes to a creature at the table: pass targetCharacterId. Nothing was spent.`, retry: true };
        }
        // A reach the row states (Blessing of the Trickster's touch): before
        // this an ally across the board was blessed by touch.
        const live = getActiveEncounter(campaign.id);
        if (ally.id !== sheet.id && live && does.rangeFt && !withinFeet(live.id, sheet.id, ally.id, does.rangeFt)) {
          return { error: `${ally.name} is beyond ${does.rangeFt} feet of ${sheet.name}; ${ctx.spend.name} reaches no further. Nothing was spent.`, refused: "rules" };
        }
        if (ally.id !== sheet.id) {
          const tempHp = rollTempHp(ally);
          sheetCondition(campaign, ally, condition, does.rounds, tempHp > ally.tempHp ? { tempHp } : {}, undefined, undefined, otherOutcomes(does, condition));
          lines.push(`${ally.name} is ${condition} for ${does.rounds} rounds.`);
          return { result: { applied: lines } };
        }
      }
      // A mark that ends the moment its holder is incapacitated is never
      // laid by an incapacitated holder (Master of Hexes: "if you aren't
      // incapacitated"). Its spend costs no action, so no turn check refused
      // it and a stunned warlock moved the curse.
      const stopped = does.endsIfIncapacitated ? incapacitatedBy(sheet.conditions) : null;
      if (stopped) {
        return { error: `${sheet.name} is ${stopped} and cannot use ${ctx.spend.name}. Nothing was spent.`, refused: "rules" };
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
      if (aim === "self" || aim === "ally") {
        const tempHp = rollTempHp(sheet);
        const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, otherOutcomes(does, condition));
        // One form at a time: a constellation taken again replaces the one it
        // finds (it was added beside it, two forms at once).
        const kept = cleared.conditions.filter((entry) => textKey(entry) !== textKey(condition) && !(does.replaces && hasCondition({ conditions: [entry] }, does.replaces)));
        patch = {
          conditions: [...kept, condition],
          conditionMeta: {
            ...cleared.meta,
            [condition]: {
              ...(does.lasting ? {} : does.untilNextTurnEnds ? { untilTurnEndOf: sheet.id } : does.untilLongRest ? { untilLongRest: true } : { rounds: does.rounds }),
              ...(quarry ? { quarry: quarry.id } : {}),
              ...(does.endsIfIncapacitated ? { endsIfIncapacitated: true } : {}),
            },
          },
          ...(tempHp > sheet.tempHp ? { tempHp } : {}),
        };
        lines.push(
          quarry
            ? `${sheet.name}'s ${condition} is on ${quarry.displayName}: their attacks against it carry it.`
            : does.lasting
              ? `${sheet.name} is ${condition} until the feature is used again.`
            : does.untilLongRest
              ? `${sheet.name} is ${condition} until it is used or they finish a long rest.`
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
      // The area the condition carries (Dread Lord's 30-foot gloom): laid on
      // the board around the holder, it follows their token and ends with the
      // condition (zone-store.ts zoneHolds whileCondition). Off the board
      // nothing is laid.
      const area = does.zone ? placeSpellZone(campaign, { spell: does.zone, caster: { kind: "pc", id: sheet.id, name: sheet.name } }) : null;
      if (area) {
        lines.push(area);
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
      const tooBig = does.maxSize ? sizeRefusal(ctx.spend.name, enemy, does.maxSize, ctx.held.level) : null;
      if (tooBig) {
        return tooBig;
      }
      // Its senses, its once a creature, and a renewal of what holds
      // (src/lib/dm/authored-save-effect-extras.ts).
      const extend = extendsHeld(does, sheet.id, enemy, ctx.args.variant);
      if (typeof extend !== "boolean") {
        return extend;
      }
      const barred = extend ? null : saveEffectRefusal(does, sheet, enemy, ctx.spend.name);
      if (barred) {
        return barred;
      }
      if (extend) {
        layWithExtras(campaign, enemy, sheet.id, does);
        return { result: { target: enemy.displayName, extended: `${enemy.displayName} stays ${[does.condition, does.alsoCondition].filter(Boolean).join(" and ")} under ${ctx.spend.name}, renewed for its whole length; no save is rolled.` } };
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
      // Who the creature strikes on a failed save, and that it can, is settled
      // before anything is spent (mt-fb-spend.ts).
      const strike = does.strikes ? forcedStrikePlan(ctx, enemy) : null;
      if (strike && "error" in strike) {
        return strike;
      }
      const keen = does.advantageAt ? Number(enemy.stats.abilities?.[does.advantageAt.ability] ?? 10) >= does.advantageAt.atLeast : false;
      const save = rollEnemySave(campaign.id, enemy, ability, dc, {
        ...(keen ? { advantage: true } : {}),
        // A Channel Divinity option's save (Elder Champion reads it).
        ...(ctx.spend.pool?.id === "channel_divinity" ? { channel: true } : {}),
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
        const amount = save.success && !does.whole ? (does.half ? Math.floor(rolled / 2) : 0) : rolled;
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
      } else if (!save.success && does.condition && (does.alsoCondition || does.endsOnDamage || does.leashFeet)) {
        const landed = layWithExtras(campaign, enemy, sheet.id, does);
        result.condition = landed ? `${enemy.displayName} is ${[does.condition, does.alsoCondition].filter(Boolean).join(" and ")}.` : `${enemy.displayName} cannot be ${does.condition}.`;
      } else if (!save.success && does.condition) {
        const landed = enemyCondition(ctx, enemy, does.condition, does.saveEnds ? { saveEnds: { ability, dc, ...(other ? { or: other } : {}) } } : does.rounds ? { rounds: does.rounds } : {});
        result.condition = landed ? `${enemy.displayName} is ${does.condition}.` : `${enemy.displayName} cannot be ${does.condition}.`;
      }
      if (does.oncePerCreature) {
        markMet(campaign, enemy, sheet.id, ctx.spend.name);
      }
      // The line for the GM, unless the engine makes the attack it asks for.
      if (!save.success && does.onFail && !strike) {
        result.onFail = `${enemy.displayName} ${does.onFail}.`;
      }
      if (!save.success && strike) {
        Object.assign(result, forcedStrike(ctx, strike));
      }
      if (!save.success && does.pushes) {
        Object.assign(result, pushFoe(ctx, getEnemy(enemy.id) ?? enemy, does.pushes.feet));
      }
      if (!save.success && does.throws) {
        Object.assign(result, throwFoe(ctx, getEnemy(enemy.id) ?? enemy, does.throws.feet));
      }
      return { result };
    }
    case "save_area":
      return saveArea(ctx, does);
    case "reroll_heal":
      return rerollHealing(ctx);
    case "reroll_save":
      return rerollLastSave(ctx);
    case "temp_hp": {
      const amount = Math.max(1, Number(rollOwnDice(campaign, sheet, `${ctx.spend.name}: temporary hit points`, formula(ctx, does.formula), { turn: ctx.turn }).total));
      if (!does.allies) {
        return {
          patch: amount > sheet.tempHp ? { tempHp: amount } : {},
          result: { tempHp: amount > sheet.tempHp ? `${amount} temporary hit points to ${sheet.name}` : `${sheet.name} keeps their ${sheet.tempHp}` },
        };
      }
      const count = Number(formula(ctx, does.allies.count)) || 1;
      const given: string[] = [];
      const chosen = alliesInReach(ctx, does.allies.rangeFt, false).slice(0, count);
      // Mantle of Inspiration: each may move with its reaction (ar-wbf-bard-mantle.ts).
      markMantleStride(campaign, sheet, ctx.spend.name, chosen);
      for (const ally of chosen) {
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
      const live = getActiveEncounter(campaign.id);
      const beyond = live && does.rangeFt
        ? [ctx.args.targetEnemyId, ...(ctx.args.targetEnemyIds ?? [])].filter((id): id is string => Boolean(id)).find((id) => !withinFeet(live.id, sheet.id, id, does.rangeFt!))
        : null;
      if (beyond) {
        return { error: `${getEnemy(beyond)?.displayName ?? "That creature"} is beyond ${does.rangeFt} feet of ${sheet.name}; ${ctx.spend.name} reaches no further. Nothing was spent.`, refused: "rules" };
      }
      const saved = resolveCounterSave(campaign, sheet, { name: ctx.spend.name, save: does.save, dc: saveDc(ctx, does.dcAbility), dice, type, half: !does.noHalf, magical: true }, { turnId: ctx.turnId, targetEnemyId: ctx.args.targetEnemyId, targetEnemyIds: ctx.args.targetEnemyIds });
      return "error" in saved ? saved : { result: { area: does.area, ...saved.result } };
    }
    case "teleport": {
      // "A willing creature you touch" (Hidden Paths): one named must stand
      // within 5 feet, refused before the use is paid.
      const touchedOne = does.touched && ctx.args.targetCharacterId ? getSheetById(ctx.args.targetCharacterId) : null;
      if (touchedOne && touchedOne.id !== sheet.id && ctx.encounter && !withinFeet(ctx.encounter.id, sheet.id, touchedOne.id, 5)) {
        return { error: `${touchedOne.name} is beyond ${sheet.name}'s touch (5 feet); ${ctx.spend.name} moves a creature they touch. Nothing was spent.`, refused: "rules" };
      }
      // A willing creature within reach goes too (Crescent Moon), asked
      // before anything moves (ar-ws-lunar-phenomenon.ts).
      const companion = does.companionFt ? companionOf(ctx, does.companionFt) : { sheet: null };
      if ("error" in companion) {
        return companion;
      }
      // With its square named the holder goes there now (ar-ws-shadow-walk.ts).
      const jump = jumpToSquare(ctx, does);
      if (jump && "error" in jump) {
        return jump;
      }
      if (!jump) {
        creditFeatureTeleport(sheet.id, ctx.spend.name, does.feet);
      }
      const move = `move_token, teleport true, spell "${ctx.spend.name}" and casterCharacterId ${sheet.id}`;
      const moved = jump
        ? jump.result
        : {
            teleport: does.touched
              ? `A willing creature ${sheet.name} touches moves up to ${does.feet} feet${does.note ? `, ${does.note}` : ""}: if a battle map is live, move its token with ${move}.`
              : `${sheet.name} moves up to ${does.feet} feet${does.note ? `, ${does.note}` : ""}: if a battle map is live, move their token with ${move}.`,
          };
      const along = companion.sheet && does.companionFt ? { companion: companionGoes(ctx, companion.sheet, does.companionFt, does.feet) } : {};
      const ward = does.ward ? layLunarWard(ctx, does.ward, companion.sheet) : null;
      return { ...(ward?.patch ? { patch: ward.patch } : {}), result: { ...moved, ...along, ...(ward ? { ward: ward.line } : {}) } };
    }
    case "die_damage": {
      // Power Surge lands on a creature the wizard's spell hurt this turn:
      // the one named, else the first one hurt (spell-damage-mark.ts).
      const hurt = ctx.spend.afterSpellDamage ? spellHurt(ctx.marks) : null;
      const enemy = hurt && !ctx.args.targetEnemyId && hurt[0] ? targetEnemy({ ...ctx, args: { ...ctx.args, targetEnemyId: hurt[0] } }) : targetEnemy(ctx);
      if ("error" in enemy) {
        return enemy;
      }
      const answer = does.afterSneak
        ? sneakAnswerFor({ encounter: getActiveEncounter(campaign.id), marks: ctx.marks, sheet, enemy, label: ctx.spend.name, rule: does.afterSneak })
        : null;
      if (answer && "error" in answer) {
        return answer;
      }
      if (hurt && !hurt.includes(enemy.id)) {
        return { error: `${ctx.spend.name} lands on a creature ${sheet.name}'s wizard spell hurt this turn, and ${enemy.displayName} is not one. Nothing was spent.`, refused: "rules" };
      }
      const dice = formula(ctx, does.dice);
      const rolled = damageDice(ctx, enemy, dice);
      const first = answer?.alsoFirst ? getEnemy(answer.firstId) : null;
      const alsoFirst = first && first.status === "alive" ? { first: { name: first.displayName, ...damageEnemy(ctx, first, rolled, does.type) } } : {};
      return { result: { rolled: `${dice}: ${rolled}`, ...damageEnemy(ctx, enemy, rolled, does.type), ...alsoFirst } };
    }
    case "flourish": {
      const enemy = targetEnemy(ctx);
      if ("error" in enemy) {
        return enemy;
      }
      const die = `1${ctx.freeDie ?? bardicDie(ctx.held.level)}`;
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
        // Arcane Jolt's healing reaches a creature the jolter can see within
        // 30 feet of the creature hit: one 35 feet off was healed before.
        const reachRefusal = does.healReachFt ? joltReachRefusal(ctx, ally, does.healReachFt) : null;
        if (reachRefusal) {
          return reachRefusal;
        }
        const rolled = rollOwnDice(campaign, sheet, diceFor(`${ctx.spend.name}: healing`, sheet, ally), formula(ctx, does.formula), { turn: ctx.turn }).total;
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
      const mine = does.mine ?? "insight";
      const theirs = does.theirs ?? "deception";
      const label = (skill: string) => `${skill[0].toUpperCase()}${skill.slice(1)}`;
      const insight = rollCharacterCheck(campaign, sheet, { skill: mine }, `${sheet.name}: ${label(mine)} against ${enemy.displayName}'s ${label(theirs)}`);
      const skills = enemy.stats.skills as Record<string, number> | undefined;
      const theirAbility = theirs === "insight" ? enemy.stats.abilities?.wis : enemy.stats.abilities?.cha;
      const deceptionMod = Number(skills?.[theirs] ?? Math.floor(((theirAbility ?? 10) - 10) / 2));
      // A contest the table sees, as every enemy's contest roll is
      // (action-common.ts). An enemy that charmed the character lies to them
      // with advantage (SRD 5.1, Charmed: the charmer's social checks).
      const charmer = theirs === "deception" && charmedBy(sheet.conditions, sheet.conditionMeta as Parameters<typeof charmedBy>[1], enemy.id);
      const deception = rollCard(ctx.campaign, ctx.turn, null, "skill_check", `${enemy.displayName}: ${label(theirs)} against ${sheet.name}'s ${label(mine)}`, d20Expression(deceptionMod, charmer ? "advantage" : "none"), null).total;
      if (insight.total <= deception) {
        return { result: { [mine]: insight.total, [theirs]: deception, read: does.goads ? `${enemy.displayName} is not taken in; nothing holds it.` : `${enemy.displayName} gives nothing away; no Sneak Attack edge.` } };
      }
      // Panache's goad lasts a minute, or until the swashbuckler and the
      // creature are more than 60 feet apart (condition-leash.ts).
      enemyCondition(ctx, enemy, does.condition, { rounds: does.rounds, ...(does.goads ? { panache: true, leashFeet: 60, leashEnds: true } : {}) });
      return {
        result: {
          [mine]: insight.total,
          [theirs]: deception,
          read: does.goads
            ? `${enemy.displayName} fixes on ${sheet.name} for a minute: disadvantage on attack rolls against anyone else, and no opportunity attacks against anyone else.`
            : `${sheet.name} reads ${enemy.displayName}: ${does.condition} for a minute.`,
        },
      };
    }
    case "variants":
      return { error: `${ctx.spend.name} needs a variant: ${Object.keys(does.options).join(" or ")}. Ask the player which, unless they named one. Nothing was spent.`, retry: true };
    // Gathered Swarm's push (src/lib/dm/authored-spend-more.ts).
    case "swarm_push":
      return swarmPush(ctx, does);
    case "summon":
      // The Dancing Item (summon-arcane.ts), else the steel defender.
      return textKey(does.form) === textKey(DANCING_ITEM) ? summonDancingItem(ctx.campaign, sheet, ctx.held.level) : summonSteelDefender(ctx.campaign, sheet, ctx.held.level);
    case "create_item":
      return createItem(ctx, does);
    // Master Scrivener's scroll (src/lib/dm/ar-ws-scrivener.ts).
    case "scribe_scroll":
      return scribeScroll(ctx, does);
    case "light":
      return toggleLight(ctx, does);
    case "wild_magic_surge":
      return wildSurge(ctx, does);
    case "chaos_pick":
      return pickChaos(ctx);
    case "damage_ward":
      return layWard(ctx, does);
    // Bolstering Magic's slot (src/lib/dm/authored-spend-counters.ts).
    case "regain_slot":
      return regainSlot(ctx, does);
    // The divine package's spends (src/lib/dm/authored-spend-divine.ts).
    case "reveal_defenses":
    case "smite_temp_hp":
    case "forge_blessing":
    case "cauterizing":
      return divineSpend(ctx, does);
    // The cleric's (src/lib/dm/authored-spend-divine-clr.ts).
    case "read_thoughts":
    case "duplicity":
    case "forge_item":
    case "sense_undead":
      return clericSpend(ctx, does);
    // The ranger's (src/lib/dm/authored-spend-divine-rng.ts).
    case "pet_command":
    case "this_turn":
      return rangerSpend(ctx, does);
    // The druid's and artificer's (src/lib/dm/authored-spend-divine-dra.ts).
    case "spirit_totem":
    case "spirit_totem_move":
    case "spreading_spores":
    case "wildfire_spirit":
    case "eldritch_cannon":
      return draSpend(ctx, does);
    // The martial subclasses' own (src/lib/dm/authored-spend-martial.ts).
    case "allies_join":
    case "action_attack":
      return martialSpend(ctx, does);
    // The monk and rogue subclasses' own (src/lib/dm/mt-mr-spends.ts).
    case "mr":
      return mrSpend(ctx, does);
    // The fighter and barbarian repair's own (src/lib/dm/mt-fb-spend.ts).
    case "cleanse":
      return cleanse(ctx, does.conditions);
    case "arcane_shot":
      return arcaneShot(ctx, does.option);
    case "echo":
      return echoSpend(ctx);
    case "mind":
      return mindSpend(ctx);
    case "tell_tale":
      return tellTale(ctx);
    case "soul_ready": {
      const readied = readySoul(sheet, ctx.args.variant);
      if ("error" in readied) {
        return { error: `${readied.error} Nothing was spent.`, retry: true };
      }
      return { result: { readied: `If ${sheet.name} drops to 0 hit points, Soul of Artifice ends the attunement to ${readied.item} with their reaction and keeps them at 1.` }, patch: readied.patch };
    }
    case "sense":
      return does.what === "magic" ? magicAwareness(ctx) : unerringEye(ctx);
    case "release_tale": {
      const held = heldTale(sheet);
      if (!held) {
        return { error: `${sheet.name} holds no spirit tale: use_resource Tales from Beyond rolls one first. Nothing was spent.`, refused: "rules" };
      }
      const tale = SPIRIT_TALES[(held.number ?? drawTale(ctx)) - 1];
      // "This can be you": a tale that helps lands on the bard when no one is named.
      const args = tale.helps && !ctx.args.targetCharacterId ? { ...ctx.args, targetCharacterId: sheet.id } : ctx.args;
      const played = resolveSpendEffect({ ...ctx, args }, tale.does);
      if ("error" in played) {
        return played;
      }
      // The tale is told: it is let go.
      const now = getSheetById(sheet.id) ?? sheet;
      const cleared = removeConditions(now.conditions, now.conditionMeta, [held.mark]);
      const base = played.patch ?? {};
      return { ...played, patch: { ...base, conditions: (base.conditions ?? cleared.conditions).filter((entry) => entry !== held.mark), conditionMeta: Object.fromEntries(Object.entries(base.conditionMeta ?? cleared.meta).filter(([name]) => name !== held.mark)) as FullPatchSheetInput["conditionMeta"] }, result: { tale: tale.name, ...played.result } };
    }
    case "wild_surge":
      return surgeSpend({ campaign: ctx.campaign, turn: ctx.turn, sheet: ctx.sheet, args: ctx.args }, does, ctx.spend.name);
    // Alter Memories (src/lib/dm/ar-ws-alter-memories.ts): the charmed
    // creature of a fight, else the numbers for the GM's roll.
    case "strip_memory": {
      const dc = saveDc(ctx, does.dcAbility);
      if (!getActiveEncounter(campaign.id)) {
        return memoryOffBoard(ctx, does, dc);
      }
      const enemy = targetEnemy(ctx);
      return "error" in enemy ? enemy : stripMemory(ctx, does, enemy, dc);
    }
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
    // Avenging Angel's fear and its menace end when the creature takes damage
    // (spell-effects.ts settleOnDamage reads endsOnDamage on each instance).
    const lasting = { ...(spec.rounds ? { rounds: spec.rounds } : {}), ...(spec.endsOnDamage ? { endsOnDamage: true } : {}) };
    if (spec.condition) {
      // Hour of Reaping's lasts until the end of the holder's next turn, not a
      // count of rounds.
      const landed = enemyCondition(ctx, enemy, spec.condition, spec.untilNextTurnEnds ? { untilTurnEndOf: ctx.sheet.id, ...(spec.endsOnDamage ? { endsOnDamage: true } : {}) } : lasting);
      lines.push(landed ? `${enemy.displayName} is ${spec.condition}.` : `${enemy.displayName} cannot be ${spec.condition}.`);
    }
    if (spec.mark) {
      enemyCondition(ctx, getEnemy(enemy.id) ?? enemy, spec.mark, lasting);
    }
  }
  // An aura asks each enemy once: those in it as it opens have been asked.
  if (spec.aura) {
    lines.push(...noteAuraAsked(ctx.campaign, ctx.sheet.id, enemies.map((enemy) => enemy.id)));
  }
  return lines;
}

function saveArea(ctx: SpendContext, does: Extract<SpendDoes, { kind: "save_area" }>): Resolution {
  // What rides the saves (Lunar Phenomenon's healing and veil) is asked
  // first and given after them (ar-ws-lunar-phenomenon.ts).
  const unhealed = does.heals ? healRefusal(ctx, does.heals) : null;
  if (unhealed) {
    return unhealed;
  }
  const saved = saveAreaSaves(ctx, does);
  if ("error" in saved) {
    return saved;
  }
  const lines = [...(saved.result.applied as string[])];
  if (does.heals) {
    lines.push(healOne(ctx, does.heals));
  }
  const veiled = does.veils ? veil(ctx) : null;
  if (veiled) {
    lines.push(veiled.line);
  }
  return { ...(veiled?.patch ? { patch: veiled.patch } : {}), result: { applied: lines } };
}

function saveAreaSaves(ctx: SpendContext, does: Extract<SpendDoes, { kind: "save_area" }>): ToolError | { result: { applied: string[] } } {
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
      // "That can see or hear you" (Order's Demand): one deafened and unable
      // to see the holder is left out; before this it was charmed.
      (!does.seesOrHears || !(enemy.conditions.some((entry) => isConditionNamed(entry, "deafened")) && unseenBecause(encounter.id, enemy, sheet))) &&
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
      ...(ctx.spend.pool?.id === "channel_divinity" ? { channel: true } : {}),
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
          ...(does.untilItsTurnEnds ? { untilTurnEndOf: enemy.id } : does.untilNextTurnEnds ? { untilTurnEndOf: sheet.id } : does.rounds ? { rounds: does.rounds } : {}),
          ...(does.endsOnDamage ? { endsOnDamage: true } : {}),
          ...(does.leashFeet ? { leashFeet: does.leashFeet } : {}),
        });
        parts.push(`is ${does.condition}`);
      }
    }
    // A second mark a failure leaves (Order's Demand: what it held is
    // dropped, the "disarmed" a Disarming Attack leaves too).
    if (does.mark && !immuneToCondition(fresh(), does.mark)) {
      layEnemyConditionInstance(campaign, fresh(), does.mark, { source: sheet.id });
      parts.push(`is ${does.mark}`);
    } else if (does.onFail) {
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
    // "Each other creature in it": an ally in the aura burns too. The aura is
    // written first, so Shielding Storm's shelter (pc-damage.ts
    // authoredAuraResistances reads the condition) already covers them.
    const allies = alliesInReach(ctx, 10, false).filter((ally) => ally.currentHp > 0);
    if (allies.length) {
      patchSheet(ctx.sheet.id, patch);
    }
    for (const ally of allies) {
      const burnt = applyPcDamage(ctx.campaign, ctx.turnId, getSheetById(ally.id) ?? ally, { amount: Number(amount), type: "fire", magical: true, reason: "Storm Aura" });
      lines.push(`${ally.name}: ${burnt.damageApplied ?? 0} fire damage${burnt.resistance ? ` (${String(burnt.resistance)})` : ""}.`);
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
