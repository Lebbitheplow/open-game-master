// The one door every spell a character casts goes through.
//
// use_spell_slot, cast_at_enemy, cast_buff, aoe_damage with a spell, the
// spell branch of pc_attack, heal with a spell and a reaction spell all call
// castSpell (through use_spell_slot in src/lib/dm/mutations.ts), so the
// questions are asked once and in one order: may the caster act at all
// (can-act.ts), do they hold the spell, can they cast in the state they are
// in, can they say and gesture it, can they pay for its material, have they
// the slot, and has their turn the room for its casting time. Every refusal
// comes before anything is written, and a dry run asks the questions
// without writing, for a tool that has refusals of its own still to ask.
//
// A spell of a minute or more (or a ritual) in a fight is begun here and
// held across the caster's turns, and completed here when its rounds have
// run out, the slot spent only then (src/lib/dm/long-casting-logic.ts).
//
// A concentration spell already running whose effect comes again on a later
// turn (Call Lightning's bolt, Heat Metal, Moonbeam) is not a new casting:
// it costs what the spell says of the turn and no slot, at the slot level
// the casting was made from. A warlock's cast with no level named is made at
// the pact level, and a wizard's mastered spell spends no slot
// (cast-rules.ts slotPlan).
//
// The rules themselves are pure and live in src/lib/dm/cast-rules.ts; this
// module reads the live state and writes the spend. It must not import
// mutations.ts (which imports it).

import { READING_THOUGHTS, isSuggestion, readsThoughts } from "@/lib/dm/read-thoughts";
import { clearCastMarks, factsAsCast, settleTwin } from "@/lib/dm/mt-srd-metamagic";
import { boonAtCast } from "@/lib/dm/ar-ws-lunar-boons";
import { surgeChanceAfter } from "@/lib/dm/ar-ws-wild-surge";
import { castRefills } from "@/lib/dm/ar-ws-transposition";
import { openStoneChange } from "@/lib/dm/ar-ws-stone";
import { holdsCantripAttack } from "@/lib/dm/ar-ws-cantrip-attack";
import { deflectionCastProblem } from "@/lib/dm/ar-ws-deflection-mark";
import { eruptOnCast } from "@/lib/dm/ar-ws-heart-storm";
import { subclassExtrasForTable } from "@/lib/db/subclass-extras";
import { enemyCounterspell } from "@/lib/dm/enemy-reactions";
import { endInvisibilityOnCast } from "@/lib/dm/attack-marks";
import { endSanctuaryOnHarm } from "@/lib/dm/spell-defenses";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, type Encounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { allocateSeq } from "@/lib/db/campaigns";
import { publishPersisted } from "@/lib/events";
import { advanceClock } from "@/lib/db/clock";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { materialPatch } from "@/lib/dm/cast-material";
import { freeCastCounter, signatureCounter, spendSignature } from "@/lib/dm/caster-features";
import { arcanumCounter } from "@/lib/dm/counter-cast-arcanum";
import { bareFacts, pointsOfferFor, pointsPayFirst, pointsPlan, pointsSpent, pointsWhenNoSlot } from "@/lib/dm/ar-ws-points-cast";
import { spendGrantUse } from "@/lib/srd/granted-casts";
import { spellFactsFor, spellMechanicsFor, spellSchoolFor } from "@/lib/content";
import { castShares } from "@/lib/srd/spell-mechanics";
import { describeCastingTime, type SpellFacts } from "@/lib/srd/spell-facts";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { canAct } from "@/lib/dm/can-act";
import { heldTurnRefusal } from "@/lib/dm/held-turn";
import { incapacitatedBy, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { attacksAllowedFor, budgetFor, markReactionUsed, storeBudget } from "@/lib/dm/turn-budget";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { droppedLine, setConcentration } from "@/lib/dm/concentration";
import { repeatSpell } from "@/lib/dm/cast-repeat";
import { beginWithSlotTool, castingRoundsOf, castingTimeWords, completedCastingOf, failLine } from "@/lib/dm/long-casting-logic";
import { beginHeldCasting, clearCompletedCasting, registerCastingCompletion } from "@/lib/dm/long-casting";
import {
  casterStateProblem,
  castComponents,
  materialPlan,
  openCastOf,
  ritualProblem,
  slotPlan,
  spellHeldProblem,
  reactionSpellOnOwnTurn,
  turnCharge,
  withOpenCast,
  bonusCastOf,
  grantedCastOf,
  grantCastsFree,
  MANTLE_OF_MAJESTY,
  type BonusCast,
  type OpenCast,
  type SlotPlan,
} from "@/lib/dm/cast-rules";
import type { TurnBudget } from "@/lib/dm/action-budget";
import { paidByManualTick } from "@/lib/dm/manual-ticks";
import { reactionRefusal } from "@/lib/dm/reaction-gate";
import { reactionTimingOf } from "@/lib/dm/reaction-kinds";
import { readiedRelease, releaseReadied } from "@/lib/dm/readied-spell";
import { castsAsOpportunity } from "@/lib/dm/ar-wbf-feat-warcaster-logic";
import { heldBySlow, markSlowedCast, slowHoldsCast } from "@/lib/dm/slow-cast";
import { antimagicProblem, silenceProblem } from "@/lib/dm/zone-rules";
import { placeSpellZone, placementReachProblem } from "@/lib/dm/zone-cast";
import { spellSaveDcFor } from "@/lib/srd";
import { castTempHp } from "@/lib/dm/authored-spells";
import { authoredSlotRefund } from "@/lib/srd/authored-effects-more";
import { SURGE_CHANCE } from "@/lib/srd/authored-effects-data4";
// The credits live in the database on the server (src/lib/db/item-cast-credits.ts).
import "@/lib/db/item-cast-credits";
import { takeItemCast, type ItemCast } from "@/lib/srd/item-cast-credit";
import { awakenedDamageType, spendSwiftRitual, swiftRitual } from "@/lib/dm/ar-ws-awakened";
import type { SpellMech } from "@/lib/srd/spell-mechanics";
import { storerHolding } from "@/lib/srd/spell-storing";
import { casterNumbers, equipmentWithoutRunning, putInRing, storeRefusal } from "@/lib/dm/ring-store";
import { castFromItem } from "@/lib/dm/item-casts";
import { summonSlotProblem } from "@/lib/srd/summon-spells";
import { spellSupportLine } from "@/lib/srd/spell-support";
import { wardOnCast } from "@/lib/dm/arcane-ward";
import { casterCost } from "@/lib/dm/spell-self";
import { toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { holdsFeature } from "@/lib/srd/feature-names";
import { revisedOnlySpell, revisedOnlySpellProblem } from "@/lib/content/edition";
import { isConditionNamed } from "@/lib/srd/feature-names";

// Which tool the cast came through. It decides two things only: whether a
// casting whose shares are resolved one call at a time (Eldritch Blast's
// beams, Bane's targets) may continue an open one, and whether the caller
// spends the reaction itself (use_reaction does).
export type CastVia = "slot" | "enemy" | "buff" | "aoe" | "attack" | "heal" | "reaction";

export type CastInput = {
  spell: string;
  level?: number;
  ritual?: boolean;
  // A homebrew spell the server knows nothing of: the caller says whether it
  // holds concentration.
  concentration?: boolean;
  via?: CastVia;
  dryRun?: boolean;
  // False when the casting falls outside a free grant's limits (the cast
  // tool that knows the target and the form says so): the grant does not
  // pay, a slot does, and a grant no slot can stand in for refuses.
  freeFits?: boolean;
  // How many of the casting's shares this call resolves (Magic Missile's
  // darts at one target); one when absent.
  uses?: number;
  // What a material counts by: creatures affected, corpses, the target's
  // Hit Dice (src/lib/dm/cast-materials.ts).
  units?: number;
  // Where a spell with an area is laid on the board (src/lib/dm/zone-cast.ts).
  at?: { x: number; y: number };
  toward?: { x: number; y: number };
  // Cast into a Ring of Spell Storing (src/lib/dm/spell-storing.ts): paid for
  // as any casting, with no effect now. Set by the store, not by the model.
  storing?: CastStoring;
  // The damage type the cast tool was asked for: a swap for a holder of
  // Awakened Spellbook (src/lib/dm/ar-ws-awakened.ts), nothing to anyone else.
  swapType?: string;
  // The dead character this casting returns to life (heal-spell.ts revive).
  revives?: string;
};

export type CastStoring = { ring: string; holderId: string };

export type CastHooks = {
  // Writes the audit row for the spend (mutations.ts keeps the audit helper).
  record: (delta: Record<string, unknown>, patch: Record<string, unknown>) => void;
  publish: () => void;
};

export type CastResult = ToolResult;

function inRunningFight(encounter: Encounter | null): encounter is Encounter {
  return Boolean(encounter && encounter.status === "active" && (encounter.kind ?? "fight") === "fight");
}

// A later ray, dart or target of a casting already made this turn: it spends
// nothing more.
function continueOpenCast(encounter: Encounter, budget: TurnBudget, open: OpenCast, name: string, input: CastInput): CastResult {
  if (input.dryRun) {
    return { ok: true, dryRun: true, spell: name, slotLevel: open.slotLevel, continuing: true };
  }
  const uses = Math.max(1, Math.min(open.left, Math.floor(input.uses ?? 1)));
  storeBudget(encounter, withOpenCast(budget, { ...open, left: open.left - uses }));
  return {
    ok: true,
    spell: name,
    slotLevel: open.slotLevel,
    uses,
    sharesLeft: open.left - uses,
    continuing: `${name}: more of the same casting (${open.left - uses} left); nothing more is spent.`,
    ...(open.item ? { fromItem: open.item } : {}),
  };
}

// The rays, darts or targets a casting from an item holds beyond this call
// (Scorching Ray from a Ring of Spell Storing at 2nd: three rays), kept open on
// the turn as a slot's casting keeps them. The item is named on it, so its later
// calls are taken before the holder's own list or Spellcasting feature is asked:
// a fighter has neither, and a wizard's own copy would spend a slot.
function openItemShares(encounter: Encounter, sheet: CharacterSheet, name: string, mech: SpellMech | null, facts: SpellFacts | null, cast: ItemCast, input: CastInput, via: CastVia): Record<string, unknown> {
  if (via === "aoe" || via === "reaction") {
    return {};
  }
  const shares = castShares(mech, { spellLevel: facts?.level ?? cast.level, slotLevel: cast.level, casterLevel: sheet.level });
  if (shares < 2) {
    return {};
  }
  const uses = Math.max(1, Math.min(shares, Math.floor(input.uses ?? 1)));
  const left = via === "slot" ? shares : shares - uses;
  // Off their own turn (a readied release) there is no turn to keep it on.
  const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
  if (!budget) {
    return {};
  }
  storeBudget(encounter, withOpenCast(budget, { spell: name, slotLevel: cast.level, left, item: cast.item }));
  const list = mech?.attacks ? "pc_attack's attacks" : mech?.resolution === "heal" ? "heal's targets" : "cast_at_enemy's targets";
  return {
    uses,
    sharesLeft: left,
    shares: `${name} holds ${shares} ${mech?.attacks ? "attack rolls" : mech?.darts ? "darts" : "targets"} from this one casting; ${left} left this turn at no further cost, each its own entry in ${list}.`,
  };
}

function slotLine(plan: SlotPlan): string {
  if (plan.kind === "none") {
    return plan.note;
  }
  return `${plan.kind === "pact" ? "pact slot " : ""}level ${plan.level}: ${plan.state.max - plan.state.used}/${plan.state.max} left`;
}

// A slot spent with no spell named: Divine Smite, and a weak tool call the
// server tolerates (docs/rules-coverage.md). Only the slot and the caster's
// ability to act at all are asked.
function namelessSlot(
  sheet: CharacterSheet,
  input: CastInput,
  hooks: CastHooks,
): CastResult {
  if (input.ritual) {
    return { error: "A ritual is a named spell with the ritual tag; name the spell being cast.", retry: true };
  }
  if (sheet.deathSaves?.dead || sheet.currentHp <= 0) {
    return { error: `${sheet.name} is ${sheet.deathSaves?.dead ? "dead" : "at 0 HP"} and cannot spend a spell slot.`, refused: "rules" };
  }
  const stopped = incapacitatedBy(sheet.conditions);
  if (stopped) {
    return { error: `${sheet.name} is ${stopped} and cannot spend a spell slot until the condition ends.`, refused: "rules" };
  }
  const state = casterStateProblem(sheet);
  if (state && sheet.wildShape) {
    return state;
  }
  const plan = slotPlan(sheet, "", null, input.level);
  if ("error" in plan) {
    return plan;
  }
  if (input.dryRun || plan.kind === "none") {
    return { ok: true, dryRun: Boolean(input.dryRun) };
  }
  const spellcasting = spellcastingAfter(sheet, plan);
  patchSheet(sheet.id, { spellcasting });
  hooks.record({ level: plan.level, used: plan.state.used, max: plan.state.max }, { spellcasting });
  hooks.publish();
  return { ok: true, slot: slotLine(plan) };
}

function spellcastingAfter(sheet: CharacterSheet, plan: SlotPlan): CharacterSheet["spellcasting"] {
  const casting = sheet.spellcasting;
  if (!casting || plan.kind === "none") {
    return casting;
  }
  return plan.kind === "pact"
    ? { ...casting, pact: { level: plan.level, ...plan.state } }
    : { ...casting, slots: { ...casting.slots, [String(plan.level)]: plan.state } };
}

// What the turn is charged, worked out before any write.
type TurnPlan =
  | { kind: "free" }
  | { kind: "budget"; budget: TurnBudget; cost: string; note?: string }
  | { kind: "reaction"; budget?: TurnBudget }
  // use_reaction spent the reaction; the cast only marks the caster's own turn.
  | { kind: "mark"; budget: TurnBudget };

// The feature that lets this one-action spell take the bonus action
// (cast-rules.ts bonusCastOf), with the spell's school from the pack.
function bonusCastFor(sheet: CharacterSheet, facts: SpellFacts | null, spell: string): BonusCast | null {
  return bonusCastOf(sheet, facts, facts ? spellSchoolFor(facts.runsAs ?? facts.name ?? spell) : null);
}

function planTurn(
  sheet: CharacterSheet,
  encounter: Encounter | null,
  facts: SpellFacts | null,
  spell: string,
  slotLevel: number | null,
  via: CastVia,
): TurnPlan | ToolError {
  if (!inRunningFight(encounter)) {
    return { kind: "free" };
  }
  const time = facts?.castingTime ?? "action";
  const budget = budgetFor(
    encounter,
    sheet.id,
    attacksAllowedFor(sheet),
    conditionTurnShape(sheet.conditions),
  );
  if (time === "reaction") {
    // On the caster's own turn a reaction spell is the turn's other spell
    // (cast-rules.ts, reactionSpellOnOwnTurn).
    const own = reactionSpellOnOwnTurn(budget, sheet.name, facts?.name ?? spell);
    if ("error" in own) {
      return own;
    }
    if (via === "reaction") {
      // use_reaction checks and spends the reaction itself.
      return own.budget ? { kind: "mark", budget: own.budget } : { kind: "free" };
    }
    if (encounter.reactionsUsed.includes(sheet.id)) {
      return {
        error: `${sheet.name} has already used their reaction; it comes back at the start of their next turn. ${facts?.name ?? spell} is not cast.`,
        refused: "rules",
      };
    }
    return { kind: "reaction", ...(own.budget ? { budget: own.budget } : {}) };
  }
  const charge = turnCharge({
    who: sheet.name,
    facts,
    spell,
    slotLevel,
    inFight: true,
    budget,
    reactionSpent: false,
    bonusCast: bonusCastFor(sheet, facts, spell),
    attackCantrip: holdsCantripAttack(sheet),
  });
  if ("error" in charge) {
    return charge;
  }
  if (charge.kind === "budget") {
    return { kind: "budget", budget: charge.budget, cost: charge.cost, ...(charge.note ? { note: charge.note } : {}) };
  }
  return { kind: "free" };
}

// Casts a named spell for `sheet`, or spends a nameless slot. The sheet is
// the fresh pre-cast state.
export function castSpell(
  campaign: Campaign,
  // Null when the server completes a held casting as a turn starts, outside
  // any DM turn (long-casting.ts).
  turnId: string | null,
  sheet: CharacterSheet,
  asked: CastInput,
  hooks: CastHooks,
): CastResult {
  const spell = asked.spell.trim();
  // Divine Smite is a paladin's feature under the 2014 rules, not a spell: a
  // slot spent naming it is the nameless slot the feature burns.
  if (!spell || (revisedOnlySpell(spell) === "Divine Smite" && holdsFeature(sheet, "Divine Smite"))) {
    return namelessSlot(sheet, asked, hooks);
  }
  // A spell only the 2024 rules print, still on a sheet from before they
  // were taken out, is not cast here (src/lib/content/edition.ts).
  const revised = revisedOnlySpellProblem(spell);
  if (revised) {
    return { error: `${revised} Nothing was spent.`, refused: "rules" };
  }
  const via = asked.via ?? "slot";
  const authors = spellAuthorsFor(campaign);
  // Distant Spell's range, for a square named for the spell's area (mt-srd-metamagic.ts).
  const facts = factsAsCast(sheet, spellFactsFor(spell, authors));
  const name = facts?.name ?? spell;
  // A casting of a minute or more held across the caster's turns whose
  // rounds have run out (long-casting-logic.ts): this call completes it, from
  // the slot it was begun with and as the ritual it was begun as.
  const completing = completedCastingOf(sheet, name);
  const input: CastInput = completing
    ? { ...asked, ...(completing.slotLevel ? { level: completing.slotLevel } : {}), ...(completing.ritual ? { ritual: true } : {}), ...(completing.storing ? { storing: completing.storing } : {}) }
    : asked;
  // The published spell a table's workshop copy runs as: what every engine
  // that keys a spell by name reads (src/lib/content/index.ts
  // spellEngineName). The copy's own name is what is spent and held.
  const engine = facts?.runsAs ?? name;
  const encounter = getActiveEncounter(campaign.id);
  const inFight = inRunningFight(encounter);
  // SRD 5.1, Longer Casting Times: in a fight a spell of a minute or more,
  // or one cast as a ritual, is begun now and held across the caster's turns.
  // Awakened Spellbook's ritual at its normal casting time (ar-ws-awakened.ts).
  const swift = !completing && swiftRitual(sheet, facts, Boolean(input.ritual));
  const holdRounds = inFight && !completing ? castingRoundsOf(facts, Boolean(input.ritual) && !swift) : null;
  // War Caster's opportunity spell is a one-action spell cast with the
  // reaction (src/lib/dm/ar-wbf-feat-warcaster-logic.ts).
  const reactionTime = !input.storing && (facts?.castingTime === "reaction" || via === "reaction" || castsAsOpportunity(sheet.id));
  // A summoning spell's creatures come through cast_buff (summon-cast.ts),
  // once its casting is done when that takes a minute in a fight.
  const summoning = via === "slot" && !input.dryRun && !input.storing && holdRounds === null ? summonSlotProblem(engine) : null;
  if (summoning) {
    return summoning;
  }
  // A reaction spell answers its trigger through use_reaction, which checks
  // the trigger and applies the spell (src/lib/dm/reaction-spells.ts): cast
  // by any other tool it would spend its slot on nothing.
  // A spell they cannot cast is told so here, as use_reaction would (a cast
  // an item pays for aside), not sent there to hear it.
  if (facts?.castingTime === "reaction" && via !== "reaction" && !input.storing) {
    const unheld = takeItemCast(sheet.id, name, { dryRun: true }) ? null : spellHeldProblem(sheet, spell, facts, { extras: subclassExtrasForTable(campaign.id, sheet.userId) });
    return unheld ?? { error: `${name} is cast as a reaction: use_reaction with feature "${name}" when its trigger happens; the server checks the trigger and applies it. Nothing was spent.`, retry: true };
  }

  // A slot level named is a real one. Level 0 is how some callers name a
  // cantrip, and passes for one.
  if (input.level !== undefined && !(input.level >= 1 && input.level <= 9)) {
    const cantrip =
      facts?.level === 0 ||
      [sheet.spellcasting, ...(sheet.spellcasting?.casters ?? [])].some((entry) =>
        (entry?.cantrips ?? []).some((name) => textKey(name) === textKey(spell)),
      );
    if (!(input.level === 0 && cantrip)) {
      return {
        error: `A spell slot has a level from 1 to 9, not ${input.level}. Name the slot ${name} is cast from, or leave the level out for the spell's own.`,
        retry: true,
      };
    }
  }

  // A concentration spell already running whose effect comes again on a
  // later turn (Call Lightning's bolt, Heat Metal, Moonbeam): no new
  // casting, so no slot, no material, and concentration is not reset. What
  // it costs of the turn the spell says (src/lib/srd/spell-mech-rows.ts).
  const mech = spellMechanicsFor({ spell: name, userIds: authors })?.mech ?? null;
  if (
    mech?.repeat &&
    via !== "slot" &&
    // Witch Bolt's beam strikes through cast_at_enemy: an attack is a new casting.
    !(via === "attack" && mech.repeatDice) &&
    sheet.concentratingOn &&
    textKey(sheet.concentratingOn) === textKey(name)
  ) {
    return repeatSpell(sheet, inRunningFight(encounter) ? encounter : null, facts, name, mech.repeat, input);
  }

  // A readied spell released off turn: the reaction, no second slot
  // (src/lib/dm/readied-spell.ts).
  const readied = readiedRelease(sheet, encounter, name);
  if (readied && encounter) {
    return releaseReadied(campaign, sheet, encounter, readied, Boolean(input.dryRun));
  }

  // A spell use_item just cast from a scroll or a wand: no slot, no
  // components, the action already paid (src/lib/dm/item-casts.ts).
  // Its area is laid as any cast's is (below), so a square out of reach is said
  // before the credit is taken.
  const lays = !input.storing && (via === "slot" || via === "buff");
  if (lays && input.at && takeItemCast(sheet.id, name, { dryRun: true })) {
    const placed = placementReachProblem(campaign, { casterId: sheet.id, casterName: sheet.name, spell: name, runsAs: facts?.runsAs, facts, at: input.at });
    if (placed) {
      return placed;
    }
  }
  const fromItem = input.storing ? null : takeItemCast(sheet.id, name, { dryRun: Boolean(input.dryRun) });
  if (fromItem) {
    let itemCast = castFromItem(campaign, turnId, sheet, facts, name, fromItem, input);
    if (!input.dryRun) {
      const live = inFight ? getActiveEncounter(campaign.id) : null;
      if (live) {
        itemCast = { ...itemCast, ...openItemShares(live, sheet, name, mech, facts, fromItem, input, via) };
      }
      if (completing) {
        clearCompletedCasting(campaign, sheet.id);
      } else if (fromItem.storedIn && typeof facts?.castingTime === "number") {
        // A stored spell takes the time it takes (spell-storing.ts); in a
        // fight it was held across turns, so it is `completing` there.
        advanceClock(campaign.id, facts.castingTime, "minutes");
      }
      const area = lays ? placeSpellZone(campaign, { spell: name, runsAs: facts?.runsAs, caster: { kind: "pc", id: sheet.id, name: sheet.name }, slotLevel: fromItem.level, dc: spellSaveDcFor(sheet, name), at: input.at, toward: input.toward, named: Boolean(input.at) }) : null;
      if (area) {
        return { ...itemCast, area };
      }
    }
    return itemCast;
  }
  if (!input.storing && inFight && via !== "slot" && via !== "reaction") {
    const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
    const open = budget ? openCastOf(budget, name) : null;
    if (budget && open?.item) {
      return continueOpenCast(encounter, budget, open, name, input);
    }
  }

  // ---- refusals, in the order a person would give them ----
  // A reaction spell is asked through the one reaction gate, with the
  // spell's own timing (src/lib/dm/reaction-kinds.ts, issue 233): Shield cast
  // as the hit that dropped the caster lands is judged as they stood before
  // it; Hellish Rebuke is not.
  if (reactionTime) {
    const refused = reactionRefusal(campaign.id, sheet, encounter, name, reactionTimingOf(engine));
    if (refused) {
      return refused;
    }
  } else {
    // A held casting was paid for turn by turn, and the server completes it
    // as the caster's turn starts, before the pointer is saved: only the
    // caster's own state is asked, not whose turn the stored row says it is.
    const able = canAct({ sheet, encounter: completing ? null : encounter, kind: "cast" });
    if (!able.ok) {
      return toolError(able);
    }
    // A turn held while an enemy before it is still to act (held-turn.ts).
    const heldOff = completing ? null : heldTurnRefusal(encounter, sheet);
    if (heldOff) {
      return heldOff;
    }
  }
  const extras = subclassExtrasForTable(campaign.id, sheet.userId);
  const held = spellHeldProblem(sheet, spell, facts, {
    ritual: input.ritual,
    extras,
  });
  if (held) {
    // Their own list does not hold it, but a ring they carry might.
    const ring = storerHolding(sheet.equipment, name);
    return ring ? { ...held, error: `${held.error} ${ring.name} holds it: use_item with spell casts it from there, then cast it with this tool.`, retry: true } : held;
  }
  // A spell an invocation or the race casts, which no class list holds
  // (src/lib/srd/granted-casts.ts): its own slot rule, level and counter.
  const grant = input.ritual ? null : grantedCastOf(sheet, spell, facts, extras);
  // A free grant casts without a slot while a use is left; one the
  // character's own slots can cast too (issue #833) is paid with a slot once
  // its uses are spent, or when a higher level is named.
  // A free grant with limits of its own (Shapechanger: "targeting only
  // yourself and becoming a beast of challenge rating 1 or lower") pays only
  // for a casting inside them; outside them a slot pays, as the text's "you
  // can still cast it normally with a slot" says. Before this the free use
  // paid for a polymorph of an ally or into a giant ape.
  const outsideLimit = Boolean(grant?.freeLimit) && (input.freeFits === false || (Boolean(grant?.freeLimit?.selfOnly) && via === "enemy"));
  if (grant?.freeLimit && outsideLimit && !grant.slotsToo) {
    return { error: `${sheet.name} casts ${name} through ${grant.source} only ${grant.freeLimit.words}; this casting is not, and no spell slot of theirs casts it. Nothing was spent.`, refused: "rules" };
  }
  const grantFree = !outsideLimit && grantCastsFree(sheet, grant, facts, input.level);
  const grantNoSlot = grant?.slot === "free" && (grantFree || !grant.slotsToo);
  // The components as this caster makes them: none of the material for an
  // invocation that says so, an Archdruid's druid spells without the voice,
  // the gestures or a free material (cast-rules.ts componentsAsCast).
  // The Hand's spell cards ask castComponents too (hand-spells.ts).
  const made = castComponents(sheet, facts, grant, extras);
  // Sorcery points in place of the slot (Eyes of the Dark's Darkness, Psionic
  // Sorcery's spells: ar-ws-points-cast.ts says when they pay). A psionic
  // spell they pay for is cast with no component, so none is asked of it.
  const pointsOffer = input.ritual || input.storing ? null : pointsOfferFor(sheet, engine, facts, input.level);
  const byPoints = pointsPayFirst(campaign.id, sheet, pointsOffer, made, { inFight, units: input.units });
  const components = byPoints && pointsOffer?.bare ? { facts: bareFacts(facts), problem: null } : made;
  const castFacts = components.facts;
  const state = casterStateProblem(sheet);
  if (state) {
    return state;
  }
  const voice = components.problem ?? silenceProblem(campaign.id, sheet.id, sheet.name, castFacts) ?? antimagicProblem(campaign.id, sheet.id, sheet.name);
  if (voice) {
    return voice;
  }
  if (input.ritual && !completing) {
    const ritual = ritualProblem(sheet, spell, facts);
    if (ritual) {
      return ritual;
    }
  }
  // Every other tool resolves a spell's effect at once; a casting held across
  // turns is begun where the server can hold it, and that tool resolves it
  // when it is complete.
  if (holdRounds !== null && via !== "slot") {
    return { error: beginWithSlotTool(sheet.name, name, castingTimeWords(facts, Boolean(input.ritual))), retry: true };
  }
  // SRD 5.1 Path of the Zealot, Warrior of the Gods: "If a spell, such as
  // raise dead, has the sole effect of restoring you to life (but not
  // undeath), the caster doesn't need material components to cast that
  // spell on you."
  const material = input.revives && warriorOfTheGods(input.revives)
    ? ({ kind: "none" } as const)
    : materialPlan(sheet, castFacts, { inFight, units: input.units, slotLevel: input.level ?? facts?.level ?? null });
  if ("error" in material) {
    return material;
  }

  // A casting whose beams or targets come one call at a time: the later
  // calls of the same casting on the same turn spend nothing more. A slot
  // spent through use_spell_slot and then resolved by the tool that applies
  // the spell (the older way to call the tools) is one casting too.
  const shared = via !== "slot" && via !== "reaction";
  const liveBudget =
    inFight && shared
      ? budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions))
      : null;
  const open = liveBudget ? openCastOf(liveBudget, name) : null;
  if (open && liveBudget) {
    return continueOpenCast(encounter as Encounter, liveBudget, open, name, input);
  }
  // Arcane Deflection's price: no new casting but a cantrip until the end of
  // the wizard's next turn (ar-ws-deflection-mark.ts says what it lets by).
  const deflected = completing ? null : deflectionCastProblem(sheet, name, facts?.level);
  if (deflected) {
    return deflected;
  }

  // The casting Slow held back last turn, completed now for this turn's
  // action and no slot, at the slot it was cast from (slow-cast.ts).
  const slowHeld = input.ritual ? null : heldBySlow(sheet, name);
  // Signature Spells (wizard 20): the chosen 3rd level spells, once each per
  // short rest at 3rd level, spend their counter instead of a slot.
  const signature = input.ritual || slowHeld || byPoints ? null : signatureCounter(sheet, facts, input.level);
  // A feat's free cast (Fey Touched's misty step, Magic Initiate's spell)
  // spends its once-a-day counter instead of a slot while one is left
  // (src/lib/srd/feat-spells.ts); with the counter spent, a slot pays.
  const freeCast = input.ritual || signature || byPoints ? null : freeCastCounter(sheet, spell, facts, input.level);
  // A warlock's Mystic Arcanum pays for its own spell (counter-cast-arcanum.ts).
  const arcanum = input.ritual || signature || freeCast || slowHeld || byPoints ? null : arcanumCounter(sheet, facts, input.level);
  // Mantle of Majesty's Command costs no slot while the mantle holds.
  const mantled =
    !input.ritual && !signature && !freeCast && !byPoints && /^command$/i.test(engine.trim()) &&
    sheet.conditions.some((entry) => isConditionNamed(entry, MANTLE_OF_MAJESTY));
  // Read Thoughts: the Suggestion cast at the creature read costs no slot,
  // and casting it ends the reading (src/lib/dm/read-thoughts.ts).
  const readFree = !input.ritual && !signature && !freeCast && !mantled && isSuggestion(engine.trim()) && readsThoughts(sheet);
  // The race's grant pays only when nothing before it in the plan below
  // did: a Topaz fighter with Fey Touched casting misty step spends the
  // feat's free cast or the ancestry's use, never both (issue #833).
  const grantPaid = Boolean(grant) && grantNoSlot && !input.ritual && !slowHeld && !signature && !freeCast && !byPoints;
  // A reaction spell cast into a ring answers no trigger: it takes the action.
  const turnFacts = input.storing && facts?.castingTime === "reaction" ? { ...facts, castingTime: "action" as const } : facts;
  const planned: SlotPlan | ToolError = input.ritual
    ? { kind: "none", note: `${name} cast as a ritual: no slot spent.` }
    : slowHeld
      ? { kind: "none", note: `${name} completes the casting Slow held back: no slot spent.` }
    : byPoints && pointsOffer
      ? pointsPlan(sheet, name, pointsOffer)
    : signature
      ? { kind: "none", note: `${name} is a Signature Spell: cast at 3rd level with no slot, once until a short rest.` }
      : freeCast
        ? { kind: "none", note: `${name} is cast without a slot (a feat's free cast): once until a long rest.` }
        : arcanum
          ? { kind: "none", note: `${name} is cast as a Mystic Arcanum, with no spell slot: once until a long rest.` }
        : grant && grantPaid
          ? { kind: "none", note: `${name} is cast through ${grant.source} with no spell slot${grant.counter ? `: ${(grant.uses ?? 1) === 1 ? "once" : `${grant.uses} times`}, and again after a ${grant.rest ?? "long"} rest` : ", at will"}${grant.castAt ? `, as a level ${grant.castAt} spell` : ""}.` }
        : mantled
          ? { kind: "none", note: `${name} is cast through Mantle of Majesty: no slot spent.` }
        : readFree
          ? { kind: "none", note: `${name} is cast through Read Thoughts: no slot spent, and the reading ends.` }
        : // A slot the player marked spent by hand for this cast pays for it;
          // a casting begun now leaves the mark for its completion.
          paidByManualTick(sheet, slotPlan(sheet, spell, facts, input.level), input.level ?? facts?.level, facts?.level, Boolean(input.dryRun) || holdRounds !== null);
  // With no slot that can pay, the sorcery points do (ar-ws-points-cast.ts).
  const lastResort = pointsWhenNoSlot(sheet, name, slowHeld ? null : pointsOffer, planned);
  const slot = lastResort.slot;
  const pointsPaid = !slowHeld && pointsOffer && (byPoints || lastResort.paid) ? pointsOffer : null;
  if ("error" in slot) {
    // A cast the turn cannot pay for is refused for that first: which slot
    // to spend is moot when the action is gone. A completing casting paid
    // for its turns already.
    const barred = completing ? null : planTurn(sheet, encounter, turnFacts, spell, input.level ?? facts?.level ?? null, via);
    return barred && "error" in barred ? barred : slot;
  }
  // Infernal Legacy's hellish rebuke is cast as a 2nd-level spell, with no slot.
  const slotLevel = slowHeld ? slowHeld.slotLevel : slot.kind === "none" ? (pointsPaid ? pointsPaid.level : grantPaid ? grant?.castAt ?? null : null) : slot.level;
  // A ritual out of a fight costs no turn; in one it is begun with the
  // action like any casting held across turns, and a completing casting
  // costs no action at all.
  const turn = completing ? ({ kind: "free" } as const) : planTurn(sheet, encounter, turnFacts, spell, slotLevel, via);
  if ("error" in turn) {
    return turn;
  }
  // A square named for the spell's area is within its range, with a clear
  // path to it (zone-cast.ts): asked of the dry run too, so the Hand's card
  // and a spell tool's own check say no before anything is spent.
  if (input.at && (via === "slot" || via === "buff")) {
    const placed = placementReachProblem(campaign, { casterId: sheet.id, casterName: sheet.name, spell: name, runsAs: facts?.runsAs, facts, at: input.at });
    if (placed) {
      return placed;
    }
  }
  const storeLevel = slotLevel ?? facts?.level ?? input.level ?? 0;
  if (input.storing) {
    const noRoom = storeRefusal(input.storing.holderId, input.storing.ring, name, storeLevel);
    if (noRoom) {
      return noRoom;
    }
  }
  // Awakened Spellbook: the damage type asked for, when the book allows it.
  const swapped = awakenedDamageType(sheet, { spell: name, asked: input.swapType, own: mech?.damageType, second: mech?.secondType, level: facts?.level ?? null, slotLevel, slotPaid: slot.kind !== "none", authors });
  if (swapped && "error" in swapped) {
    return swapped;
  }
  if (input.dryRun) {
    return { ok: true, dryRun: true, spell: name, slotLevel, ...(swapped ? { damageType: swapped.type } : {}) };
  }
  // The casting begins with this turn's action and nothing else is spent
  // (long-casting.ts holds it from here).
  if (holdRounds !== null && encounter) {
    if (swift) {
      spendSwiftRitual(campaign, sheet.id);
    }
    const spent = turn.kind === "budget" ? { budget: turn.budget, ...(turn.note ? { note: turn.note } : {}) } : null;
    return beginHeldCasting(campaign, turnId, sheet, encounter, spent, { name, facts, slotLevel, ritual: Boolean(input.ritual), rounds: holdRounds, ...(input.storing ? { storing: input.storing } : {}) });
  }

  // ---- the spend: nothing below refuses ----
  const result: CastResult = { ok: true, spell: name, slotLevel, slot: slotLine(slot) };
  if (swapped) {
    result.damageType = swapped.type;
    result.awakenedSpellbook = `${name} deals ${swapped.type} damage in place of ${mech?.damageType}: the type of ${swapped.from}, a spell of the slot's level in the book.`;
  }
  // What the server leaves to the DM of this spell (src/lib/srd/spell-support.ts).
  const manual = input.storing ? null : spellSupportLine(name);
  if (manual) {
    result.manual = manual;
  }
  const patch: FullPatchSheetInput = {};
  if (slot.kind !== "none") {
    patch.spellcasting = spellcastingAfter(sheet, slot);
  }
  Object.assign(patch, materialPatch(sheet, material, result));
  if (readFree) {
    const cleared = removeConditions(patch.conditions ?? sheet.conditions, (patch.conditionMeta ?? sheet.conditionMeta) as ConditionMetaMap, [READING_THOUGHTS]);
    patch.conditions = cleared.conditions;
    patch.conditionMeta = cleared.meta as FullPatchSheetInput["conditionMeta"];
  }
  if (signature) {
    patch.resources = spendSignature(sheet.resources, signature);
  }
  if (freeCast) {
    patch.resources = spendSignature(sheet.resources, freeCast);
  }
  if (arcanum) {
    patch.resources = spendSignature(patch.resources ?? sheet.resources, arcanum);
  }
  if (pointsPaid) {
    patch.resources = pointsSpent(sheet, patch, pointsPaid);
  }
  // The grant's use (Thief of Five Fates' with its slot, Infernal Legacy's
  // without one). A cast a slot paid for, its free uses spent, spends none.
  if (grant?.counter && ((grant.slot === "slot" && slot.kind !== "none") || (grantPaid && grantFree))) {
    patch.resources = spendGrantUse(patch.resources ?? sheet.resources, grant);
  }
  // Said only of a grant that paid, or of a slot that paid in its place.
  if (grant && (grantPaid || slot.kind !== "none")) {
    result.granted =
      grant.slot === "free" && !grantPaid
        ? `${name} is cast with a spell slot; ${grant.source} gives it without one${grant.counter ? `, ${(grant.uses ?? 1) === 1 ? "once" : `${grant.uses} times`} a ${grant.rest ?? "long"} rest` : ""}.`
        : `${name} is cast through ${grant.source}.${grant.note ? ` ${grant.note}` : ""}`;
  }
  // Expert Divination (School of Divination 6): a divination spell of 2nd
  // level or higher cast with a slot gives back one spent slot of a lower
  // level, 5th at most.
  const refund =
    slot.kind !== "none" && patch.spellcasting ? authoredSlotRefund(sheet, { school: spellSchoolFor(spell, authors), slotLevel }, patch.spellcasting.slots) : null;
  if (refund && patch.spellcasting) {
    const slots = patch.spellcasting.slots;
    const row = slots[String(refund.level)];
    patch.spellcasting = { ...patch.spellcasting, slots: { ...slots, [String(refund.level)]: { ...row, used: row.used - 1 } } };
    result.slotRefund = `${refund.feature}: a spent level ${refund.level} slot comes back.`;
  }
  // A counter a casting of this school gives back (Benign Transposition on a
  // conjuration spell of 1st level or higher: ar-ws-transposition.ts).
  const refilled = input.storing ? null : castRefills(patch.resources ?? sheet.resources, { school: spellSchoolFor(spell, authors), level: facts?.level ?? slotLevel ?? 0 });
  if (refilled) {
    patch.resources = refilled.resources;
    result.refilled = refilled.notes.join(" ");
  }
  // Lunar Boons: the Metamagic paid for this spell costs 1 sorcery point less
  // when the spell is of the phase's schools (src/lib/dm/ar-ws-lunar-boons.ts).
  const boon = input.storing ? null : boonAtCast(campaign.id, sheet, patch, spellSchoolFor(spell, authors));
  if (boon) {
    Object.assign(patch, boon.patch);
    if (boon.note) {
      result.lunarBoons = boon.note;
    }
  }
  // Wild Magic Surge: after a sorcerer spell of 1st level or higher the GM may
  // have the sorcerer roll on the surge table, and a spent Tides of Chaos then
  // comes back. The mark lasts the round; the GM's use_resource spends it.
  // The chance is every such casting's, Tides of Chaos spent or not
  // (src/lib/dm/ar-ws-wild-surge.ts surgeChanceAfter says which).
  const surgeLine = input.storing ? null : surgeChanceAfter(sheet, facts);
  if (surgeLine) {
    const held = (patch.conditions ?? sheet.conditions).filter((entry) => !isConditionNamed(entry, SURGE_CHANCE));
    patch.conditions = [...held, SURGE_CHANCE];
    patch.conditionMeta = { ...((patch.conditionMeta ?? sheet.conditionMeta) as ConditionMetaMap), [SURGE_CHANCE]: { rounds: 1 } };
    result.wildMagicSurge = surgeLine;
  }
  // Cast from their own slots now: an item's numbers for it are over.
  const freed = input.storing ? null : equipmentWithoutRunning(patch.equipment ?? sheet.equipment, name);
  if (freed) {
    patch.equipment = freed;
  }
  if (Object.keys(patch).length) {
    patchSheet(sheet.id, patch);
    hooks.record(
      {
        spell: name,
        ...(slot.kind !== "none" ? { level: slot.level, used: slot.state.used, max: slot.state.max } : {}),
        ...(input.ritual ? { ritual: true } : {}),
        ...(signature ? { signature, level: 3 } : {}),
        ...(freeCast ? { freeCast } : {}),
        ...(pointsPaid ? { sorceryPoints: pointsPaid.points, through: pointsPaid.feature } : {}),
        ...(grant ? { granted: grant.source } : {}),
      },
      patch,
    );
    hooks.publish();
  }
  if (completing) {
    clearCompletedCasting(campaign, sheet.id);
    result.completed = `${name}'s casting is complete and it takes effect now; it costs no action.`;
  }

  // Twinned Spell paid for this spell (mt-srd-metamagic.ts): its price is
  // settled against the level it is cast at, and an eligible spell takes one
  // more creature. An area, and a casting that already takes several, do not.
  const ownShares = castShares(mech, { spellLevel: facts?.level ?? slotLevel ?? 0, slotLevel, casterLevel: sheet.level });
  const twin = input.storing ? null : settleTwin(campaign, sheet.id, name, { facts, shares: via === "aoe" ? Math.max(2, ownShares) : ownShares, slotLevel });
  if (twin) {
    result.metamagic = twin.note;
  }
  if (turn.kind === "budget" && encounter) {
    let budget = turn.budget;
    // aoe_damage resolves every creature in the area in its one call, so
    // nothing of the casting is left open for a second call to reuse.
    const shares = via === "aoe" ? 1 : ownShares + (twin?.extra ?? 0);
    // use_spell_slot resolves nothing itself, so every share is still to come.
    const uses = Math.max(1, Math.min(shares, Math.floor(input.uses ?? 1)));
    const left = via === "slot" ? shares : shares - uses;
    if (left > 0) {
      budget = withOpenCast(budget, { spell: name, slotLevel, left });
    }
    result.sharesLeft = left;
    result.uses = uses;
    if (shares > 1) {
      const list = mech?.attacks ? "pc_attack's attacks" : mech?.resolution === "heal" ? "heal's targets" : "cast_at_enemy's targets";
      result.shares = `${name} holds ${shares} ${mech?.attacks ? "attack rolls" : mech?.darts ? "darts" : "targets"} from this one casting; ${left} left this turn at no further cost, each its own entry in ${list}.`;
    }
    storeBudget(encounter, budget);
    result.cost = turn.cost === "bonus action" ? "their bonus action" : "their action";
    if (turn.note) {
      result.costNote = turn.note;
    }
  } else if (turn.kind === "reaction" && encounter) {
    if (turn.budget) {
      encounter.turnBudget = turn.budget;
    }
    markReactionUsed(encounter, sheet.id);
    result.cost = "their reaction";
  } else if (turn.kind === "mark" && encounter) {
    storeBudget(encounter, turn.budget);
  }

  if (slowHeld) {
    markSlowedCast(campaign.id, sheet.id, null);
  } else if (
    inFight && !input.ritual && facts?.castingTime === "action" && turn.kind === "budget" &&
    conditionTurnShape(sheet.conditions).slowed && slowHoldsCast(campaign, sheet, name)
  ) {
    // Slow: paid for, and nothing happens until the caster's next turn.
    markSlowedCast(campaign.id, sheet.id, { spell: name, slotLevel });
    return {
      error: `Slow holds ${name} back (the d20 came up 11 or higher): the slot and this turn's action are spent and the spell does not take effect yet. On ${sheet.name}'s next turn, cast it again with its tool to complete it: that spends their action and no slot. If they do not, the spell is wasted. Do not resolve it now.`,
      refused: "rules",
    };
  }

  // A monster whose block lists Counterspell answers a spell cast at its
  // side, after the slot and the action are spent (enemy-reactions.ts).
  if (inFight && encounter && slotLevel && !input.ritual && (via === "enemy" || via === "aoe" || via === "attack")) {
    const answered = enemyCounterspell(campaign.id, null, encounter, sheet, name, slotLevel);
    if (answered?.countered) {
      // A countered casting holds nothing more: no ray, dart or target of it
      // is left for a later call.
      const open = encounter.turnBudget ? openCastOf(encounter.turnBudget, name) : null;
      if (open && encounter.turnBudget) {
        storeBudget(encounter, withOpenCast(encounter.turnBudget, { ...open, left: 0 }));
      }
      return { error: answered.note, refused: "rules", countered: true, slotSpent: result.slot };
    }
    if (answered) {
      result.counterspell = answered.note;
    }
  }

  // A completing casting's time went by in the fight's rounds, not on the clock.
  if (input.ritual && !completing) {
    // Ten minutes longer than the spell's own casting time, unless Awakened
    // Spellbook's use of the day sped it.
    const minutes = (swift ? 0 : 10) + (typeof facts?.castingTime === "number" ? facts.castingTime : 0);
    if (minutes > 0) {
      advanceClock(campaign.id, minutes, "minutes");
    }
    result.note = swift
      ? `${name} cast as a ritual: no slot spent. ${spendSwiftRitual(campaign, sheet.id)}${minutes > 0 ? ` ${minutes} minutes of casting; the clock moved on.` : ""}`
      : `${name} cast as a ritual: ${minutes} minutes of casting, no slot spent. The clock moved on.`;
  } else if (typeof facts?.castingTime === "number" && !completing) {
    advanceClock(campaign.id, facts.castingTime, "minutes");
    result.castingTime = `${describeCastingTime(facts.castingTime)} of casting; the clock moved on.`;
  }

  // Transmuter's Stone: a transmutation spell of 1st level or higher opens one
  // change of the stone's benefit, laid now that the casting's own time has
  // gone by (ar-ws-stone.ts).
  const stoneChange = input.storing ? null : openStoneChange(campaign, sheet.id, { school: spellSchoolFor(spell, authors), level: facts?.level ?? slotLevel ?? 0 });
  if (stoneChange) {
    result.stoneChange = stoneChange;
  }

  const concentrates = !input.storing && (input.concentration === true || facts?.concentration === true);
  if (concentrates) {
    // The first spell ends, and with it every effect it held in place: an
    // earlier casting of this same spell too.
    const { displaced, failedCasting } = setConcentration(campaign, turnId, sheet.id, name, slotLevel);
    result.concentration = true;
    if (displaced) {
      result.droppedConcentration = failedCasting ? failLine(sheet.name, failedCasting, `${name} took the concentration`) : droppedLine(displaced, name);
    }
  }
  if (input.storing) {
    putInRing(campaign, turnId, input.storing.holderId, input.storing.ring, { spell: name, level: storeLevel, ...casterNumbers(sheet, name), by: sheet.name });
  }
  // Contact Other Plane's toll on its caster (spell-self.ts).
  Object.assign(result, casterCost(campaign, sheet, engine, name));
  // An abjurer's Arcane Ward rises or recovers with an abjuration spell (arcane-ward.ts).
  Object.assign(result, wardOnCast(campaign, sheet.id, spellSchoolFor(name, authors), slotLevel ?? (facts?.level || null)));
  // Grasping Tentacles: casting the guarded spell gives temporary hit points
  // (src/lib/dm/authored-spells.ts).
  const guardedCast = castTempHp(campaign, sheet, engine, name);
  if (guardedCast) {
    result.subclassFeature = guardedCast;
  }
  // Casting a spell ends Invisibility (src/lib/dm/attack-marks.ts), and one
  // cast at an enemy ends Sanctuary (src/lib/dm/spell-defenses.ts).
  endInvisibilityOnCast(campaign.id, sheet.id);
  // The Metamagic paid for this spell is used (mt-srd-metamagic.ts).
  clearCastMarks(campaign, sheet.id, via === "enemy" || via === "aoe" || via === "attack");
  if (via === "enemy" || via === "aoe" || via === "attack") {
    endSanctuaryOnHarm(campaign.id, sheet.id);
  }
  // Heart of the Storm: a lightning or thunder spell sets the caster's storm
  // off, once for the casting (ar-ws-heart-storm.ts).
  if (!input.storing) {
    Object.assign(result, eruptOnCast(campaign, turnId, sheet, { spell: name, level: facts?.level ?? slotLevel ?? 0, types: [mech?.damageType, mech?.secondType] }));
  }
  // Its area on the board; aoe_damage and cast_at_enemy lay theirs after the saves.
  const zone =!input.storing && (via === "slot" || via === "buff") ? placeSpellZone(campaign, { spell: name, runsAs: facts?.runsAs, caster: { kind: "pc", id: sheet.id, name: sheet.name }, slotLevel, dc: spellSaveDcFor(sheet, name), at: input.at, toward: input.toward, named: Boolean(input.at), ...(pointsPaid?.seesThrough ? { seenThroughBy: sheet.id } : {}) }) : null;
  return zone ? { ...result, area: zone } : result;
}

// A casting the server held completes through this door as its rounds run
// out (long-casting.ts finishCasting), written to the audit trail and the
// sheet's stream as every cast is. Registered, not imported there: the
// clock reaches long-casting.ts, and this module reaches the clock.
registerCastingCompletion((campaign, sheetId, spell) => {
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return { error: "The caster is no longer at the table.", refused: "rules" };
  }
  return castSpell(campaign, null, sheet, { spell, via: "slot" }, {
    record: (delta, patch) => {
      const entry = insertSheetAudit({
        campaignId: campaign.id,
        characterId: sheet.id,
        turnId: null,
        kind: "use_spell_slot",
        delta,
        reason: `the casting of ${spell} is complete`,
        seq: allocateSeq(campaign.id),
        before: sheet,
        patch,
      });
      publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
    },
    publish: () => {
      const updated = patchSheet(sheet.id, {});
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
    },
  });
});

// A dead zealot a spell returns to life asks no material of its caster.
function warriorOfTheGods(revivedId: string): boolean {
  const revived = getSheetById(revivedId);
  return Boolean(revived?.deathSaves?.dead && holdsFeature(revived, "Warrior of the Gods"));
}
