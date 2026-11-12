// The conditions the tail spell rows lay down (src/lib/srd/spell-mech-tail-rows.ts),
// as rows of the one registry (src/lib/srd/condition-effects.ts spreads them
// in). Kept apart so the registry file does not grow past reading; the type
// is imported as a type only, so the two files do not load each other.

import type { ConditionEffectRow } from "@/lib/srd/condition-effects";

const EVERY_TYPE = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];

const ABILITY_NAMES = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" } as const;

// Bestow Curse on one ability: its checks and saves at disadvantage.
const ABILITY_CURSES: ConditionEffectRow[] = (Object.keys(ABILITY_NAMES) as Array<keyof typeof ABILITY_NAMES>).map((ability) => ({
  id: `cursed_${ability}`,
  match: [`cursed (${ability})`],
  summary: `Bestow Curse: disadvantage on ${ABILITY_NAMES[ability]} checks and saving throws.`,
  disadvantageOn: [
    { kind: "save", ability },
    { kind: "check", ability },
  ],
}));

export const TAIL_CONDITION_EFFECTS: ConditionEffectRow[] = [
  ...ABILITY_CURSES,
  {
    id: "cursed_attacks",
    match: ["cursed (attacks)"],
    summary: "Bestow Curse: disadvantage on attack rolls against the caster.",
  },
  {
    id: "cursed_will",
    match: ["cursed (will)"],
    summary: "Bestow Curse: a WIS save at the start of each of its turns, or it does nothing that turn.",
  },
  {
    id: "cursed_necrotic",
    match: ["cursed (necrotic)"],
    summary: "Bestow Curse: the caster's attacks and spells deal 1d8 necrotic more to it.",
  },
  {
    id: "dazed",
    match: ["dazed"],
    summary: "Bestow Curse: it wastes its action this turn.",
    noAction: true,
  },
  {
    id: "mocked",
    match: ["mocked"],
    summary: "Vicious Mockery: disadvantage on the next attack roll it makes before the end of its next turn.",
    attackDisadvantage: true,
    consumedBy: "attack",
  },
  {
    id: "searing_metal",
    match: ["searing metal"],
    summary: "Heat Metal: it keeps hold of the red-hot object and has disadvantage on attack rolls and ability checks until the caster's next turn.",
    attackDisadvantage: true,
    disadvantageOn: [{ kind: "check" }],
  },
  {
    id: "sickened",
    match: ["sickened"],
    summary: "Eyebite (Sickened): disadvantage on attack rolls and ability checks; a WIS save at the end of each of its turns ends it.",
    attackDisadvantage: true,
    disadvantageOn: [{ kind: "check" }],
  },
  {
    id: "halted",
    match: ["halted"],
    summary: "Command (Halt): it does not move and takes no action on its turn.",
    noAction: true,
    noMove: true,
    speedMultiplier: 0,
  },
  {
    id: "lethargic",
    match: ["lethargic"],
    summary: "Haste's lethargy: it cannot move or take actions until after its next turn.",
    noAction: true,
    noMove: true,
    speedMultiplier: 0,
  },
  {
    id: "retching",
    match: ["retching"],
    summary: "Stinking Cloud: it spends its action retching and reeling this turn.",
    noAction: true,
  },
  {
    id: "wandering",
    match: ["wandering"],
    summary: "Confusion: it moves in a random direction and takes no action this turn.",
    noAction: true,
  },
  {
    id: "levitating",
    match: ["levitating"],
    summary: "Levitate: it hangs in the air and can move only by pushing or pulling against something fixed; its speed is 0.",
    speedMultiplier: 0,
  },
  {
    id: "suggested",
    match: ["suggested"],
    summary: "Suggestion: it pursues the suggested course of action; damage from the caster or their companions ends it.",
  },
  {
    id: "enclosed",
    match: ["enclosed"],
    summary: "Resilient Sphere: sealed in a sphere of force; nothing passes in or out, so it can neither be harmed from outside nor harm anything outside.",
    untargetable: true,
    noAttacks: true,
  },
  {
    id: "gaseous_form",
    match: ["gaseous form"],
    summary: "Gaseous Form: a misty cloud with a 10-foot fly speed, resistance to nonmagical damage and advantage on STR, DEX and CON saves; it cannot attack or cast spells.",
    resistances: EVERY_TYPE,
    nonmagicalOnly: true,
    advantageOn: [
      { kind: "save", ability: "str" },
      { kind: "save", ability: "dex" },
      { kind: "save", ability: "con" },
    ],
    noCasting: true,
    noAttacks: true,
    speedSet: 10,
  },
  {
    id: "heroes_feast",
    match: ["heroes' feast", "heroes feast"],
    summary: "Heroes' Feast: immune to poison and to being frightened, advantage on WIS saves, and 2d10 more hit points for 24 hours.",
    conditionImmunities: ["frightened", "poisoned"],
    damageImmunities: ["poison"],
    advantageOn: [{ kind: "save", ability: "wis" }],
  },
  {
    id: "dispel_evil_and_good",
    match: ["dispel evil and good"],
    summary: "Dispel Evil and Good: celestials, elementals, fey, fiends and undead have disadvantage on attack rolls against them.",
    attacksAgainstDisadvantageFrom: ["celestial", "elemental", "fey", "fiend", "undead"],
  },
  {
    id: "enfeebled",
    match: ["enfeebled"],
    summary: "Ray of Enfeeblement: its weapon attacks that use Strength deal half damage; a CON save at the end of each of its turns ends it.",
  },
  {
    id: "regenerating",
    match: ["regenerating"],
    summary: "Regenerate: 1 hit point back at the start of each of its turns.",
  },
  {
    id: "mind_blank",
    match: ["mind blank"],
    summary: "Mind Blank: immune to psychic damage and to being charmed.",
    conditionImmunities: ["charmed"],
    damageImmunities: ["psychic"],
  },
  {
    id: "foresight",
    match: ["foresight"],
    summary: "Foresight: advantage on attack rolls, ability checks and saving throws, and attack rolls against them have disadvantage.",
    attackAdvantage: true,
    advantageOn: [{ kind: "check" }, { kind: "save" }],
    attacksAgainstDisadvantage: true,
  },
  // The marks the engine keeps for what comes at the end of a creature's turn
  // (src/lib/dm/spell-turn-end.ts); each carries its spell in the meta.
  {
    id: "acid_arrow_splash",
    match: ["acid arrow"],
    summary: "Acid Arrow: the acid burns again at the end of its next turn.",
  },
  {
    id: "phantasmal_dread",
    match: ["phantasmal killer"],
    summary: "Phantasmal Killer: at the end of each of its turns it saves again or takes psychic damage.",
  },
  {
    id: "weird_dread",
    match: ["weird"],
    summary: "Weird: at the end of each of its turns it saves again or takes psychic damage.",
  },
  {
    id: "hardening",
    match: ["flesh to stone"],
    summary: "Flesh to Stone: it saves at the end of each of its turns; three failures turn it to stone, three successes free it.",
  },
  // Zealous Presence (Path of the Zealot 10): "advantage on attack rolls and
  // saving throws until the start of your next turn".
  {
    id: "zealous_presence",
    match: ["zealous presence"],
    summary: "Zealous Presence: advantage on attack rolls and saving throws until the barbarian's next turn.",
    attackAdvantage: true,
    advantageOn: [{ kind: "save" }],
  },
  // Bolstering Magic (Path of Wild Magic 6): "for 10 minutes the creature can
  // roll a d3 whenever making an attack roll or an ability check".
  {
    id: "bolstering_magic",
    match: ["bolstering magic (d3)", "bolstering magic"],
    summary: "Bolstering Magic: +1d3 on attack rolls and ability checks for 10 minutes.",
    attackDie: "1d3",
    checkDie: "1d3",
  },
  // Unbreakable Majesty (College of Glamour 14): an attacker makes a Charisma
  // save or picks a new target, the GM holding the save.
  {
    id: "unbreakable_majesty",
    match: ["unbreakable majesty"],
    summary: "Unbreakable Majesty: a creature that attacks the bard first makes a Charisma save against their spell save DC; on a failure it cannot attack them this turn and must pick a new target.",
  },
  // The record the counter repair's spends lay (src/lib/srd/authored-effects-
  // sweep-counters.ts): what each holds while it lasts.
  {
    id: "universal_speech",
    match: ["universal speech"],
    summary: "Universal Speech: the creatures the bard chose understand them for an hour, whatever language they speak.",
  },
  {
    id: "eyes_of_night",
    match: ["eyes of night (300 ft darkvision)", "eyes of night"],
    summary: "Eyes of Night: darkvision out to 300 feet for an hour, shared by a Twilight cleric.",
  },
  {
    id: "ghost_walk",
    match: ["ghost walk"],
    summary: "Ghost Walk: spectral for 10 minutes, a 10-foot flying speed, attacks against them at disadvantage, and they move through creatures and objects.",
    attacksAgainstDisadvantage: true,
  },
  {
    id: "third_eye",
    match: ["the third eye (darkvision 60 ft)", "the third eye (ethereal sight)", "the third eye (reads any language)", "the third eye (sees invisibility 10 ft)"],
    summary: "The Third Eye: the sense the wizard chose (darkvision 60 feet, sight into the Ethereal Plane, reading any language, or seeing the invisible within 10 feet) until they are incapacitated or rest.",
  },
  {
    id: "elixir_swiftness",
    match: ["elixir of swiftness (+10 ft speed)"],
    summary: "Elixir of Swiftness: walking speed +10 feet for an hour.",
    speedBonus: 10,
  },
  {
    id: "elixir_resilience",
    match: ["elixir of resilience (+1 ac)"],
    summary: "Elixir of Resilience: +1 AC for 10 minutes.",
    acBonus: 1,
  },
  {
    id: "elixir_boldness",
    match: ["elixir of boldness (d4)"],
    summary: "Elixir of Boldness: +1d4 on attack rolls and saving throws for a minute.",
    attackDie: "1d4",
    saveDie: "1d4",
  },
  {
    id: "elixir_transformation",
    match: ["elixir of transformation"],
    summary: "Elixir of Transformation: the drinker's body is altered as by alter self for 10 minutes.",
  },
  // Bottled Respite (the Genie's vessel): the warlock is inside the vessel.
  {
    id: "genie_vessel",
    match: ["in the genie's vessel"],
    summary: "Bottled Respite: inside the genie's vessel, out of reach of the world outside, until they leave as a bonus action or the time runs out.",
  },
];
