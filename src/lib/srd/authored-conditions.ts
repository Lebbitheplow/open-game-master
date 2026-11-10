// The conditions the authored subclass spends leave (src/lib/dm/authored-spends.ts),
// as rows of the condition-effects registry, which appends them to its own:
// a condition name resolves to riders the attack, save, AC and speed engines
// already read. A row with only a summary is read by the authored hooks
// (src/lib/dm/authored-hooks.ts) or tells the table what the condition means.

import type { ConditionEffectRow } from "@/lib/srd/condition-effects";

const ALL_BUT = (...except: string[]) =>
  [
    "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
    "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
  ].filter((type) => !except.includes(type));

const summaryOnly = (id: string, name: string, summary: string): ConditionEffectRow => ({
  id,
  match: [name],
  summary,
});

export const AUTHORED_CONDITION_ROWS: ConditionEffectRow[] = [
  {
    id: "symbiotic_entity",
    match: ["symbiotic entity"],
    summary: "Symbiotic Entity: melee weapon hits deal +1d6 necrotic (the temporary hit points came with it) for 10 minutes.",
    onHitDice: { dice: "1d6", type: "necrotic" },
    weaponOnly: true,
  },
  {
    id: "kensei_shot",
    match: ["kensei's shot"],
    summary: "Kensei's Shot: ranged weapon hits with a kensei weapon deal +1d4 this turn.",
    onHitDice: { dice: "1d4", type: "" },
    weaponOnly: true,
  },
  ...[1, 2, 3].map(
    (points): ConditionEffectRow => ({
      id: `sharpen_the_blade_${points}`,
      match: [`sharpen the blade (+${points})`],
      summary: `Sharpen the Blade: +${points} to attack and damage rolls with a kensei weapon for a minute.`,
      paramAttackBonus: true,
      onHitDice: { dice: String(points), type: "" },
      weaponOnly: true,
    }),
  ),
  { id: "agile_parry", match: ["agile parry"], summary: "Agile Parry: +2 AC until the start of the monk's next turn, while they hold the kensei weapon.", acBonus: 2 },
  // Blade Flourish's defensive flourish: the Bardic Inspiration die rolled,
  // as AC until the bard's next turn.
  ...Array.from({ length: 12 }, (_, index): ConditionEffectRow => ({
    id: `defensive_flourish_${index + 1}`,
    match: [`defensive flourish (+${index + 1})`],
    summary: `Defensive Flourish: +${index + 1} AC until the bard's next turn.`,
    acBonus: index + 1,
  })),
  {
    id: "awakened_astral_self",
    match: ["awakened astral self"],
    summary: "Awakened Astral Self: +2 AC, and a third arms strike with the Attack action (narrated).",
    acBonus: 2,
  },
  summaryOnly(
    "arms_of_the_astral_self",
    "arms of the astral self",
    "Arms of the Astral Self: spectral arms for 10 minutes; unarmed strikes reach 5 feet further and deal force damage.",
  ),
  summaryOnly(
    "visage_of_the_astral_self",
    "visage of the astral self",
    "Visage of the Astral Self: sight through magical and nonmagical darkness to 120 feet, advantage on Insight and Intimidation checks, and a voice the monk can aim at one creature within 60 feet or carry 600 feet, for 10 minutes.",
  ),
  {
    id: "shadow_step",
    match: ["shadow step"],
    summary: "Shadow Step: advantage on the next melee attack this turn.",
    attackAdvantage: true,
    consumedBy: "attack",
  },
  {
    id: "drunkards_luck_attack",
    match: ["drunkard's luck (attack)"],
    summary: "Drunkard's Luck: the next attack roll cancels its disadvantage (an advantage that the roll spends).",
    attackAdvantage: true,
    consumedBy: "attack",
  },
  // Held from the Hand or use_resource (src/lib/dm/destructive-wrath.ts): the
  // chip on the party card says what it waits for.
  summaryOnly("destructive_wrath", "destructive wrath", "Destructive Wrath: the next lightning or thunder damage they roll is dealt at its maximum; a rest ends it."),
  summaryOnly("drunkards_luck_check", "drunkard's luck (check)", "Drunkard's Luck: the next ability check cancels its disadvantage."),
  summaryOnly("drunkards_luck_save", "drunkard's luck (save)", "Drunkard's Luck: the next saving throw cancels its disadvantage."),
  {
    id: "tides_of_chaos_attack",
    match: ["tides of chaos (attack)"],
    summary: "Tides of Chaos: advantage on the next attack roll, which spends it.",
    attackAdvantage: true,
    consumedBy: "attack",
  },
  summaryOnly("tides_of_chaos_check", "tides of chaos (check)", "Tides of Chaos: advantage on the next ability check, which spends it."),
  summaryOnly("tides_of_chaos_save", "tides of chaos (save)", "Tides of Chaos: advantage on the next saving throw, which spends it."),
  summaryOnly("surge_chance", "surge chance", "Wild Magic Surge: a sorcerer spell was just cast with Tides of Chaos spent; if the GM has the sorcerer roll on the wild magic table now, Tides of Chaos comes back."),
  ...(["1d8", "1d10"] as const).map(
    (dice): ConditionEffectRow => ({
      id: `giants_might_${dice}`,
      match: [`giant's might (${dice})`],
      summary: `Giant's Might: Large, advantage on Strength checks and saves, and one weapon hit per turn deals +${dice} damage.`,
      advantageOn: [
        { kind: "save", ability: "str" },
        { kind: "check", ability: "str" },
      ],
      onHitDice: { dice, type: "" },
      weaponOnly: true,
    }),
  ),
  {
    id: "blessing_of_the_forge_armor",
    match: ["blessing of the forge (armor)"],
    summary: "Blessing of the Forge: the armor grants +1 AC until the cleric blesses something else.",
    acBonus: 1,
  },
  {
    id: "blessing_of_the_forge_weapon",
    match: ["blessing of the forge (+1)"],
    summary: "Blessing of the Forge: the weapon is +1 to attack and damage rolls until the cleric blesses something else.",
    paramAttackBonus: true,
    onHitDice: { dice: "1", type: "" },
    weaponOnly: true,
  },
  summaryOnly("blessing_of_the_trickster", "blessing of the trickster", "Blessing of the Trickster: advantage on Stealth checks for an hour."),
  summaryOnly("vigilant_blessing", "vigilant blessing", "Vigilant Blessing: advantage on the next initiative roll."),
  summaryOnly("elegant_maneuver", "elegant maneuver", "Elegant Maneuver: advantage on the next Acrobatics or Athletics check this turn."),
  {
    id: "emissary_of_peace",
    match: ["emissary of peace"],
    summary: "Emissary of Peace: +5 to Persuasion checks for 10 minutes.",
    skillBonus: { skill: "persuasion", bonus: 5 },
  },
  summaryOnly("peerless_athlete", "peerless athlete", "Peerless Athlete: advantage on Athletics and Acrobatics, extra carrying capacity and 10 extra feet of jump distance, for 10 minutes."),
  {
    id: "watchers_will",
    match: ["watcher's will"],
    summary: "Watcher's Will: advantage on Intelligence, Wisdom and Charisma saves for a minute.",
    advantageOn: [
      { kind: "save", ability: "int" },
      { kind: "save", ability: "wis" },
      { kind: "save", ability: "cha" },
    ],
  },
  summaryOnly("champion_challenge", "champion challenge", "Champion Challenge: cannot willingly move more than 30 feet from the paladin who challenged it; ends if the paladin is incapacitated or dies, or it is more than 30 feet away."),
  // Its turn-end benefits are the cleric's row (turn_end_aura, authored-turns.ts).
  summaryOnly("twilight_sanctuary", "twilight sanctuary", "Twilight Sanctuary: a 30-foot sphere of twilight around the cleric for a minute; a creature ending its turn in it loses a charm or fear, or gains temporary hit points."),
  summaryOnly(
    "corona_of_light",
    "corona of light",
    "Corona of Light: bright light 60 feet around the cleric; enemies in it save at disadvantage against spells for a minute.",
  ),
  ...(["d6", "d8", "d10", "d12"] as const).map(
    (die): ConditionEffectRow => ({
      id: `unsettled_${die}`,
      match: [`unsettled (${die})`],
      summary: `Unsettling Words: 1${die} comes off this creature's next saving throw.`,
      savePenaltyDie: `1${die}`,
      consumedBy: "save",
    }),
  ),
  summaryOnly("hound_of_ill_omen", "hound of ill omen", "Hound of Ill Omen: a shadow hound hunts this creature; it saves at disadvantage against the sorcerer's spells."),
  summaryOnly("eldritch_strike", "eldritch strike", "Eldritch Strike: disadvantage on the next save against the fighter's spell before the end of their next turn."),
  summaryOnly("distracted", "distracted", "Distracted by a mage hand: the rogue who distracted it has advantage on attacks against it this turn."),
  summaryOnly("ancestral_protectors", "ancestral protectors", "Ancestral Protectors: disadvantage on attacks against anyone but the barbarian, whose allies resist its damage, until the barbarian's next turn."),
  summaryOnly("unwavering_mark", "unwavering mark", "Unwavering Mark: disadvantage on attacks against anyone but the cavalier until their next turn."),
  summaryOnly("thunder_gauntlets", "thunder gauntlets", "Thunder Gauntlets: disadvantage on attacks against anyone but the armorer until their next turn."),
  {
    id: "ambush_master_mark",
    match: ["ambush master"],
    summary: "Ambush Master: attack rolls against this creature have advantage until the scout's next turn.",
    attacksAgainstAdvantage: true,
  },
  {
    id: "lit_by_perfected_armor",
    match: ["lit by perfected armor"],
    summary: "Perfected Armor: the next attack roll against this glowing creature has advantage.",
    attacksAgainstAdvantage: true,
    consumedAgainst: true,
  },
  summaryOnly("orders_wrath", "order's wrath", "Order's Wrath: the next ally to hit this creature deals +2d8 psychic."),
  {
    id: "planar_warrior",
    match: ["planar warrior"],
    summary: "Planar Warrior: the next weapon hit this turn deals +1d8 force.",
    onHitDice: { dice: "1d8", type: "force" },
    weaponOnly: true,
    consumedBy: "hit",
  },
  {
    id: "planar_warrior_2d8",
    match: ["planar warrior (2d8)"],
    summary: "Planar Warrior: the next weapon hit this turn deals +2d8 force.",
    onHitDice: { dice: "2d8", type: "force" },
    weaponOnly: true,
    consumedBy: "hit",
  },
  summaryOnly("slayers_prey", "slayer's prey", "Slayer's Prey: the first weapon hit each turn deals +1d6."),
  {
    id: "umbral_form",
    match: ["umbral form"],
    summary: "Umbral Form: resistance to all damage but force and radiant, and moving through creatures and objects, for a minute.",
    resistances: ALL_BUT("force", "radiant"),
  },
  summaryOnly("otherworldly_wings", "otherworldly wings", "Otherworldly Wings: a flying speed of 30 feet."),
  {
    id: "bulwark_of_force",
    match: ["bulwark of force"],
    summary: "Bulwark of Force: half cover, +2 AC and +2 on Dexterity saves, for a minute.",
    acBonus: 2,
    saveFlat: 2,
    saveFlatAbility: "dex",
  },
  {
    id: "abjured_still",
    match: ["abjured still"],
    summary: "Abjure Enemy: speed 0 for a minute or until it takes damage.",
    speedMultiplier: 0,
  },
  {
    id: "abjured_slowed",
    match: ["abjured slowed"],
    summary: "Abjure Enemy: half speed for a minute or until it takes damage.",
    speedMultiplier: 0.5,
  },
  {
    id: "held_in_place",
    match: ["held in place"],
    summary: "Held in place (Hold the Line): speed 0 for the rest of the turn.",
    speedMultiplier: 0,
  },
  {
    id: "raging_storm_tundra",
    match: ["raging storm (tundra)"],
    summary: "Raging Storm (Tundra): speed 0 until the start of the barbarian's next turn.",
    speedMultiplier: 0,
  },
  summaryOnly("storm_aura", "storm aura", "Storm Aura: the raging Storm Herald's 10-foot aura (desert, sea or tundra)."),
  summaryOnly("fanatical_focus_spent", "fanatical focus spent", "Fanatical Focus is spent until this rage ends."),
  summaryOnly("elder_champion", "elder champion", "Elder Champion: 10 hit points at the start of each turn, and enemies within 10 feet save at disadvantage against the paladin."),
  summaryOnly("vow_of_enmity", "vow of enmity", "Vow of Enmity: advantage on attacks against the creature vowed against, for a minute."),
  summaryOnly("avenging_angel", "avenging angel", "Avenging Angel: a 60-foot flying speed for an hour, and a 30-foot aura of menace that frightens enemies who fail a Wisdom save."),
  {
    id: "menaced_by_an_avenging_angel",
    match: ["menaced by an avenging angel"],
    summary: "Avenging Angel's menace: frightened of the paladin, and every attack roll against this creature has advantage, for a minute or until it takes damage.",
    attacksAgainstAdvantage: true,
  },
  {
    id: "invincible_conqueror",
    match: ["invincible conqueror"],
    summary: "Invincible Conqueror: resistance to all damage for a minute; the extra attack and the 19-20 critical are narrated.",
    resistances: ALL_BUT(),
  },
  {
    id: "living_legend",
    match: ["living legend"],
    summary: "Living Legend: advantage on Charisma checks for a minute, once on each turn a missed weapon attack can hit instead (the GM rules the hit), and a reaction rerolls a failed save (use_resource 'Living Legend Reroll').",
    advantageOn: [{ kind: "check", ability: "cha" }],
  },
  summaryOnly("mortal_bulwark", "mortal bulwark", "Mortal Bulwark: truesight 120 feet and advantage on attacks against aberrations, celestials, elementals, fey and fiends."),
  {
    id: "exalted_champion",
    match: ["exalted champion"],
    summary: "Exalted Champion: resistance to nonmagical weapon damage and advantage on Wisdom saves for an hour.",
    resistances: ["bludgeoning", "piercing", "slashing"],
    nonmagicalOnly: true,
    advantageOn: [{ kind: "save", ability: "wis" }],
  },
  {
    id: "dread_lord",
    match: ["dread lord"],
    summary:
      "Dread Lord: a 30-foot aura of gloom; attack rolls against the oathbreaker by creatures that rely on sight are at disadvantage, enemies frightened of them that start a turn in it take 4d10 psychic, and a bonus-action melee spell attack with the shadows (pc_attack weapon \"Dread Lord's Shadows\") deals 3d10 + Charisma necrotic.",
    attacksAgainstDisadvantage: true,
    grantedAttack: {
      name: "Dread Lord's Shadows",
      diceByLevel: [[1, "3d10"]],
      type: "necrotic",
      abilityToDamage: true,
      ranged: false,
      bonusAction: true,
    },
  },
  {
    id: "eldritch_cannon",
    match: ["eldritch cannon"],
    summary:
      "Eldritch Cannon: a bonus action activates it (use_resource \"Activate Cannon\": flamethrower or protector), or fires its Force Ballista (pc_attack weapon \"Force Ballista\", 2d8 force, a push of 5 feet on a hit).",
    grantedAttack: {
      name: "Force Ballista",
      diceByLevel: [[1, "2d8"], [9, "3d8"]],
      type: "force",
      abilityToDamage: false,
      ranged: true,
      bonusAction: true,
      rangeFeet: 120,
      // The ballista fires from the cannon, which stands within 5 feet of
      // the artificer and walks 15 feet with the bonus action (issue 659).
      from: { zone: "eldritch cannon", reachFeet: 120, moveFeet: 15, rangeFeet: 5, label: "Eldritch Cannon" },
    },
  },
  // The genre classes' marks (authored-effects-genre.ts): the condition names
  // its creature in its meta (quarry), and every attack on it carries the
  // bonus (src/lib/dm/attack-marks.ts).
  {
    id: "target_lock",
    match: ["target lock"],
    summary: "Target Lock: +2 damage on attacks against the marked foe.",
    onHitDice: { dice: "2", type: "" },
    marksTarget: true,
  },
  {
    id: "hunters_brand",
    match: ["hunter's brand", "hunters brand"],
    summary: "Hunter's Brand: +1d6 radiant on attacks against the branded creature, until it dies or the hunter rests.",
    onHitDice: { dice: "1d6", type: "radiant" },
    marksTarget: true,
  },
  {
    id: "quarry",
    match: ["quarry"],
    summary: "Quarry: +1d6 damage on attacks against the marked creature, until it dies.",
    onHitDice: { dice: "1d6", type: "" },
    marksTarget: true,
  },
  summaryOnly("celestial_wings", "celestial revelation: heavenly wings", "Celestial Revelation (Heavenly Wings): a flying speed equal to the walking speed, and once a turn +proficiency bonus radiant damage on one target."),
  summaryOnly("celestial_radiance", "celestial revelation: inner radiance", "Celestial Revelation (Inner Radiance): bright light; each creature within 10 feet takes radiant damage equal to the proficiency bonus at the end of the aasimar's turns, and once a turn +proficiency bonus radiant damage on one target."),
  summaryOnly("celestial_shroud", "celestial revelation: necrotic shroud", "Celestial Revelation (Necrotic Shroud): creatures within 10 feet save (Charisma) or are frightened until the end of the aasimar's next turn, and once a turn +proficiency bonus necrotic damage on one target."),
  summaryOnly("ashen_hymn", "ashen hymn", "Ashen Hymn: enemies within 10 feet have disadvantage on their first save against fear each turn, for a minute."),
  summaryOnly("candlelight_vigil", "candlelight vigil", "Candlelight Vigil: allies within 10 feet add 1d4 to saves against the supernatural, for a minute."),
  summaryOnly("head_of_steam", "head of steam", "Head of Steam: the next Piston Strike this turn deals +2d6 instead."),
  summaryOnly("mantle_of_majesty", "mantle of majesty", "Mantle of Majesty: command is cast as a bonus action with no slot each turn for the minute, and a creature the bard charmed fails its save against it."),
  {
    id: "soul_trinket",
    match: ["soul trinket"],
    summary: "A soul trinket: advantage on Constitution saves and death saving throws while it is held.",
    deathSaveAdvantage: true,
  },
  {
    id: "adjusted_density_lighter",
    match: ["adjusted density (lighter)"],
    summary: "Adjust Density (halved): +10 feet of speed, disadvantage on Strength checks and saves.",
    speedBonus: 10,
    disadvantageOn: [
      { kind: "save", ability: "str" },
      { kind: "check", ability: "str" },
    ],
  },
  {
    id: "adjusted_density_heavier",
    match: ["adjusted density (heavier)"],
    summary: "Adjust Density (doubled): -10 feet of speed, advantage on Strength checks and saves.",
    speedBonus: -10,
    advantageOn: [
      { kind: "save", ability: "str" },
      { kind: "check", ability: "str" },
    ],
  },
  summaryOnly("emissary_lapsed", "emissary lapsed", "Emissary of Redemption is set aside until a long rest: the paladin attacked or harmed a creature."),
  summaryOnly("spurned_by_redemption", "spurned by redemption", "The Redemption paladin attacked this creature: their Emissary of Redemption holds nothing against it until their long rest."),
  summaryOnly("withstood_among_the_dead", "withstood among the dead", "This undead made its save against the Undying warlock's Among the Dead and may attack them for 24 hours."),
  summaryOnly("withstood_instinctive_charm", "withstood instinctive charm", "This creature resisted the Enchantment wizard's Instinctive Charm, which cannot sway it again until their long rest."),
  summaryOnly("pulled_by_perfected_armor", "pulled by perfected armor", "Perfected Armor: pulled up to 25 feet toward the Guardian armorer (move_token forced); if it lands within 5 feet, they may attack it as part of the reaction."),
  {
    id: "hearth_of_moonlight_and_shadow",
    match: ["hearth of moonlight and shadow"],
    summary: "Hearth of Moonlight and Shadow: +5 to Stealth and Perception checks inside the 30-foot sphere while the rest lasts; open flames inside cannot be seen from outside.",
    skillBonuses: [
      { skill: "stealth", bonus: 5 },
      { skill: "perception", bonus: 5 },
    ],
  },
  summaryOnly("hour_of_reaping", "hour of reaping", "Hour of Reaping: the Long Death monk's dread this turn; each creature within 30 feet that failed the Wisdom save is frightened of them until the end of the monk's next turn."),
  // Revelation in Flesh: one benefit per sorcery point spent (the fly and
  // swim speeds are the authored move effects gated on these).
  summaryOnly("revelation_in_flesh_fly", "revelation in flesh (fly)", "Revelation in Flesh: a flying speed equal to the walking speed, and the sorcerer can hover."),
  summaryOnly("revelation_in_flesh_swim", "revelation in flesh (swim)", "Revelation in Flesh: a swimming speed of twice the walking speed, and the sorcerer breathes water."),
  summaryOnly("revelation_in_flesh_see", "revelation in flesh (see)", "Revelation in Flesh: the sorcerer sees any invisible creature within 60 feet that is not behind total cover."),
  summaryOnly("revelation_in_flesh_squeeze", "revelation in flesh (squeeze)", "Revelation in Flesh: the sorcerer moves through a space an inch wide and spends 5 feet of movement to escape nonmagical restraints or a grapple."),
  summaryOnly("emboldening_bond", "emboldening bond", "Emboldening Bond: once a turn, within 30 feet of another bonded creature (60 from the cleric's 17th level), add a d4 to an attack roll, ability check or saving throw (roll it as a bonus die)."),
  // Hexblade's Curse: the warlock's condition names the cursed creature in
  // its meta (quarry): +proficiency damage on every hit against it, and a
  // critical hit on 19-20 (src/lib/dm/attack-marks.ts).
  ...[2, 3, 4, 5, 6].map(
    (bonus): ConditionEffectRow => ({
      id: `hexblades_curse_${bonus}`,
      match: [`hexblade's curse (+${bonus})`],
      summary: `Hexblade's Curse: +${bonus} damage and a critical hit on 19-20 against the cursed creature; hit points back when it dies.`,
      onHitDice: { dice: String(bonus), type: "" },
      marksTarget: true,
      critRangeVsMarked: 19,
    }),
  ),
  summaryOnly("insightful_fighting", "insightful fighting", "Insightful Fighting: the rogue may Sneak Attack this creature without advantage for a minute."),
  // The final round's hooks (src/lib/srd/authored-effects-more.ts).
  summaryOnly("wildfire_spirit", "wildfire spirit", "The wildfire spirit is out: the druid's fire and healing spells gain 1d8 (Enhanced Bond)."),
  summaryOnly("slayers_prey_marked", "slayer's prey (marked)", "The Monster Slayer's prey: the ranger adds 1d6 to saves against its effects (Supernatural Defense)."),
  summaryOnly("struck_as_it_fled", "struck as it fled", "Relentless Avenger: the paladin's opportunity attack hit; they may move up to half their speed with use_reaction, drawing no opportunity attacks."),
  summaryOnly("echo_manifested", "echo manifested", "Manifest Echo: the Echo Knight's echo is out (AC 14 + proficiency bonus, 1 hit point); Shadow Martyr can send it into an attack that hit another creature, and a hit that destroys it ends it."),
];
