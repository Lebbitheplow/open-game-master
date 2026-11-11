// The sorcerer subclasses' rows built in the fifth round of the arcane repair
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

// A spell paid for with sorcery points in place of a slot is the cast guard's
// (src/lib/dm/ar-ws-points-cast.ts says when the points pay).
const POINTS_CAST = { file: "src/lib/dm/cast-guard.ts", call: "pointsOfferFor(sheet, engine, facts, input.level)" };

export const AUTHORED_DATA_W2_AR_WS_SORCERER: Record<string, AuthoredEntry> = {
  // "You have darkvision out to 120 feet" (the effect, as authored-effects-data4.ts
  // had it). "From 3rd level you know darkness ... you can cast it with 2
  // sorcery points as well as a slot, and when you do you can see through
  // that darkness": the cast guard takes the points and lays the darkness as
  // seen through by its caster (src/lib/battlemap/zones.ts seenThroughBy).
  "sorcerer::Eyes of the Dark": {
    subclass: "Shadow Magic",
    effects: [{ kind: "darkvision", feet: 120 }],
    heldBy: POINTS_CAST,
  },
  // "Spend 3 sorcery points to summon a shadow dire wolf that chases one
  // creature": the mark on the quarry (as authored-effects-data3.ts had it,
  // read by the enemy_save effect) and now the hound itself, a creature on
  // the sorcerer's side bound to that quarry (src/lib/dm/ar-ws-hound.ts).
  "sorcerer::Hound of Ill Omen": {
    subclass: "Shadow Magic",
    spends: [
      {
        name: "Hound of Ill Omen",
        pool: { id: "sorcery_points", amount: 3 },
        action: "bonus",
        does: { kind: "buff", hound: true, target: "enemy", condition: "hound of ill omen", rounds: 50 },
      },
    ],
    effects: [{ kind: "enemy_save", when: "marked", mark: "hound of ill omen" }],
  },
  // "Cast your psionic spells by spending sorcery points equal to the spell's
  // level instead of a slot, with no verbal, somatic or costly components."
  "sorcerer::Psionic Sorcery": { subclass: "Aberrant Mind", heldBy: POINTS_CAST },
  // "Before or after casting a spell of 1st level or higher, a bonus action
  // lets you fly 10 feet without provoking": the flight as authored-effects-data3.ts
  // had it, now open in a fight only once the turn has seen a levelled spell
  // cast (src/lib/dm/ar-ws-tempest-logic.ts has the ruling on "before").
  "sorcerer::Tempestuous Magic": {
    subclass: "Storm Sorcery",
    spends: [
      { name: "Tempestuous Magic", action: "bonus", afterLevelledCast: true, does: { kind: "teleport", feet: 10, note: "flying, without provoking opportunity attacks" } },
    ],
  },
  // "A reaction deals your sorcerer level in lightning damage to a melee
  // attacker and pushes it 20 feet on a failed Strength save": the damage as
  // authored-effects-data3.ts had it, and the push made in the reaction
  // (src/lib/dm/ar-ws-storm-fury.ts) where the earlier row answered a sentence
  // for a second call.
  "sorcerer::Storm's Fury": {
    subclass: "Storm Sorcery",
    reactions: [
      {
        name: "Storm's Fury",
        does: {
          kind: "strike_back",
          amount: (level) => level,
          type: "lightning",
          melee: true,
          save: { ability: "str", dcAbility: "spell", damageRegardless: true, pushFeet: 20 },
        },
      },
    ],
  },
};
