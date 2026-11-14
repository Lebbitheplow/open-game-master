// The areas the dark fantasy classes' spends lay on the board, wired by the
// 2026-11-13 creator audit's second genre pass (WAVE2 D5: the genre text is
// the rule). They run as the spell areas do (src/lib/battlemap/zones-spells.ts
// zoneRowFor reads these after the spells), laid by src/lib/dm/genre-b-zones.ts
// layGenreZone and resolved by the zone triggers. A swarm of rats or a ring of
// quicklime is no spell: nothing here is magic, and each save's DC is the
// feature's, carried on the area. Pure data.

import type { ZoneRow } from "@/lib/battlemap/zones-spells";

const MINUTE = 10;

// Rat Tide: "creatures inside save (DEX) or take 2d6 piercing and are
// distracted (disadvantage on their next attack)". The text gives the swarm no
// duration; it stays a minute, as the other genre swarms do, which is also the
// "while your swarm is active" The Walls Have Teeth reads.
const ratTide = (feet: number): ZoneRow => ({
  shape: "cube", feet, level: 0, concentration: false, rounds: MINUTE, difficult: 2, mundane: true, tone: "nature",
  catchesWhenLaid: true,
  trigger: { on: ["enter"], save: "dex", dice: "2d6", type: "piercing", damageOnFail: true, condition: "distracted by rats", oncePerTurn: true },
  summary: "a flood of rats: difficult terrain; entering it, DEX save or 2d6 piercing and disadvantage on the next attack",
});

export const RAT_TIDE = "rat tide";
export const RAT_TIDE_GROWN = "rat tide grown";
export const GARDEN_OF_GRIEF = "garden of grief";

export const GENRE_CC_A_ZONE_ROWS: Record<string, ZoneRow> = {
  // Quarantine Ring: "a 20-ft radius circle for 10 minutes: enemies treat it
  // as difficult terrain and take 2d6 poison entering (CON save halves)",
  // drawn around the plague doctor where they stand.
  "quarantine ring": {
    shape: "sphere", feet: 20, level: 0, concentration: false, rounds: 10 * MINUTE, self: true, halvesHostile: true, mundane: true, tone: "poison",
    trigger: { on: ["enter"], who: "hostile", save: "con", dice: "2d6", type: "poison", half: true, oncePerTurn: true },
    summary: "a ring of quicklime and smoke: enemies move at half speed in it; an enemy entering it takes 2d6 poison, CON save for half",
  },
  // Garden of Grief: "a 20-ft radius garden of black roses for 1 minute:
  // allies in it regain 1d6 HP per turn, enemies are slowed". Grown where
  // the grave knight stands; the healing is read as each ally's turn starts
  // (src/lib/dm/genre-cc-a-turns.ts).
  [GARDEN_OF_GRIEF]: {
    shape: "sphere", feet: 20, level: 0, concentration: false, rounds: MINUTE, self: true, halvesHostile: true, mundane: true, tone: "nature",
    summary: "black roses: enemies move at half speed in it; an ally starting a turn in it regains 1d6 hit points",
  },
  [RAT_TIDE]: ratTide(15),
  // Rat Tide (2 uses): "its cube grows to 20 ft".
  [RAT_TIDE_GROWN]: ratTide(20),
};
