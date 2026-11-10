// The cyberpunk, dark fantasy and horror classes' features, as the authored
// layer's rows (WAVE2 D5: "The genre classes' text is the rule, played on the
// SRD 5.1 engine"). Each row is found by its feature's name (authored-effects.ts
// heldAuthored), with `classes` naming the class it belongs to so a name another
// genre class uses means only that class's feature. The text each row holds is
// the catalog's (src/lib/classes/<genre>-features.json); the ledgers
// (scripts/clauses/genre-<genre>.json) say which clause each row holds.
//
// Before this every one of these was a line of the GM's prompt and nothing
// else: Chrome Constitution resisted no poison, Iron Constitution let a poison
// land, Hypervigilant was surprised with the rest of the party.
import type { AuthoredEffect, AuthoredEntry } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

const row = (classId: string, feature: string, effects: AuthoredEffect[], more: Partial<AuthoredEntry> = {}): GenreRow => ({
  feature,
  classes: [classId],
  entry: { subclass: "genre", effects, ...more },
});

const FEAR: AuthoredEffect = { kind: "save_adv", against: ["frightened"] };

// ---- passive defenses, saves and senses ----
const PASSIVES: GenreRow[] = [
  // cyberpunk
  row("netrunner", "Ghost in the Feed", [{ kind: "check_adv", skills: ["stealth"], creatures: ["construct"], note: "Advantage on Stealth against a construct; cameras and sensors are the GM's to name as constructs." }]),
  row("netrunner", "Neural Firewall", (["int", "wis", "cha"] as const).map((ability): AuthoredEffect => ({ kind: "save_adv", ability, magical: true }))),
  // "cannot be surprised while conscious"; its +2 to initiative is the
  // feature-effects entry (genre-a-feature-defs.ts).
  row("street_samurai", "Chrome Reflexes", [{ kind: "no_surprise" }]),
  row("street_samurai", "Subdermal Plating", [{ kind: "ac", amount: 1, gate: { notHeavy: true } }]),
  row("street_samurai", "Chrome Constitution", [{ kind: "save_adv", ability: "con" }, { kind: "resist", types: ["poison"] }]),
  row("esper", "Thought Shield", [{ kind: "save_bonus", amount: 2, ability: "wis", note: "+2 on WIS saves; a mind that cannot be read is the GM's to keep." }]),
  row("esper", "Mind Fortress", [{ kind: "resist", types: ["psychic"] }, { kind: "save_adv", against: ["charmed", "frightened"] }]),
  row("esper", "Ascendant Mind", [{ kind: "immune_damage", types: ["psychic"] }]),
  // dark fantasy
  row("witch_hunter", "Grim Resolve", [FEAR]),
  row("witch_hunter", "Iron Will", [{ kind: "save_adv", against: ["charmed"] }]),
  row("plague_doctor", "Miasma Ward", [{ kind: "resist", types: ["poison"] }, { kind: "save_adv", against: ["disease"] }]),
  row("plague_doctor", "Beaked Mask", [FEAR]),
  row("plague_doctor", "Iron Constitution", [{ kind: "immune_damage", types: ["poison"] }, { kind: "immune_condition", conditions: ["poisoned", "diseased"] }]),
  row("plague_doctor", "Miasma Mantle", [{ kind: "resist", types: ["necrotic"] }]),
  row("grave_knight", "Knight of Dust", [{ kind: "resist", types: ["necrotic"] }]),
  row("grave_knight", "Wight-Iron Will", [{ kind: "immune_condition", conditions: ["frightened", "charmed"] }]),
  row("penitent", "Scarred Hide", [{ kind: "resist", types: ["slashing"], nonmagical: true }]),
  row("penitent", "Flagellant's Trance", [FEAR]),
  // "when a creature hits you in melee, it takes your WIS mod in fire damage"
  row("penitent", "Robes of Soot", [{ kind: "resist", types: ["fire"] }, { kind: "retaliate", formula: "wis", type: "fire", melee: true }]),
  row("dirgesinger", "Songs of the Barrow", [{ kind: "save_adv", against: ["frightened", "necrotic"] }]),
  row("vermin_lord", "Plaguebearer's Immunity", [{ kind: "immune_condition", conditions: ["diseased"] }, { kind: "resist", types: ["poison"] }]),
  // horror
  row("exorcist", "Litany of Defense", [FEAR]),
  row("exorcist", "Unshakeable Faith", [{ kind: "immune_condition", conditions: ["frightened"] }, { kind: "save_adv", against: ["charmed"] }]),
  row("exorcist", "Sacred Bulwark", [{ kind: "resist", types: ["necrotic", "psychic"] }]),
  row("occultist", "Palimpsest Soul", [{ kind: "resist", types: ["psychic"] }]),
  row("occultist", "Unblinking Study", [{ kind: "no_surprise", types: ["aberration", "fiend", "undead"] }]),
  row("survivor", "Read the Room", [{ kind: "init_adv" }]),
  row("survivor", "Hypervigilant", [{ kind: "no_surprise" }]),
  row("slayer", "Iron Stomach", [{ kind: "save_adv", against: ["poisoned", "disease"] }]),
  row("slayer", "Flinchless", [FEAR]),
  row("slayer", "Veteran's Guard", [{ kind: "ac", amount: 1 }, { kind: "oa_disadv" }]),
  row("parapsychologist", "Rational Mind", [{ kind: "save_adv", against: ["charmed", "frightened"] }]),
  row("parapsychologist", "Controlled Exposure", [{ kind: "resist", types: ["psychic"] }]),
  row("parapsychologist", "Clinical Detachment", [{ kind: "immune_condition", conditions: ["frightened"], note: "While the instruments are in hand: the GM says when they are not." }]),
  row("apostate", "Scar Tissue", [{ kind: "resist", types: ["necrotic"] }]),
  row("apostate", "Hunted Instincts", [{ kind: "no_surprise", slugs: ["cultist", "cult_fanatic"] }]),
];

// ---- spends and reactions on the feature's own counter ----
// Each spend pays its own counter (src/lib/classes/resources.json), checked
// and written by src/lib/dm/authored-spends.ts; each reaction answers the
// open hit record (src/lib/dm/authored-reactions.ts), its counter passive to
// use_resource (src/lib/srd/genre-a-counter-terms.ts).
const counted = (classId: string, feature: string, counter: string, more: Omit<AuthoredEntry, "subclass" | "counter">): GenreRow => ({
  feature,
  classes: [classId],
  entry: { subclass: "genre", counter, ...more },
});

const SPENDS: GenreRow[] = [
  counted("esper", "Static Shield", "cyberpunk_static_shield", {
    spends: [{ name: "Static Shield", pool: { id: "cyberpunk_static_shield" }, action: "bonus", does: { kind: "buff", condition: "static shield", rounds: 1 } }],
  }),
  counted("street_samurai", "Indomitable Firmware", "cyberpunk_indomitable_firmware", {
    spends: [{ name: "Indomitable Firmware", pool: { id: "cyberpunk_indomitable_firmware" }, action: "none", does: { kind: "reroll_save" } }],
  }),
  // "control a construct or networked system for 1 minute (INT save
  // negates)": a networked system is no creature the app models, so the
  // construct is the nearest SRD mechanic (WAVE2 D5), commanded as Command
  // Undead commands its undead.
  counted("netrunner", "Root Access", "cyberpunk_root_access", {
    spends: [{
      name: "Root Access",
      pool: { id: "cyberpunk_root_access" },
      action: "action",
      does: { kind: "save_effect", save: "int", dcAbility: "spell", condition: "charmed", rounds: 10, types: ["construct"], commands: true, onFail: "obeys the netrunner for a minute" },
    }],
  }),
  counted("slayer", "One Against the Night", "horror_one_against_the_night", {
    spends: [{ name: "One Against the Night", pool: { id: "horror_one_against_the_night" }, action: "none", does: { kind: "buff", condition: "one against the night", rounds: 10 } }],
  }),
  counted("grave_knight", "Deathless Champion", "dark_fantasy_deathless_champion", {
    spends: [{ name: "Deathless Champion", pool: { id: "dark_fantasy_deathless_champion" }, action: "none", does: { kind: "buff", condition: "deathless champion", rounds: 10 } }],
  }),
  // "banish a fiend, undead, or spirit of CR 15 or lower to its home plane
  // (CHA save negates)": a spirit is an undead in the SRD's types.
  counted("exorcist", "The Unhosted Word", "horror_the_unhosted_word", {
    spends: [{
      name: "The Unhosted Word",
      pool: { id: "horror_the_unhosted_word" },
      action: "action",
      does: { kind: "save_effect", save: "cha", dcAbility: "spell", condition: "banished", types: ["fiend", "undead"], onFail: "is banished to its home plane (the GM refuses a creature above challenge rating 15)" },
    }],
  }),
  counted("street_samurai", "Bullet Time", "cyberpunk_bullet_time", {
    reactions: [{ name: "Bullet Time", pool: { id: "cyberpunk_bullet_time" }, sees: "attacker", does: { kind: "ac_vs_hit", amount: 3, rangedOnly: true } }],
  }),
  counted("netrunner", "Overwatch", "cyberpunk_overwatch", {
    reactions: [{ name: "Overwatch", pool: { id: "cyberpunk_overwatch" }, sees: "target", does: { kind: "disadv_vs_hit", allyWith: "Overwatch", rangeFt: 120 } }],
  }),
  counted("apostate", "Blood Ward", "horror_blood_ward", {
    reactions: [{
      name: "Blood Ward",
      pool: { id: "horror_blood_ward" },
      does: { kind: "resist_instance", types: ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"], who: "either", rangeFt: 0, lingers: "blood ward" },
    }],
  }),
  counted("survivor", "Pain Tolerance", "horror_pain_tolerance", {
    reactions: [{ name: "Pain Tolerance", pool: { id: "horror_pain_tolerance" }, does: { kind: "reduce", amount: "half", who: "self" } }],
  }),
];

// ---- strikes, and the defenses a state switches on ----
// The riders and attack bonuses are read by src/lib/dm/genre-a-strikes.ts;
// the gates (below half, below a quarter, two weapons in hand) by
// src/lib/srd/genre-a-gates.ts through gateHolds.
const BELOW_HALF = { belowHalf: true } as const;
const BELOW_QUARTER = { belowQuarter: true } as const;
// The grave knight's bonded weapon in hand (Deathly Pact Blade's spend lays it).
const PACT_BLADE = { condition: "deathly pact blade", because: "the pact blade in hand (Deathly Pact Blade)" } as const;

const STRIKES: GenreRow[] = [
  // dark fantasy
  row("penitent", "Zeal Through Pain", [
    { kind: "check_adv", abilities: ["str"], gate: BELOW_HALF },
    { kind: "attack_bonus", amount: 1, gate: BELOW_HALF },
  ]),
  row("penitent", "Cinder Palms", [{ kind: "hit_rider", dice: "1d4", type: "fire", when: "melee", weapons: ["unarmed strike", "flail"] }]),
  row("penitent", "Ecstatic Fury", [
    { kind: "hit_rider", dice: "2d6", gate: BELOW_QUARTER },
    { kind: "immune_condition", conditions: ["frightened", "charmed"], gate: BELOW_QUARTER },
  ]),
  row("vermin_lord", "Gutter Fighting", [{ kind: "hit_rider", dice: "1d6", oncePerTurn: true, vsNotActed: true }]),
  // "rises to +2d6": a second d6 on the same hits.
  row("vermin_lord", "Greater Gutter Fighting", [{ kind: "hit_rider", dice: "1d6", oncePerTurn: true, vsNotActed: true }]),
  row("vermin_lord", "Nimble Escape", [
    { kind: "bonus_route", action: "dash" },
    { kind: "bonus_route", action: "disengage" },
    { kind: "bonus_route", action: "hide" },
  ]),
  row("grave_knight", "Reaping Blade", [{ kind: "hit_rider", dice: "1d8", type: "necrotic", when: "melee", gate: PACT_BLADE }]),
  // "Your pact blade's necrotic rises to +2d8": one more d8 on Reaping Blade's.
  row("grave_knight", "Champion of the Quiet Court", [{ kind: "hit_rider", dice: "1d8", type: "necrotic", when: "melee", gate: PACT_BLADE }]),
  row("witch_hunter", "Anathema Ward", [{ kind: "resist", types: ["necrotic"] }]),
  row("dirgesinger", "The Final Movement", [{ kind: "init_refill", resource: "dark_fantasy_requiem_inspiration", amount: 3 }]),
  // horror
  // "spirits" are undead in the SRD's types.
  row("exorcist", "Anathema", [{ kind: "hit_rider", dice: "2d8", type: "radiant", oncePerTurn: true, vsTypes: ["fiend", "undead"] }]),
  row("slayer", "Blessed Silver", [{ kind: "hit_rider", dice: "1d8", type: "radiant", vsTypes: ["undead", "fiend", "shapechanger"] }]),
  row("survivor", "Desperate Strength", [{ kind: "attack_bonus", amount: 2, gate: BELOW_HALF }]),
  row("survivor", "Deep Reserves", [{ kind: "init_refill", resource: "horror_adrenaline_surge", amount: "all" }]),
  // "your stigmata ignore resistance to necrotic": the apostate's necrotic.
  row("apostate", "Skin Like Scripture", [
    { kind: "ac", amount: 2, gate: BELOW_HALF },
    { kind: "ignore_resist", types: ["necrotic"], gate: BELOW_HALF },
  ]),
  // cyberpunk
  row("street_samurai", "Twin Chrome", [{ kind: "ac", amount: 1, gate: { dualWield: true } }]),
];

export const GENRE_A_AUTHORED: GenreRow[] = [...PASSIVES, ...SPENDS, ...STRIKES];
