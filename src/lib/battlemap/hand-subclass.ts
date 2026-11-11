// The subclass features the authored layer resolves (src/lib/srd/authored-
// effects.ts), as the Hand and the sheet offer them: each spend a card
// played with use_resource by the feature's own name (Kensei's Shot, Shadow
// Step, Psychic Blades...), Intimidating Presence aimed at a creature, and the
// once-chosen options (Totem Spirit, Aspect of the Beast...) as a pick on the
// sheet. Each card carries the engine's own gate and pool, so a card is never
// offered for a spend use_resource would refuse for want of the feature.
//
// Pure; scripts/test-hand-engine.mjs drives it.
import { attunedItems } from "@/lib/dm/soul-of-artifice";
import { SNEAK_HIT, WEAPON_HIT } from "@/lib/dm/action-budget";
import { DIVINE_SMITE_LANDED } from "@/lib/dm/divine-marks";
import { heldFlames } from "@/lib/dm/cauterizing-flames-logic";
import { NATURAL_HIT, chargedFeet } from "@/lib/srd/mt-fb-run";
import { pendingSurge, surgeOf } from "@/lib/srd/mt-fb-surge-state";
import { BOW_HIT, NO_ROLL, shotsKnown } from "@/lib/srd/mt-fb-arcane-shot";
import { spellHurt } from "@/lib/dm/spell-damage-logic";
import { chaosFaces, WILD_SURGE_TABLE } from "@/lib/srd/ar-ws-wild-surge-table";
import { castFirstReason, levelledCastThisTurn } from "@/lib/dm/ar-ws-tempest-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { authoredSpendFor, gateHolds, heldAuthored, resolveFormula, type AuthoredSpend, type HeldAuthored } from "@/lib/srd/authored-effects";
import { resourceDef, resourceName, type ResourceDef } from "@/lib/srd/class-resources";
import { otherPrice } from "@/lib/srd/counter-rules";
import type { SpendAction } from "@/lib/srd/authored-effects-types";
import { holdsFeature } from "@/lib/srd/trait-rules";
import {
  CHOSEN_CREATURES,
  costGate,
  gated,
  primaryClass,
  standingGate,
  type Gate,
  type HandBoardFacts,
  type HandCard,
  type HandCost,
  type HandShares,
  type HandTarget,
  type HandTurn,
  failedSaveGate,
} from "@/lib/battlemap/hand-core";
import { mrCardGate } from "@/lib/battlemap/mt-mr-hand";
import { textKey } from "@/lib/language/text-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { iconPath, isPainted } from "@/lib/icons";
import { inFightOf } from "@/lib/battlemap/hand-counters";
import { TRIGGERED_COUNTERS } from "@/lib/srd/trigger-table";
import { dealtByTrigger } from "@/lib/battlemap/hand-react-triggers";
import { taleAimsAt } from "@/lib/srd/spirit-tales-table";

type SpendDoes = AuthoredSpend["does"];

const COST: Record<string, HandCost> = { action: "action", bonus: "bonus", reaction: "reaction", none: "free" };

// A variant's word as a pick reads on a card: "bear" as "Bear".
export const pickLabel = (value: string) => value.replace(/^./, (c) => c.toUpperCase());

function targetOf(does: SpendDoes): HandTarget {
  if (does.kind === "buff") {
    // A quarry (Hexblade's Curse) marks a creature, and the engine asks which.
    return does.target === "enemy" || does.quarry ? "enemy" : does.target === "ally" || does.target === "creature" ? "ally" : "self";
  }
  if (does.kind === "save_effect" || does.kind === "insight_contest" || does.kind === "die_damage") return "enemy";
  // A spirit tale is told at a foe, or at a friend for one that heals: the
  // tale held decides, read in spendCards (spirit-tales-table.ts taleAimsAt).
  if (does.kind === "release_tale") return "enemy";
  // The creatures of the player's choice: aimed at one, the others added.
  if (does.kind === "save_area" && does.chosen) return "enemy";
  // The creature the hit landed on (Blade Flourish, Gathered Swarm's push),
  // and the creatures an area report rolls for (counter-saves.ts): the
  // engine asks for targetEnemyId, which a card aimed at nothing never sent.
  if (does.kind === "flourish" || does.kind === "swarm_push" || does.kind === "aoe_report") return "enemy";
  // A heal only (an Experimental Elixir's healing) goes to the creature fed it.
  if (does.kind === "flames" && does.healOnly) return "ally";
  // A slot given back to the creature touched (Bolstering Magic).
  if (does.kind === "regain_slot") return "ally";
  // The creature Hunter's Sense reads (authored-spend-divine.ts).
  if (does.kind === "reveal_defenses") return "enemy";
  // The ally Inspiring Smite shares its temporary hit points with.
  if (does.kind === "smite_temp_hp") return "ally";
  // The creature whose armor or weapon Blessing of the Forge blesses.
  if (does.kind === "forge_blessing") return "ally";
  // The creature standing in a spectral flame: healed or burned.
  if (does.kind === "cauterizing") return does.mode === "heal" ? "ally" : "enemy";
  // The creature whose thoughts Read Thoughts reads (authored-spend-divine-clr.ts).
  if (does.kind === "read_thoughts") return "enemy";
  // A monk's or a rogue's own spend says who it is aimed at.
  if (does.kind === "mr") return does.aims ?? "none";
  // The creature warded (Bastion of Law), the holder or an ally in reach.
  if (does.kind === "damage_ward") return "ally";
  // The charmed creature whose memory Alter Memories reaches (ar-ws-alter-memories.ts).
  if (does.kind === "strip_memory") return "enemy";
  return "none";
}

// A save whose failure makes the creature attack another of the holder's
// choice (Infectious Fury: src/lib/dm/mt-fb-spend.ts forcedStrikePlan): the
// card is aimed at the creature that saves and takes the one it attacks as
// a second creature, sent with it in targetEnemyIds.
const forcedVictim = (does: SpendDoes) => does.kind === "save_effect" && Boolean(does.strikes);
const VICTIM: HandShares = { count: 2, unit: "creature", stack: false, min: 2, attacks: true };

// The kinds the engine resolves only on a creature in a fight.
const FIGHT_ONLY = new Set<SpendDoes["kind"]>(["save_effect", "die_damage", "flourish", "swarm_push", "insight_contest", "reveal_defenses", "strip_memory"]);

// The option an aim plays, or the spend's own.
function aimDoes(does: SpendDoes, variant: string | undefined): SpendDoes {
  return does.kind === "variants" && variant ? (does.options[variant]?.does ?? does) : does;
}

// A spend aimed at a creature the holder must see (its row's sight flag), which
// the engine refuses while they are blinded. One that takes the allies it sees
// (Watcher's Will) leaves the unseen out instead, so it stays open.
function sightBound(does: SpendDoes): boolean {
  if (!("sight" in does) || !does.sight) return false;
  // The creatures of the player's choice that they can see (Champion
  // Challenge): a blinded holder sees none, and the engine finds nothing in reach.
  if (does.kind === "save_area") return Boolean(does.chosen) && does.sight === true;
  return does.kind === "save_effect" || does.kind === "reveal_defenses" || (does.kind === "buff" && (does.target === "enemy" || Boolean(does.quarry)));
}

// The sight a card aimed at a foe carries (HandCard.sight): the spend's own
// flag, which use_resource reads (authored-spend-effects.ts unseenBecause),
// for one creature (sightBound) or the creatures of the player's choice an
// area takes (Champion Challenge leaves the unseen out of its reach).
function sightOf(does: SpendDoes, target: HandTarget): Pick<HandCard, "sight"> {
  if (target !== "enemy" || !("sight" in does) || !does.sight) return {};
  // A "seesHolder" area of the player's choice (Charm Animals and Plants) is
  // not shut by a blinded holder, but its chips still follow the board.
  if (!sightBound(does) && !(does.kind === "save_area" && does.chosen)) return {};
  return { sight: does.sight === "seesHolder" ? "seesHolder" : true };
}

// The reach a spend holds its creatures to, printed on the card.
function reachOf(does: SpendDoes): string {
  // Options aimed alike share one card, which says the widest reach.
  const feet = does.kind === "variants"
    ? Math.max(0, ...Object.values(does.options).map((option) => ("rangeFt" in option.does && typeof option.does.rangeFt === "number" ? option.does.rangeFt : 0))) || null
    : "rangeFt" in does && typeof does.rangeFt === "number" ? does.rangeFt : null;
  return feet ? `${feet} ft` : "";
}

function linesOf(does: SpendDoes): { dice: string; condition: string } {
  switch (does.kind) {
    case "buff":
      // A buff with variants names none on its face: the player picks.
      if (does.variants) return { dice: "", condition: "" };
      return { dice: typeof does.condition === "string" ? does.condition : does.condition[0]?.[1] ?? "", condition: typeof does.condition === "string" ? does.condition : "" };
    case "save_effect":
    case "save_area":
    case "aoe_report":
      return { dice: `${does.save.toUpperCase()} save`, condition: "condition" in does ? (does.condition ?? "") : "" };
    case "temp_hp":
      return { dice: "temp hp", condition: "" };
    case "teleport":
      return { dice: `${does.feet} ft`, condition: "" };
    case "die_damage":
      return { dice: `+${typeof does.dice === "string" ? does.dice : "dice"} ${does.type}`, condition: "" };
    default:
      return { dice: "", condition: "" };
  }
}

// Whether a spend is played from the Hand as its own card: subclassSpendCards
// deals it, and hand-spells.ts featureCards leaves its counter to this card, so
// the card carries the spend's name, target and gate. A counter's own card sent
// its id and no target, and a capstone spent its use for nothing.
export function playedAsSpendCard(sheet: CharacterSheet, name: string): boolean {
  const found = authoredSpendFor(sheet, name);
  if (!found) return false;
  const { spend, held } = found;
  return spend.fight !== "out" && spend.does.kind !== "choose" && (spendAction(spend) !== "reaction" || aimedReaction(spend)) && !triggeredSpend(spend) && gateHolds(spend.gate, sheet, held);
}

// A spend paid from a counter trigger-table.ts holds (authored-spends.ts
// answers its record before anything is spent).
function triggeredSpend(spend: AuthoredSpend): boolean {
  return Boolean(spend.pool && TRIGGERED_COUNTERS.includes(spend.pool.id));
}

// A reaction that heals one creature or burns another (Cauterizing Flames): one
// card per aim, as Arcane Jolt has. As one plain reaction card it sent neither
// the pick nor a target, and the engine refused it every time.
function aimedReaction(spend: AuthoredSpend): boolean {
  // Cauterizing Flames' heal or burn, each aimed at the creature in a flame.
  const options = spend.does.kind === "variants" ? Object.values(spend.does.options) : [];
  return spendAction(spend) === "reaction" && (spend.does.kind === "flames" || (options.length > 0 && options.every((option) => option.does.kind === "cauterizing")));
}

// The turn's cost as the engine charges it (authored-spends.ts prepareCost):
// the spend's own, else its same-named counter's; a spend that names none
// costs nothing of the turn (Arcane Jolt rides the hit, Psychic Blades the
// attack), and one with variants is priced by the variant played.
function spendAction(spend: AuthoredSpend): SpendAction | NonNullable<ResourceDef["action"]> {
  return spend.action ?? ownCounter(spend)?.action ?? (spend.does.kind === "variants" ? "action" : "none");
}

// The counter of a spend's own name (Elder Champion's sub_elder_champion),
// or null for a spend paid from a shared pool (ki, Bardic Inspiration).
function ownCounter(spend: AuthoredSpend) {
  const own = spend.pool ? resourceDef(spend.pool.id) : null;
  return own?.displayName === spend.name ? own : null;
}

// One card per spend the character holds that is played in a fight. `taken`
// names the cards dealt before these (a spend with a counter of its own name
// is dealt where that counter's card sat, counterSpendCards) so none shows
// twice.
export function subclassSpendCards(sheet: CharacterSheet, turn: HandTurn, taken: Set<string>, board?: HandBoardFacts): HandCard[] {
  const cards: HandCard[] = [];
  for (const held of heldAuthored(sheet)) {
    for (const spend of held.entry.spends ?? []) {
      if (taken.has(textKey(spend.name))) continue;
      const dealt = spendCards(sheet, turn, held, spend, board);
      if (dealt.length) taken.add(textKey(spend.name));
      cards.push(...dealt);
    }
  }
  return cards;
}

// The cards of the spend a counter of its own name stands for, dealt in the
// counter's place among the feature cards (hand-spells.ts featureCards): dealt
// after every other feature, a level 20 paladin's capstone went behind More.
export function counterSpendCards(sheet: CharacterSheet, turn: HandTurn, name: string): HandCard[] {
  const found = authoredSpendFor(sheet, name);
  return found ? spendCards(sheet, turn, found.held, found.spend) : [];
}

// The ways a spend aims, each its own card: one, or for a spend that either
// burns a creature or heals one (Arcane Jolt: "either deal an extra 2d6 force
// damage to the target, or ... restores a number of hit points equal to 2d6"),
// one at an enemy and one at an ally, so each posts the target it needs.
// `key`: what tells two aims of one spend apart on the card's id when no variant does.
type Aim = { variant?: string; key?: string; label?: string; target: HandTarget; dice: string; heals: boolean; afterWeaponHit?: boolean; action?: SpendAction; reach?: string };

function aimsOf(does: SpendDoes, level: number, mods: Record<string, number>): Aim[] {
  if (does.kind === "flames") {
    const dice = resolveFormula(does.formula, level, mods);
    const heal = { variant: "heal", label: "healing", target: "ally" as const, dice: `heals ${dice}`, heals: true };
    return does.healOnly ? [{ ...heal, variant: undefined, label: undefined }] : [{ variant: "burn", label: does.type, target: "enemy", dice: `+${dice} ${does.type}`, heals: false }, heal];
  }
  // Turn the Tide, Balm of Peace: every hurt ally in reach, with no aim.
  if (does.kind === "heal_area") {
    return [{ target: "none", dice: `heals ${resolveFormula(does.formula, level, mods)}`, heals: true }];
  }
  // Options aimed differently (Telekinetic Adept's thrust at the creature
  // hit, its leap at the psi warrior): one card each, so each sends its aim.
  if (does.kind === "variants") {
    const options = Object.entries(does.options);
    // Cauterizing Flames: its fire card and its healing card, worded as the
    // flames the druid raises (cauterizing-flames.ts).
    if (options.length && options.every(([, option]) => option.does.kind === "cauterizing")) {
      return options.flatMap(([variant, option]): Aim[] => {
        const flame = option.does;
        if (flame.kind !== "cauterizing") return [];
        const dice = resolveFormula(flame.formula, level, mods);
        return flame.mode === "heal"
          ? [{ variant, label: "healing", target: "ally" as const, dice: `heals ${dice}`, heals: true }]
          : [{ variant, label: flame.type, target: "enemy" as const, dice: `${dice} ${flame.type}`, heals: false }];
      });
    }
    const targets = new Set(options.map(([, option]) => targetOf(option.does)));
    // An option whose creature then attacks another (Infectious Fury) is its
    // own card, which takes that second creature as a pick (forcedVictim).
    if (targets.size > 1 || options.some(([, option]) => forcedVictim(option.does))) {
      return options.map(([variant, option]) => ({ variant, label: pickLabel(variant), target: targetOf(option.does), dice: linesOf(option.does).dice, heals: false, afterWeaponHit: option.afterWeaponHit, action: option.action, reach: reachOf(option.does) }));
    }
  }
  const lines = linesOf(does);
  // A creature of either side (Adjust Density, src/lib/dm/ar-ws-buff-aim.ts):
  // one card at an ally or the holder, one at a foe, so each posts the target
  // the engine reads for it.
  if (does.kind === "buff" && does.target === "creature") {
    return [{ target: "ally", dice: lines.dice, heals: false }, { key: "foe", label: "foe", target: "enemy", dice: lines.dice, heals: false }];
  }
  return [{ target: targetOf(does), dice: lines.dice, heals: false }];
}

function spendCards(sheet: CharacterSheet, turn: HandTurn, held: HeldAuthored, spend: AuthoredSpend, board?: HandBoardFacts): HandCard[] {
  const does = spend.does;
  // The counter of this spend's own name. Its card's id, cost and uses line
  // carry over, so a seat the player arranged holds and Hidden Paths, whose
  // variants price themselves, stays a bonus action.
  const counter = ownCounter(spend);
  const action = spendAction(spend);
  // A spend that answers a record (Master of Hexes after the cursed creature's
  // death) is dealt by the trigger cards when it is open (hand-react-triggers.ts).
  if (spend.gm || spend.fight === "out" || does.kind === "choose" || (action === "reaction" && !aimedReaction(spend)) || !gateHolds(spend.gate, sheet, held) || dealtByTrigger(spend.name)) return [];
  // A spend whose counter waits on a trigger (Call the Hunt's rage just
  // entered) is dealt when the trigger opens (hand-react-triggers.ts), never
  // on the holder's own turn: the engine refuses it until then.
  if (triggeredSpend(spend)) return [];
  const cost = COST[action] ?? "action";
  const pool = spend.pool;
  const state = pool ? sheet.resources[pool.id] : undefined;
  const left = state ? state.max - state.used : null;
  const lines = linesOf(does);
  const perUnit = Boolean(pool?.perUnit);
  const need = pool?.optional ? 0 : pool?.amount ?? 1;
  const poolGate: Gate =
    // The other price the counter's row names still pays (counter-rules.ts
    // otherPrice), as authored-spends.ts charges it.
    state && left !== null && left < need && !perUnit && !(pool && ownOtherPrice(pool.id, sheet))
      ? {
          // A counter of the spend's own name is its uses, not a raw id.
          reason: counter
            ? `${spend.name} has no use left (${left}/${state!.max}). It comes back after a rest.`
            : `${spend.name} needs ${need} and ${sheet.name} has ${left} ${resourceName(pool!.id)} left. It comes back after a rest.`,
          spent: true,
        }
      : null;
  // A variant a chosen option fixes (Lunar Phenomenon's phase) is the one card.
  const fixed = spend.variantFrom ? (heldAuthored(sheet).find((entry) => textKey(entry.feature) === textKey(spend.variantFrom!))?.choice ?? null) : null;
  const aims = aimsOf(does, held.level, computeSheetDerived(sheet).abilityMods)
    .filter((aim) => !fixed || !aim.variant || textKey(aim.variant) === textKey(fixed))
    // Release Tale aimed at a foe sent a healing tale's friend as the goblin,
    // and the engine refused it: the tale held says which side it is told at.
    .map((aim) => (does.kind === "release_tale" ? { ...aim, target: taleAimsAt(sheet) } : aim));
  return aims.map((aim) => {
    const aimCost = aim.action ? (COST[aim.action] ?? cost) : cost;
    const card: HandCard = {
      id: `${counter ? `feature:${counter.id}` : `feature:authored:${textKey(spend.name).replace(/\s+/g, "-")}`}${(aim.variant ?? aim.key) && aims.length > 1 ? `:${aim.variant ?? aim.key}` : ""}`,
      type: aim.heals ? "mend" : does.kind === "save_effect" || does.kind === "save_area" ? (lines.condition ? "control" : "spell") : does.kind === "buff" ? "ward" : "feature",
      name: aim.label && aims.length > 1 ? `${spend.name} (${aim.label})` : spend.name,
      ...(does.kind === "save_area" && does.chosen ? { shares: CHOSEN_CREATURES } : {}),
      ...(forcedVictim(aimDoes(does, aim.variant)) ? { shares: VICTIM } : {}),
      cost: aimCost,
      range: aim.reach || reachOf(does) || (aim.target === "self" || aim.target === "none" ? "Self" : ""),
      // A reaction's fire is the whole of it, not a rider's extra damage.
      dice: action === "reaction" ? aim.dice.replace(/^\+/, "") : aim.dice,
      roll: does.kind === "save_effect" || does.kind === "save_area" ? "no attack" : "no roll",
      rules: `${held.feature}: the server resolves it.`,
      // The counter's reminder, which its own card used to show on hover.
      ...(counter ? { description: counter.guidance } : {}),
      resource: counter && state && left !== null ? `Uses ${left}/${state.max}` : state && left !== null ? `${resourceName(pool!.id)} ${left}/${state.max}` : "",
      condition: lines.condition,
      // A shared pool's option with no painting of its own wears the pool's, as
      // its option card did (hand-options.ts).
      icon: { kind: "feature", key: pool && !isPainted(iconPath("feature", spend.name)) && isPainted(iconPath("feature", resourceName(pool.id))) ? resourceName(pool.id) : spend.name, family: `class-${primaryClass(sheet)}` },
      target: aim.target,
      toHit: null,
      damage: null,
      damageType: "",
      heals: aim.heals,
      save: null,
      melee: false,
      disabled: null,
      spent: false,
      // A spend by amount (Sharpen the Blade, Touch of the Long Death): the
      // player says how much in the box.
      // Performance of Creation: the player names the item in the box.
      compose: perUnit || does.kind === "create_item",
      ...(perUnit ? { unit: pool!.id === "ki" ? "ki" : "points" } : {}),
      ...(pool ? { pool: pool.id } : {}),
      intent:
        action === "reaction"
          ? { card: "reaction", feature: spend.name, ...(aim.variant ? { variant: aim.variant } : {}) }
          : { card: "feature", resourceId: spend.name, ...(aim.variant ? { variant: aim.variant } : {}) },
      ...(does.kind === "buff" && does.othersOnly ? { othersOnly: true } : {}),
      ...sightOf(aimDoes(does, aim.variant), aim.target),
      // Alter Memories reaches a creature the wizard has charmed: the aim bar
      // offers the charmed alone, and the engine judges whose charm it is.
      ...(does.kind === "strip_memory" ? { aimHolds: "charmed" } : {}),
    };
    // Controlled Chaos picks one of the two wild magic rolls the surge left.
    if (does.kind === "chaos_pick") {
      card.choice = { arg: "variant", label: "Surge", options: chaosFaces(sheet).map((face) => ({ value: String(face), label: `${face}: ${WILD_SURGE_TABLE[face - 1]?.name ?? "?"}` })) };
    }
    // Soul of Artifice readies one of the items attuned.
    if (does.kind === "soul_ready") {
      card.choice = { arg: "variant", label: "Attunement to end", options: attunedItems(sheet).map((name) => ({ value: name, label: name })) };
    }
    if (does.kind === "buff" && does.variants) {
      // One pick per outcome: Adjust Density's "halve" is another word for "lighter".
      const seen = new Set<string>();
      const options = Object.entries(does.variants).filter(([, outcome]) => !seen.has(outcome) && Boolean(seen.add(outcome)));
      card.choice = {
        arg: "variant",
        label: "Choose",
        options: options.map(([value]) => ({ value, label: pickLabel(value) })),
      };
    }
    if (does.kind === "variants" && aims.length === 1) {
      card.choice = {
        arg: "variant",
        label: "Choose",
        // A Controlled Surge chooses between the numbers it rolled.
        options: Object.entries(does.options)
          .filter(([, option]) => option.does.kind !== "wild_surge" || !option.does.pick || (pendingSurge(sheet) ?? []).includes(option.does.pick) || !pendingSurge(sheet))
          // An Arcane Shot offers the options the archer knows.
          .filter(([, option]) => option.does.kind !== "arcane_shot" || shotsKnown(sheet.features).includes(option.does.option))
          .map(([value]) => ({ value, label: pickLabel(value) })),
      };
    }
    return gated(
      card,
      standingGate(sheet, turn, cost === "reaction" ? "reaction" : cost === "bonus" ? "bonus" : cost === "free" ? "free" : "action"),
      poolGate,
      (aim.afterWeaponHit ?? spend.afterWeaponHit) && turn.myTurn && !(turn.marks ?? []).some((mark) => mark.startsWith(WEAPON_HIT))
        ? { reason: `${spend.name} rides a weapon hit: land one this turn first.`, spent: false }
        : null,
      // Cauterizing Flames answers a creature in one of the druid's flames.
      does.kind === "chaos_pick" && !chaosFaces(sheet).length
        ? { reason: `${spend.name} picks between two wild magic rolls a surge has just made, and none is waiting.`, spent: false }
        : null,
      does.kind === "soul_ready" && !attunedItems(sheet).length
        ? { reason: `${spend.name} ends an attunement, and ${sheet.name} is attuned to nothing.`, spent: false }
        : null,
      aimDoes(does, aim.variant).kind === "cauterizing" && !heldFlames(sheet).length
        ? { reason: `${spend.name} answers a creature entering a spectral flame, and none burns for ${sheet.name} now.`, spent: false }
        : null,
      // Inspiring Smite comes right after a Divine Smite (authored-spend-divine.ts).
      aimDoes(does, aim.variant).kind === "smite_temp_hp" && !(turn.marks ?? []).includes(DIVINE_SMITE_LANDED)
        ? { reason: `${spend.name} comes right after a Divine Smite: land one this turn first.`, spent: false }
        : null,
      // What rides a natural weapon's hit waits for one, and what ends a
      // condition waits for the condition, as the engine does
      // (src/lib/dm/mt-fb-charge.ts naturalHitRefusal, mt-fb-spend.ts cleanse).
      spend.afterNaturalHit && turn.myTurn && !(turn.marks ?? []).some((mark) => mark.startsWith(NATURAL_HIT))
        ? { reason: `${spend.name} rides a hit of a natural weapon (bite, claws or tail): land one this turn first.`, spent: false }
        : null,
      (() => {
        const aimed = aimDoes(does, aim.variant);
        return aimed.kind === "cleanse" && !sheet.conditions.some((entry) => aimed.conditions.some((name) => isConditionNamed(entry, name)))
          ? { reason: `${spend.name} ends being ${aimed.conditions.join(" or ")}, and ${sheet.name} is neither.`, spent: false }
          : null;
      })(),
      // An Arcane Shot goes with an option the archer knows, on an arrow that
      // hit this turn; the two loosed with no attack roll need no hit
      // (src/lib/dm/mt-fb-arcane-shot.ts).
      (() => {
        if (does.kind !== "variants" || !Object.values(does.options).some((option) => option.does.kind === "arcane_shot")) {
          return null;
        }
        const known = shotsKnown(sheet.features);
        if (!known.length) {
          return { reason: `${spend.name} needs its options chosen on the sheet first.`, spent: false };
        }
        const rides = (turn.marks ?? []).some((mark) => mark.startsWith(BOW_HIT));
        return turn.myTurn && !rides && !known.some((shot) => NO_ROLL.includes(shot))
          ? { reason: `${spend.name} rides an arrow from a shortbow or longbow that hit this turn: land one first.`, spent: false }
          : null;
      })(),
      // A Wild Surge's choice waits for two rolls, and its repeat for its
      // effect to be the surge in force (src/lib/srd/mt-fb-surge-state.ts).
      does.kind === "variants" && Object.values(does.options).some((option) => option.does.kind === "wild_surge") && !pendingSurge(sheet)
        ? { reason: `${spend.name} chooses between two Wild Surge rolls, and none is waiting.`, spent: false }
        : null,
      does.kind === "wild_surge" && does.again && surgeOf(sheet) !== does.again
        ? { reason: `${spend.name} repeats Wild Surge's effect ${does.again}, which is not the surge in force.`, spent: false }
        : null,
      // A spend that rides a charge waits for the run, as the engine does
      // (src/lib/dm/mt-fb-charge.ts).
      spend.chargeFeet && turn.myTurn && chargedFeet(turn.marks) < spend.chargeFeet
        ? { reason: `${spend.name} follows a run of at least ${spend.chargeFeet} feet straight at the creature, then a hit on it.`, spent: false }
        : null,
      // What answers a Sneak Attack waits for the hit that dealt it, as the
      // engine does (src/lib/dm/sneak-answer.ts).
      (() => {
        const aimed = aimDoes(does, aim.variant);
        return aimed.kind === "die_damage" && aimed.afterSneak && turn.myTurn && !(turn.marks ?? []).some((mark) => mark.startsWith(SNEAK_HIT));
      })()
        ? { reason: `${spend.name} answers a Sneak Attack: land one this turn first.`, spent: false }
        : null,
      // An attack added to the Attack action waits for that action to begin,
      // as the engine does (turn-budget.ts grantActionAttack).
      aimDoes(does, aim.variant).kind === "action_attack" && (!turn.myTurn || turn.attacksMade <= 0 || turn.castThisAction === true)
        ? { reason: `${spend.name} adds an attack to the Attack action: make its first attack first.`, spent: false }
        : null,
      // Power Surge: after a wizard spell of this turn hurt a creature.
      spend.afterSpellDamage && turn.myTurn && !spellHurt(turn.marks).length
        ? { reason: `${spend.name} rides a wizard spell's damage: hurt a creature with one this turn first.`, spent: false }
        : null,
      // Tempestuous Magic: in a fight, after a spell of 1st level or higher
      // cast this turn (out of one no turn is kept, and the engine takes it).
      spend.afterLevelledCast && inFightOf(turn) === true && turn.myTurn && !levelledCastThisTurn(turn.marks)
        ? { reason: castFirstReason(spend.name, sheet.name), spent: false }
        : null,
      // Aimed at a creature of the fight (the engine answers "there is no
      // fight" out of one): shut until a fight is on.
      inFightOf(turn) === false && (aim.afterWeaponHit || spend.afterWeaponHit || spend.afterSpellDamage || FIGHT_ONLY.has(aimDoes(does, aim.variant).kind))
        ? { reason: `${spend.name} is used in a fight, on a creature in it.`, spent: false }
        : null,
      // "A creature you can see": none while the holder is blinded.
      sightBound(aimDoes(does, aim.variant)) && sheet.conditions.some((entry) => isConditionNamed(entry, "blinded"))
        ? { reason: `${spend.name} takes a creature ${sheet.name} can see, and they are blinded.`, spent: false }
        : null,
      // What a monk's or a rogue's own spend waits for (mt-mr-hand.ts).
      mrCardGate(sheet, turn, spend, board),
      aimCost === "free" ? null : costGate(aimCost, turn, sheet, spend.name),
      does.kind === "reroll_save" ? failedSaveGate(spend.name, turn) : null,
    );
  });
}

// Intimidating Presence (Berserker 10): the action, one creature within 30
// feet, a WIS save against 8 + proficiency + CHA or frightened until the end
// of the barbarian's next turn (use_resource with targetEnemyId; the engine's
// combat-features.ts rolls it).
export function intimidatingPresenceCards(sheet: CharacterSheet, turn: HandTurn): HandCard[] {
  if (!holdsFeature(sheet, "intimidating presence")) return [];
  const derived = computeSheetDerived(sheet);
  const dc = 8 + derived.proficiencyBonus + derived.abilityMods.cha;
  const card: HandCard = {
    id: "feature:intimidating-presence",
    type: "control",
    name: "Intimidating Presence",
    cost: "action",
    range: "30 ft",
    dice: `WIS save DC ${dc}`,
    roll: "no attack",
    rules: "Frightened until the end of your next turn; a creature that saves cannot be frightened by it for 24 hours.",
    resource: "",
    condition: "Frightened",
    icon: { kind: "feature", key: "Intimidating Presence", family: "class-barbarian" },
    target: "enemy",
    toHit: null,
    damage: null,
    damageType: "",
    heals: false,
    save: { ability: "WIS", dc },
    melee: false,
    disabled: null,
    spent: false,
    compose: false,
    intent: { card: "feature", resourceId: "Intimidating Presence" },
    // "choose one creature that you can see": the chips follow the board's
    // sight, as the engine's refusal does (combat-features.ts).
    sight: true,
  };
  return [
    gated(
      card,
      standingGate(sheet, turn, "action"),
      sheet.conditions.some((entry) => isConditionNamed(entry, "blinded"))
        ? { reason: `Intimidating Presence takes a creature ${sheet.name} can see, and they are blinded.`, spent: false }
        : null,
      costGate("action", turn, sheet, "Intimidating Presence"),
    ),
  ];
}

// The once-chosen options of the subclass features a character holds
// (Totem Spirit, Aspect of the Beast, Totemic Attunement, Transmuter's Stone,
// Elemental Gift, Armor Model): use_resource by the feature's name with the
// option as the variant, outside a fight. `chosen` is the option the sheet's
// feature name already carries ("Totem Spirit (Bear)"), or null.
export type FeatureChoice = { feature: string; spend: string; options: string[]; chosen: string | null };

export function featureChoices(sheet: CharacterSheet): FeatureChoice[] {
  const out: FeatureChoice[] = [];
  for (const held of heldAuthored(sheet)) {
    for (const spend of held.entry.spends ?? []) {
      if (spend.does.kind !== "choose") continue;
      out.push({ feature: held.feature, spend: spend.name, options: spend.does.options, chosen: held.choice });
    }
  }
  return out;
}

function ownOtherPrice(counterId: string, sheet: CharacterSheet): boolean {
  const def = resourceDef(counterId);
  return Boolean(def && otherPrice(def, sheet));
}
