// The table every character of the Hand sweep is seated at: the spells a
// caster is given, the board, where everyone stands, and the states walked
// (scripts/lib/sweep-hand.mjs seats and stages them).

// The spells a caster is given: a few of every way a spell resolves (an
// attack roll, a save, an area, a heal, a buff, a reaction, a bonus action,
// concentration, a ritual), all SRD 5.1. `conc` is the one the
// "concentrating" state holds.
export const KITS = {
  bard: { ability: "cha", cantrips: ["Vicious Mockery", "Light"], spells: ["Healing Word", "Cure Wounds", "Dissonant Whispers", "Faerie Fire", "Hold Person", "Heat Metal", "Hypnotic Pattern", "Dispel Magic", "Polymorph", "Mass Cure Wounds", "Detect Magic", "Thunderwave"], conc: "Faerie Fire", known: true },
  cleric: { ability: "wis", cantrips: ["Sacred Flame", "Guidance"], spells: ["Cure Wounds", "Healing Word", "Bless", "Guiding Bolt", "Shield of Faith", "Spiritual Weapon", "Hold Person", "Spirit Guardians", "Revivify", "Flame Strike", "Banishment", "Inflict Wounds", "Lesser Restoration"], conc: "Bless" },
  druid: { ability: "wis", cantrips: ["Produce Flame", "Shillelagh"], spells: ["Entangle", "Cure Wounds", "Faerie Fire", "Thunderwave", "Moonbeam", "Call Lightning", "Conjure Animals", "Barkskin", "Healing Word", "Heat Metal", "Ice Storm"], conc: "Faerie Fire" },
  sorcerer: { ability: "cha", cantrips: ["Fire Bolt", "Ray of Frost", "Shocking Grasp"], spells: ["Magic Missile", "Shield", "Burning Hands", "Scorching Ray", "Misty Step", "Fireball", "Counterspell", "Haste", "Hold Person", "Lightning Bolt", "Cone of Cold"], conc: "Haste", known: true },
  warlock: { ability: "cha", cantrips: ["Eldritch Blast", "Chill Touch"], spells: ["Hex", "Hellish Rebuke", "Hold Person", "Misty Step", "Counterspell", "Fly", "Burning Hands", "Banishment"], conc: "Hex", known: true },
  wizard: { ability: "int", cantrips: ["Fire Bolt", "Shocking Grasp", "Acid Splash"], spells: ["Magic Missile", "Shield", "Mage Armor", "Sleep", "Web", "Fireball", "Counterspell", "Lightning Bolt", "Feather Fall", "Detect Magic", "Hold Person", "Misty Step", "Cone of Cold", "Wall of Fire"], conc: "Web", book: true },
  paladin: { ability: "cha", cantrips: [], spells: ["Bless", "Cure Wounds", "Shield of Faith", "Divine Favor", "Command", "Branding Smite", "Lesser Restoration", "Revivify"], conc: "Bless" },
  ranger: { ability: "wis", cantrips: [], spells: ["Hunter's Mark", "Cure Wounds", "Spike Growth", "Pass without Trace", "Conjure Animals", "Lesser Restoration"], conc: "Hunter's Mark", known: true },
  artificer: { ability: "int", cantrips: ["Fire Bolt", "Mending"], spells: ["Cure Wounds", "Faerie Fire", "Heat Metal", "Haste", "Lesser Restoration", "Revivify"], conc: "Faerie Fire" },
  third: { ability: "int", cantrips: ["Fire Bolt", "Shocking Grasp"], spells: ["Magic Missile", "Shield", "Burning Hands", "Misty Step", "Hold Person", "Fireball"], conc: "Hold Person", known: true },
};

export const ABILITIES = { str: 16, dex: 16, con: 14, int: 16, wis: 16, cha: 16 };

// The board every table is laid on: fifty squares by nine, open and bright.
// The character stands at (24,4) with a foe beside them, one at 30 feet and
// one at 100; an ally beside them, a mage and an ally at 0 hit points.
const WIDTH = 50;
export const ROWS = Array.from({ length: 9 }, () => ".".repeat(WIDTH));
export const SPOTS = {
  hero: { x: 24, y: 4 },
  near: { x: 25, y: 4 },
  mid: { x: 30, y: 4 },
  far: { x: 44, y: 4 },
  ally: { x: 23, y: 4 },
  mage: { x: 24, y: 3 },
  down: { x: 24, y: 5 },
};

export const STATES = [
  "fresh", "action-spent", "bonus-spent", "reaction-spent", "zero-hp", "stunned", "prone", "grappled",
  "blinded", "darkness", "silenced", "no-free-hand", "raging", "concentrating", "foe-30ft", "foe-100ft",
  "foe-invisible", "out-of-fight", "hit-on-hero", "hit-on-ally", "failed-save",
];

// The creature types a refused card is tried against before the refusal is
// held against it: Turn Undead with no undead near, Hold Person on a beast.
export const FOE_TYPES = ["undead", "beast", "fiend", "fey", "plant", "elemental", "celestial", "aberration", "humanoid"];

