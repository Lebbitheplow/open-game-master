// One card per option of a pool whose options cost different things (issue
// 233, src/lib/dm/option-costs.ts): each Channel Divinity option and Psionic
// Energy use the sheet holds, and the Battle Master's Rally and Commander's
// Strike. Before this the Hand dealt one Channel Divinity card that named no
// option and cost an action whatever was chosen.
//
// Pure; scripts/test-hand-options.mjs drives it.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { channelOptions, psionicOptions, type HeldOption } from "@/lib/dm/option-costs";
import { isAfterRollChannelOption } from "@/lib/dm/after-roll-logic";
import { VOW_OF_ENMITY } from "@/lib/srd/vow-of-enmity";
import { authoredSpendFor, heldReaction } from "@/lib/srd/authored-effects";
import { maneuverDieFor } from "@/lib/dm/maneuver-rules";
import { iconPath, isPainted, type IconRef } from "@/lib/icons";
import {
  CHOSEN_CREATURES,
  type HandShares,
  costGate,
  gated,
  primaryClass,
  standingGate,
  type HandCard,
  type HandCost,
  type HandTarget,
  type HandTurn,
} from "@/lib/battlemap/hand-core";
import { textKey } from "@/lib/language/text-logic";
import { isNamed } from "@/lib/srd/feature-names";

const COST: Record<HeldOption["cost"], HandCost> = {
  action: "action",
  bonus: "bonus",
  reaction: "reaction",
  none: "free",
  ritual: "action",
};

function card(
  sheet: CharacterSheet,
  turn: HandTurn,
  pool: { id: string; label: string },
  option: { name: string; cost: HandCost; rules: string; target?: HandTarget; dice?: string; ritual?: boolean; icon?: IconRef; shares?: HandShares },
): HandCard {
  const state = sheet.resources[pool.id];
  const left = state ? state.max - state.used : 0;
  const cost = option.cost;
  const made: HandCard = {
    id: `option:${pool.id}:${textKey(option.name).replaceAll(" ", "-")}`,
    type: option.target === "ally" ? "ward" : "feature",
    name: option.name,
    cost,
    range: option.target === "ally" || option.target === "enemy" ? "" : "Self",
    dice: option.dice ?? "",
    roll: "no roll",
    rules: option.rules,
    resource: state ? `${pool.label} ${left}/${state.max}` : "",
    condition: "",
    // The option's own painting, else its pool's, else the class emblem.
    icon: option.icon ?? {
      kind: "feature",
      key: isPainted(iconPath("feature", option.name)) ? option.name : pool.label,
      family: `class-${primaryClass(sheet)}`,
    },
    target: option.target ?? "none",
    ...(option.shares ? { shares: option.shares } : {}),
    toHit: null,
    damage: null,
    damageType: "",
    heals: false,
    save: null,
    melee: false,
    disabled: null,
    spent: false,
    compose: false,
    pool: pool.id,
    intent:
      cost === "reaction"
        ? { card: "reaction", feature: option.name }
        : { card: "feature", resourceId: pool.id, variant: option.name.toLowerCase().slice(0, 40) },
  };
  return gated(
    made,
    standingGate(sheet, turn, cost === "reaction" ? "reaction" : cost === "bonus" ? "bonus" : cost === "free" ? "free" : "action"),
    option.ritual && turn.table ? { reason: `${option.name} is an hour-long ritual, not something done in a fight.`, spent: false } : null,
    left > 0 ? null : { reason: `${pool.label} is spent until a rest.`, spent: true },
    costGate(cost, turn, sheet, option.name),
  );
}

// The options aimed at one creature, which the engine asks for by id.
const AIMED_OPTIONS = [VOW_OF_ENMITY, textKey("Arcane Abjuration"), textKey("Abjure Enemy"), textKey("Control Undead")];
// The options that take the creatures of the player's choice (channel-fear.ts
// chosen): aimed at one, the others added.
const CHOSEN_OPTIONS = [textKey("Conquering Presence"), textKey("Dreadful Aspect")];

const RULES: Record<HeldOption["cost"], string> = {
  action: "Takes their action.",
  bonus: "Takes their bonus action.",
  reaction: "Taken with their reaction, when its trigger comes.",
  none: "Rides a roll they are already making; no action of its own.",
  ritual: "An hour of ritual work, out of a fight.",
};

export function optionCards(sheet: CharacterSheet, turn: HandTurn): HandCard[] {
  const cards: HandCard[] = [];
  if (sheet.resources.channel_divinity) {
    for (const option of channelOptions(sheet)) {
      // Offered when its trigger comes (hand-react.ts), as a reaction card.
      if (heldReaction(sheet, option.name)) continue;
      // Guided Strike, War God's Blessing and Touch of Death are chosen after
      // the d20, on the card the roll waits on (after-roll-logic.ts): played
      // here, they had nothing to ride.
      if (isAfterRollChannelOption(option.name)) continue;
      // A row of the authored table is dealt as its own card, which carries the
      // row's target and cost (hand-subclass.ts).
      if (authoredSpendFor(sheet, option.name)) continue;
      cards.push(
        card(sheet, turn, { id: "channel_divinity", label: "Channel Divinity" }, {
          name: option.name,
          cost: COST[option.cost],
          rules: `Channel Divinity. ${RULES[option.cost]}`,
          ritual: option.cost === "ritual",
          ...(AIMED_OPTIONS.includes(textKey(option.name)) ? { target: "enemy" as const } : {}),
          ...(CHOSEN_OPTIONS.includes(textKey(option.name)) ? { target: "enemy" as const, shares: CHOSEN_CREATURES } : {}),
        }),
      );
    }
  }
  if (sheet.resources.sub_psionic_energy) {
    for (const option of psionicOptions(sheet)) {
      // Protective Field answers a hit: the reaction prompt offers it.
      if (option.cost === "reaction") continue;
      cards.push(
        card(sheet, turn, { id: "sub_psionic_energy", label: "Psionic Energy" }, {
          name: option.name,
          cost: COST[option.cost],
          rules: `A Psionic Energy die. ${RULES[option.cost]}`,
        }),
      );
    }
  }
  if (sheet.resources.sub_superiority_dice) {
    const die = `1${maneuverDieFor(sheet)}`;
    const knows = (name: string) => sheet.features.some((feature) => /^maneuver:/i.test(feature.name) && isNamed(feature.name, name));
    if (knows("rally")) {
      cards.push(
        card(sheet, turn, { id: "sub_superiority_dice", label: "Dice" }, {
          name: "Rally",
          cost: "bonus",
          rules: "A companion gains temporary hit points: the die plus your Charisma modifier.",
          target: "ally",
          dice: `${die} temp hp`,
          icon: { kind: "option", key: "Maneuver: Rally", family: "option-maneuver" },
        }),
      );
    }
    if (knows("commander's strike")) {
      cards.push(
        card(sheet, turn, { id: "sub_superiority_dice", label: "Dice" }, {
          name: "Commander's Strike",
          cost: "bonus",
          rules: "Forgo one attack: a companion strikes now with their reaction, the die added to its damage.",
          target: "ally",
          dice: `+${die}`,
          icon: { kind: "option", key: "Maneuver: Commander's Strike", family: "option-maneuver" },
        }),
      );
    }
  }
  return cards;
}
