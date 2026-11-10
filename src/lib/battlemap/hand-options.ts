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
import { isConditionNamed, isNamed } from "@/lib/srd/feature-names";
import { DESTRUCTIVE_WRATH, holdsDestructiveWrath } from "@/lib/dm/destructive-wrath-logic";
import { WEAPON_HIT } from "@/lib/dm/action-budget";
import { inFightOf } from "@/lib/battlemap/hand-counters";

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
  option: { name: string; cost: HandCost; rules: string; target?: HandTarget; dice?: string; ritual?: boolean; icon?: IconRef; shares?: HandShares; reach?: string; sight?: HandCard["sight"]; gates?: Array<{ reason: string; spent: boolean } | null> },
): HandCard {
  const state = sheet.resources[pool.id];
  const left = state ? state.max - state.used : 0;
  const cost = option.cost;
  const made: HandCard = {
    id: `option:${pool.id}:${textKey(option.name).replaceAll(" ", "-")}`,
    type: option.target === "ally" ? "ward" : "feature",
    name: option.name,
    cost,
    range: option.reach ?? (option.target === "ally" || option.target === "enemy" ? "" : "Self"),
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
    ...(option.sight ? { sight: option.sight } : {}),
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
    ...(option.gates ?? []),
  );
}

// Turn Undead and its oath forms work on the creatures of a fight within 30
// feet (SRD 5.1: "Each undead that can see or hear you within 30 feet"); the
// engine refuses them out of a fight and with nobody in reach, so the card
// says the reach and shuts with no fight on.
const TURNING = [textKey("Turn Undead"), textKey("Turn the Unholy"), textKey("Turn the Faithless"), textKey("Abjure the Extraplanar")];
const REACH_30 = [...TURNING, textKey("Preserve Life")];
// The options held to a creature the holder can see: the engine asks
// unseenBecause for each (feature-spends.ts Vow of Enmity, command-undead.ts
// Control Undead, channel-fear.ts sees "them"). Their cards carry the sight
// flag, so the aim bar leaves an unseen creature's chip out (hand-play.ts
// aimUnseen), and shut while the holder is blinded.
const SIGHT_OPTIONS = [VOW_OF_ENMITY, textKey("Abjure Enemy"), textKey("Control Undead"), textKey("Conquering Presence")];
// Held to a creature that can see the holder (channel-fear.ts sees "user":
// Dreadful Aspect's "if it can see you"); a blinded holder still plays it.
const SEEN_BY_OPTIONS = [textKey("Dreadful Aspect")];

function optionSight(name: string): HandCard["sight"] {
  const key = textKey(name);
  return SIGHT_OPTIONS.includes(key) ? true : SEEN_BY_OPTIONS.includes(key) ? "seesHolder" : undefined;
}

function optionGates(sheet: CharacterSheet, turn: HandTurn, name: string) {
  const key = textKey(name);
  return [
    TURNING.includes(key) && inFightOf(turn) === false ? { reason: `${name} works on the creatures of a fight; there is none.`, spent: false } : null,
    optionSight(name) === true && sheet.conditions.some((entry) => isConditionNamed(entry, "blinded")) ? { reason: `${name} takes a creature ${sheet.name} can see, and they are blinded.`, spent: false } : null,
  ];
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
      // Already held for the next lightning or thunder damage (destructive-wrath.ts).
      const wrath = isNamed(option.name, DESTRUCTIVE_WRATH);
      if (wrath && holdsDestructiveWrath(sheet)) continue;
      // A row of the authored table is dealt as its own card, which carries the
      // row's target and cost (hand-subclass.ts).
      if (authoredSpendFor(sheet, option.name)) continue;
      cards.push(
        card(sheet, turn, { id: "channel_divinity", label: "Channel Divinity" }, {
          name: option.name,
          cost: COST[option.cost],
          // Played here it is held for a roll the server makes at once (a
          // save spell, an area); a hit offers it on its own card.
          rules: wrath ? "Channel Divinity. Held for their next lightning or thunder damage, dealt at its maximum." : `Channel Divinity. ${RULES[option.cost]}`,
          ritual: option.cost === "ritual",
          ...(AIMED_OPTIONS.includes(textKey(option.name)) ? { target: "enemy" as const } : {}),
          ...(CHOSEN_OPTIONS.includes(textKey(option.name)) ? { target: "enemy" as const, shares: CHOSEN_CREATURES } : {}),
          ...(REACH_30.includes(textKey(option.name)) ? { reach: "30 ft" } : {}),
          sight: optionSight(option.name),
          gates: optionGates(sheet, turn, option.name),
        }),
      );
    }
  }
  if (sheet.resources.sub_psionic_energy) {
    for (const option of psionicOptions(sheet)) {
      // Protective Field answers a hit: the reaction prompt offers it.
      if (option.cost === "reaction") continue;
      // A use the authored layer resolves on a creature (Psionic Strike's
      // force on the creature hit) is aimed at it and waits for the hit, as
      // its spend does (authored-spends.ts afterWeaponHit).
      const authored = authoredSpendFor(sheet, option.name)?.spend;
      const aimed = authored?.does.kind === "die_damage" || authored?.does.kind === "save_effect";
      const rides = Boolean(authored?.afterWeaponHit);
      cards.push(
        card(sheet, turn, { id: "sub_psionic_energy", label: "Psionic Energy" }, {
          name: option.name,
          cost: COST[option.cost],
          rules: `A Psionic Energy die. ${RULES[option.cost]}`,
          ...(aimed ? { target: "enemy" as const } : {}),
          gates: [
            rides && turn.myTurn && !(turn.marks ?? []).some((mark) => mark.startsWith(WEAPON_HIT)) ? { reason: `${option.name} rides a weapon hit: land one this turn first.`, spent: false } : null,
            (rides || aimed) && inFightOf(turn) === false ? { reason: `${option.name} is used in a fight, on a creature in it.`, spent: false } : null,
          ],
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
