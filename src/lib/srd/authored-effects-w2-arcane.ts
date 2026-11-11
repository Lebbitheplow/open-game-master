// The arcane subclasses' rows built in the second wave of the clause ledger
// (scripts/clauses/arcane.json): features of the wizard, sorcerer, warlock
// and bard whose text states a mechanic no row held. Registered in
// AUTHORED_TABLE (src/lib/srd/authored-effects.ts) with one line, so the
// other packages' tables are never appended to.
//
// Pure.
import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";
import { INFUSIONS } from "@/lib/srd/infusions";

const LUNAR_PHASES = ["Full Moon", "New Moon", "Crescent Moon"];

// The SRD 5.1 spells of the artificer's list a Spell-Storing Item takes: 1st
// and 2nd level, cast with one action (src/lib/dm/spell-storing-item.ts). The
// SRD's spells name no artificer among their classes, so the list is held
// here, where the card's picker and the spend both read it.
export const STORABLE_SPELLS = [
  "Cure Wounds", "Detect Magic", "Disguise Self", "Expeditious Retreat", "Faerie Fire", "False Life", "Grease", "Jump", "Longstrider", "Purify Food and Drink",
  "Aid", "Alter Self", "Arcane Lock", "Blur", "Continual Flame", "Darkvision", "Enhance Ability", "Enlarge/Reduce", "Heat Metal", "Invisibility", "Lesser Restoration", "Levitate",
  "Protection from Poison", "Rope Trick", "See Invisibility", "Spider Climb", "Web",
];

export const AUTHORED_DATA_W2_ARCANE: Record<string, AuthoredEntry> = {
  // Each Infusion pick (src/lib/srd/options.json): what it does is the
  // infused item's, laid by Infuse Item (src/lib/dm/infuse-item.ts) and run
  // where the item is used through the item finders that read its row.
  ...Object.fromEntries(
    INFUSIONS.map((def) => [`artificer::Infusion: ${def.name}`, { subclass: "Artificer", heldBy: { file: "src/lib/srd/infusions.ts", call: "infusionNamed(" } } satisfies AuthoredEntry]),
  ),
  // A core artificer feature (20th). Its hold at 1 hit point is pc-damage.ts's
  // (src/lib/dm/soul-of-artifice.ts); this card readies which attunement it
  // ends, picked from the items attuned.
  "artificer::Soul of Artifice": {
    subclass: "Artificer",
    spends: [{ name: "Soul of Artifice", action: "none", does: { kind: "soul_ready" } }],
  },
  // The spell a Spell-Storing Item takes, picked from its list. Resolved by
  // the counter's own door (src/lib/dm/spell-storing-item.ts, asked first
  // by srd-feature-spends.ts); this row gives the card its picker.
  "artificer::Spell-Storing Item": {
    subclass: "Artificer",
    spends: [{ name: "Spell-Storing Item", pool: { id: "art_spell_storing_item" }, fight: "out", does: { kind: "choose", options: STORABLE_SPELLS } }],
  },
  // "Once per turn when you deal damage to a creature or object with a wizard
  // spell, you can spend one to deal extra force damage equal to half your
  // wizard level": after a wizard spell of this turn hurt the creature
  // (src/lib/dm/spell-damage-mark.ts), on that creature. What a rest gives
  // back is the counter's row (restHolds in authored-resources.json).
  "wizard::Power Surge": {
    subclass: "War Magic",
    spends: [
      {
        // The counter's own name, so its card and painting stay the surge's.
        name: "Power Surges",
        aliases: ["Power Surge"],
        pool: { id: "sub_power_surge" },
        oncePerTurn: true,
        afterSpellDamage: true,
        does: { kind: "die_damage", dice: (level) => Math.max(1, Math.floor(level / 2)), type: "force" },
      },
    ],
  },
  // "As an action, animate a Large or smaller nonmagical item within 30 feet
  // as a Dancing Item for an hour": an ally with its stat block
  // (src/lib/dm/summon-arcane.ts). The slot that buys another use is the
  // counter's slotFallback.
  "bard::Animating Performance": {
    subclass: "College of Creation",
    spends: [{ name: "Animating Performance", pool: { id: "sub_animating_performance" }, action: "action", does: { kind: "summon", form: "Dancing Item" } }],
  },
  // "Create a nonmagical item worth no more than 20 times your bard level as
  // an action": the item named goes into the pack (authored-spend-arcane.ts).
  "bard::Performance of Creation": {
    subclass: "College of Creation",
    spends: [{ name: "Performance of Creation", pool: { id: "sub_performance_of_creation" }, action: "action", does: { kind: "create_item", gpPerLevel: 20 } }],
  },
  // "Once on each of your turns, when you hit a creature with an attack roll,
  // you can make it save on Wisdom against your spell save DC or be
  // frightened of you until the end of your next turn", while the form runs
  // (src/lib/dm/hit-save.ts). Its temporary hit points and its immunity to
  // fright are the counter's and condition-effects.ts's.
  "warlock::Form of Dread": {
    subclass: "The Undead",
    effects: [{ kind: "hit_save", save: "wis", condition: "frightened", gate: { condition: "form of dread" } }],
  },
  // The Bladesong's "advantage on Acrobatics" while it runs (the counter
  // sub_bladesong lays the condition; its AC and speed are condition-effects.ts's).
  "wizard::Bladesong": {
    subclass: "Bladesinging",
    effects: [{ kind: "check_adv", skills: ["acrobatics"], gate: { condition: "bladesong" } }],
  },
  // "While your spellbook is on your person you have advantage on
  // Intelligence (Arcana) checks". The reaction that spends the book is the
  // counter's (src/lib/dm/reaction-counters.ts); a wizard's book is taken to
  // be carried, as every wizard spell cast from it is.
  "wizard::One with the Word": {
    subclass: "Order of Scribes",
    effects: [{ kind: "check_adv", skills: ["arcana"] }],
  },
  // "and advantage on saves against being charmed or frightened"; the
  // psychic resistance is feature-effects.ts's.
  "sorcerer::Psychic Defenses": {
    subclass: "Aberrant Mind",
    effects: [{ kind: "save_adv", against: ["charmed", "frightened"] }],
  },
  // "As a bonus action you can spend 1 sorcery point to change your current
  // phase": in a fight too, where Lunar Embodiment's own choice (fight: out)
  // is shut. The free castings of each phase's spell are the cast guard's
  // (src/lib/srd/counter-casts.ts sub_waxing_and_waning).
  "sorcerer::Waxing and Waning": {
    subclass: "Lunar Sorcery",
    spends: [
      {
        name: "Change Phase",
        aliases: ["Waxing and Waning"],
        pool: { id: "sorcery_points", amount: 1 },
        action: "bonus",
        does: { kind: "choose", options: LUNAR_PHASES, feature: "Lunar Embodiment" },
      },
    ],
  },
};
