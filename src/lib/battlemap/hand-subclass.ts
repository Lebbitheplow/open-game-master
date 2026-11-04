// The subclass features the authored layer resolves (src/lib/srd/authored-
// effects.ts), as the Hand and the sheet offer them: each spend a card
// played with use_resource by the feature's own name (Kensei's Shot, Shadow
// Step, Psychic Blades...), Intimidating Presence aimed at a creature, and the
// once-chosen options (Totem Spirit, Aspect of the Beast...) as a pick on the
// sheet. Each card carries the engine's own gate and pool, so a card is never
// offered for a spend use_resource would refuse for want of the feature.
//
// Pure; scripts/test-hand-engine.mjs drives it.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { authoredSpendFor, gateHolds, heldAuthored, resolveFormula, type AuthoredSpend, type HeldAuthored } from "@/lib/srd/authored-effects";
import { resourceDef, resourceName, type ResourceDef } from "@/lib/srd/class-resources";
import type { SpendAction } from "@/lib/srd/authored-effects-types";
import { holdsFeature } from "@/lib/srd/trait-rules";
import {
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

type SpendDoes = AuthoredSpend["does"];

const COST: Record<string, HandCost> = { action: "action", bonus: "bonus", none: "free" };

// A variant's word as a pick reads on a card: "bear" as "Bear".
export const pickLabel = (value: string) => value.replace(/^./, (c) => c.toUpperCase());

function targetOf(does: SpendDoes): HandTarget {
  if (does.kind === "buff") {
    // A quarry (Hexblade's Curse) marks a creature, and the engine asks which.
    return does.target === "enemy" || does.quarry ? "enemy" : does.target === "ally" ? "ally" : "self";
  }
  if (does.kind === "save_effect" || does.kind === "insight_contest" || does.kind === "die_damage") return "enemy";
  return "none";
}

function linesOf(does: SpendDoes): { dice: string; condition: string } {
  switch (does.kind) {
    case "buff":
      // A buff with variants names none on its face: the player picks.
      if (does.variants) return { dice: "", condition: "" };
      return { dice: typeof does.condition === "string" ? does.condition : does.condition[0]?.[1] ?? "", condition: typeof does.condition === "string" ? does.condition : "" };
    case "save_effect":
      return { dice: `${does.save.toUpperCase()} save`, condition: does.condition ?? "" };
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
  return spend.fight !== "out" && spend.does.kind !== "choose" && spendAction(spend) !== "reaction" && gateHolds(spend.gate, sheet, held);
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
function aimsOf(does: SpendDoes, level: number, mods: Record<string, number>): Array<{ variant?: string; label?: string; target: HandTarget; dice: string; heals: boolean }> {
  if (does.kind === "flames") {
    const dice = resolveFormula(does.formula, level, mods);
    const heal = { variant: "heal", label: "healing", target: "ally" as const, dice: `heals ${dice}`, heals: true };
    return does.healOnly ? [{ ...heal, variant: undefined, label: undefined }] : [{ variant: "burn", label: "force", target: "enemy", dice: `+${dice} ${does.type}`, heals: false }, heal];
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
  if (spend.fight === "out" || does.kind === "choose" || action === "reaction" || !gateHolds(spend.gate, sheet, held)) return [];
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
    const card: HandCard = {
      id: `${counter ? `feature:${counter.id}` : `feature:authored:${textKey(spend.name).replace(/\s+/g, "-")}`}${aim.variant && aims.length > 1 ? `:${aim.variant}` : ""}`,
      type: aim.heals ? "mend" : does.kind === "save_effect" ? (lines.condition ? "control" : "spell") : does.kind === "buff" ? "ward" : "feature",
      name: aim.label && aims.length > 1 ? `${spend.name} (${aim.label})` : spend.name,
      cost,
      range: aim.target === "self" || aim.target === "none" ? "Self" : "",
      dice: aim.dice,
      roll: does.kind === "save_effect" ? "no attack" : "no roll",
      rules: `${held.feature}: the server resolves it.`,
      // The counter's reminder, which its own card used to show on hover.
      ...(counter ? { description: counter.guidance } : {}),
      resource: counter && state && left !== null ? `Uses ${left}/${state.max}` : state && left !== null ? `${resourceName(pool!.id)} ${left}/${state.max}` : "",
      condition: lines.condition,
      icon: { kind: "feature", key: spend.name, family: `class-${primaryClass(sheet)}` },
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
      intent: { card: "feature", resourceId: spend.name, ...(aim.variant ? { variant: aim.variant } : {}) },
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
    if (does.kind === "variants") {
      card.choice = {
        arg: "variant",
        label: "Choose",
        options: Object.keys(does.options).map((value) => ({ value, label: pickLabel(value) })),
      };
    }
    return gated(
      card,
      standingGate(sheet, turn, cost === "bonus" ? "bonus" : cost === "free" ? "free" : "action"),
      poolGate,
      cost === "free" ? null : costGate(cost, turn, sheet, spend.name),
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
