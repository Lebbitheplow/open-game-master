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

const FULL_MOON = { feature: "Lunar Embodiment", value: "full moon" };
const NEW_MOON = { feature: "Lunar Embodiment", value: "new moon" };

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
  // "Once per turn, the highest damage die you roll for a spell explodes: roll
  // it again and add it": at every door a character's spell damage is rolled
  // (src/lib/dm/ar-ws-bombardment.ts names them), with no call of its own.
  // The row authored-effects-data3.ts had (the Full Moon's checks, the New
  // Moon's Stealth, the Crescent Moon's resistances), with the two halves it
  // left to the GM: "Full Moon: a bonus action sheds bright light in 10 feet
  // and dim light 10 feet beyond (or douses it)" is the spend, and "attack
  // rolls against you have disadvantage while you are entirely in darkness"
  // the New Moon's second effect (src/lib/dm/ar-ws-lunar-empowerment.ts).
  "sorcerer::Lunar Empowerment": {
    subclass: "Lunar Sorcery",
    effects: [
      { kind: "check_adv", skills: ["investigation", "perception"], gate: { choiceOf: FULL_MOON }, note: "Only within the bright light the sorcerer sheds; the GM keeps to that." },
      { kind: "check_adv", skills: ["stealth"], gate: { choiceOf: NEW_MOON } },
      { kind: "attacked_disadv_dark", gate: { choiceOf: NEW_MOON } },
      { kind: "resist", types: ["necrotic", "radiant"], gate: { choiceOf: { feature: "Lunar Embodiment", value: "crescent moon" } } },
    ],
    spends: [{ name: "Lunar Empowerment", aliases: ["Moonlight"], action: "bonus", gate: { choiceOf: FULL_MOON }, does: { kind: "light", brightFt: 10, dimFt: 10, condition: "moonlight" } }],
  },
  // "Spend 1 to 5 sorcery points to give a creature that many d8s to spend
  // reducing damage, until your next long rest": the points in amount, an
  // action, the creature within 30 feet; the warded creature spends the dice
  // itself (src/lib/dm/ar-ws-bastion.ts).
  "sorcerer::Bastion of Law": {
    subclass: "Clockwork Soul",
    spends: [{ name: "Bastion of Law", pool: { id: "sorcery_points", perUnit: true, max: 5 }, action: "action", does: { kind: "damage_ward", die: "d8", rangeFt: 30, condition: "bastion of law" } }],
  },
  // "Spend 1 sorcery point to reroll healing dice for yourself or an ally,
  // once per turn": it answers the healing dice a spell rolled this turn
  // (src/lib/srd/trigger-table.ts), costs nothing of the turn, and keeps its
  // once a turn itself, since the turn is often an ally's
  // (src/lib/dm/ar-ws-empowered-healing.ts).
  "sorcerer::Empowered Healing": {
    subclass: "Divine Soul",
    spends: [{ name: "Empowered Healing", pool: { id: "sorcery_points", amount: 1 }, action: "none", does: { kind: "reroll_heal" } }],
  },
  "sorcerer::Spell Bombardment": { subclass: "Wild Magic", heldBy: { file: "src/lib/dm/ar-ws-bombardment.ts", call: "holdsFeature(sheet, SPELL_BOMBARDMENT)" } },
};
