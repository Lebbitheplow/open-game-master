// The monk and rogue subclasses' rows wave 2 built (part mr): registered in
// AUTHORED_TABLE (authored-effects.ts) with one line, so no other package
// appends to this array. A row changed in place stays in the data file that
// held it; a row that was only narrated moved here once an engine held it.

import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

export const AUTHORED_DATA_W2_MT_MR: Record<string, AuthoredEntry> = {
  // ---- monk ----
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
  // in feet. Homing Strikes still waits on an offer after a missed attack.
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
    narrated: "Homing Strikes' die on a missed Psychic Blade: the GM rolls the die (the counter's) and adds it to the attack roll.",
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
        does: { kind: "mr", id: "rend_mind", aims: "enemy" },
      },
    ],
  },
  "rogue::Death's Friend": {
    subclass: "Phantom",
    heldBy: { file: "src/lib/dm/rest-tools.ts", call: "soulTrinketAtRestEnd(" },
  },
};
