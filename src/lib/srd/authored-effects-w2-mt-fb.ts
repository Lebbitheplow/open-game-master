// The fighter and barbarian subclass rows the martial package's fb part built
// in wave 2 of the 2026-11-09 gap sweep: registered in AUTHORED_TABLE
// (authored-effects.ts) with one line, so no other part appends to this
// object. A key here that an older table also carries replaces that row whole.

import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

export const AUTHORED_DATA_W2_MT_FB: Record<string, AuthoredEntry> = {
  // What the action senses is told to the barbarian from the board's spells,
  // creatures and items (src/lib/dm/sense-magic.ts).
  "barbarian::Magic Awareness": {
    subclass: "Path of Wild Magic",
    spends: [{ name: "Magic Awareness", pool: { id: "sub_magic_awareness" }, action: "action", does: { kind: "sense", what: "magic" } }],
  },
  // What the action senses is told to the rogue, and nothing of what it hides.
  "rogue::Unerring Eye": {
    subclass: "Inquisitive",
    spends: [{ name: "Unerring Eye", pool: { id: "sub_unerring_eye" }, action: "action", does: { kind: "sense", what: "deceit" } }],
  },
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
  // the variant: the psychic damage is rolled here, and the creature that
  // fails makes its attack on the creature named with its reaction
  // (src/lib/dm/mt-fb-spend.ts forcedStrike).
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
                strikes: true,
                onFail: "must use its reaction to make a melee attack against another creature of the barbarian's choice that the barbarian can see. None was named on the call (targetEnemyIds), so the GM makes that attack for it now",
              },
            },
          },
        },
      },
    ],
  },  // Arcane Shot (XGtE): one option a turn on an arrow from a shortbow or
  // longbow, from the two uses. Which options a sheet knows, and what each
  // does, is src/lib/dm/mt-fb-arcane-shot.ts.
  "fighter::Arcane Shot": {
    subclass: "Arcane Archer",
    spends: [
      {
        name: "Arcane Shot",
        pool: { id: "sub_arcane_shot" },
        action: "none",
        oncePerTurn: true,
        does: {
          kind: "variants",
          options: {
            banishing: { does: { kind: "arcane_shot", option: "banishing" } },
            beguiling: { does: { kind: "arcane_shot", option: "beguiling" } },
            bursting: { does: { kind: "arcane_shot", option: "bursting" } },
            enfeebling: { does: { kind: "arcane_shot", option: "enfeebling" } },
            grasping: { does: { kind: "arcane_shot", option: "grasping" } },
            piercing: { does: { kind: "arcane_shot", option: "piercing" } },
            seeking: { does: { kind: "arcane_shot", option: "seeking" } },
            shadow: { does: { kind: "arcane_shot", option: "shadow" } },
          },
        },
      },
    ],
  },

  // "When you enter your rage, roll a d8 for a magical effect that lasts the
  // rage": rolled as the rage is entered and applied by
  // src/lib/dm/mt-fb-wild-surge.ts, which keeps the surge in force as the
  // condition "wild surge (N)". These are what the table leaves standing: a
  // weapon turned to force and thrown (4), force for whoever hits the
  // barbarian (5), and the bonus-action repeats of 2, 3 and 8, each taken
  // only while its effect is the surge in force (the engine and the Hand both
  // read src/lib/srd/mt-fb-surge-state.ts: no hand-laid condition opens one).
  "barbarian::Wild Surge": {
    subclass: "Path of Wild Magic",
    spends: [
      { name: "Wild Surge Teleport", action: "bonus", does: { kind: "wild_surge", again: 2 } },
      { name: "Wild Surge Spirit", action: "bonus", does: { kind: "wild_surge", again: 3 } },
      { name: "Wild Surge Bolt", action: "bonus", does: { kind: "wild_surge", again: 8 } },
    ],
    effects: [
      { kind: "infuse", type: "force", rangeFt: 20, longRangeFt: 60, gate: { condition: "wild surge (4)" } },
      { kind: "retaliate", formula: "1d6", type: "force", gate: { condition: "wild surge (5)" } },
    ],
  },
  // "roll twice and choose either effect; if both dice show the same number,
  // choose any effect on the table": the two rolls wait as "wild surge
  // pending", and this is the choice.
  "barbarian::Controlled Surge": {
    subclass: "Path of Wild Magic",
    spends: [
      {
        name: "Controlled Surge",
        aliases: ["Wild Surge Choice"],
        action: "none",
        does: {
          kind: "variants",
          options: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((pick) => [String(pick), { does: { kind: "wild_surge" as const, pick } }])),
        },
      },
    ],
  },
  // "When you take damage or fail a save while raging, a reaction rerolls
  // your Wild Surge effect" (the trigger: trigger-table.ts).
  "barbarian::Unstable Backlash": {
    subclass: "Path of Wild Magic",
    reactions: [{ name: "Unstable Backlash", gate: { raging: true }, does: { kind: "resurge" } }],
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
