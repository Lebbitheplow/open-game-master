// The fighter and barbarian subclass rows the martial package's fb part built
// in wave 2 of the 2026-11-09 gap sweep: registered in AUTHORED_TABLE
// (authored-effects.ts) with one line, so no other part appends to this
// object. A key here that an older table also carries replaces that row whole.

import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

export const AUTHORED_DATA_W2_MT_FB: Record<string, AuthoredEntry> = {
  // "a reaction-free end to being charmed or frightened by spending a die"
  // (the resistance is feature-effects.ts's): a die was spent under the
  // variant and the fighter stayed frightened.
  // "The prestidigitation or druidcraft cantrip": the option chosen names it,
  // and src/lib/srd/mt-fb-casts.ts lets the archer cast it (Intelligence).
  "fighter::Arcane Archer Lore": {
    subclass: "Arcane Archer",
    spends: [{ name: "Arcane Archer Lore Cantrip", aliases: ["Arcane Archer Lore"], fight: "out", does: { kind: "choose", options: ["Prestidigitation", "Druidcraft"] } }],
  },
  // "a natural-weapon hit forces a Wisdom save: the target either attacks a
  // creature of your choice or takes 2d12 psychic damage". The counter was
  // spent with no hit landed, or after a sword's. The barbarian's choice is
  // the variant: the psychic damage is rolled here; the attack on another
  // creature is the GM's to make for the creature that failed.
  "barbarian::Infectious Fury": {
    subclass: "Path of the Beast",
    counter: "sub_infectious_fury",
    spends: [
      {
        name: "Infectious Fury",
        pool: { id: "sub_infectious_fury" },
        action: "none",
        afterNaturalHit: true,
        does: {
          kind: "variants",
          options: {
            damage: { does: { kind: "save_effect", save: "wis", dcAbility: "con", dice: "2d12", type: "psychic" } },
            attack: {
              does: {
                kind: "save_effect",
                save: "wis",
                dcAbility: "con",
                onFail: "must use its reaction to make a melee attack against another creature of the barbarian's choice that the barbarian can see: the GM makes that attack for it now",
              },
            },
          },
        },
      },
    ],
  },
  // "you can adapt to swim, climb or jump after each rest": chosen out of a
  // fight. Swim and climb are a speed equal to the walking speed; the jump's
  // Athletics check that lengthens a leap is rolled with request_roll when
  // the barbarian jumps.
  "barbarian::Bestial Soul": {
    subclass: "Path of the Beast",
    spends: [{ name: "Bestial Soul", aliases: ["Bestial Soul Adaptation"], fight: "out", does: { kind: "choose", options: ["Swim", "Climb", "Jump"] } }],
    effects: [
      { kind: "move", swim: "walk", gate: { choice: "swim" } },
      { kind: "move", climb: "walk", gate: { choice: "climb" } },
    ],
  },
  "fighter::Guarded Mind": {
    subclass: "Psi Warrior",
    spends: [{ name: "Guarded Mind", pool: { id: "sub_psionic_energy" }, action: "none", does: { kind: "cleanse", conditions: ["charmed", "frightened"] } }],
  },
};
