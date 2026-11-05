// Channel Divinity options as rows of the authored table. Each spends the shared
// pool and says what it does, so use_resource resolves it by the option's name,
// by itself or in variant (src/lib/dm/authored-spends.ts). A row's action must
// match the option's cost in src/lib/dm/option-costs.ts.
//
// The options not here are resolved in src/lib/dm/feature-spends.ts, or still
// spend the use and leave the rest to the GM.

import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

const POOL = { id: "channel_divinity" };

export const AUTHORED_DATA_CHANNEL: Record<string, AuthoredEntry> = {
  "cleric::Channel Divinity: Radiance of the Dawn": {
    subclass: "Light Domain",
    spends: [
      {
        name: "Radiance of the Dawn",
        pool: POOL,
        action: "action",
        does: { kind: "save_area", save: "con", dcAbility: "spell", rangeFt: 30, dice: "2d10+level", type: "radiant", half: true },
      },
    ],
  },
  "cleric::Channel Divinity: Charm Animals and Plants": {
    subclass: "Nature Domain",
    spends: [
      {
        name: "Charm Animals and Plants",
        pool: POOL,
        action: "action",
        does: { kind: "save_area", save: "wis", dcAbility: "spell", rangeFt: 30, condition: "charmed", rounds: 10, endsOnDamage: true, types: ["beast", "plant"], sight: true },
      },
    ],
  },
  "cleric::Channel Divinity: Cloak of Shadows": {
    subclass: "Trickery Domain",
    spends: [
      {
        name: "Cloak of Shadows",
        pool: POOL,
        action: "action",
        // An attack or a cast ends it, as any invisibility but Greater
        // Invisibility's (src/lib/dm/attack-marks.ts).
        does: { kind: "buff", condition: "invisible", rounds: 2, untilNextTurnEnds: true },
      },
    ],
  },
  "cleric::Channel Divinity: Order's Demand": {
    subclass: "Order Domain",
    spends: [
      {
        name: "Order's Demand",
        pool: POOL,
        action: "action",
        does: {
          kind: "save_area",
          save: "wis",
          dcAbility: "spell",
          rangeFt: 30,
          condition: "charmed",
          untilNextTurnEnds: true,
          endsOnDamage: true,
          onFail: "can be made to drop what it is holding",
        },
      },
    ],
  },
  "paladin::Channel Divinity: Nature's Wrath": {
    subclass: "Oath of the Ancients",
    spends: [
      {
        name: "Nature's Wrath",
        pool: POOL,
        action: "action",
        does: { kind: "save_effect", save: "str", orSave: "dex", dcAbility: "spell", rangeFt: 10, condition: "restrained", saveEnds: true },
      },
    ],
  },
  "paladin::Channel Divinity: Emissary of Peace": {
    subclass: "Oath of Redemption",
    spends: [{ name: "Emissary of Peace", pool: POOL, action: "bonus", does: { kind: "buff", condition: "emissary of peace", rounds: 100 } }],
  },
  "paladin::Channel Divinity: Peerless Athlete": {
    subclass: "Oath of Glory",
    spends: [{ name: "Peerless Athlete", pool: POOL, action: "bonus", does: { kind: "buff", condition: "peerless athlete", rounds: 100 } }],
    effects: [{ kind: "check_adv", skills: ["athletics", "acrobatics"], gate: { condition: "peerless athlete" } }],
  },
  "paladin::Channel Divinity: Watcher's Will": {
    subclass: "Oath of the Watchers",
    spends: [
      {
        name: "Watcher's Will",
        pool: POOL,
        action: "action",
        // The holder and their Charisma modifier in allies, at least one.
        does: { kind: "buff", target: "allies", condition: "watcher's will", rounds: 10, rangeFt: 30, count: (_level, mods) => Math.max(1, mods.cha ?? 0) },
      },
    ],
  },
  "paladin::Channel Divinity: Champion Challenge": {
    subclass: "Oath of the Crown",
    spends: [
      {
        name: "Champion Challenge",
        pool: POOL,
        action: "bonus",
        // Creatures the paladin can see. The text gives no duration; a minute
        // stands in until the GM ends it.
        does: { kind: "save_area", save: "wis", dcAbility: "spell", rangeFt: 30, condition: "champion challenge", rounds: 10, sight: true },
      },
    ],
  },
};
