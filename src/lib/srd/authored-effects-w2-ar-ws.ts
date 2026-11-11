// The wizard subclasses' rows built in the fifth round of the arcane repair
// (the "ws" part of the clause ledger, scripts/clauses/arcane.json): features
// whose text states a mechanic no row held, or held only in part. Registered
// in AUTHORED_TABLE (src/lib/srd/authored-effects.ts) with one line.
//
// AUTHORED_TABLE takes the last row written for a key, whole: a row here for a
// feature an earlier table already holds spreads that row first and adds to
// it, so nothing the earlier rounds built is dropped.
//
// Pure.
import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

export const AUTHORED_DATA_W2_AR_WS: Record<string, AuthoredEntry> = {
  // "Add your proficiency bonus to ability checks made as part of an
  // abjuration spell, such as counterspell and dispel magic": the server rolls
  // both checks, so it adds the bonus (src/lib/dm/ar-ws-spell-check.ts). The
  // earlier row left it to the GM, who has no roll to add it to.
  "wizard::Improved Abjuration": {
    subclass: "School of Abjuration",
    effects: [{ kind: "spell_check_prof", school: "abjuration" }],
  },
  // "An enchantment spell of 1st level or higher that targets one creature
  // can target a second": the text sets no distance between the two, so each
  // need only be in the spell's own range (src/lib/dm/authored-reaper.ts). The
  // earlier row held the second creature to Reaper's 5 feet of the first.
  "wizard::Split Enchantment": {
    subclass: "School of Enchantment",
    effects: [{ kind: "twin_spell", school: "enchantment", minLevel: 1, maxLevel: 9, anywhere: true }],
  },
  // "you can strip up to your Charisma modifier plus one hour of memory on a
  // failed save": an action, the charmed creature's Intelligence save against
  // the wizard's spell save DC (src/lib/dm/ar-ws-alter-memories.ts). That the
  // creature forgets it was charmed is the GM's to play. No card in the Hand
  // (gm): the Hand knows no creature's conditions, so its card would stand
  // open on creatures the wizard has not charmed and be refused; the player
  // says it and the GM calls it on the charmed creature.
  "wizard::Alter Memories": {
    subclass: "School of Enchantment",
    spends: [{ name: "Alter Memories", action: "action", gm: true, does: { kind: "strip_memory", save: "int", dcAbility: "spell", hoursAbility: "cha", condition: "memory stripped" } }],
  },
  // "Halve or double a creature's or object's weight for a minute": a creature
  // of either side (src/lib/dm/ar-ws-buff-aim.ts). The earlier row took an ally
  // only, and a foe named for it was dropped for the wizard. The condition's
  // speed and Strength rolls are in authored-conditions.ts, its carrying
  // capacity in src/lib/srd/ar-ws-density.ts.
  "wizard::Adjust Density": {
    subclass: "Graviturgy Magic",
    spends: [
      {
        name: "Adjust Density",
        action: "action",
        does: {
          kind: "buff",
          target: "creature",
          condition: "adjusted density (lighter)",
          variants: { lighter: "adjusted density (lighter)", halve: "adjusted density (lighter)", heavier: "adjusted density (heavier)", double: "adjusted density (heavier)" },
          rounds: 10,
        },
      },
    ],
  },
  // "After a long rest you can create a magic scroll of a 1st- or 2nd-level
  // wizard spell from your book with a casting time of an action": the spell
  // is the variant, the scroll a row on the pack (src/lib/dm/ar-ws-scrivener.ts).
  // Written out of a fight, when a rest ends, and by name: the Hand has no
  // card that names a spell from the book, so the player says it and the GM
  // calls it; the scroll itself is a card (hand-items.ts).
  "wizard::Master Scrivener": {
    subclass: "Order of Scribes",
    counter: "sub_master_scrivener",
    spends: [{ name: "Master Scrivener", pool: { id: "sub_master_scrivener" }, action: "none", fight: "out", does: { kind: "scribe_scroll", minLevel: 1, maxLevel: 2 } }],
  },
  // "once per long rest you can cast a ritual spell from the book at its
  // normal casting time rather than adding 10 minutes": the use lays a mark
  // the next ritual from the book spends (src/lib/dm/ar-ws-awakened.ts, read by
  // the one cast guard). "you can change its damage type to one found in
  // another spell in your book of the slot's level": the same module, asked by
  // the guard for the type the cast tools were given. The earlier row left
  // both to the GM.
  "wizard::Awakened Spellbook": {
    subclass: "Order of Scribes",
    counter: "sub_awakened_spellbook",
    heldBy: { file: "src/lib/dm/cast-guard.ts", call: "awakenedDamageType(" },
    spends: [{ name: "Awakened Spellbook", pool: { id: "sub_awakened_spellbook" }, action: "none", does: { kind: "buff", condition: "swift ritual", rounds: 4800, untilLongRest: true } }],
  },
};
