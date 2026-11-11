// The glyph each published spell wears where its own rows cannot say it
// (issue 845). spell-glyph-logic.ts reads a spell's damage type, healing,
// cure, summoning, condition or buff from the engine's mechanics row; the
// names here are the spells that row leaves silent or would mislead:
//
//   - spells with no mechanics row bundled (the pack's text is the only
//     source, and a server without the pack still deals their cards);
//   - a row that buffs, where the spell is read by what it does with that
//     buff: the smites and Spiritual Weapon by their damage, Mage Armor and
//     Sanctuary as a guard, Blink as a step through space;
//   - the reviewed picks of the glyph council (issue 845, round 2):
//     restore for the spells that end a condition or curse, dispel for the
//     two that end a spell, choice where the caster picks the damage type
//     (Chromatic Orb) or a die does (Chaos Bolt, Prismatic Spray).
//
// Seeded from grokbot's reviewed map of the 510 spells in
// src/lib/srd/manifest/spells.json (protection renamed guard, control
// renamed debuff), and kept to only what the rows do not already answer:
// scripts/test-spell-glyphs.mjs fails on a name here that the rules would
// give the same glyph, and on any manifest spell left without one.
import type { SpellGlyph } from "@/lib/battlemap/spell-glyph-logic";

export const SPELL_GLYPH_NAMES: Partial<Record<SpellGlyph, string[]>> = {
  acid: [
    "Caustic Brew", "Primal Savagery", "Vitriolic Sphere",
  ],
  buff: [
    "Alter Self", "Awaken", "Beast Bond", "Borrowed Knowledge", "Darkvision", "Fortune's Favor", "Friends",
    "Glibness", "Mass Polymorph", "Rary's Telepathic Bond", "Seeming", "Skill Empowerment",
    "Sudden Awakening", "Tongues", "Water Breathing",
  ],
  choice: [
    "Chaos Bolt", "Chromatic Orb", "Dragon's Breath", "Elemental Weapon", "Forbiddance", "Glyph of Warding",
    "Prismatic Spray", "Spirit Shroud",
  ],
  cold: [
    "Binding Ice", "Frostbite", "Hunger of Hadar", "Ice Knife", "Ice Storm", "Investiture of Ice",
    "Snowball Swarm",
  ],
  debuff: [
    "Cause Fear", "Charm Monster", "Color Spray", "Compelled Duel", "Compulsion", "Control Winds",
    "Crown of Madness", "Darkness", "Divine Word", "Draconic Mischief", "Earthbind", "Elemental Bane",
    "Enemies Abound", "Ensnaring Strike", "Enthrall", "Forcecage", "Grasping Vine", "Gust", "Gust of Wind",
    "Hunter's Mark", "Illusory Dragon", "Immovable Object", "Magic Jar", "Planar Binding", "Power Word Kill",
    "Power Word Pain", "Puppet", "Ray of Enfeeblement", "Reality Break", "Reverse Gravity", "Silence",
    "Silvery Barbs", "Sleep", "Snare", "Soul Cage", "Stinking Cloud", "Symbol", "Telekinesis",
    "Temporal Shunt", "Time Stop", "Transmute Rock", "Wall of Sand", "Watery Sphere", "Zone of Truth",
  ],
  detection: [
    "Arcane Eye", "Augury", "Beast Sense", "Clairvoyance", "Commune", "Commune with Nature",
    "Comprehend Languages", "Contact Other Plane", "Detect Evil and Good", "Detect Magic",
    "Detect Poison and Disease", "Detect Thoughts", "Divination", "Find Traps", "Find the Path", "Identify",
    "Legend Lore", "Locate Animals or Plants", "Locate Creature", "Locate Object", "Scrying",
    "See Invisibility", "Speak with Animals", "Speak with Dead", "Speak with Plants", "Telepathy",
    "True Seeing", "Wild Cunning",
  ],
  dispel: [
    "Counterspell", "Dispel Magic",
  ],
  fire: [
    "Blazing Stride", "Create Bonfire", "Flame Arrows", "Flame Blade", "Green-Flame Blade", "Immolation",
    "Investiture of Flame", "Minute Meteors", "Scorcher", "Searing Smite",
  ],
  force: [
    "Arcane Transformation", "Banishing Smite", "Blade of Disaster", "Dark Star", "Draconic Transformation",
    "Gravity Fissure", "Gravity Sinkhole", "Magnify Gravity", "Mordenkainen's Sword", "Pulse Wave",
    "Spiritual Weapon", "Steel Wind Strike", "Sword Burst", "Zephyr Strike",
  ],
  guard: [
    "Absorb Elements", "Aid", "Alarm", "Antilife Shell", "Antimagic Field", "Arcane Lock", "Armor of Agathys",
    "Aura of Life", "Aura of Purity", "Barkskin", "Blade Ward", "Catnap", "Circle of Power", "Contingency",
    "Death Ward", "Dispel Evil and Good", "Druid Grove", "Feather Fall", "Feign Death", "Fire Shield",
    "Fog Cloud", "Freedom of Movement", "Gentle Repose", "Globe of Invulnerability", "Guards and Wards",
    "Hallow", "Holy Aura", "Intellect Fortress", "Investiture of Stone", "Leomund's Tiny Hut", "Mage Armor",
    "Magic Circle", "Meld into Stone", "Mind Blank", "Mordenkainen's Private Sanctum", "Nondetection",
    "Otiluke's Resilient Sphere", "Pass without Trace", "Platinum Shield", "Primordial Ward",
    "Prismatic Wall", "Protection from Energy", "Protection from Evil and Good", "Protection from Poison",
    "Resistance", "Sanctuary", "Sequester", "Shield", "Shield of Faith", "Stoneskin", "Temple of the Gods",
    "Wall of Force", "Wall of Stone", "Wall of Water", "Warding Bond", "Warding Wind",
  ],
  heal: [
    "Beacon of Hope", "Goodberry", "Healing Spirit", "Reincarnate", "Spare the Dying", "Wither and Bloom",
  ],
  lightning: [
    "Lightning Arrow", "Lightning Lure", "Storm Sphere",
  ],
  necrotic: [
    "Arms of Hadar", "Enervation", "Hex", "Horrid Wilting", "Negative Energy Flood", "Sapping Sting",
    "Shadow of Moil", "Time Ravage", "Toll the Dead",
  ],
  physical: [
    "Bones of the Earth", "Catapult", "Conjure Barrage", "Conjure Volley", "Cordon of Arrows", "Dust Devil",
    "Earth Tremor", "Earthen Grasp", "Erupting Earth", "Hail of Thorns", "Investiture of Wind", "Maelstrom",
    "Magic Stone", "Spike Growth", "Spray of Cards", "Thorn Whip", "Tidal Wave", "Tsunami", "Whirlwind",
    "Wrath of Nature",
  ],
  poison: [
    "Infestation", "Ray of Sickness",
  ],
  psychic: [
    "Dissonant Whispers", "Maddening Darkness", "Mental Prison", "Mind Sliver", "Mind Spike", "Mind Whip",
    "Phantasmal Force", "Phantasmal Killer", "Psychic Lance", "Psychic Scream", "Shadow Blade",
    "Staggering Smite", "Synaptic Static", "Weird", "Wrathful Smite",
  ],
  radiant: [
    "Blinding Smite", "Branding Smite", "Crown of Stars", "Crusader's Mantle", "Dawn", "Divine Favor",
    "Holy Weapon", "Sickening Radiance", "Spirit Guardians", "Wall of Light", "Word of Radiance",
  ],
  summon: [
    "Animate Dead", "Clone", "Conjure Animals", "Conjure Celestial", "Conjure Elemental", "Conjure Fey",
    "Conjure Minor Elementals", "Conjure Woodland Beings", "Create Undead", "Find Familiar", "Find Steed",
    "Giant Insect", "Mordenkainen's Faithful Hound", "Phantom Steed", "Planar Ally", "Simulacrum",
    "Speedy Courier", "Unseen Servant",
  ],
  teleport: [
    "Arcane Gate", "Astral Projection", "Blink", "Demiplane", "Dimension Door", "Dream of the Blue Veil",
    "Etherealness", "Far Step", "Gate", "Misty Step", "Passwall", "Plane Shift", "Rope Trick", "Scatter",
    "Teleport", "Teleportation Circle", "Transport via Plants", "Tree Stride", "Vortex Warp",
    "Word of Recall",
  ],
  thunder: [
    "Booming Blade", "Destructive Wave", "Thunder Step", "Thunderclap", "Thunderous Smite",
  ],
  utility: [
    "Animal Messenger", "Ceremony", "Conjured Tower", "Continual Flame", "Control Flames", "Control Weather",
    "Create Food and Water", "Create or Destroy Water", "Creation", "Dancing Lights", "Daylight",
    "Disguise Self", "Drawmij's Instant Summons", "Dream", "Druidcraft", "Fabricate", "Gift of Gab",
    "Hallucinatory Terrain", "Illusory Script", "Knock", "Leomund's Secret Chest", "Light", "Mage Hand",
    "Magic Mouth", "Major Image", "Mending", "Message", "Mighty Fortress", "Minor Illusion", "Mirage Arcane",
    "Mislead", "Mold Earth", "Mordenkainen's Magnificent Mansion", "Move Earth", "Nystul's Magic Aura",
    "Plant Growth", "Prestidigitation", "Programmed Illusion", "Project Image", "Purify Food and Drink",
    "Pyrotechnics", "Sending", "Shape Water", "Silent Image", "Skywrite", "Stone Shape",
    "Tenser's Floating Disk", "Tether Essence", "Thaumaturgy", "Wish", "Wristpocket",
  ],
};
