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
  // "and one of those attacks may be a cantrip with a casting time of one
  // action": the cast guard counts such a cantrip as one attack of the Attack
  // action, once per action (src/lib/dm/ar-ws-cantrip-attack.ts). The second
  // attack itself is feature-effects.ts's extra_attack.
  "wizard::Extra Attack": {
    subclass: "Bladesinging",
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
};
