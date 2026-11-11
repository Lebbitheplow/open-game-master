// The mystery, post-apocalyptic and steampunk classes' features, as rules the
// engines read (wave 2 of the gap sweep, WAVE2 D5: "The genre classes' text
// is the rule, played on the SRD 5.1 engine"). Their text is the catalogs'
// (src/lib/classes/{mystery,post-apocalyptic,steampunk}-features.json); each
// row is found by feature name the way authored-effects-genre.ts's are, with
// `classes` naming the class it belongs to so a name another class shares
// never runs as this one.
//
// Three tables:
//   GENRE_B_AUTHORED      the authored layer's shapes (passive effects, spends
//                         on a feature's own counter, reactions), registered in
//                         GENRE_AUTHORED;
//   GENRE_B_FEATURE_DEFS  feature-effects.ts's own shapes (initiative, walking
//                         speed, armor class while armored),
//                         which the authored layer hands to that table only for
//                         the SRD subclasses (authored-feature-defs.ts);
//   GENRE_B_TRIGGERS      what a reaction-shaped counter answers, for
//                         trigger-table.ts.
//
// Before this every one of these features was its sentence in the GM's prompt:
// Iron Jaw resisted nothing, Practiced Composure rolled one die, a Steam
// Knight's Boiler Plate added no armor.
//
// Pure data; no database.
import type { AuthoredEntry, ReactionDoes, SpendAction, SpendDoes } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

const row = (feature: string, classes: string[], entry: Omit<AuthoredEntry, "subclass">): GenreRow => ({
  feature,
  classes,
  entry: { subclass: "genre", ...entry },
});

const CHIMERIC_LIMB = { name: "Chimeric Limb", aliases: ["claw", "tendril", "bone blade", "limb"], type: "slashing", ability: "cha" as const };

export const GENRE_B_AUTHORED: GenreRow[] = [
  // ---- mystery ----
  // "Advantage on saves against fear and charm".
  row("Practiced Composure", ["detective"], { effects: [{ kind: "save_adv", against: ["frightened", "charmed"] }] }),
  // "Advantage on saves against fear, charm, and madness": madness is no
  // condition a save names (src/lib/dm/roll-about.ts SAVE_AGAINST), so it is
  // the GM's to rule; fear and charm are the engine's.
  row("Professional Detachment", ["alienist"], { effects: [{ kind: "save_adv", against: ["frightened", "charmed"] }] }),
  row("Iron Composure", ["alienist"], { effects: [{ kind: "immune_condition", conditions: ["frightened"] }] }),
  row("Mirror Talk", ["grifter"], { effects: [{ kind: "save_adv", against: ["charmed"] }] }),
  row("Patient Hands", ["grifter"], { effects: [{ kind: "check_adv", skills: ["sleight_of_hand"] }] }),
  row("Iron Jaw", ["enforcer"], { effects: [{ kind: "resist", types: ["bludgeoning"], nonmagical: true }] }),
  row("Two Steps Ahead", ["muckraker"], { effects: [{ kind: "init_adv" }] }),
  row("Between Worlds", ["spirit_medium"], { effects: [{ kind: "resist", types: ["necrotic"] }] }),
  // "Double proficiency bonus on Insight", "... on Intimidation", "... on Investigation".
  row("Read the Mind's Wound", ["alienist"], { effects: [{ kind: "skill_expertise", skills: ["insight"] }] }),
  row("Intimidating Presence", ["enforcer"], { effects: [{ kind: "skill_expertise", skills: ["intimidation"] }] }),
  row("Shorthand", ["muckraker"], { effects: [{ kind: "skill_expertise", skills: ["investigation"] }] }),
  // "While below half HP, resistance to all damage" (its +10 rides the
  // swing, src/lib/srd/genre-b-combat.ts).
  row("Last Man Standing", ["enforcer"], { effects: [{ kind: "resist", types: "all", gate: { belowHalf: true } }] }),
  // ---- post-apocalyptic ----
  // "Advantage on saves against radiation, poison, and disease": radiation is
  // poison or necrotic harm on this engine, which the poison save covers.
  row("Waste-Wise", ["scavenger"], { effects: [{ kind: "save_adv", against: ["poisoned", "poison", "disease"] }] }),
  row("Fear No Rust", ["road_warrior"], { effects: [{ kind: "save_adv", against: ["frightened"] }] }),
  row("Scar Tissue", ["road_warrior"], { effects: [{ kind: "resist", types: ["bludgeoning"], nonmagical: true }] }),
  // "Your speed cannot be reduced and you cannot be knocked prone while conscious."
  row("Unstoppable", ["road_warrior"], { effects: [{ kind: "immune_condition", conditions: ["prone"] }] }),
  // "While unarmored, AC equals 13 + DEX modifier": three over the unarmored 10.
  row("Adaptive Hide", ["aberrant"], { effects: [{ kind: "ac", amount: 3, gate: { unarmored: true } }] }),
  // "Immune to poison and disease": the damage and the condition.
  // "a creature that hits you with a bite takes 2d6 poison".
  row("Toxic Blood", ["aberrant"], { effects: [{ kind: "immune_damage", types: ["poison"] }, { kind: "immune_condition", conditions: ["poisoned"] }, { kind: "retaliate", formula: "2d6", type: "poison", melee: true, attacks: ["bite"] }] }),
  row("Chameleon Skin", ["aberrant"], { effects: [{ kind: "check_adv", skills: ["stealth"] }] }),
  row("Scrap Armor Weave", ["salvage_tech"], { effects: [{ kind: "ac", amount: 1 }, { kind: "resist", types: ["lightning"] }] }),
  // The holder's own part of "You and allies within 10 ft have resistance to
  // necrotic damage and advantage against fear".
  // The allies' part: the necrotic resistance here, the advantage against
  // fear in src/lib/dm/genre-b-auras.ts.
  row("Walk Through the Valley", ["waste_preacher"], { effects: [{ kind: "resist", types: ["necrotic"] }, { kind: "save_adv", against: ["frightened"] }, { kind: "aura_resist", rangeFt: 10, types: ["necrotic"] }] }),
  // ---- steampunk ----
  row("Acid Resistant Apron", ["alchemist"], { effects: [{ kind: "resist", types: ["acid", "poison"] }] }),
  row("Grounded Stance", ["aether_channeler"], { effects: [{ kind: "resist", types: ["lightning"] }] }),
  // "Galvanic Discharge is always active": every melee hit shocks, with no
  // charge to spend (a charged hit is the charge's own, authored-effects-genre-b-steampunk.ts).
  row("Lightning Rod", ["aether_channeler"], { effects: [{ kind: "immune_damage", types: ["lightning"] }, { kind: "retaliate", formula: "1d8", type: "lightning", melee: true, gate: { notCondition: "galvanic discharge" } }] }),
  // "Advantage on saves against poison gas and drowning".
  row("Pressure Seal", ["steam_knight"], { effects: [{ kind: "save_adv", against: ["poisoned", "poison"] }] }),
  row("Reinforced Boiler", ["steam_knight"], { effects: [{ kind: "resist", types: ["fire"] }] }),
  row("Adamant Boiler", ["steam_knight"], { effects: [{ kind: "crit_immune" }] }),
  // "opportunity attacks against you have disadvantage".
  row("Cat's Grace", ["aeronaut"], { effects: [{ kind: "oa_disadv" }] }),

  // "A claw, tendril, or bone blade: a natural weapon dealing 1d8 + CHA
  // slashing": pc_attack names it, swung with CHA (src/lib/srd/authored-effects-more.ts
  // authoredNaturalWeapon, src/lib/dm/pc-attack-profile.ts). Casting a mutation
  // through it is the GM's to narrate: a spell's reach is the spell's.
  row("Chimeric Limb", ["aberrant"], { effects: [{ kind: "natural_weapon", weapon: { ...CHIMERIC_LIMB, dice: "1d8" } }] }),
  // "Your Chimeric Limb deals 2d8, counts as magical, and grants 10-ft reach."
  row("Perfect Chimera", ["aberrant"], { effects: [{ kind: "natural_weapon", weapon: { ...CHIMERIC_LIMB, dice: "2d8", reach: true, magical: true, remakes: true } }] }),

  // "1/turn, your improvised weapons deal +1d4 poison and the target cannot
  // regain HP until your next turn": the 1d4 is src/lib/srd/genre-b-combat.ts
  // genreBRiders; the hit marks the creature until the scavenger's next turn.
  row("Tetanus Edge", ["scavenger"], { effects: [{ kind: "mark", condition: "tetanus", effect: "no_regain", oncePerTurn: true, improvised: true }] }),

  // ---- passives on the engine's own readers (wave 2, second pass) ----
  // "Darkvision 60 ft" (src/lib/srd/authored-effects-more.ts authoredDarkvisionFeet).
  row("Predator Senses", ["aberrant"], { effects: [{ kind: "darkvision", feet: 60 }] }),
  // "While conscious, regain 5 HP at the start of your turn if below half HP"
  // (src/lib/dm/authored-turns.ts authoredTurnStart): at 0 hit points the
  // knight is unconscious, and regains nothing.
  row("The Engine Eternal", ["steam_knight"], { effects: [{ kind: "turn_heal", when: "start", formula: "5", gate: { belowHalf: true, notCondition: "unconscious" } }] }),
  // "Your acid formulae ignore resistance": the alchemist's acid is their
  // formulae's (src/lib/dm/authored-saves.ts authoredIgnoresResistance).
  row("Alkahest", ["alchemist"], { effects: [{ kind: "ignore_resist", types: ["acid"] }] }),
  // "Concentration on your sermons cannot be broken by damage": every spell
  // the preacher casts is a sermon (authored-effects-more.ts authoredConcentrationGuard).
  row("The Word Made Iron", ["waste_preacher"], { effects: [{ kind: "concentration_guard", anySpell: true, tempHp: "0" }] }),
  // Checks about one circumstance, which the check call names (src/lib/dm/roll-about.ts CHECK_ABOUT):
  // "Advantage on checks to drive, ride, or repair vehicles".
  row("Wheelman", ["road_warrior"], { effects: [{ kind: "check_adv", abilities: ["str", "dex", "con", "int", "wis", "cha"], about: "vehicles" }] }),
  // "Advantage on checks to understand or copy unfamiliar technology".
  row("Quick Study", ["gadgeteer"], { effects: [{ kind: "check_adv", abilities: ["str", "dex", "con", "int", "wis", "cha"], about: "devices" }] }),
  // "You and your beast track with advantage" (the beast's tracking is the GM's: no pet rolls checks).
  row("Scent the Wind", ["packmaster"], { effects: [{ kind: "check_adv", abilities: ["str", "dex", "con", "int", "wis", "cha"], about: "tracking" }] }),
  // "Deception checks to hold it have advantage": a check about passing as someone else.
  row("A New Face", ["grifter"], { effects: [{ kind: "check_adv", abilities: ["cha"], about: "disguise" }] }),
  // "Advantage on checks to interpret dreams, art, ciphers, and ritual
  // symbolism": a hidden message of a visual kind (art, a cipher, a symbol);
  // a dream is no check the engine names.
  row("Symbol Reading", ["alienist"], { effects: [{ kind: "check_adv", abilities: ["str", "dex", "con", "int", "wis", "cha"], about: "hidden_message" }] }),
  // "advantage on all WIS checks involving them": beasts and plants, the check's creature.
  row("Lord of the Green", ["packmaster"], { effects: [{ kind: "check_adv", abilities: ["wis"], creatures: ["beast", "plant"] }] }),

  // Saves against the holder's spells (src/lib/dm/authored-saves.ts
  // authoredEnemySave): "undead within 30 ft have disadvantage on saves
  // against your workings"; "Machines and constructs have disadvantage on saves
  // against your arts" (a machine is a construct on the SRD engine).
  row("Mistress of the Threshold", ["spirit_medium"], { effects: [{ kind: "enemy_save", when: "near", rangeFt: 30, types: ["undead"] }] }),
  row("The Grid Bows", ["aether_channeler"], { effects: [{ kind: "enemy_save", when: "any", types: ["construct"] }] }),
  // "Your mutations ignore resistance to their damage type": every spell the
  // aberrant casts is a mutation (authored-saves.ts authoredIgnoresResistance).
  row("Perfected Instability", ["aberrant"], { effects: [{ kind: "ignore_resist", types: ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"], spells: true }] }),

  // ---- spends on the feature's own counter (src/lib/classes/resources.json) ----
  // Each spends its counter through use_resource (src/lib/dm/authored-spends.ts),
  // so a bare spend does what the text says rather than reading it back. The
  // conditions are rows of src/lib/srd/genre-b-conditions.ts.
  // "Bonus action: a shielding spirit grants you or an ally +2 AC until your next turn."
  spend("Spirit Ward", ["spirit_medium"], "mystery_spirit_ward", "bonus", { kind: "buff", target: "ally", condition: "spirit ward", rounds: 1 }),
  // "grant yourself and allies within 30 ft advantage on the next check made in pursuit of a suspect."
  spend("The Game Afoot", ["detective"], "mystery_the_game_afoot", undefined, { kind: "buff", target: "allies", rangeFt: 30, count: "8", condition: "the game afoot", rounds: 600 }),
  // "allies within 30 ft gain temp HP equal to your level + CON mod."
  spend("Rally the Line", ["enforcer"], "mystery_rally_the_line", undefined, { kind: "temp_hp", formula: "level+con", allies: { rangeFt: 30, count: "8" } }),
  // "impose disadvantage on a creature's attack or check by voicing its doubt aloud (WIS save negates)."
  spend("Dream Logic", ["alienist"], "mystery_dream_logic", undefined, { kind: "save_effect", save: "wis", dcAbility: "int", condition: "dream logic", rounds: 10 }),
  // "a creature that can hear you treats you as a trusted friend for 10 minutes (WIS save negates)": charmed by the grifter.
  spend("Everybody's Friend", ["grifter"], "mystery_everybody_s_friend", undefined, { kind: "save_effect", save: "wis", dcAbility: "cha", condition: "charmed", rounds: 100 }),
  // "an interrogation question must be answered truthfully or the subject visibly refuses (WIS save to refuse quietly)."
  spend("Pressure Point", ["detective"], "mystery_pressure_point", undefined, {
    kind: "save_effect", save: "wis", dcAbility: "int", condition: "pressure point", rounds: 1,
    onFail: "It answers the question truthfully, or refuses where everyone can see it refuse.",
  }),
  // "you and your beast each gain +2 to damage rolls for 1 minute" (the beast's +2 is the GM's: no pet carries the holder's conditions).
  spend("Shared Fury", ["packmaster"], "post_apocalyptic_shared_fury", undefined, { kind: "buff", condition: "shared fury", rounds: 10 }),
  // "Bonus action: one ally within 30 ft gains temp HP equal to your level + WIS mod."
  spend("Flock's Shepherd", ["waste_preacher"], "post_apocalyptic_flock_s_shepherd", "bonus", { kind: "buff", target: "ally", othersOnly: true, condition: "shepherded", rounds: 600, tempHp: "level+wis" }),
  // "project a 10-ft energy dome for 1 minute: allies inside gain +2 AC".
  spend("Salvaged Shield Node", ["salvage_tech"], "post_apocalyptic_salvaged_shield_node", undefined, { kind: "buff", target: "allies", rangeFt: 10, count: "8", condition: "salvaged shield node", rounds: 10 }),
  // "brew a greater elixir: drinker gains advantage on everything for 1 minute."
  spend("Elixir of Mastery", ["alchemist"], "steampunk_elixir_of_mastery", undefined, { kind: "buff", target: "ally", condition: "elixir of mastery", rounds: 10 }),
  // "for 1 minute you and adjacent allies have resistance to all damage."
  spend("Unbreakable Vanguard", ["steam_knight"], "steampunk_unbreakable_vanguard", undefined, { kind: "buff", target: "allies", rangeFt: 5, count: "8", condition: "unbreakable vanguard", rounds: 10 }),
  // "a whirling storm shield for 1 minute: +2 AC and melee attackers take 2d8 lightning."
  {
    feature: "Tempest Shell",
    classes: ["aether_channeler"],
    entry: {
      subclass: "genre",
      counter: "steampunk_tempest_shell",
      effects: [{ kind: "retaliate", formula: "2d8", type: "lightning", melee: true, gate: { condition: "tempest shell" } }],
      spends: [{ name: "Tempest Shell", pool: { id: "steampunk_tempest_shell" }, does: { kind: "buff", condition: "tempest shell", rounds: 10 } }],
    },
  },
  // "double your speed and gain an extra action each turn for 1 minute".
  // "take 3d10 fire when it ends": the debt the minute leaves (src/lib/dm/genre-b-steampunk-ends.ts).
  spend("Full Throttle", ["steam_knight"], "steampunk_full_throttle", undefined, { kind: "buff", condition: "full throttle", rounds: 10, debt: "boiler strain" }),
  // "1/rest, reduce all damage you take this round by your CON modifier" (the cut: genre-b-combat.ts genreDamageCut).
  spend("Hardened", ["road_warrior"], "post_apocalyptic_hardened", undefined, { kind: "buff", condition: "hardened", rounds: 1 }),
  // "1/rest, your tuned weapon deals +2d8 lightning on one hit; the target
  // cannot take reactions until its next turn".
  { feature: "Arc Coil", classes: ["gadgeteer"], entry: { subclass: "genre", counter: "steampunk_arc_coil", spends: [{ name: "Arc Coil", pool: { id: "steampunk_arc_coil" }, afterWeaponHit: true, does: { kind: "die_damage", dice: "2d8", type: "lightning", until: "arc shocked" } }] } },
  // "1 minute of work restores 1d8 + INT HP to a construct, machine, or armored ally" (Field Repair (2d8): 2d8 + INT from 11th).
  spend("Field Repair", ["machinist"], "steampunk_field_repair", "action", { kind: "flames", healOnly: true, type: "", formula: [[1, "1d8+int"], [11, "2d8+int"]] }),
  // "whack a machine or construct: restore 1d8 + INT HP to it".
  spend("Percussive Maintenance", ["salvage_tech"], "post_apocalyptic_percussive_maintenance", "action", { kind: "flames", healOnly: true, type: "", formula: "1d8+int" }),

  // "2/long rest, brew a draught: the drinker regains 2d4 + INT HP as a bonus
  // action"; Philosopher's Draught cures one poison and grants an hour of
  // poison immunity (src/lib/dm/genre-b-cure.ts genreDraught).
  spend("Emergency Draught", ["alchemist"], "steampunk_emergency_draught", "bonus", {
    kind: "draught", formula: "2d4+int", upgrade: { feature: "Philosopher's Draught", ends: ["poisoned"], condition: "philosopher's draught", rounds: 600 },
  }),
  // "Spend a hit die as a bonus action to heal, CHA-mod uses per long rest."
  spend("Regenerative Strain", ["aberrant"], "post_apocalyptic_regenerative_strain", "bonus", { kind: "hit_die" }),
  // "1/rest, turn to crackling energy and move 30 ft through creatures and
  // objects as a bonus action": the nearest SRD move is a teleport of 30 feet.
  spend("Storm Step", ["aether_channeler"], "steampunk_storm_step", "bonus", { kind: "teleport", feet: 30, note: "through creatures and objects as crackling energy" }),

  // Slotless casts (src/lib/dm/genre-b-free-cast.ts MARKS, read by the cast
  // guard): one cast of the level or lower, the mark spent by it.
  // "cast a 1st-level schematic without expending a slot"; Perpetual Motion:
  // "works for schematics up to 3rd level, twice per rest".
  spend("Overpressure Valve", ["machinist"], "steampunk_overpressure_valve", undefined, { kind: "buff", condition: [[5, "slotless cast (1st)"], [18, "slotless cast (3rd)"]], rounds: 600 }),
  // "cast a 1st-level tech effect without expending a slot"; Power Cell Cache (3rd): "up to 3rd level".
  spend("Power Cell Cache", ["salvage_tech"], "post_apocalyptic_power_cell_cache", undefined, { kind: "buff", condition: [[5, "slotless cast (1st)"], [14, "slotless cast (3rd)"]], rounds: 600 }),
  spend("Sublimation", ["alchemist"], "steampunk_sublimation", undefined, { kind: "buff", condition: "slotless cast (3rd)", rounds: 600 }),
  spend("The Examined Mind", ["alienist"], "mystery_the_examined_mind", undefined, { kind: "buff", condition: "slotless cast (5th)", rounds: 600 }),
  spend("Magnum Opus", ["machinist"], "steampunk_magnum_opus", undefined, { kind: "buff", condition: "slotless cast (6th)", rounds: 600 }),
  spend("The Great Work", ["alchemist"], "steampunk_the_great_work", undefined, { kind: "buff", condition: "slotless cast (7th)", rounds: 600 }),
  // "Choose one 3rd-level schematic; cast it 1/long rest without a slot": the player's chosen spell, of exactly that level.
  spend("Master Schematic", ["machinist"], "steampunk_master_schematic", undefined, { kind: "buff", condition: "chosen cast (3rd)", rounds: 600 }),
  spend("Prototype Rig", ["salvage_tech"], "post_apocalyptic_prototype_rig", undefined, { kind: "buff", condition: "chosen cast (5th)", rounds: 600 }),
  // "for 1 minute your ... of Nth level or lower cost no slots", the mark kept for the minute.
  spend("Living Dynamo", ["aether_channeler"], "steampunk_living_dynamo", undefined, { kind: "buff", condition: "slotless minute (3rd)", rounds: 10 }),
  spend("Reactor Heart", ["salvage_tech"], "post_apocalyptic_reactor_heart", undefined, { kind: "buff", condition: "slotless minute (4th)", rounds: 10 }),
  // "your mutations of 3rd level or lower cost no slots and your Adaptive Hide grants +2 more AC".
  spend("The Next Step", ["aberrant"], "post_apocalyptic_the_next_step", undefined, { kind: "buff", condition: "the next step", rounds: 10 }),
  // Conditions ended (src/lib/dm/genre-b-cure.ts): an illusion or a curse is
  // no condition the board holds, so charm and fear (and a curse the GM laid
  // by that name) are the engine's.
  spend("Break the Delusion", ["alienist"], "mystery_break_the_delusion", undefined, { kind: "cure", ends: ["charmed", "frightened"], rangeFt: 30 }),
  spend("Deliverance", ["waste_preacher"], "post_apocalyptic_deliverance", undefined, { kind: "cure", ends: ["frightened", "charmed", "cursed"], rangeFt: 30 }),
  // "allies within 60 ft regain 5d8 HP and are freed of fear, charm, and exhaustion by one level".
  spend("Revelation", ["waste_preacher"], "post_apocalyptic_revelation", undefined, { kind: "cure", ends: ["frightened", "charmed"], rangeFt: 60, every: true, heal: "5d8", exhaustion: 1 }),
  // "1/long rest, regain expended slot levels equal to your INT modifier" (and CHA).
  spend("Aether Capacitor", ["machinist"], "steampunk_aether_capacitor", undefined, { kind: "regain_slot_levels", levels: "int" }),
  spend("Aetheric Battery", ["aether_channeler"], "steampunk_aetheric_battery", undefined, { kind: "regain_slot_levels", levels: "cha" }),
  // "your raised hand sheds sunlight in a 30-ft radius for 10 minutes; undead
  // and mutants in it have disadvantage on attacks": the light on the
  // preacher, and an undead's attack on them at disadvantage while it burns.
  {
    feature: "Dawnlight",
    classes: ["waste_preacher"],
    entry: {
      subclass: "genre",
      counter: "post_apocalyptic_dawnlight",
      // "undead and mutants in it": a mutant is a monstrosity on the SRD
      // engine (as Alpha's Roar reads it), and "in it" is within the 30 feet
      // of the light, whoever they attack.
      effects: [{ kind: "attacked_disadv", from: ["undead", "monstrosity"], rangeFt: 30, gate: { condition: "dawnlight" } }],
      // The light on the board (src/lib/battlemap/zones-genre-b.ts), burning
      // once the preacher has The Last Dawn Rises.
      spends: [{ name: "Dawnlight", pool: { id: "post_apocalyptic_dawnlight" }, does: { kind: "buff", condition: "dawnlight", rounds: 100, zone: { lays: "dawnlight", upgrade: { feature: "The Last Dawn Rises", lays: "the last dawn" } } } }],
    },
  },

  // A mark on the caster the next damaging spell spends
  // (src/lib/dm/genre-b-spell-hits.ts): "a damaging art rolls maximum dice";
  // "add +1d4 to one formula's damage or healing"; "a single-target lightning
  // art jumps to a second target within 15 ft for half damage". A minute to
  // cast it in.
  spend("Overcharge", ["aether_channeler"], "steampunk_overcharge", "none", { kind: "buff", condition: "overcharge", rounds: 10 }),
  spend("Chain Arc", ["aether_channeler"], "steampunk_chain_arc", "none", { kind: "buff", condition: "chain arc", rounds: 10 }),
  {
    feature: "Catalyst Stone",
    classes: ["alchemist"],
    entry: {
      subclass: "genre",
      counter: "steampunk_catalyst_stone",
      // The healing half: the die rides the next healing spell's roll
      // (src/lib/dm/heal-bonus.ts), and that spell spends the stone.
      effects: [{ kind: "spell_rider", dice: [[1, "1d4"], [9, "1d8"]], healing: true, gate: { condition: "catalyst stone" } }],
      spends: [{ name: "Catalyst Stone", pool: { id: "steampunk_catalyst_stone" }, action: "none", does: { kind: "buff", condition: "catalyst stone", rounds: 10 } }],
    },
  },
  // "Your healing sermons add your WIS modifier again to HP restored": every
  // spell the preacher heals with is a sermon.
  row("Lay On the Word", ["waste_preacher"], { effects: [{ kind: "spell_rider", dice: "wis", healing: true }] }),

  // Areas on the board (src/lib/dm/genre-b-zones.ts, rows in
  // src/lib/battlemap/zones-genre-b.ts), thrown onto a creature within reach.
  spend("Gear Swarm", ["machinist"], "steampunk_gear_swarm", undefined, { kind: "zone", lays: "gear swarm", rangeFt: 30 }),
  spend("Dissolving Mist", ["alchemist"], "steampunk_dissolving_mist", undefined, { kind: "zone", lays: "dissolving mist", rangeFt: 60, dcAbility: "int" }),

  // Foes in reach save or suffer (src/lib/dm/authored-spend-effects.ts saveArea,
  // only the holder's foes: the procession and the cloud spare the party).
  // "hostile beasts and mutants within 30 ft save (WIS) or cower (no move
  // toward you) for 1 minute": a mutant is a monstrosity on the SRD engine, and
  // the cowering creature's walk never comes nearer the packmaster
  // (src/lib/dm/enemy-approach.ts fearSourceAt).
  spend("Alpha's Roar", ["packmaster"], "post_apocalyptic_alpha_s_roar", undefined, { kind: "save_area", save: "wis", dcAbility: "wis", rangeFt: 30, types: ["beast", "monstrosity"], condition: "cowering", rounds: 10 }),
  // "a stinking cloud fills a 10-ft radius for 1 minute: creatures inside save
  // (CON) or retch, losing their action": the cloud stands on the alchemist,
  // and a creature that fails retches for its minute (no action).
  spend("Fumes and Vapors", ["alchemist"], "steampunk_fumes_and_vapors", undefined, { kind: "save_area", save: "con", dcAbility: "int", rangeFt: 10, condition: "retching", rounds: 10 }),

  // ---- reactions on the feature's own counter ----
  // "Reaction when attacked: your read of the attacker imposes disadvantage": the attack that hit is rolled again at disadvantage.
  react("Deductive Counter", ["detective"], "mystery_deductive_counter", { kind: "disadv_vs_hit" }),
  react("Duck the Consequences", ["muckraker"], "mystery_duck_the_consequences", { kind: "disadv_vs_hit" }),
  // "Reaction when hit: gain resistance to that instance of damage."
  react("Ectoplasmic Shield", ["spirit_medium"], "mystery_ectoplasmic_shield", { kind: "reduce", amount: "half", who: "self" }),
  // "reaction when hit: split into a swarm shape until your next turn, taking half damage from the attack".
  react("Splintered Form", ["aberrant"], "post_apocalyptic_splintered_form", { kind: "reduce", amount: "half", who: "self" }),
  // "Reaction when hit in melee: the attacker takes 2d6 acid as an ampoule bursts."
  react("Vitriol Ampoule", ["alchemist"], "steampunk_vitriol_ampoule", { kind: "strike_back", amount: "2d6", type: "acid", melee: true }),
];

function spend(feature: string, classes: string[], counter: string, action: SpendAction | undefined, does: SpendDoes): GenreRow {
  return { feature, classes, entry: { subclass: "genre", counter, spends: [{ name: feature, pool: { id: counter }, ...(action ? { action } : {}), does }] } };
}

function react(feature: string, classes: string[], counter: string, does: ReactionDoes): GenreRow {
  return { feature, classes, entry: { subclass: "genre", counter, reactions: [{ name: feature, pool: { id: counter }, does }] } };
}

// feature-effects.ts's shapes, matched by name (keyed there) and held to the class.
type Def = {
  match: string[];
  classes: string[];
  effects: Array<
    | { kind: "initiative_bonus"; amount: number }
    | { kind: "speed_bonus"; amount: (level: number) => number }
    | { kind: "ac_bonus"; amount: number; requiresArmor?: boolean }
    | { kind: "half_proficiency"; scope: "mental" }
    | { kind: "crit_range"; low: number }
  >;
  guidance: string;
};

export const GENRE_B_FEATURE_DEFS: Def[] = [
  { match: ["anticipate violence"], classes: ["detective"], effects: [{ kind: "initiative_bonus", amount: 2 }], guidance: "Anticipate Violence: +2 initiative, which the server adds." },
  // "Add half your proficiency bonus to INT and WIS checks you are not proficient in."
  { match: ["sharpened logic"], classes: ["detective"], effects: [{ kind: "half_proficiency", scope: "mental" }], guidance: "Sharpened Logic: half the proficiency bonus on Intelligence and Wisdom checks without it, which the server adds." },
  { match: ["master of the high wire"], classes: ["aeronaut"], effects: [{ kind: "speed_bonus", amount: () => 10 }], guidance: "Master of the High Wire: +10 ft walking speed, which the server adds." },
  // "Your tuned armor grants +1 AC": armor the steam knight wears is tuned.
  { match: ["boiler plate"], classes: ["steam_knight"], effects: [{ kind: "ac_bonus", amount: 1, requiresArmor: true }], guidance: "Boiler Plate: +1 AC while armored, which the server adds." },
  // "Boiler Plate grants +2 AC": one more than Boiler Plate's own.
  { match: ["reinforced boiler"], classes: ["steam_knight"], effects: [{ kind: "ac_bonus", amount: 1, requiresArmor: true }], guidance: "Reinforced Boiler: Boiler Plate's bonus is +2 AC while armored, which the server adds." },
  // Masterwork Arsenal: "their critical range improves to 19-20" (the +2 is
  // src/lib/srd/genre-b-combat.ts genreWornRiders).
  { match: ["masterwork arsenal"], classes: ["gadgeteer"], effects: [{ kind: "crit_range", low: 19 }], guidance: "Masterwork Arsenal: weapon attacks score a critical hit on a 19 or 20, which the server applies." },
  { match: ["reinforced chassis"], classes: ["machinist"], effects: [{ kind: "ac_bonus", amount: 1, requiresArmor: true }], guidance: "Reinforced Chassis: +1 AC while armored, which the server adds." },
];

// What a trigger-shaped genre counter answers (src/lib/srd/trigger-table.ts
// WRITTEN): its use is refused with nothing on record to answer, and the Hand
// deals it when the trigger comes, never as a card on the holder's own turn.
// None yet: Emergency Release's vent answers a blow that takes the steam knight
// below half, a trigger of a counter that costs no reaction, which the Hand's
// reaction strip does not deal (the handoff names it).
export const GENRE_B_TRIGGERS: Record<string, { on: Array<{ kind: "damaged" }>; what: string }> = {};
