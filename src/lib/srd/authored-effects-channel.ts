// Channel Divinity options as rows of the authored table. Each spends the shared
// pool and says what it does, so use_resource resolves it by the option's name,
// by itself or in variant (src/lib/dm/authored-spends.ts). A row's action must
// match the option's cost in src/lib/dm/option-costs.ts.
//
// The options not here are resolved in src/lib/dm/feature-spends.ts, or still
// spend the use and leave the rest to the GM.

import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

const POOL = { id: "channel_divinity" };

// A modifier added to dice, its sign written either way ("1d6+3", "1d6-1").
const plus = (dice: string, mod: number | undefined) => `${dice}${(mod ?? 0) < 0 ? "" : "+"}${mod ?? 0}`;

export const AUTHORED_DATA_CHANNEL: Record<string, AuthoredEntry> = {
  "cleric::Channel Divinity: Radiance of the Dawn": {
    subclass: "Light Domain",
    spends: [
      {
        name: "Radiance of the Dawn",
        pool: POOL,
        action: "action",
        // Every hostile creature in reach, seen or not, but none with total
        // cover from the cleric; and "any magical darkness within 30 feet of
        // you is dispelled".
        does: { kind: "save_area", save: "con", dcAbility: "spell", rangeFt: 30, dice: "2d10+level", type: "radiant", half: true, coverShields: true, dispelsDarkness: true },
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
        // A beast or plant "that can see you": its sight of the cleric, not
        // the cleric's of it (authored-effects-types.ts `sight`).
        does: { kind: "save_area", save: "wis", dcAbility: "spell", rangeFt: 30, condition: "charmed", rounds: 10, endsOnDamage: true, types: ["beast", "plant"], sight: "seesHolder" },
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
          chosen: true,
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
        // A creature the paladin can see; it picks Strength or Dexterity for
        // the first save and again for each save to break free.
        does: { kind: "save_effect", save: "str", orSave: "dex", dcAbility: "spell", rangeFt: 10, condition: "restrained", saveEnds: true, sight: true },
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
        // The holder and their Charisma modifier in allies they can see, at
        // least one.
        does: { kind: "buff", target: "allies", condition: "watcher's will", rounds: 10, rangeFt: 30, count: (_level, mods) => Math.max(1, mods.cha ?? 0), sight: true },
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
        // Creatures the paladin can see. No count of rounds: it ends when the
        // paladin is incapacitated or dies, or the creature is more than 30 feet
        // away (SCAG, Oath of the Crown).
        does: { kind: "save_area", save: "wis", dcAbility: "spell", rangeFt: 30, condition: "champion challenge", leashFeet: 30, sight: true, chosen: true },
      },
    ],
  },
  "paladin::Channel Divinity: Turn the Tide": {
    subclass: "Oath of the Crown",
    spends: [
      {
        name: "Turn the Tide",
        pool: POOL,
        action: "bonus",
        // SCAG: each creature of the paladin's choice that can hear them within
        // 30 feet, with no more than half its hit points, regains 1d6 + CHA (at
        // least 1).
        does: { kind: "heal_area", formula: (_level, mods) => plus("1d6", mods.cha), rangeFt: 30, belowHalf: true, hears: true },
      },
    ],
  },
  "cleric::Channel Divinity: Balm of Peace": {
    subclass: "Peace Domain",
    spends: [
      {
        name: "Balm of Peace",
        pool: POOL,
        action: "action",
        // TCoE: the cleric moves up to their speed without provoking, and each
        // other creature they pass within 5 feet of regains 2d6 + WIS (at least
        // 1), once per use. On the board the server walks it; the note is for
        // a scene with none.
        does: {
          kind: "heal_area",
          formula: (_level, mods) => plus("2d6", mods.wis),
          rangeFt: "move",
          othersOnly: true,
          each: true,
          note: "The cleric moves up to their speed past the creatures healed, provoking no opportunity attacks: move the token along that path.",
        },
      },
    ],
  },
  "cleric::Channel Divinity: Twilight Sanctuary": {
    subclass: "Twilight Domain",
    spends: [
      {
        name: "Twilight Sanctuary",
        pool: POOL,
        action: "action",
        does: { kind: "buff", condition: "twilight sanctuary", rounds: 10 },
      },
    ],
    // TCoE: a 30-foot sphere for a minute, or until the cleric is
    // incapacitated or dies. A creature ending its turn in it gains 1d6 +
    // cleric level temporary hit points, or ends one charm or fear on it.
    effects: [{ kind: "turn_end_aura", rangeFt: 30, tempHp: (level) => `1d6+${level}`, ends: ["charmed", "frightened"], gate: { condition: "twilight sanctuary" } }],
  },
};
