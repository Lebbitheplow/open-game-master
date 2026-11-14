// The wards the horror classes set before a fight (cc1113 genre-c, WAVE2 D5:
// the genre text is the rule). Each is laid on the board by
// src/lib/dm/genre-gh-wards.ts: on the scene board standing when the ritual
// ends, and again on a fight's board while the ward still holds where the
// party is. Each lasts while its setter carries the ward's condition (the
// hours the text gives, kept by the world clock). Pure data.

import type { ZoneRow } from "@/lib/battlemap/zones-spells";

const HOUR = 600;

export const GENRE_GH_ZONE_ROWS: Record<string, ZoneRow> = {
  // Sanctified Ground (exorcist 5): "10 minutes of ritual wards a 30-ft area
  // for 8 hours; hostile spirits entering it are visible and take 1d8 radiant
  // on entry". 30 feet across, centred where the exorcist stood; a spirit is
  // an undead in the SRD's terms (as Rite of Repulsion reads it).
  "sanctified ground": {
    shape: "sphere", feet: 15, level: 0, concentration: false, rounds: 8 * HOUR, whileCondition: "sanctified ground", tone: "radiant",
    trigger: { on: ["enter"], who: "hostile", types: ["undead"], dice: "1d8", type: "radiant", reveals: ["invisible", "hidden"] },
    summary: "sanctified ground: a hostile spirit entering is seen and takes 1d8 radiant",
  },
  // Warding Sigil (occultist 1): "1 minute of chalk-work wards a doorway or
  // 5-ft line for 8 hours; the first hostile creature crossing takes 2d6
  // psychic (INT save halves)". One square, the sigil spent by its first.
  "warding sigil": {
    shape: "cube", feet: 5, level: 0, concentration: false, rounds: 8 * HOUR, whileCondition: "warding sigil", budget: 1, tone: "gloom",
    trigger: { on: ["enter"], who: "hostile", save: "int", dice: "2d6", type: "psychic", half: true, firstOnly: true },
    summary: "warding sigil: the first hostile creature crossing it makes an INT save, 2d6 psychic (half on a success)",
  },
  // Rite of the Threshold (occultist 9): "Your Warding Sigil can cover a
  // 15-ft radius and also blocks ethereal passage".
  "threshold sigil": {
    shape: "sphere", feet: 15, level: 0, concentration: false, rounds: 8 * HOUR, whileCondition: "warding sigil", budget: 1, barsEthereal: true, tone: "gloom",
    trigger: { on: ["enter"], who: "hostile", save: "int", dice: "2d6", type: "psychic", half: true, firstOnly: true },
    summary: "warding sigil: no ethereal creature crosses its edge; the first hostile creature entering makes an INT save, 2d6 psychic (half on a success)",
  },
  // Grounding Rig (parapsychologist 11): "a 10-minute setup makes a 20-ft
  // radius immune to teleportation and phasing for 1 hour".
  "grounding rig": {
    shape: "sphere", feet: 20, level: 0, concentration: false, rounds: HOUR, whileCondition: "grounding rig", noTeleport: true, barsEthereal: true, mundane: true, tone: "force",
    summary: "grounding rig: no creature teleports into, out of or within it, and no ethereal creature crosses its edge",
  },
};
