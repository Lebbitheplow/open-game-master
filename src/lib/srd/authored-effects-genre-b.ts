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
  row("Toxic Blood", ["aberrant"], { effects: [{ kind: "immune_damage", types: ["poison"] }, { kind: "immune_condition", conditions: ["poisoned"] }] }),
  row("Chameleon Skin", ["aberrant"], { effects: [{ kind: "check_adv", skills: ["stealth"] }] }),
  row("Scrap Armor Weave", ["salvage_tech"], { effects: [{ kind: "ac", amount: 1 }, { kind: "resist", types: ["lightning"] }] }),
  // The holder's own part of "You and allies within 10 ft have resistance to
  // necrotic damage and advantage against fear".
  row("Walk Through the Valley", ["waste_preacher"], { effects: [{ kind: "resist", types: ["necrotic"] }, { kind: "save_adv", against: ["frightened"] }] }),
  // ---- steampunk ----
  row("Acid Resistant Apron", ["alchemist"], { effects: [{ kind: "resist", types: ["acid", "poison"] }] }),
  row("Grounded Stance", ["aether_channeler"], { effects: [{ kind: "resist", types: ["lightning"] }] }),
  row("Lightning Rod", ["aether_channeler"], { effects: [{ kind: "immune_damage", types: ["lightning"] }] }),
  // "Advantage on saves against poison gas and drowning".
  row("Pressure Seal", ["steam_knight"], { effects: [{ kind: "save_adv", against: ["poisoned", "poison"] }] }),
  row("Reinforced Boiler", ["steam_knight"], { effects: [{ kind: "resist", types: ["fire"] }] }),
  row("Adamant Boiler", ["steam_knight"], { effects: [{ kind: "crit_immune" }] }),
  // "opportunity attacks against you have disadvantage".
  row("Cat's Grace", ["aeronaut"], { effects: [{ kind: "oa_disadv" }] }),

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
  spend("Full Throttle", ["steam_knight"], "steampunk_full_throttle", undefined, { kind: "buff", condition: "full throttle", rounds: 10 }),
  // "1/rest, your tuned weapon deals +2d8 lightning on one hit".
  { feature: "Arc Coil", classes: ["gadgeteer"], entry: { subclass: "genre", counter: "steampunk_arc_coil", spends: [{ name: "Arc Coil", pool: { id: "steampunk_arc_coil" }, afterWeaponHit: true, does: { kind: "die_damage", dice: "2d8", type: "lightning" } }] } },
  // "1 minute of work restores 1d8 + INT HP to a construct, machine, or armored ally" (Field Repair (2d8): 2d8 + INT from 11th).
  spend("Field Repair", ["machinist"], "steampunk_field_repair", "action", { kind: "flames", healOnly: true, type: "", formula: [[1, "1d8+int"], [11, "2d8+int"]] }),
  // "whack a machine or construct: restore 1d8 + INT HP to it".
  spend("Percussive Maintenance", ["salvage_tech"], "post_apocalyptic_percussive_maintenance", "action", { kind: "flames", healOnly: true, type: "", formula: "1d8+int" }),

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
  { match: ["reinforced chassis"], classes: ["machinist"], effects: [{ kind: "ac_bonus", amount: 1, requiresArmor: true }], guidance: "Reinforced Chassis: +1 AC while armored, which the server adds." },
];

// What a trigger-shaped genre counter answers (src/lib/srd/trigger-table.ts
// WRITTEN): its use is refused with nothing on record to answer, and the Hand
// deals it when the trigger comes, never as a card on the holder's own turn.
// None yet: Emergency Release's vent answers a blow that takes the steam knight
// below half, a trigger of a counter that costs no reaction, which the Hand's
// reaction strip does not deal (the handoff names it).
export const GENRE_B_TRIGGERS: Record<string, { on: Array<{ kind: "damaged" }>; what: string }> = {};
