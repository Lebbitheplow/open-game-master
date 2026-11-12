import { breathAugment } from "@/lib/dm/mt-mr-dragon";
import type { Campaign } from "@/lib/db/campaigns";
import { shadowInvisibility, shadowLightProblem } from "@/lib/dm/one-with-shadows";
import { getSheetById } from "@/lib/db/sheets";
import { breakConcentration, droppedLine, setConcentration } from "@/lib/dm/concentration";
import { aoeSpendFor } from "@/lib/srd/aoe-spend";
import { diceFor as healingOn, rollOwnDice } from "@/lib/dm/character-roll";
import { computeSheetDerived } from "@/lib/srd";
import { ELEMENTAL_WILD_SHAPE_COST, elementalWildShape, wildShapeUse, type WildShapeAsk } from "@/lib/dm/wild-shape-use";
import { RAGE_FIRST, withoutRageFirst } from "@/lib/dm/mt-srd-barbarian";
import { targetReachProblem } from "@/lib/dm/mt-srd-reach";
import { heldUnlimitedState, isUnlimited, matchResource, RAGING, recoveringPrefix, resourceLevel, type ResourceDef, type SaveAbilityId, type SaveTerms } from "@/lib/srd/class-resources";
import { counterGate, counterSaveDc, otherPrice } from "@/lib/srd/counter-rules";
import { rallyMark, rallyRefusal } from "@/lib/dm/ar-wbf-feat-rally";
import { treatsRefusal } from "@/lib/dm/ar-wbf-feat-treats";
import { sheetSize } from "@/lib/dm/sheet-foe-stats";
import { resolveCounterHit, resolveCounterSave, type CounterSaveAim } from "@/lib/dm/counter-saves";
import { getActiveEncounter } from "@/lib/db/encounters";
import { unseenBecause, unseenByConditions, withinFeet } from "@/lib/dm/authored-saves";
import { effectiveMaxHp, incapacitatedBy, wearsHeavyArmor } from "@/lib/dm/condition-logic";
import { conditionEffectsFor } from "@/lib/srd/condition-effects";
import { consumableEffect, findCarriedItem, notCarried } from "@/lib/dm/item-logic";
import { metamagicPaid } from "@/lib/dm/ar-ws-lunar-boons";
import { kiTechnique, spendKiTechnique, spendQuickenedSpell } from "@/lib/dm/bonus-actions";
import { secondOptionProblem } from "@/lib/dm/mt-srd-metamagic";
import { removeItemMath } from "@/lib/dm/mutation-math";
import { textKey } from "@/lib/language/text-logic";
import { chosenOptions, optionsOfKind } from "@/lib/srd/options";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { holdsMote } from "@/lib/srd/authored-effects-more";
import { givenDieMarks } from "@/lib/dm/ar-wbf-bard-dice-logic";
import { noneNamed, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { isConditionNamed, nameChoice } from "@/lib/srd/feature-names";
import { isTableGearName } from "@/lib/db/homebrew";
import { spentSlotRefusal } from "@/lib/dm/cast-rules";
import { planSwap } from "@/lib/dm/ar-ws-transposition";
import { creditFeatureTeleport } from "@/lib/dm/feature-teleport";
import { planFeatureMove, type Square } from "@/lib/dm/feature-move";
import { allyReachRefusal } from "@/lib/dm/ally-reach-dra";

export { computePurchase } from "@/lib/dm/purchase-math";

// Handlers for the resource-engine mutation tools: use_item (atomic
// consumable use), purchase (atomic gold + item trade), and use_resource
// (limited-use class features). Dispatched from applyDmMutation, which owns
// the sheet resolution, audit, and publish plumbing; these helpers compute
// the patch + result so mutations.ts only grows dispatch lines. Must not
// import mutations.ts (the import points the other way).

export type Outcome = {
  patch: FullPatchSheetInput;
  result: ToolResult;
  // Extra target-sheet patch for use_item fed to someone else.
  healTarget?: { characterId: string; amount: number };
  // Extra target-sheet patch for a feature that lands on someone else
  // (Bardic Inspiration). Applied and published by the caller.
  patchTarget?: { characterId: string; patch: FullPatchSheetInput };
  event?: string;
  // Wild Shape: how many in-world hours the form lasts, for the clock.
  shapeHours?: number;
  // A buff held by concentration: the caller takes it once the patch has
  // landed (holdConcentration), so the spell it displaces ends after.
  concentrate?: string;
};

// A feature buff held by concentration (Mantle of Majesty, Spirit
// Projection): the holder concentrates on the feature's name, which ends
// whatever they held before, and a broken concentration ends the buff, since
// its condition carries the feature as its spell (spell-effects.ts
// heldBySpell). Called by use_resource after the spend's patch has landed.
export function holdConcentration(campaign: Campaign, turnId: string | null, sheetId: string, outcome: Outcome): ToolResult {
  if (!outcome.concentrate) {
    return {};
  }
  const { displaced } = setConcentration(campaign, turnId, sheetId, outcome.concentrate);
  return displaced ? { concentrationEnded: droppedLine(displaced, outcome.concentrate) } : {};
}

// Rolls healing as a visible dice card. Shared by the potion path and the
// class-feature healing path; the heal itself always rides the standard heal
// mutation so the death engine wakes a dying target. Exported for the Combat
// Wild Shape slot-heal in mutations.ts.
//
// The dice are the roller's own, whoever is healed: the character whose
// feature it is, or who pours the potion. A seat on physical dice rolls them
// (src/lib/dm/character-roll.ts), as it rolls its damage. They were thrown
// here, so a fighter with real dice on the table had Second Wind rolled for
// them (issue 902). The card joins the turn's cards, so the chronicle shows
// it: it was sent to the table as it was rolled and then never seen again.
// A flat amount (Unearthly Recovery's half the maximum) has nothing to roll
// and is never waited on (character-roll.ts).
export function rollHealing(
  campaign: Campaign,
  roller: CharacterSheet,
  detail: string,
  expression: string,
): number {
  return rollOwnDice(campaign, roller, `${detail} (${expression})`, expression, { flatCard: true }).total;
}

export function computeUseItem(
  campaign: Campaign,
  sheet: CharacterSheet,
  target: CharacterSheet,
  itemName: string,
): Outcome | ToolError {
  const carried = findCarriedItem(sheet.equipment, itemName);
  if (!carried) {
    const refusal = notCarried(sheet.name, sheet.equipment.map((item) => item.name), itemName, isTableGearName(campaign.id, itemName));
    return { ...refusal, error: `${refusal.error} One taken in this same action is given with grant_item first, then used.` };
  }
  const removal = removeItemMath(sheet.equipment, carried.name, 1);
  if (!removal) {
    return notCarried(sheet.name, sheet.equipment.map((item) => item.name), itemName, isTableGearName(campaign.id, itemName));
  }
  const effect = consumableEffect(carried);
  const base: Outcome = {
    patch: { equipment: removal.equipment },
    result: {
      ok: true,
      used: carried.name,
      remaining: removal.equipment.find((entry) => entry.name === carried.name)?.qty ?? 0,
    },
  };
  if (effect.kind === "healing") {
    if (target.deathSaves?.dead) {
      return { error: `${target.name} is DEAD; a potion cannot help.`, refused: "rules" };
    }
    const total = rollHealing(campaign, sheet, healingOn(carried.name, sheet, target), effect.expression);
    base.healTarget = { characterId: target.id, amount: Math.max(1, total) };
    base.result.healingRolled = total;
  }
  return base;
}

// How the target of an inspiration die carries it: a condition on their
// sheet that the next d20 roll consumes (src/lib/dm/rolls.ts). The die size
// rides in the name so one string carries the whole effect.
export function inspirationCondition(die: string): string {
  return `bardic inspiration (${die})`;
}

// What a Metamagic option costs. SRD 5.1 sorcerer, Metamagic: "You gain two
// of the following Metamagic options of your choice", each at the price its
// paragraph names: Careful, Distant, Empowered, Extended and Subtle Spell 1
// point, Quickened Spell 2, Heightened Spell 3; Twinned Spell "a number of
// sorcery points equal to the spell's level (1 sorcery point if the spell is
// a cantrip)", which the call gives in amount. Seeking and Transmuted Spell
// (the options list's later two) at their printed 2 and 1.
const METAMAGIC_POINTS: Record<string, number> = {
  "careful spell": 1,
  "distant spell": 1,
  "empowered spell": 1,
  "extended spell": 1,
  "subtle spell": 1,
  "transmuted spell": 1,
  "quickened spell": 2,
  "seeking spell": 2,
  "heightened spell": 3,
};

// The points a named option costs this sorcerer, or the refusal when they
// never learned it (a Metamagic Adept's picks count: they are filed the
// same way).
export function metamagicPrice(sheet: Pick<CharacterSheet, "name" | "features">, option: string, amount: number): { points: number } | ToolError {
  if (!chosenOptions(sheet.features, "metamagic").some((name) => textKey(name) === textKey(option))) {
    return { error: `${sheet.name} has not learned the ${option} Metamagic option. Ask the player whether to cast the spell without it. Nothing was spent.`, retry: true };
  }
  return { points: METAMAGIC_POINTS[textKey(option)] ?? Math.max(1, amount) };
}

// 10 minutes of rounds, the SRD duration for a held inspiration die.
const INSPIRATION_ROUNDS = 100;

// ---- Font of Magic (sorcery-point <-> spell-slot conversion) ----

// SRD point cost to create a slot of each level; slots above 5th cannot be
// created. The reverse direction refunds points equal to the slot's level.
const FONT_SLOT_COST: Record<number, number> = { 1: 2, 2: 3, 3: 5, 4: 6, 5: 7 };

type FontDirection = "create_slot" | "recover_points";

// The two conversions by the variant the Sorcery Points guidance names (a
// fixed choice, src/lib/srd/class-resources.ts); the slot level is the call's
// amount, as Primeval Awareness takes it. Any other variant is a plain
// Metamagic spend (null).
const FONT_OF_MAGIC = new Map<string, FontDirection>([
  ["create slot", "create_slot"],
  ["convert slot", "recover_points"],
]);

export function fontOfMagicDirection(variant: string | undefined): FontDirection | null {
  return FONT_OF_MAGIC.get(textKey(variant ?? "")) ?? null;
}

function computeFontOfMagic(
  sheet: CharacterSheet,
  displayName: string,
  state: { max: number; used: number },
  conversion: { direction: FontDirection; level: number },
): Outcome | ToolError {
  const { direction, level } = conversion;
  if (!sheet.spellcasting) {
    return { error: `${sheet.name} has no spellcasting to convert ${displayName} into.`, refused: "rules" };
  }
  const slots = { ...sheet.spellcasting.slots };
  const key = String(level);
  if (direction === "create_slot") {
    const cost = FONT_SLOT_COST[level];
    if (!cost) {
      return { error: `Font of Magic cannot create a slot above 5th level.`, refused: "rules" };
    }
    const left = state.max - state.used;
    if (left < cost) {
      return {
        error: `Creating a level-${level} slot costs ${cost} sorcery points; ${sheet.name} has ${left}/${state.max} left.`,
        refused: "rules",
      };
    }
    const slot = slots[key];
    // A spent slot returns first; otherwise a bonus slot rides on max until
    // the long rest claws created slots back (rest-logic.ts).
    slots[key] = slot
      ? slot.used > 0
        ? { max: slot.max, used: slot.used - 1 }
        : { max: slot.max + 1, used: slot.used }
      : { max: 1, used: 0 };
    return {
      patch: {
        resources: {
          ...sheet.resources,
          sorcery_points: { max: state.max, used: state.used + cost },
        },
        spellcasting: { ...sheet.spellcasting, slots },
      },
      result: {
        ok: true,
        resource: displayName,
        spent: cost,
        left: `${left - cost}/${state.max}`,
        created: `one level-${level} spell slot`,
        note: "Created slots vanish at the end of a long rest.",
      },
    };
  }
  // recover_points: break an unspent slot of this level into points.
  const slot = slots[key];
  if (!slot || slot.used >= slot.max) {
    return spentSlotRefusal(sheet.name, sheet.spellcasting, { level, lowest: 1, what: `converting into ${displayName}`, withPact: false });
  }
  const refund = Math.min(level, state.used);
  if (refund <= 0) {
    return {
      error: `${sheet.name} is already at full ${displayName} (${state.max - state.used}/${state.max}); breaking a slot would waste it.`,
      refused: "rules",
    };
  }
  slots[key] = { max: slot.max, used: slot.used + 1 };
  return {
    patch: {
      resources: {
        ...sheet.resources,
        sorcery_points: { max: state.max, used: state.used - refund },
      },
      spellcasting: { ...sheet.spellcasting, slots },
    },
    result: {
      ok: true,
      resource: displayName,
      converted: `one level-${level} spell slot`,
      regained: `${refund} sorcery point${refund === 1 ? "" : "s"}`,
      left: `${state.max - state.used + refund}/${state.max}`,
    },
  };
}

type PoolState = CharacterSheet["resources"][string];

// What pays for a use: the pool itself or, with no use left, a pool that
// pays for one instead (Breath of the Dragon's 2 ki, or five sorcery
// points) or a spell slot of a level the row names;
// the refusal when none can. Asked before an option is asked for too
// (mutations.ts). Every other price a counter's text names goes on its row
// (fallbackPool, slotFallback) and through here, never at one spend.
export function payForUse(
  sheet: CharacterSheet,
  def: ResourceDef,
  state: PoolState,
  amount: number,
): { fallback: { id: string; amount: number; state: PoolState } | null; slot?: number } | ToolError {
  const left = state.max - state.used;
  if (left >= amount) {
    return { fallback: null };
  }
  const fallback = def.fallbackPool ?? null;
  const fallbackState = fallback ? sheet.resources[fallback.id] : undefined;
  const other = otherPrice(def, sheet);
  if (other && "pool" in other && fallbackState) {
    return { fallback: { ...other.pool, state: fallbackState } };
  }
  if (other && "slot" in other) {
    return { fallback: null, slot: other.slot };
  }
  const slotWords = def.slotFallback ? ` With none left it costs a spell slot${def.slotFallback > 1 ? ` of level ${def.slotFallback} or higher` : ""}, and they have none unspent.` : "";
  return {
    error: `${sheet.name} has ${left}/${state.max} ${def.displayName} left; they cannot spend ${amount}.${
      fallback ? ` With none left it costs ${fallback.amount} ${fallback.id.replace(/_/g, " ")}, and they have ${fallbackState ? fallbackState.max - fallbackState.used : 0}.` : ""
    }${slotWords} The feature is not available; narrate accordingly.`,
    refused: "rules",
  };
}


// The marker a spend leaves when its use returns only after a rolled number
// of long rests: "<name> recovering (n)", counted down by each long rest.
function recoveryMarker(campaign: Campaign, sheet: CharacterSheet, def: ResourceDef): { conditions: string[]; note: string } {
  const rests = Math.max(1, rollHealing(campaign, sheet, `${def.displayName}: long rests until it returns`, def.recovers ?? "1"));
  const prefix = recoveringPrefix(def.displayName);
  return {
    conditions: [...sheet.conditions.filter((entry) => !isConditionNamed(entry, prefix)), `${prefix} (${rests})`],
    note: `${def.displayName} comes back after ${rests} long rest${rests === 1 ? "" : "s"}.`,
  };
}

// A counter's save, its row's terms filled in (src/lib/dm/counter-saves.ts).
function rollCounterSave(
  campaign: Campaign,
  sheet: CharacterSheet,
  def: ResourceDef,
  base: { save: SaveAbilityId; dc: number; dice?: string | null; type?: string; half?: boolean; condition?: string },
  variant: string | undefined,
  aim: CounterSaveAim | undefined,
  // A reach other than the row's (Augment Breath's).
  reachFt?: number,
): ReturnType<typeof resolveCounterSave> {
  const effect = def.effect as SaveTerms;
  let type = base.type ?? effect.type;
  if (effect.typeFromVariant?.length) {
    const named = effect.typeFromVariant.find((entry) => textKey(entry) === textKey(variant ?? ""));
    if (variant?.trim() && !named) {
      return noneNamed(`${def.displayName} has no damage type called`, variant.trim(), effect.typeFromVariant);
    }
    type = named ?? effect.typeFromVariant[0];
  }
  const mods = computeSheetDerived(sheet).abilityMods;
  const most = typeof effect.most === "string" ? Math.max(1, mods[effect.most] ?? 0) : effect.most;
  return resolveCounterSave(campaign, sheet, {
    name: def.displayName,
    save: base.save,
    dc: base.dc,
    dice: base.dice,
    ...(type ? { type } : {}),
    half: base.half ?? effect.half,
    condition: base.condition,
    rounds: effect.rounds,
    rangeFt: reachFt ?? effect.rangeFt,
    ...(effect.cone ? { cone: true } : {}),
    types: effect.types,
    ...(most ? { most } : {}),
    magical: effect.magical ?? def.id !== "breath_weapon",
  }, aim ?? {});
}

// The slot a counter's slotFallback is paid with: of that level at least,
// and free, or the refusal (cast-rules.ts says which slots are free).
function slotPayment(sheet: CharacterSheet, def: ResourceDef, level: number): ToolError | { spellcasting: NonNullable<CharacterSheet["spellcasting"]> } {
  const casting = sheet.spellcasting;
  const slot = casting?.slots?.[String(level)];
  if (!casting || level < (def.slotFallback ?? 1) || !slot || slot.used >= slot.max) {
    return spentSlotRefusal(sheet.name, casting, { level, lowest: def.slotFallback ?? 1, what: def.displayName, withPact: true });
  }
  return { spellcasting: { ...casting, slots: { ...casting.slots, [String(level)]: { ...slot, used: slot.used + 1 } } } };
}

// A counter that reaches another creature only so far, or only one its
// holder can see (Healing Light: "a creature you can see within 60 feet"):
// the board's distance and the sight every check reads, refused before
// anything is spent. Out of a fight, or with no board, the GM keeps to it.
function reachRefusal(
  campaign: Campaign,
  sheet: CharacterSheet,
  target: CharacterSheet,
  name: string,
  reach: { rangeFt?: number; sight?: boolean },
): ToolError | null {
  if (target.id === sheet.id) {
    return null;
  }
  const encounter = getActiveEncounter(campaign.id);
  if (reach.sight) {
    const unseen = encounter ? unseenBecause(encounter.id, sheet, target, { hidden: false }) : unseenByConditions(null, sheet, target, { hidden: false });
    if (unseen) {
      return { error: `${sheet.name} cannot see ${target.name} (${unseen}), and ${name} takes a creature they can see. Nothing was spent.`, refused: "rules" };
    }
  }
  if (encounter && reach.rangeFt && !withinFeet(encounter.id, sheet.id, target.id, reach.rangeFt)) {
    return { error: `${target.name} is beyond ${reach.rangeFt} feet of ${sheet.name}; ${name} reaches no further. Nothing was spent.`, refused: "rules" };
  }
  return null;
}

export function computeUseResource(
  campaign: Campaign,
  sheet: CharacterSheet,
  target: CharacterSheet,
  resourceName: string,
  amount: number,
  form?: WildShapeAsk,
  variant?: string,
  // The reaction gate judged the character as they stood before the hit
  // that dropped them (a reaction that answers it, or one taken on dropping
  // to 0): the use goes ahead at 0 hit points (issue 233).
  reacting?: { beforeDrop?: boolean },
  // The creatures a save the counter forces is rolled for, and the turn its
  // dice cards belong to (src/lib/dm/counter-saves.ts).
  aim?: CounterSaveAim,
  // The square a teleport goes to, from the console or the Hand
  // (src/lib/dm/feature-move.ts); without it the teleport is credited to
  // move_token. `slotLevel`: the spell slot that pays once the uses are
  // gone (ResourceDef.slotFallback).
  more: { square?: Square; slotLevel?: number } = {},
): Outcome | ToolError {
  const square = more.square;
  const def = matchResource(resourceName);
  const state = def ? (sheet.resources[def.id] ?? heldUnlimitedState(def, sheet) ?? undefined) : undefined;
  if (!def || !state) {
    const available = Object.keys(sheet.resources);
    const theirs = available.length ? ` Their resources: ${available.join(", ")}.` : " They have no limited-use resources.";
    // A resource the rules know that the sheet lacks is the game saying no;
    // a name nobody knows is the call's to fix, from the list.
    return def
      ? { error: `${sheet.name} has no tracked resource "${resourceName}".${theirs}`, refused: "rules" }
      : { error: `No resource called "${resourceName}" is known.${theirs} Send the one meant, by the name on the sheet.`, retry: true };
  }
  // A pool another call spends refuses a bare spend, with that call named
  // in its guidance; one whose options this tool spends takes them by
  // variant (WAVE1 R10: "refuses a bare use_resource spend with a pointer
  // to the right call, spending nothing").
  if (def.passive && !(def.options && variant?.trim())) {
    return {
      error: `${def.displayName} is not spent by a use_resource call of its own: ${def.guidance} Nothing was spent.`,
      retry: true,
    };
  }
  if (sheet.deathSaves?.dead) {
    return { error: `${sheet.name} is dead and cannot use ${def.displayName}.`, refused: "rules" };
  }
  // A reaction judged before the drop, or a feature used at 0 hit points by
  // its own text (ResourceDef.atZeroHp: Defy Death after a death save).
  const standing = (Boolean(reacting?.beforeDrop) && def.action === "reaction") || Boolean(def.atZeroHp);
  if (sheet.currentHp <= 0 && !standing) {
    return {
      error: `${sheet.name} is at 0 HP and cannot use ${def.displayName}; they are unconscious and take no actions.`,
      refused: "rules",
    };
  }
  const stoppedBy = standing ? null : incapacitatedBy(sheet.conditions);
  if (stoppedBy) {
    return {
      error: `${sheet.name} is ${stoppedBy} and cannot use ${def.displayName} until the condition ends.`,
      refused: "rules",
    };
  }

  // The monk's ki techniques spend the bonus action and land their effect
  // (src/lib/dm/bonus-actions.ts); a plain spend (Stunning Strike's point)
  // passes no variant and falls through to the generic path below.
  if (def.id === "ki") {
    const technique = kiTechnique(variant);
    if (technique) {
      return spendKiTechnique(campaign, sheet, technique, variant);
    }
    if (variant?.trim()) {
      return {
        error: `${def.displayName} takes variant 'flurry of blows', 'patient defense', 'step of the wind' ('step of the wind dash' to Dash), 'diamond soul' or 'empty body'; "${variant}" is none of them. A plain spend (Stunning Strike) names no variant. Nothing was spent.`,
        retry: true,
      };
    }
  }

  // Font of Magic: sorcery points convert into a spell slot and back, the
  // direction in the variant and the slot level in amount; a plain spend
  // (Metamagic) falls through to the generic path below.
  // A named Metamagic option's own price (metamagicPrice).
  let metamagicPoints: number | null = null;
  if (def.id === "sorcery_points") {
    // The variant as its rules text lists it (class-resources.ts).
    if (textKey(variant ?? "") === "quickened spell") {
      // One option a spell (mt-srd-metamagic.ts).
      const second = secondOptionProblem(sheet, "Quickened Spell", true);
      if (second) {
        return second;
      }
      const quickened = spendQuickenedSpell(campaign, sheet, state);
      return "error" in quickened ? quickened : metamagicPaid(campaign.id, sheet, quickened);
    }
    const direction = fontOfMagicDirection(variant);
    if (direction) {
      return computeFontOfMagic(sheet, def.displayName, state, { direction, level: amount });
    }
    // Any other variant is a value off the list, never a spend: a plain
    // Metamagic spend names no variant, or the option it pays for.
    const option = variant?.trim() ? optionsOfKind("metamagic").find((entry) => textKey(entry.n) === textKey(variant)) : undefined;
    if (variant?.trim() && !option) {
      return {
        error: `${def.displayName} takes variant 'create slot' or 'convert slot' (Font of Magic, the slot's level in amount), 'Quickened Spell', or a Metamagic option by its name; "${variant}" is none of them. For a Metamagic spend give the points in amount. Nothing was spent.`,
        retry: true,
      };
    }
    if (option) {
      const priced = metamagicPrice(sheet, option.n, amount);
      if ("error" in priced) {
        return priced;
      }
      metamagicPoints = priced.points;
      // One option a spell (mt-srd-metamagic.ts).
      const second = secondOptionProblem(sheet, option.n);
      if (second) {
        return second;
      }
    }
  }

  // Reverting a Wild Shape costs nothing: a second call while shaped drops
  // the form rather than burning another use.
  if (def.effect.kind === "wild_shape" && sheet.wildShape) {
    const form = sheet.wildShape.form;
    return {
      patch: { wildShape: null },
      result: {
        ok: true,
        reverted: form,
        hp: `${sheet.currentHp}/${sheet.maxHp}`,
        note: `${sheet.name} returns to their own body with the hit points they had before shifting. No use was spent.`,
      },
    };
  }

  // Elemental Wild Shape spends two uses at once, or is refused before
  // anything is spent (src/lib/dm/wild-shape-use.ts).
  const elementalAsk = def.effect.kind === "wild_shape" ? elementalWildShape(sheet, form?.name) : null;
  if (elementalAsk && "error" in elementalAsk) {
    return elementalAsk;
  }
  const elemental = elementalAsk?.form ?? null;
  const cost = elemental ? ELEMENTAL_WILD_SHAPE_COST : (metamagicPoints ?? amount);

  // The counter's own preconditions, as its Hand card reads them
  // (src/lib/srd/counter-rules.ts).
  const live = getActiveEncounter(campaign.id);
  const gate = counterGate(def, sheet, Boolean(live && (live.kind ?? "fight") === "fight"));
  if (gate) {
    return { error: `${gate} Nothing was spent.`, refused: "rules" };
  }
  // The reach the counter's text gives its target (mt-srd-reach.ts).
  const beyond = targetReachProblem(campaign.id, def, sheet, target);
  if (beyond) {
    return { error: `${beyond} Nothing was spent.`, refused: "rules" };
  }
  // A pool a single use may only dip into (Balm of the Summer Court: half the
  // druid level of dice; Healing Light: the Charisma modifier).
  if (def.perUse) {
    const cap =
      def.perUse === "half_level"
        ? Math.max(1, Math.floor(resourceLevel(def, sheet) / 2))
        : Math.max(1, computeSheetDerived(sheet).abilityMods.cha);
    if (amount > cap) {
      return {
        error: `${def.displayName} spends at most ${cap} at a time for ${sheet.name} (${def.perUse === "half_level" ? "half their level" : "their Charisma modifier"}); ${amount} is more. Nothing was spent.`,
        retry: true,
      };
    }
  }
  const left = state.max - state.used;
  // Drake's Breath: "Once per long rest, or by expending a spell slot of 3rd
  // level or higher". With the use spent the slot named pays (use_resource
  // level), and with none named the lowest unspent slot of that level or
  // higher does (payForUse, counter-rules.ts otherPrice): one field on the
  // row, slotFallback, for both.
  const slotPays = def.slotFallback && left < cost && more.slotLevel !== undefined ? slotPayment(sheet, def, more.slotLevel) : null;
  if (slotPays && "error" in slotPays) {
    return slotPays;
  }
  const payment = slotPays ? { fallback: null } : payForUse(sheet, def, state, cost);
  if ("error" in payment) {
    return payment;
  }
  const paid = payment.fallback;
  // A spell slot paid for the use (slotFallback, none named in the call).
  const paidSlot = payment.slot ?? null;
  // A feature with no limit is used, not counted down.
  const unlimited = isUnlimited(state);
  const spent = slotPays
    ? sheet.resources
    : paid
    ? { ...sheet.resources, [paid.id]: { max: paid.state.max, used: paid.state.used + paid.amount } }
    : unlimited || paidSlot !== null
      ? sheet.resources
      : { ...sheet.resources, [def.id]: { max: state.max, used: state.used + cost } };
  const slotSpent = paidSlot !== null && sheet.spellcasting
    ? { spellcasting: { ...sheet.spellcasting, slots: { ...sheet.spellcasting.slots, [String(paidSlot)]: { ...sheet.spellcasting.slots[String(paidSlot)], used: sheet.spellcasting.slots[String(paidSlot)].used + 1 } } } }
    : {};
  // A use that returns only after several long rests (Limited Wish): the
  // marker the rest counts down (src/lib/dm/rest-logic.ts).
  const recovering = def.recovers && !paid && paidSlot === null && !unlimited ? recoveryMarker(campaign, sheet, def) : null;
  const outcome: Outcome = {
    patch: { resources: spent, ...slotSpent, ...(recovering ? { conditions: recovering.conditions } : {}), ...(slotPays ? { spellcasting: slotPays.spellcasting } : {}) },
    result: {
      ok: true,
      ...(recovering ? { returns: recovering.note } : {}),
      resource: def.displayName,
      spent: slotPays ? `a level ${more.slotLevel} spell slot (no use was left)` : paid ? `${paid.amount} ${paid.id.replace(/_/g, " ")} (no use was left)` : paidSlot !== null ? `a level ${paidSlot} spell slot (no use was left)` : cost,
      left: unlimited ? "unlimited" : paid || paidSlot !== null ? `0/${state.max}` : `${left - cost}/${state.max}`,
      refills: def.recharge === "short" ? "on any rest" : "on a long rest",
      effect: def.guidance,
    },
  };

  // Lunar Boons: a Metamagic option paid waits for its spell, or takes the
  // boon of one already cast this turn (src/lib/dm/ar-ws-lunar-boons.ts).
  if (metamagicPoints !== null) {
    metamagicPaid(campaign.id, sheet, outcome);
  }

  // One with Shadows: dim light or darkness, then invisible until the warlock
  // moves or acts (src/lib/dm/one-with-shadows.ts).
  if (def.id === "one_with_shadows") {
    const bright = shadowLightProblem(campaign.id, sheet);
    if (bright) {
      return bright;
    }
    Object.assign(outcome.patch, shadowInvisibility(sheet));
    outcome.result.invisible = `${sheet.name} is invisible until they move or take an action or a reaction.`;
    return outcome;
  }
  // Steps of Night (Twilight Domain 6): "while in dim light or darkness" the
  // cleric takes wing; before this the cleric flew on a brightly lit board.
  if (def.id === "sub_steps_of_night") {
    const bright = shadowLightProblem(campaign.id, sheet, def.displayName);
    if (bright) {
      return bright;
    }
  }

  const derived = computeSheetDerived(sheet);
  // Multiclass: an effect's level-scaled dice read the owning class's level
  // (Second Wind heals 1d10 + FIGHTER level), not the summed character level.
  const fxLevel = resourceLevel(def, sheet);
  switch (def.effect.kind) {
    case "heal_self": {
      // "halfmax": half the character's hit point maximum (Unearthly Recovery).
      const expression = def.effect.dice(fxLevel, derived.abilityMods).replace(/\bhalfmax\b/g, String(Math.floor(effectiveMaxHp(sheet) / 2)));
      const total = rollHealing(campaign, sheet, def.displayName, expression);
      outcome.healTarget = { characterId: sheet.id, amount: Math.max(1, total) };
      outcome.result.healingRolled = total;
      return outcome;
    }
    case "heal_pool": {
      if (target.deathSaves?.dead) {
        return { error: `${target.name} is DEAD; ${def.displayName} cannot help.`, refused: "rules" };
      }
      outcome.healTarget = { characterId: target.id, amount };
      outcome.result.healed = `${amount} HP to ${target.name}`;
      return outcome;
    }
    case "heal_dice_pool": {
      // Each spent use is one die of healing to the target.
      if (target.deathSaves?.dead) {
        return { error: `${target.name} is DEAD; ${def.displayName} cannot help.`, refused: "rules" };
      }
      // The pool's own reach and sight (Balm of the Summer Court: "a creature
      // you can see within 120 feet"), before a die is rolled: a creature
      // 125 feet off and an invisible one were healed all the same.
      const outOfReach = allyReachRefusal(campaign.id, sheet, target, { feature: def.displayName, rangeFt: def.effect.rangeFt, sight: def.effect.sight });
      if (outOfReach) {
        return outOfReach;
      }
      const beyond = reachRefusal(campaign, sheet, target, def.displayName, def.effect);
      if (beyond) {
        return beyond;
      }
      const total = rollHealing(campaign, sheet, healingOn(def.displayName, sheet, target), `${amount}${def.effect.die}`);
      outcome.healTarget = { characterId: target.id, amount: Math.max(1, total) };
      outcome.result.healingRolled = total;
      outcome.result.healed = `${total} HP to ${target.name}`;
      // Balm of the Summer Court: a temporary hit point for each die, kept
      // only when it beats what the creature already has.
      const temp = (def.effect.tempPerDie ?? 0) * amount;
      if (temp > target.tempHp) {
        if (target.id === sheet.id) {
          outcome.patch.tempHp = temp;
        } else {
          outcome.patchTarget = { characterId: target.id, patch: { tempHp: temp } };
        }
        outcome.result.tempHp = `${temp} temporary hit points to ${target.name}`;
      }
      return outcome;
    }
    case "heal_target": {
      if (target.deathSaves?.dead) {
        return { error: `${target.name} is DEAD; ${def.displayName} cannot help.`, refused: "rules" };
      }
      const expression = def.effect.dice(fxLevel, derived.abilityMods);
      const total = rollHealing(campaign, sheet, healingOn(def.displayName, sheet, target), expression);
      outcome.healTarget = { characterId: target.id, amount: Math.max(1, total) };
      outcome.result.healingRolled = total;
      return outcome;
    }
    case "temp_hp": {
      // Inspiring Leader reaches a creature once until it rests (ar-wbf-feat-rally.ts).
      const rallied = rallyRefusal(def.id, target);
      if (rallied) {
        return rallied;
      }
      // Chef's treats keep 8 hours from the cook's long rest (ar-wbf-feat-treats.ts).
      const spoiled = treatsRefusal(campaign.id, def.id, sheet);
      if (spoiled) {
        return spoiled;
      }
      const expression = def.effect.dice(fxLevel, derived.abilityMods);
      const total = Math.max(
        1,
        rollHealing(campaign, sheet, healingOn(`${def.displayName} (temporary HP)`, sheet, target), expression),
      );
      // 5e temporary hit points never stack; the higher value stands.
      if (target.tempHp >= total) {
        outcome.result.tempHp = `${target.name} keeps their existing ${target.tempHp} temporary hit points (the new ${total} would be lower).`;
        return outcome;
      }
      if (target.id === sheet.id) {
        outcome.patch.tempHp = total;
        Object.assign(outcome.patch, rallyMark(def.id, target));
      } else {
        outcome.patchTarget = { characterId: target.id, patch: { tempHp: total, ...rallyMark(def.id, target) } };
      }
      outcome.result.tempHp = `${total} temporary hit points to ${target.name}`;
      return outcome;
    }
    case "buff": {
      const effect = def.effect;
      // A feature with variants takes the one named whole or by its choice
      // ("bear" for "spirit totem: bear"); a miss is refused, never the
      // first.
      let condition = effect.condition;
      if (effect.variants?.length) {
        const wanted = textKey(variant ?? "");
        const picked = effect.variants.find((entry) => [entry, nameChoice(entry) ?? ""].some((spelling) => textKey(spelling) === wanted));
        if (!picked) {
          return wanted
            ? noneNamed(`${def.displayName} has no variant called`, (variant ?? "").trim(), effect.variants)
            : { error: `${def.displayName} needs its variant: ${effect.variants.join(", ")}. Ask the player which, unless they named one. Nothing was spent.`, retry: true };
        }
        condition = picked;
      }
      const recipient = effect.target === "ally" ? target : sheet;
      if (recipient.conditions.some((entry) => entry.toLowerCase() === condition)) {
        return { error: `${recipient.name} is already ${condition}; the feature is already running.`, refused: "rules" };
      }
      const conditionPatch = {
        conditions: [...recipient.conditions, condition],
        conditionMeta: {
          ...recipient.conditionMeta,
          [condition]: { rounds: effect.rounds, ...(effect.concentration ? { spell: def.displayName, source: sheet.id } : {}) },
        },
      };
      if (effect.concentration) {
        outcome.concentrate = def.displayName;
      }
      // Temporary hit points riding the buff (Fighting Spirit, Form of
      // Dread); 5e temp HP never stacks, the higher value stands.
      let tempHpPatch: { tempHp: number } | null = null;
      if (effect.tempHp) {
        const rolled = Math.max(
          1,
          rollHealing(
            campaign,
            sheet,
            healingOn(`${def.displayName} (temporary HP)`, sheet, recipient),
            effect.tempHp(sheet.level, derived.abilityMods),
          ),
        );
        if (rolled > recipient.tempHp) {
          tempHpPatch = { tempHp: rolled };
          outcome.result.tempHp = `${rolled} temporary hit points to ${recipient.name}`;
        }
      }
      if (recipient.id === sheet.id) {
        outcome.patch.conditions = conditionPatch.conditions;
        outcome.patch.conditionMeta = conditionPatch.conditionMeta;
        if (tempHpPatch) {
          outcome.patch.tempHp = tempHpPatch.tempHp;
        }
      } else {
        outcome.patchTarget = {
          characterId: recipient.id,
          patch: { ...conditionPatch, ...(tempHpPatch ?? {}) },
        };
      }
      if (effect.teleportFeet) {
        creditFeatureTeleport(sheet.id, def.displayName, effect.teleportFeet);
        outcome.result.teleport = `${sheet.name} teleports up to ${effect.teleportFeet} feet: if a battle map is live, move their token with move_token, teleport true, spell "${def.displayName}" and casterCharacterId ${sheet.id}.`;
      }
      const summary = conditionEffectsFor(condition)?.summary;
      outcome.result.applied = `${condition} on ${recipient.name} for ${effect.rounds} rounds`;
      if (summary) {
        outcome.result.effect = summary;
      }
      return outcome;
    }
    case "enemy_save": {
      // Rolled here, on the creatures the call names: it handed the numbers
      // back for an aoe_damage call, which a person's table never made.
      const effect = def.effect;
      const saved = rollCounterSave(campaign, sheet, def, {
        save: effect.save,
        dc: counterSaveDc(effect.dcAbility, derived, Math.max(...Object.values(derived.abilityMods))),
        dice: effect.dice ? effect.dice(fxLevel, derived.abilityMods) : null,
        condition: effect.condition,
      }, variant, aim);
      return "error" in saved ? saved : { ...outcome, result: { ...outcome.result, ...saved.result } };
    }
    case "hit_damage": {
      // Fury of the Small: rolled here onto the creature hit, after the hit.
      const hit = resolveCounterHit(campaign, sheet, { name: def.displayName, dice: def.effect.dice(fxLevel, derived.abilityMods), larger: def.effect.larger, holderSize: sheetSize(sheet) }, aim ?? {});
      return "error" in hit ? hit : { ...outcome, result: { ...outcome.result, ...hit.result } };
    }
    case "teleport": {
      // A square named: the move is made in the spend, a willing creature
      // the feature brings along with it (Misty Wanderer: "bringing a
      // willing creature within 5 feet along"). Before this the step was
      // handed back as words.
      if (square) {
        const along = def.effect.along && target.id !== sheet.id ? { refId: target.id, withinFeet: def.effect.along } : null;
        const move = planFeatureMove(campaign, { refId: sheet.id, square, feet: def.effect.feet, what: def.displayName, teleport: true, along });
        if ("error" in move) {
          return move;
        }
        outcome.result.teleport = move.go();
        return outcome;
      }
      // With a willing creature named, the two change places (Benign
      // Transposition); the plain jump below is left for move_token.
      if (def.effect.swap && target.id !== sheet.id) {
        const swap = planSwap(campaign, sheet, target, def.displayName, def.effect.feet);
        if ("error" in swap) {
          return swap;
        }
        outcome.result.swapped = swap.apply();
        return outcome;
      }
      creditFeatureTeleport(sheet.id, def.displayName, def.effect.feet);
      outcome.result.teleport = `${sheet.name} teleports up to ${def.effect.feet} feet: if a battle map is live, move their token with move_token, teleport true, spell "${def.displayName}" and casterCharacterId ${sheet.id}.`;
      return outcome;
    }
    case "condition": {
      const condition = def.effect.condition;
      if (sheet.conditions.some((entry) => entry.toLowerCase() === condition)) {
        return { error: `${sheet.name} is already ${condition}; the feature is already running.`, refused: "rules" };
      }
      // A rage ends any spell the barbarian was concentrating on (SRD 5.1,
      // Rage). Nothing is refused past this point, so it is ended here, and
      // the conditions are read again after the spell's own have come off.
      let holder = sheet;
      if (condition === RAGING && sheet.concentratingOn) {
        const ended = breakConcentration(campaign, null, sheet.id, "entered a rage");
        holder = getSheetById(sheet.id) ?? sheet;
        if (ended) {
          outcome.result.concentrationEnded = `${sheet.name} stops concentrating on ${ended} as the rage takes hold.`;
        }
      }
      // Feral Instinct's hold on a surprised first turn ends with the rage
      // it waited for (mt-srd-barbarian.ts).
      const entered = condition === RAGING ? withoutRageFirst(holder) : holder;
      const metaKept = Object.fromEntries(Object.entries(holder.conditionMeta ?? {}).filter(([name]) => name !== RAGE_FIRST));
      outcome.patch.conditions = [...entered.conditions, condition];
      outcome.patch.conditionMeta = {
        ...metaKept,
        [condition]: { rounds: def.effect.rounds },
      };
      outcome.result.applied = `${condition} for ${def.effect.rounds} rounds`;
      if (condition === RAGING && wearsHeavyArmor(sheet.equipment)) {
        outcome.result.heavyArmor = `${sheet.name} is wearing heavy armor, so this rage gives none of its benefits: no resistance, no bonus damage, no advantage on Strength. They gain them the moment the armor is off.`;
      }
      return outcome;
    }
    case "inspire": {
      // "one creature other than yourself" (SRD 5.1, Bardic Inspiration);
      // Cosmic Omen answers "a roll near you", the druid's own among them.
      if (target.id === sheet.id && def.effect.othersOnly) {
        return {
          error: `${def.displayName} goes to another creature, never to the bard themselves. Pass targetCharacterId.`,
          retry: true,
        };
      }
      const die = def.effect.die(fxLevel);
      const condition = inspirationCondition(die);
      // SRD 5.1 bard, Bardic Inspiration: "A creature can have only one
      // Bardic Inspiration die at a time", whatever its size: a d6 from one
      // bard bars a d8 from another.
      const held = target.conditions.find((entry) => isConditionNamed(entry, "bardic inspiration"));
      if (held) {
        return { error: `${target.name} already holds an unspent inspiration die (${held}), and a creature can have only one at a time.`, refused: "rules" };
      }
      outcome.patchTarget = {
        characterId: target.id,
        patch: {
          conditions: [...target.conditions, condition],
          conditionMeta: {
            ...target.conditionMeta,
            // Who gave it, and a Creation bard's mote with it
            // (src/lib/dm/authored-mote.ts); what a Valor or an Eloquence
            // bard's die may do (ar-wbf-bard-dice-logic.ts).
            // The bard is kept as the die's source: a roll it makes succeed is
            // recorded as theirs (Infectious Inspiration, last-save.ts).
            [condition]: { rounds: INSPIRATION_ROUNDS, source: sheet.id, ...(holdsMote(sheet) ? { mote: true } : {}), ...givenDieMarks(sheet) },
          },
        },
      };
      outcome.result.granted = `1${die} to ${target.name}, spent automatically on their next d20 roll`;
      return outcome;
    }
    case "aoe": {
      // Half on a success, rolled here on the creatures the area catches.
      const spend = aoeSpendFor(def, sheet, fxLevel, derived)!;
      // Augment Breath, asked for in Breath of the Dragon's own variant
      // (mt-mr-dragon.ts): four rolls, the longer reach, 1 ki more.
      const augment = breathAugment(sheet, def.id, variant, outcome.patch.resources ?? sheet.resources);
      if (augment && "error" in augment) {
        return augment;
      }
      const saved = rollCounterSave(campaign, sheet, def, { save: spend.saveAbility, dc: spend.dc, dice: augment?.dice ?? spend.dice, type: spend.damageType, half: def.effect.half ?? true }, augment ? augment.variant : variant, aim, augment?.rangeFt);
      if (augment && !("error" in saved)) {
        outcome.patch.resources = augment.resources;
        outcome.result.augmented = `Augment Breath: 1 ki more, ${augment.dice} to ${augment.rangeFt} feet.`;
      }
      return "error" in saved ? saved : { ...outcome, result: { ...outcome.result, ...(spend.area && !augment ? { area: spend.area } : {}), ...saved.result } };
    }
    case "wild_shape": {
      // The Hand's card names the beast as its pick (variant); the console
      // and the AI GM in form.
      const asked = form?.name?.trim() ? form : variant?.trim() ? { ...form, name: variant.trim() } : form;
      return wildShapeUse(sheet, outcome, def.displayName, asked, elemental);
    }
    case "recover_slots": {
      // Spent through take_rest, which reads the counter and returns the
      // slots; spending it by hand here would burn the use for nothing.
      return {
        error: `${def.displayName} happens as part of a short rest, not on its own. Call take_rest with kind=short and the server applies it.`,
        retry: true,
      };
    }
    case "narrative":
      return outcome;
  }
}
