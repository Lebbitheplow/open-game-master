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
import { AUTHORED_DATA_B2 } from "@/lib/srd/authored-effects-data3";
import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

// The stone's row as the earlier table holds it (its options and effects).
const STONE = AUTHORED_DATA_B2["wizard::Transmuter's Stone"];

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
  // creature forgets it was charmed is the GM's to play. Its Hand card is aimed
  // at the charmed creatures alone (HandCard.aimHolds, read from the board's
  // chips), so it no longer stands open on a creature the engine refuses.
  "wizard::Alter Memories": {
    subclass: "School of Enchantment",
    spends: [{ name: "Alter Memories", action: "action", does: { kind: "strip_memory", save: "int", dcAbility: "spell", hoursAbility: "cha", condition: "memory stripped" } }],
  },
  // "You learn animate dead, raise one extra corpse per casting, and undead
  // you create with a necromancy spell gain your wizard level in extra hit
  // points and add your proficiency bonus to weapon damage": the server makes
  // the creatures, so it makes one more and makes them sturdier
  // (src/lib/dm/ar-ws-thralls.ts, from summon-cast.ts). The earlier row left
  // both to the GM's pen on a stat block the GM never writes.
  "wizard::Undead Thralls": {
    subclass: "School of Necromancy",
    effects: [
      { kind: "summon_extra", spell: "Animate Dead", amount: 1 },
      { kind: "summon_thrall", school: "necromancy", types: ["undead"] },
    ],
  },
  // "your hit point maximum cannot be reduced": a drain, a lowering effect
  // and exhaustion's halving all leave it where it is
  // (src/lib/dm/ar-ws-inured-logic.ts). The necrotic resistance of the same
  // feature is the feature table's (src/lib/srd/feature-effects.ts). No row
  // held this half before.
  "wizard::Inured to Undeath": {
    subclass: "School of Necromancy",
    effects: [{ kind: "max_hp_fixed" }],
  },
  // "An undead with an Intelligence of 12 or higher that failed repeats the
  // save at the end of every hour, breaking free on a success": the server
  // rolls it as the clock moves (src/lib/dm/ar-ws-command-hours.ts). The
  // earlier row, restated here whole, left that save to the GM.
  "wizard::Command Undead": {
    subclass: "School of Necromancy",
    spends: [
      {
        name: "Command Undead",
        action: "action",
        does: {
          kind: "save_effect",
          save: "cha",
          dcAbility: "spell",
          condition: "charmed",
          rangeFt: 60,
          sight: true,
          types: ["undead"],
          advantageAt: { ability: "int", atLeast: 8 },
          commands: true,
          hourlySaveAt: { ability: "int", atLeast: 12 },
          onFail: "obeys the wizard until they use this again (one of Intelligence 12 or more repeats the save at the end of every hour, rolled by the server as time passes, and breaks free on a success)",
        },
      },
    ],
  },
  // "changeable when you cast a transmutation spell": the stone's first
  // benefit is chosen out of a fight as before, and a change needs a
  // transmutation spell of 1st level or higher just cast, in a fight or out
  // (src/lib/dm/ar-ws-stone.ts, with the ruling). The earlier row, spread
  // here whole, let it change at will out of a fight and never in one.
  "wizard::Transmuter's Stone": {
    ...STONE,
    spends: (STONE.spends ?? []).map((spend) =>
      spend.does.kind === "choose" ? { ...spend, does: { ...spend.does, changeAfterCast: { school: "transmutation", minLevel: 1 } } } : spend,
    ),
  },
  // "and one of those attacks may be a cantrip with a casting time of one
  // action": the cast guard counts such a cantrip as one attack of the Attack
  // action, once per action (src/lib/dm/ar-ws-cantrip-attack.ts). The second
  // attack itself is feature-effects.ts's extra_attack.
  "wizard::Extra Attack": {
    subclass: "Bladesinging",
    // Extra Attack is every martial class's too: this one is the wizard's alone.
    ownClassOnly: true,
    effects: [{ kind: "attack_cantrip" }],
  },
  // "A reaction after being hit or failing a save grants +2 AC or +4 on the
  // save, at the cost of casting only cantrips on your next turn": the earlier
  // row held the +2 alone. The same reaction answers a save just failed with
  // +4, and every use leaves the mark the cast door reads
  // (src/lib/dm/ar-ws-deflection.ts, ar-ws-deflection-mark.ts).
  "wizard::Arcane Deflection": {
    subclass: "War Magic",
    reactions: [{ name: "Arcane Deflection", does: { kind: "ac_vs_hit", amount: 2, orSave: 4, cantripsOnly: true } }],
  },
  // "Arcane Deflection also deals half your wizard level in force damage to
  // up to three creatures within 60 feet": dealt by the reaction itself, to
  // the creatures the call names or the three nearest the wizard can see. The
  // earlier row left it to the GM and apply_damage.
  "wizard::Deflecting Shroud": {
    subclass: "War Magic",
    heldBy: { file: "src/lib/dm/ar-ws-deflection.ts", call: "deflectingShroud(" },
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
