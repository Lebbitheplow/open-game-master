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
};
