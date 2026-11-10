// The subclass features the authored layer resolves (src/lib/srd/authored-
// effects.ts), as the Hand and the sheet offer them: each spend a card
// played with use_resource by the feature's own name (Kensei's Shot, Shadow
// Step, Psychic Blades...), Intimidating Presence aimed at a creature, and the
// once-chosen options (Totem Spirit, Aspect of the Beast...) as a pick on the
// sheet. Each card carries the engine's own gate and pool, so a card is never
// offered for a spend use_resource would refuse for want of the feature.
//
// Pure; scripts/test-hand-engine.mjs drives it.
import { WEAPON_HIT } from "@/lib/dm/action-budget";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { authoredSpendFor, gateHolds, heldAuthored, resolveFormula, type AuthoredSpend, type HeldAuthored } from "@/lib/srd/authored-effects";
import { resourceDef, resourceName, type ResourceDef } from "@/lib/srd/class-resources";
import type { SpendAction } from "@/lib/srd/authored-effects-types";
import { holdsFeature } from "@/lib/srd/trait-rules";
import {
  CHOSEN_CREATURES,
  costGate,
  gated,
  primaryClass,
  standingGate,
  type Gate,
  type HandCard,
  type HandCost,
  type HandTarget,
  type HandTurn,
} from "@/lib/battlemap/hand-core";
import { textKey } from "@/lib/language/text-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { iconPath, isPainted } from "@/lib/icons";
import { inFightOf } from "@/lib/battlemap/hand-counters";

type SpendDoes = AuthoredSpend["does"];

const COST: Record<string, HandCost> = { action: "action", bonus: "bonus", reaction: "reaction", none: "free" };

// A variant's word as a pick reads on a card: "bear" as "Bear".
export const pickLabel = (value: string) => value.replace(/^./, (c) => c.toUpperCase());

function targetOf(does: SpendDoes): HandTarget {
  if (does.kind === "buff") {
    // A quarry (Hexblade's Curse) marks a creature, and the engine asks which.
    return does.target === "enemy" || does.quarry ? "enemy" : does.target === "ally" ? "ally" : "self";
  }
  if (does.kind === "save_effect" || does.kind === "insight_contest" || does.kind === "die_damage") return "enemy";
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
  return "none";
}

// The kinds the engine resolves only on a creature in a fight.
const FIGHT_ONLY = new Set<SpendDoes["kind"]>(["save_effect", "die_damage", "flourish", "swarm_push", "insight_contest"]);

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
  return does.kind === "save_effect" || (does.kind === "buff" && (does.target === "enemy" || Boolean(does.quarry)));
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
  return spend.fight !== "out" && spend.does.kind !== "choose" && (spendAction(spend) !== "reaction" || aimedReaction(spend)) && gateHolds(spend.gate, sheet, held);
}

// A reaction that heals one creature or burns another (Cauterizing Flames): one
// card per aim, as Arcane Jolt has. As one plain reaction card it sent neither
// the pick nor a target, and the engine refused it every time.
function aimedReaction(spend: AuthoredSpend): boolean {
  return spendAction(spend) === "reaction" && spend.does.kind === "flames";
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
export function subclassSpendCards(sheet: CharacterSheet, turn: HandTurn, taken: Set<string>): HandCard[] {
  const cards: HandCard[] = [];
  for (const held of heldAuthored(sheet)) {
    for (const spend of held.entry.spends ?? []) {
      if (taken.has(textKey(spend.name))) continue;
      const dealt = spendCards(sheet, turn, held, spend);
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
type Aim = { variant?: string; label?: string; target: HandTarget; dice: string; heals: boolean; afterWeaponHit?: boolean; action?: SpendAction; reach?: string };

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
    const targets = new Set(options.map(([, option]) => targetOf(option.does)));
    if (targets.size > 1) {
      return options.map(([variant, option]) => ({ variant, label: pickLabel(variant), target: targetOf(option.does), dice: linesOf(option.does).dice, heals: false, afterWeaponHit: option.afterWeaponHit, action: option.action, reach: reachOf(option.does) }));
    }
  }
  const lines = linesOf(does);
  return [{ target: targetOf(does), dice: lines.dice, heals: false }];
}

function spendCards(sheet: CharacterSheet, turn: HandTurn, held: HeldAuthored, spend: AuthoredSpend): HandCard[] {
  const does = spend.does;
  // The counter of this spend's own name. Its card's id, cost and uses line
  // carry over, so a seat the player arranged holds and Hidden Paths, whose
  // variants price themselves, stays a bonus action.
  const counter = ownCounter(spend);
  const action = spendAction(spend);
  if (spend.gm || spend.fight === "out" || does.kind === "choose" || (action === "reaction" && !aimedReaction(spend)) || !gateHolds(spend.gate, sheet, held)) return [];
  const cost = COST[action] ?? "action";
  const pool = spend.pool;
  const state = pool ? sheet.resources[pool.id] : undefined;
  const left = state ? state.max - state.used : null;
  const lines = linesOf(does);
  const perUnit = Boolean(pool?.perUnit);
  const need = pool?.optional ? 0 : pool?.amount ?? 1;
  const poolGate: Gate =
    state && left !== null && left < need && !perUnit
      ? {
          // A counter of the spend's own name is its uses, not a raw id.
          reason: counter
            ? `${spend.name} has no use left (${left}/${state!.max}). It comes back after a rest.`
            : `${spend.name} needs ${need} and ${sheet.name} has ${left} ${resourceName(pool!.id)} left. It comes back after a rest.`,
          spent: true,
        }
      : null;
  const aims = aimsOf(does, held.level, computeSheetDerived(sheet).abilityMods);
  return aims.map((aim) => {
    const aimCost = aim.action ? (COST[aim.action] ?? cost) : cost;
    const card: HandCard = {
      id: `${counter ? `feature:${counter.id}` : `feature:authored:${textKey(spend.name).replace(/\s+/g, "-")}`}${aim.variant && aims.length > 1 ? `:${aim.variant}` : ""}`,
      type: aim.heals ? "mend" : does.kind === "save_effect" || does.kind === "save_area" ? (lines.condition ? "control" : "spell") : does.kind === "buff" ? "ward" : "feature",
      name: aim.label && aims.length > 1 ? `${spend.name} (${aim.label})` : spend.name,
      ...(does.kind === "save_area" && does.chosen ? { shares: CHOSEN_CREATURES } : {}),
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
      compose: perUnit,
      ...(perUnit ? { unit: pool!.id === "ki" ? "ki" : "points" } : {}),
      ...(pool ? { pool: pool.id } : {}),
      intent:
        action === "reaction"
          ? { card: "reaction", feature: spend.name, ...(aim.variant ? { variant: aim.variant } : {}) }
          : { card: "feature", resourceId: spend.name, ...(aim.variant ? { variant: aim.variant } : {}) },
      ...(does.kind === "buff" && does.othersOnly ? { othersOnly: true } : {}),
      ...sightOf(aimDoes(does, aim.variant), aim.target),
    };
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
        options: Object.keys(does.options).map((value) => ({ value, label: pickLabel(value) })),
      };
    }
    return gated(
      card,
      standingGate(sheet, turn, cost === "reaction" ? "reaction" : cost === "bonus" ? "bonus" : cost === "free" ? "free" : "action"),
      poolGate,
      (aim.afterWeaponHit ?? spend.afterWeaponHit) && turn.myTurn && !(turn.marks ?? []).some((mark) => mark.startsWith(WEAPON_HIT))
        ? { reason: `${spend.name} rides a weapon hit: land one this turn first.`, spent: false }
        : null,
      // Aimed at a creature of the fight (the engine answers "there is no
      // fight" out of one): shut until a fight is on.
      inFightOf(turn) === false && (aim.afterWeaponHit || spend.afterWeaponHit || FIGHT_ONLY.has(aimDoes(does, aim.variant).kind))
        ? { reason: `${spend.name} is used in a fight, on a creature in it.`, spent: false }
        : null,
      // "A creature you can see": none while the holder is blinded.
      sightBound(aimDoes(does, aim.variant)) && sheet.conditions.some((entry) => isConditionNamed(entry, "blinded"))
        ? { reason: `${spend.name} takes a creature ${sheet.name} can see, and they are blinded.`, spent: false }
        : null,
      aimCost === "free" ? null : costGate(aimCost, turn, sheet, spend.name),
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
  };
  return [gated(card, standingGate(sheet, turn, "action"), costGate("action", turn, sheet, "Intimidating Presence"))];
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
