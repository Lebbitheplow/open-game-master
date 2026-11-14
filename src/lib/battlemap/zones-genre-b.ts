// The areas the mystery, post-apocalyptic and steampunk classes' spends lay
// on the board (WAVE2 D5: the genre text is the rule). They run as the spell
// areas do (src/lib/battlemap/zones-spells.ts zoneRowFor reads these after the
// spells), laid by src/lib/dm/genre-b-zones.ts and resolved by the zone
// triggers. A device or a sermon is no spell: nothing here is magic, and each
// save's DC is the feature's, carried on the area. Pure data.

import type { ZoneRow } from "@/lib/battlemap/zones-spells";

const MINUTE = 10;

export const GENRE_B_ZONE_ROWS: Record<string, ZoneRow> = {
  // A gadgeteer's Smoke Bomb: "thrown up to 30 feet, a 10-foot radius of
  // smoke that blocks sight for a minute"; Smoke Discipline: "Your smoke
  // bombs fill a 15-ft radius and you see through your own smoke" (the zone
  // is laid seen through by its thrower: src/lib/dm/genre-b-zones.ts).
  "smoke bomb": {
    shape: "sphere", feet: 10, level: 0, concentration: false, rounds: MINUTE, obscured: "heavy", gas: true, mundane: true, tone: "fog",
    summary: "smoke: heavily obscured (blocks sight)",
  },
  "disciplined smoke": {
    shape: "sphere", feet: 15, level: 0, concentration: false, rounds: MINUTE, obscured: "heavy", gas: true, mundane: true, tone: "fog",
    summary: "smoke: heavily obscured (blocks sight), its thrower sees through it",
  },
  // Gear Swarm: "a 15-ft cube becomes difficult terrain and deals 2d6 slashing
  // to creatures entering it, for 1 minute".
  "gear swarm": {
    shape: "cube", feet: 15, level: 0, concentration: false, rounds: MINUTE, difficult: 2, mundane: true, tone: "blade",
    trigger: { on: ["enter"], dice: "2d6", type: "slashing", oncePerTurn: true },
    summary: "whirring gears: difficult terrain; entering it, 2d6 slashing",
  },
  // Dissolving Mist: "a 20-ft radius acid fog for 1 minute: 3d6 acid at the
  // start of each creature's turn inside (CON save halves)". Each creature,
  // the alchemist's friends too: the fog spares nobody.
  "dissolving mist": {
    shape: "sphere", feet: 20, level: 0, concentration: false, rounds: MINUTE, gas: true, mundane: true, tone: "poison",
    trigger: { on: ["start"], save: "con", dice: "3d6", type: "acid", half: true },
    summary: "acid fog: starting a turn there, CON save, 3d6 acid (half on a success)",
  },
  // Dawnlight: "your raised hand sheds sunlight in a 30-ft radius for 10
  // minutes". The light goes with the preacher and ends with the dawnlight
  // the spend laid on them.
  dawnlight: {
    shape: "aura", feet: 30, level: 0, concentration: false, rounds: 10 * MINUTE, light: true, whileCondition: "dawnlight", mundane: true, tone: "radiant",
    summary: "sunlight: undead and monstrosities in it attack at disadvantage",
  },
  // The Last Dawn Rises: "Your Dawnlight damages: hostile undead and
  // aberrations take 2d8 radiant entering or starting their turn in it."
  "the last dawn": {
    shape: "aura", feet: 30, level: 0, concentration: false, rounds: 10 * MINUTE, light: true, whileCondition: "dawnlight", mundane: true, tone: "radiant",
    trigger: { on: ["enter", "start"], who: "hostile", types: ["undead", "aberration"], dice: "2d8", type: "radiant", oncePerTurn: true },
    summary: "burning sunlight: undead and monstrosities in it attack at disadvantage; a hostile undead or aberration entering or starting its turn there takes 2d8 radiant",
  },
};
