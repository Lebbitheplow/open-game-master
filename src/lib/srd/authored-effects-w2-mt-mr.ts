// The monk and rogue subclasses' rows wave 2 built (part mr): registered in
// AUTHORED_TABLE (authored-effects.ts) with one line, so no other package
// appends to this array. A row changed in place stays in the data file that
// held it; a row that was only narrated moved here once an engine held it.

import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

// As src/lib/srd/mt-mr-unarmed.ts reads them (that module imports the table,
// so the words are written here).
const DRACONIC_CHOICES = ["Acid", "Cold", "Fire", "Lightning", "Poison", "Bludgeoning"];

export const AUTHORED_DATA_W2_MT_MR: Record<string, AuthoredEntry> = {
  // ---- monk ----
  // "Spend 2 ki to cast darkness, darkvision, pass without trace or silence,
  // and you know minor illusion": grants the cast guard reads, the ki spent
  // by the spell's own tool (src/lib/srd/mt-mr-casts.ts).
  "monk::Shadow Arts": {
    subclass: "Way of Shadow",
    heldBy: { file: "src/lib/srd/granted-casts.ts", call: "kiCastsHeld(" },
  },
  // An action, as the published feature: invisible while the monk's square is
  // dim or dark, until they attack, cast or step into light.
  "monk::Cloak of Shadows": {
    subclass: "Way of Shadow",
    spends: [{ name: "Cloak of Shadows", action: "action", needs: "shadows", does: { kind: "mr", id: "cloak_of_shadows" } }],
  },
  // "Flurry of Blows also grants the benefit of Disengage and 10 feet of
  // extra movement": written on the turn as the flurry is bought.
  "monk::Drunken Technique": {
    subclass: "Way of the Drunken Master",
    heldBy: { file: "src/lib/dm/bonus-actions.ts", call: "flurryBought(" },
  },
  // "Kensei weapons count as magical" is the attack profile's
  // (src/lib/srd/mt-mr-kensei.ts kenseiStance); the 1 ki for the martial arts
  // die on a hit is Deft Strike.
  "monk::One with the Blade": {
    subclass: "Way of the Kensei",
    spends: [
      {
        name: "Deft Strike",
        aliases: ["One with the Blade"],
        pool: { id: "ki", amount: 1 },
        oncePerTurn: true,
        action: "none",
        afterWeaponHit: true,
        does: { kind: "mr", id: "deft_strike", aims: "enemy" },
      },
    ],
  },
  // "Reroll a missed monk-weapon attack once per turn": offered on the card
  // the missed attack waits on (mt-mr-offers-logic.ts mrAttackOffers).
  "monk::Unerring Accuracy": {
    subclass: "Way of the Kensei",
    heldBy: { file: "src/lib/dm/mt-mr-offers-logic.ts", call: 'holdsRow(sheet, "monk::Unerring Accuracy")' },
  },
  // Hand of Healing ends a condition and Hand of Harm poisons, both in the
  // spends themselves.
  "monk::Physician's Touch": {
    subclass: "Way of Mercy",
    heldBy: { file: "src/lib/dm/mt-mr-spends.ts", call: "physiciansTouch(" },
  },
  // Every strike of the flurry may be given up for Hand of Healing, and Hand
  // of Harm on one of its strikes takes no ki (the "flurry_harm" need).
  "monk::Flurry of Healing and Harm": {
    subclass: "Way of Mercy",
    heldBy: { file: "src/lib/dm/mt-mr-needs.ts", call: 'holdsRow(sheet, "monk::Flurry of Healing and Harm")' },
  },
  // Draconic Strike: the type the unarmed strikes deal in place of
  // bludgeoning is a standing choice, changed at will with no action
  // (use_resource "Draconic Strike", the type as its variant; "Bludgeoning"
  // goes back). The attack profile reads it (src/lib/srd/mt-mr-unarmed.ts),
  // and so do the wyrm's ward and Explosive Fury (src/lib/dm/mt-mr-dragon.ts).
  // The language is the sheet's training.
  // Draconic Presence's reroll is offered on the card a failed Intimidation
  // or Persuasion check waits on (src/lib/dm/mt-mr-offers-logic.ts); its
  // counter is spent only when the reroll turns the failure.
  "monk::Draconic Disciple": {
    subclass: "Way of the Ascendant Dragon",
    counter: "sub_draconic_presence",
    spends: [{ name: "Draconic Strike", aliases: ["Draconic Disciple"], action: "none", does: { kind: "choose", options: DRACONIC_CHOICES } }],
  },
  // The aura, either kind (src/lib/dm/mt-mr-dragon.ts): the frightening one
  // asks its save as an enemy's turn starts within 10 feet, and the ward's
  // condition names the type its allies resist ("aspect of the wyrm: ward
  // (fire)"). Once a long rest, or 3 ki with the use spent.
  "monk::Aspect of the Wyrm": {
    subclass: "Way of the Ascendant Dragon",
    counter: "sub_aspect_of_the_wyrm",
    effects: [{ kind: "aura_resist", rangeFt: 10, typeFrom: { condition: "aspect of the wyrm: ward", map: { acid: "acid", cold: "cold", fire: "fire", lightning: "lightning", poison: "poison" } } }],
    spends: [
      {
        name: "Aspect of the Wyrm",
        pool: { id: "sub_aspect_of_the_wyrm", fallback: "ki", fallbackAmount: 3 },
        action: "bonus",
        does: {
          kind: "variants",
          options: {
            frighten: { does: { kind: "mr", id: "wyrm_frighten" } },
            "ward acid": { does: { kind: "mr", id: "wyrm_ward" } },
            "ward cold": { does: { kind: "mr", id: "wyrm_ward" } },
            "ward fire": { does: { kind: "mr", id: "wyrm_ward" } },
            "ward lightning": { does: { kind: "mr", id: "wyrm_ward" } },
            "ward poison": { does: { kind: "mr", id: "wyrm_ward" } },
          },
        },
      },
    ],
  },
  // Explosive Fury rides the activation of Aspect of the Wyrm
  // (mt-mr-dragon.ts explosiveFury), where it was a spend of its own with
  // nothing to answer. Augment Breath is asked for in Breath of the Dragon's
  // own call (breathAugment); the blindsight is src/lib/srd/mt-mr-senses.ts.
  "monk::Ascendant Aspect": {
    subclass: "Way of the Ascendant Dragon",
    heldBy: { file: "src/lib/dm/mt-mr-dragon.ts", call: "explosiveFury(" },
  },
  // "When you use Step of the Wind" is the counter's trigger
  // (trigger-table.ts); the wings last to the end of the turn.
  "monk::Wings Unfurled": {
    subclass: "Way of the Ascendant Dragon",
    counter: "sub_wings_unfurled",
    spends: [{ name: "Wings Unfurled", pool: { id: "sub_wings_unfurled" }, action: "none", does: { kind: "mr", id: "wings_unfurled" } }],
  },

  // ---- rogue ----
  // "A creature you attack in melee cannot make opportunity attacks against
  // you for the rest of your turn": the mark Mobile leaves, for a holder.
  "rogue::Fancy Footwork": {
    subclass: "Swashbuckler",
    heldBy: { file: "src/lib/dm/pc-attack-spend.ts", call: 'holdsRow(sheet, "rogue::Fancy Footwork")' },
  },
  // The necrotic on the first creature is Wails from the Grave's own spend
  // (authored-effects-sweep-counters.ts, afterSneak.firstToo); the trinket at
  // a long rest's end is the rest's.
  // Psychic Teleportation is the engine's: a die rolled, ten times its roll
  // in feet. Homing Strikes is offered on the card a missed psychic blade
  // waits on (mt-mr-offers-logic.ts mrAttackOffers), its die spent only when
  // it turns the miss.
  "rogue::Soul Blades": {
    subclass: "Soulknife",
    spends: [
      {
        name: "Psychic Teleportation",
        pool: { id: "sub_psionic_energy", amount: 1 },
        action: "bonus",
        does: { kind: "mr", id: "psychic_teleport" },
      },
    ],
  },
  // "Spend a die to turn a failed check with a proficient skill or tool into
  // a success if the die closes the gap": offered on the card the failed
  // check waits on (mt-mr-offers-logic.ts mrCheckOffers).
  "rogue::Psi-Bolstered Knack": {
    subclass: "Soulknife",
    heldBy: { file: "src/lib/dm/mt-mr-offers-logic.ts", call: 'holdsRow(sheet, "rogue::Psi-Bolstered Knack")' },
  },
  // The counter's free use, or three Psionic Energy dice with it spent.
  "rogue::Rend Mind": {
    subclass: "Soulknife",
    counter: "sub_rend_mind",
    spends: [
      {
        name: "Rend Mind",
        pool: { id: "sub_rend_mind", fallback: "sub_psionic_energy", fallbackAmount: 3 },
        action: "none",
        fight: "in",
        // The Sneak Attack it answers is a weapon hit of this turn: the card
        // waits for one, as every spend that rides a hit does.
        afterWeaponHit: true,
        does: { kind: "mr", id: "rend_mind", aims: "enemy" },
      },
    ],
  },
  "rogue::Death's Friend": {
    subclass: "Phantom",
    heldBy: { file: "src/lib/dm/rest-tools.ts", call: "soulTrinketAtRestEnd(" },
  },
};
