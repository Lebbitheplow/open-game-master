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
};
