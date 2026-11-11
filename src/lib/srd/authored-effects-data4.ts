// The engine hooks of issue 474's subclass audit, Appendix B: the authored
// features whose rules text states a number or a state that no engine held,
// across every class (the shape of an entry: authored-effects-data.ts). Each
// gets the hook that fits, or a `narrated` line saying why the DM holds it.

import { WHISPERED_MARK, borrowedVariants } from "@/lib/srd/borrowed-proficiency";
import type { AuthoredEntry, Formula } from "@/lib/srd/authored-effects-types";

// Wild Magic Surge (Wild Magic sorcerer 1): after a sorcerer spell of 1st
// level or higher "the GM may have you roll" on the surge table, and a spent
// Tides of Chaos comes back when they do. A casting that opens that chance
// leaves this mark for a round (cast-guard.ts, authored-effects-more.ts
// opensSurgeChance); use_resource "Wild Magic Surge" needs it, and spends it.
export const SURGE_CHANCE = "surge chance";

const ALL_DAMAGE = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];
const PHYSICAL = ["bludgeoning", "piercing", "slashing"];
// A Psionic Energy die by class level, plus the Intelligence modifier.
const PSIONIC_INT: Formula = (level, mods) => `1${level >= 17 ? "d12" : level >= 11 ? "d10" : level >= 5 ? "d8" : "d6"}+${mods.int ?? 0}`;
// The subclass's spell table grants it, known or always prepared and free
// (subclasses.json `spells`).
const SPELL_TABLE = { file: "src/lib/srd/features.ts", call: "export function subclassSpellsFor(" };

export const AUTHORED_DATA_C: Record<string, AuthoredEntry> = {
  // ---- barbarian ----
  // The rituals are cast with the spells' own tool, ritual true
  // (src/lib/srd/mt-fb-casts.ts); what they reveal is the GM's to tell.
  "barbarian::Spirit Seeker": {
    subclass: "Path of the Totem Warrior",
    heldBy: { file: "src/lib/srd/granted-casts.ts", call: "featureCastsHeld(" },
  },
  "barbarian::Spirit Walker": {
    subclass: "Path of the Totem Warrior",
    heldBy: { file: "src/lib/srd/granted-casts.ts", call: "featureCastsHeld(" },
  },
  "barbarian::Vengeful Ancestors": {
    subclass: "Path of the Ancestral Guardian",
    // Spirit Shield's reaction: the damage it prevents strikes the attacker.
    heldBy: { file: "src/lib/dm/authored-reactions.ts", call: "does.reflect" },
  },
  "barbarian::Warrior of the Gods": {
    subclass: "Path of the Zealot",
    // A spell that returns the dead zealot to life costs its caster no
    // material component (the diamonds of Revivify or Raise Dead).
    heldBy: { file: "src/lib/dm/cast-guard.ts", call: "warriorOfTheGods(" },
  },
  "barbarian::Rage Beyond Death": {
    subclass: "Path of the Zealot",
    // Up at 0 hit points while raging, dying all the same, the death held off
    // until the rage ends.
    heldBy: { file: "src/lib/dm/death.ts", call: "ragesBeyondDeath(" },
  },
  // Wild Surge and Controlled Surge: src/lib/srd/authored-effects-w2-mt-fb.ts.

  // ---- bard ----
  // Blade Flourish's freeDie (authored-effects-data.ts): with no Bardic
  // Inspiration left, the flourish rolls a d6 and spends nothing.
  "bard::Master's Flourish": {
    subclass: "College of Swords",
    heldBy: { file: "src/lib/dm/authored-spends.ts", call: "spend.pool.freeDie" },
  },
  "bard::Silver Tongue": {
    subclass: "College of Eloquence",
    effects: [{ kind: "check_floor", skills: ["persuasion", "deception"], floor: 10 }],
  },
  // The die this bard gives is marked where it is given (resource-tools.ts)
  // and is not spent by a roll it leaves short (after-roll.ts, forced-save.ts).
  "bard::Unfailing Inspiration": {
    subclass: "College of Eloquence",
    heldBy: { file: "src/lib/dm/ar-wbf-bard-dice-logic.ts", call: "unfailingDieKept(" },
  },
  "bard::Creative Crescendo": {
    subclass: "College of Creation",
    narrated: "More items from Performance of Creation, free of their gold limit: crafting the GM narrates, no number in a fight.",
  },
  "bard::Guiding Whispers": {
    subclass: "College of Spirits",
    // The cantrip is the spell table's; its 60 feet for this bard are
    // cast-reach.ts spellReachProblem (ar-wbf-bard-casting-logic.ts).
    heldBy: SPELL_TABLE,
  },
  "bard::Spiritual Focus": {
    subclass: "College of Spirits",
    effects: [
      {
        kind: "spell_rider",
        dice: "1d6",
        classes: ["bard"],
        damageTypes: ALL_DAMAGE,
        healing: true,
        gate: { level: 6 },
        // The focus itself (a candle, a deck, a talking board carried) is
        // cast-materials.ts focusProblem (ar-wbf-bard-casting-logic.ts).
        note: "Cast through the spiritual focus: a candle, a deck or a talking board the bard carries.",
      },
    ],
  },
  // The server's own Spirit Tales table (src/lib/dm/spirit-tales.ts): a
  // bonus action and a Bardic Inspiration die roll the tale, an action plays
  // it on a creature within 30 feet.
  "bard::Tales from Beyond": {
    subclass: "College of Spirits",
    spends: [
      { name: "Tales from Beyond", pool: { id: "bardic_inspiration" }, action: "bonus", does: { kind: "tell_tale" } },
      { name: "Release Tale", aliases: ["Bestow Tale", "Spirit Tale"], action: "action", gate: { condition: "spirit tale", because: "a spirit tale held in mind (Tales from Beyond rolls one)" }, does: { kind: "release_tale" } },
    ],
  },
  "bard::Mystical Connection": {
    subclass: "College of Spirits",
    narrated: "Rolling the Spirit Tales table twice and choosing is the GM's roll on that narrated table.",
  },

  // ---- cleric ----
  "cleric::Potent Spellcasting": {
    subclass: "Knowledge, Light, Grave, Peace and Arcana Domains",
    effects: [{ kind: "spell_rider", dice: "wis", classes: ["cleric"], cantrips: true, note: "One damage roll of a cleric cantrip." }],
  },
  "cleric::Bonus Cantrip (Light)": { subclass: "Light Domain", heldBy: SPELL_TABLE },
  "cleric::Thunderbolt Strike": {
    subclass: "Tempest Domain",
    heldBy: { file: "src/lib/dm/enemy-damage.ts", call: "thunderboltPush(" },
  },
  "cleric::Improved Duplicity": {
    subclass: "Trickery Domain",
    // Invoke Duplicity's count of four (authored-spend-divine-clr.ts duplicity).
    heldBy: { file: "src/lib/dm/authored-spend-divine-clr.ts", call: "\"Improved Duplicity\") ? 4" },
  },
  "cleric::Avatar of Battle": {
    subclass: "War Domain",
    effects: [{ kind: "resist", types: PHYSICAL, nonmagical: true }],
  },
  "cleric::Twilight Shroud": {
    subclass: "Twilight Domain",
    // Half cover for the cleric and allies inside Twilight Sanctuary, on every
    // attack and every save that reads cover.
    heldBy: { file: "src/lib/dm/attack-spatial.ts", call: "twilightShroudCover(" },
  },
  "cleric::Spell Breaker": {
    subclass: "Arcana Domain",
    heldBy: { file: "src/lib/dm/spell-breaker.ts", call: "spellBreaker(" },
  },
  "cleric::Arcane Mastery": {
    subclass: "Arcana Domain",
    // Four wizard spells of 6th to 9th level, picked off the cleric list and
    // held on top of the prepared count (class-spell-grants.ts).
    heldBy: { file: "src/lib/srd/class-spell-grants.ts", call: "clericGrants(" },
  },

  // ---- druid ----
  "druid::Circle Forms": {
    subclass: "Circle of the Moon",
    // Wild Shape's challenge rating ceiling for a Moon druid.
    heldBy: { file: "src/lib/srd/wild-shape-caps.ts", call: "moonDruid ? Math.max(baseCr, moonCr)" },
  },
  "druid::Thousand Forms": {
    subclass: "Circle of the Moon",
    narrated: "Alter self at will, with no slot: the GM casts it for the druid whenever they ask.",
  },
  "druid::Hearth of Moonlight and Shadow": {
    subclass: "Circle of Dreams",
    spends: [
      {
        name: "Hearth of Moonlight and Shadow",
        action: "none",
        fight: "out",
        // "During a short or long rest ... until the rest ends": take_rest
        // takes it off every creature inside (it outlasted the rest before).
        does: { kind: "buff", target: "allies", condition: "hearth of moonlight and shadow", rounds: 4800, rangeFt: 30, count: "12", untilRestEnds: true },
      },
    ],
  },
  "druid::Mighty Summoner": {
    subclass: "Circle of the Shepherd",
    // The natural weapons' magic reads these types too (src/lib/dm/mighty-summoner.ts).
    effects: [{ kind: "summon_hp_per_hd", amount: 2, types: ["beast", "fey"], note: "Their natural weapons count as magical against resistance and immunity to nonmagical attacks." }],
  },
  // "Summoned creatures inside your Spirit Totem aura heal half your druid
  // level at the end of your turns": the turn's end heals them
  // (src/lib/dm/spirit-totem.ts guardianSpiritHeal, from authored-turns.ts).
  "druid::Guardian Spirit": {
    subclass: "Circle of the Shepherd",
    heldBy: { file: "src/lib/dm/authored-turns.ts", call: "guardianSpiritHeal(" },
  },
  // "While Symbiotic Entity is active, a bonus action hurls spores into a
  // 10-foot cube within 30 feet for a minute": a board area at the square
  // named (src/lib/dm/spreading-spores.ts) that strikes as the spell areas do,
  // and Halo of Spores' reaction stays shut while it lasts (its row's gate).
  "druid::Spreading Spores": {
    subclass: "Circle of Spores",
    spends: [
      {
        name: "Spreading Spores",
        action: "bonus",
        gate: { condition: "symbiotic entity", because: "needs Symbiotic Entity running" },
        does: { kind: "spreading_spores", rangeFt: 30, rounds: 10 },
      },
    ],
  },
  "druid::Full of Stars": {
    subclass: "Circle of Stars",
    effects: [{ kind: "resist", types: PHYSICAL, gate: { condition: "starry form" } }],
  },

  // ---- fighter ----
  "fighter::Improved Combat Superiority": {
    subclass: "Battle Master",
    // The superiority die: a d10 at fighter 10, a d12 at 18.
    heldBy: { file: "src/lib/dm/maneuver-rules.ts", call: "export function superiorityDie(" },
  },
  "fighter::Arcane Charge": {
    subclass: "Eldritch Knight",
    // Action Surge credits the 30-foot teleport.
    heldBy: { file: "src/lib/dm/mutations.ts", call: "afterCounterSpend(" },
  },
  "fighter::Improved War Magic": {
    subclass: "Eldritch Knight",
    effects: [{ kind: "bonus_attack", after: "spell" }],
  },
  "fighter::Ferocious Charger": {
    subclass: "Cavalier",
    spends: [
      {
        name: "Ferocious Charger",
        action: "none",
        oncePerTurn: true,
        fight: "in",
        // "when you move at least 10 feet in a straight line right before
        // attacking a creature and hit it": the hit and the run are both on the
        // turn's record (attack-swing.ts WEAPON_HIT, mt-fb-charge.ts).
        afterWeaponHit: true,
        chargeFeet: 10,
        does: {
          kind: "save_effect",
          save: "str",
          dcAbility: "str",
          condition: "prone",
          rangeFt: 5,
        },
      },
    ],
  },
  "fighter::Echo Avatar": {
    subclass: "Echo Knight",
    narrated: "Seeing and hearing through the echo up to 1,000 feet away: scouting the GM narrates.",
  },
  "fighter::Psionic Strike": {
    subclass: "Psi Warrior",
    spends: [
      {
        name: "Psionic Strike",
        pool: { id: "sub_psionic_energy" },
        oncePerTurn: true,
        // "add it ... as force damage to a hit": after a weapon hit this turn.
        afterWeaponHit: true,
        action: "none",
        does: { kind: "die_damage", dice: PSIONIC_INT, type: "force" },
      },
    ],
  },
  // "free once per short rest or by spending a die": the free use first, then
  // a Psionic Energy die. Every use took a die before.
  "fighter::Telekinetic Movement": {
    subclass: "Psi Warrior",
    counter: "sub_telekinetic_movement",
    spends: [
      {
        name: "Telekinetic Movement",
        pool: { id: "sub_telekinetic_movement", fallback: "sub_psionic_energy" },
        action: "action",
        // The move is credited as a feature's is (feature-teleport.ts), for
        // move_token to make: no touch is asked, the mind does it.
        does: { kind: "teleport", feet: 30, touched: true, note: "by the mind alone, no touch needed (a Large or smaller loose object may be moved instead)" },
      },
    ],
  },
  // Each rune's counter holds two uses from 15th level ([15, 2]).
  "fighter::Master of Runes": {
    subclass: "Rune Knight",
    heldBy: { file: "src/lib/srd/authored-resources.json", call: "\"sub_hill_rune\"" },
  },
  "fighter::Rallying Cry": {
    subclass: "Banneret",
    // Second Wind heals up to three allies within 60 feet for the fighter level.
    heldBy: { file: "src/lib/dm/mutations.ts", call: "afterCounterSpend(" },
  },
  "fighter::Bulwark": {
    subclass: "Banneret",
    effects: [{ kind: "indomitable_ally", rangeFt: 60 }],
  },

  // ---- monk ----
  "monk::Sun Shield": {
    subclass: "Way of the Sun Soul",
    effects: [{ kind: "retaliate", formula: (_level, mods) => 5 + (mods.wis ?? 0), type: "radiant", melee: true, note: "The bright light it sheds is the GM's to place." }],
  },
  "monk::Hour of Reaping": {
    subclass: "Way of the Long Death",
    spends: [
      {
        name: "Hour of Reaping",
        action: "action",
        does: {
          kind: "buff",
          condition: "hour of reaping",
          rounds: 1,
          burst: { save: "wis", dcAbility: "wis", rangeFt: 30, condition: "frightened", untilNextTurnEnds: true },
        },
      },
    ],
  },
  "monk::Mastery of Death": {
    subclass: "Way of the Long Death",
    // The damage path holds the monk and spends the ki (src/lib/dm/mastery-of-death.ts).
    narrated: "Spending 1 ki to drop to 1 hit point instead of 0: the engine holds the monk at 1 and spends the ki as the blow lands.",
  },
  "monk::Hand of Healing": {
    subclass: "Way of Mercy",
    spends: [
      {
        name: "Hand of Healing",
        pool: { id: "ki", amount: 1 },
        action: "action",
        does: { kind: "mr", id: "hand_of_healing", aims: "ally", rangeFt: 5 },
      },
      // "Or replace one Flurry of Blows attack with it": a strike of the
      // flurry given up, for no action and no ki.
      {
        name: "Flurry of Healing",
        aliases: ["Hand of Healing (Flurry of Blows)"],
        action: "none",
        fight: "in",
        does: { kind: "mr", id: "flurry_healing", aims: "ally", rangeFt: 5 },
      },
    ],
  },
  "monk::Hand of Harm": {
    subclass: "Way of Mercy",
    spends: [
      {
        name: "Hand of Harm",
        // Free on a Flurry of Blows strike with Flurry of Healing and Harm.
        pool: { id: "ki", amount: 1, free: "flurry_harm" },
        oncePerTurn: true,
        action: "none",
        afterWeaponHit: true,
        does: { kind: "mr", id: "hand_of_harm", aims: "enemy" },
      },
    ],
  },

  // ---- paladin ----
  "paladin::Scornful Rebuke": {
    subclass: "Oath of Conquest",
    effects: [{ kind: "retaliate", formula: (_level, mods) => Math.max(1, mods.cha ?? 0), type: "psychic" }],
  },
  "paladin::Aura of the Sentinel": {
    subclass: "Oath of the Watchers",
    effects: [
      {
        kind: "init_prof",
        rangeFt: [[7, 10], [18, 30]],
        note: "Allies within 10 feet (30 from 18th level) add it too, while the paladin is up; the server adds it to their initiative.",
      },
    ],
  },
  "paladin::Aura of Hate": {
    subclass: "Oathbreaker",
    effects: [
      {
        kind: "damage_ability",
        ability: "cha",
        when: "melee",
        aura: { rangeFt: [[7, 10], [18, 30]], types: ["fiend", "undead"] },
        note: "Fiends and undead within 10 feet (30 from 18th level) add it too, while the paladin is up; the server adds it to their melee weapon blows.",
      },
    ],
  },
  "paladin::Supernatural Resistance": {
    subclass: "Oathbreaker",
    effects: [{ kind: "resist", types: PHYSICAL, nonmagical: true }],
  },

  // ---- ranger ----
  "ranger::Umbral Sight": {
    subclass: "Gloom Stalker",
    effects: [{ kind: "darkvision", feet: 60, orAdd: 30, note: "Unseen by creatures that rely on darkvision in darkness: the board's sight rule keeps to it (src/lib/dm/attack-light.ts)." }],
  },
  // One more attack of the Attack action after a miss, once a turn, and a
  // third creature's attack after two were attacked: the turn budget gives
  // them (src/lib/dm/turn-extra-attacks-logic.ts, read by budgetFor).
  "ranger::Stalker's Flurry": {
    subclass: "Gloom Stalker",
    heldBy: { file: "src/lib/dm/turn-extra-attacks-logic.ts", call: "export function turnExtraAttacks(" },
  },
  "ranger::Distant Strike": {
    subclass: "Horizon Walker",
    heldBy: { file: "src/lib/dm/turn-extra-attacks-logic.ts", call: "export function distantStrikeRefusal(" },
  },
  // Two attacks for one command: pet_attack's second is free once the first
  // is made (src/lib/dm/pet-attack-cost.ts).
  "ranger::Bestial Fury": {
    subclass: "Beast Master",
    heldBy: { file: "src/lib/dm/pet-attack-cost.ts", call: 'holdsFeature(sheet, "Bestial Fury")' },
  },
  // A spell the ranger casts on themselves lands on the companion's record
  // too (cast_buff, src/lib/dm/pet-command.ts shareSpell).
  "ranger::Share Spells": {
    subclass: "Beast Master",
    heldBy: { file: "src/lib/dm/cast-buff.ts", call: "shareSpell(" },
  },
  "ranger::Exceptional Training": {
    subclass: "Beast Master",
    // "On a turn your companion doesn't attack, a bonus action can command
    // it to Dash, Disengage or Help" (src/lib/dm/authored-spend-divine-rng.ts).
    spends: [
      {
        name: "Exceptional Training",
        aliases: ["Command Companion"],
        action: "bonus",
        gate: { pet: "beast_companion" },
        does: {
          kind: "variants",
          options: {
            dash: { does: { kind: "pet_command", options: ["dash"] } },
            disengage: { does: { kind: "pet_command", options: ["disengage"] } },
            help: { does: { kind: "pet_command", options: ["help"] } },
          },
        },
      },
    ],
    effects: [{ kind: "pet_magical", pets: ["beast_companion"] }],
  },
  "ranger::Fey Wanderer Magic": { subclass: "Fey Wanderer", heldBy: SPELL_TABLE },
  "ranger::Swarmkeeper Magic": { subclass: "Swarmkeeper", heldBy: SPELL_TABLE },
  "ranger::Draconic Gift": { subclass: "Drakewarden", heldBy: SPELL_TABLE },
  "ranger::Bond of Fang and Scale": {
    subclass: "Drakewarden",
    // The essence the drake was summoned with, "Bond of Fang and Scale
    // (Fire)": the ranger resists that damage. The drake's size, wings and
    // extra bite die are on its own sheet (pet-tools).
    spends: [{ name: "Drake Essence", aliases: ["Draconic Essence"], does: { kind: "choose", options: ["Acid", "Cold", "Fire", "Lightning", "Poison"] } }],
    effects: [
      { kind: "resist", types: ["acid"], gate: { choice: "Acid" } },
      { kind: "resist", types: ["cold"], gate: { choice: "Cold" } },
      { kind: "resist", types: ["fire"], gate: { choice: "Fire" } },
      { kind: "resist", types: ["lightning"], gate: { choice: "Lightning" } },
      { kind: "resist", types: ["poison"], gate: { choice: "Poison" } },
    ],
  },

  // ---- rogue ----
  "rogue::Infiltration Expertise": { subclass: "Assassin", narrated: "A false identity built over days: roleplay, nothing on a sheet changes." },
  "rogue::Impostor": { subclass: "Assassin", narrated: "Mimicking a studied person: roleplay the GM judges with a Deception check." },
  "rogue::Death Strike": {
    subclass: "Assassin",
    // The save and the doubling are the engine's (src/lib/dm/death-strike.ts).
    narrated: "A hit on a surprised creature: it makes a Constitution save (DC 8 + Dexterity + proficiency) or takes double damage; the engine rolls the save and doubles the blow.",
  },
  "rogue::Mage Hand Legerdemain": {
    subclass: "Arcane Trickster",
    narrated: "An invisible mage hand that picks locks and pockets: Sleight of Hand checks the GM calls for.",
  },
  "rogue::Insightful Manipulator": { subclass: "Mastermind", narrated: "Information the GM gives after a minute of watching." },
  "rogue::Soul of Deceit": { subclass: "Mastermind", narrated: "Thoughts that cannot be read and lies that read as true: the GM keeps to that." },
  // Persuasion against the hostile creature's Insight: on a win it is goaded
  // for a minute (src/lib/dm/goaded.ts reads it at its attacks and its
  // opportunity attacks). A creature that is not hostile is no row of the
  // fight, and its charm is the GM's (the action is a social one there).
  "rogue::Panache": {
    subclass: "Swashbuckler",
    spends: [{ name: "Panache", action: "action", fight: "in", does: { kind: "insight_contest", mine: "persuasion", theirs: "insight", condition: "goaded", rounds: 10, goads: true } }],
  },
  "rogue::Ear for Deceit": {
    subclass: "Inquisitive",
    // "To tell whether a creature is lying": the check's `about` says so (roll-about.ts "lies").
    effects: [{ kind: "check_floor", skills: ["insight"], floor: 8, about: "lies" }],
  },
  // One skill or tool proficiency chosen out of a fight, once after each
  // short or long rest (its counter), kept until the next choice replaces
  // it; the skill check and the tool check read it (borrowed-proficiency.ts).
  "rogue::Whispers of the Dead": {
    subclass: "Phantom",
    spends: [{ name: "Whispers of the Dead", pool: { id: "sub_whispers_of_the_dead" }, action: "none", fight: "out", does: { kind: "buff", condition: WHISPERED_MARK, variants: borrowedVariants(WHISPERED_MARK), rounds: 0, lasting: true } }],
  },
  "rogue::Psychic Whispers": { subclass: "Soulknife", narrated: "Telepathic links for hours: conversation, nothing on a sheet changes." },

  // ---- sorcerer ----
  // The d20 and the wild magic table are the GM's to roll and narrate; the
  // use given back is the engine's, and the GM's call, so no card is dealt.
  "sorcerer::Wild Magic Surge": {
    subclass: "Wild Magic",
    spends: [
      {
        name: "Wild Magic Surge",
        gm: true,
        action: "none",
        gate: { condition: SURGE_CHANCE, because: "gives Tides of Chaos back only right after a sorcerer spell of 1st level or higher, while Tides of Chaos is spent" },
        does: { kind: "restore", pool: "sub_tides_of_chaos", amount: 1, clears: SURGE_CHANCE },
      },
    ],
  },
  "sorcerer::Controlled Chaos": { subclass: "Wild Magic", narrated: "Rolling the wild magic table twice and choosing is the GM's roll on that narrated table." },
  "sorcerer::Spell Bombardment": {
    subclass: "Wild Magic",
    narrated: "One damage die rolled again and added, once a turn: the GM adds it with apply_damage.",
  },
  "sorcerer::Empowered Healing": {
    subclass: "Divine Soul",
    narrated: "Rerolling healing dice for a sorcery point: the GM rolls them again and spends the point with use_resource.",
  },
  "sorcerer::Eyes of the Dark": {
    subclass: "Shadow Magic",
    effects: [{ kind: "darkvision", feet: 120, note: "Darkness for 2 sorcery points, seen through when cast that way, is the cast tools' with the points spent." }],
  },
  "sorcerer::Psionic Spells": { subclass: "Aberrant Mind", heldBy: SPELL_TABLE },
  "sorcerer::Psionic Sorcery": {
    subclass: "Aberrant Mind",
    narrated: "A psionic spell cast with sorcery points instead of a slot: the cast tools with the points spent by use_resource.",
  },
  "sorcerer::Revelation in Flesh": {
    subclass: "Aberrant Mind",
    spends: [
      {
        name: "Revelation in Flesh",
        pool: { id: "sorcery_points", perUnit: true, max: 4 },
        action: "bonus",
        does: {
          kind: "buff",
          condition: "revelation in flesh (fly)",
          variants: {
            fly: "revelation in flesh (fly)",
            swim: "revelation in flesh (swim)",
            see: "revelation in flesh (see)",
            squeeze: "revelation in flesh (squeeze)",
          },
          rounds: 100,
        },
      },
    ],
    effects: [
      { kind: "move", fly: "walk", gate: { condition: "revelation in flesh (fly)" } },
      { kind: "move", swim: "double_walk", gate: { condition: "revelation in flesh (swim)" }, note: "The sorcerer breathes water; one benefit per point spent." },
    ],
  },
  "sorcerer::Clockwork Magic": { subclass: "Clockwork Soul", heldBy: SPELL_TABLE },
  "sorcerer::Bastion of Law": {
    subclass: "Clockwork Soul",
    narrated: "A ward of d8s that soaks damage: the GM rolls the dice spent off the damage, the sorcery points spent with use_resource.",
  },

  // ---- warlock ----
  "warlock::Awakened Mind": { subclass: "The Great Old One", narrated: "Telepathic speech: conversation, nothing on a sheet changes." },
  "warlock::Thought Shield": {
    subclass: "The Great Old One",
    effects: [{ kind: "resist", types: ["psychic"], note: "Psychic damage a creature deals the warlock is dealt back to it, the amount the warlock took (thought-shield.ts)." }],
  },
  "warlock::Create Thrall": { subclass: "The Great Old One", narrated: "A charmed thrall in telepathic contact: set_condition charmed, held until a remove curse." },
  "warlock::Bonus Cantrips (Celestial)": { subclass: "The Celestial", heldBy: SPELL_TABLE },
  // Once a turn: one more damage die in Form of Dread, and the hit's damage
  // necrotic when pc_attack is asked for it (damageType "necrotic").
  "warlock::Grave Touched": {
    subclass: "The Undead",
    heldBy: { file: "src/lib/dm/ar-wbf-warlock-grave-logic.ts", call: "export function graveTouchedDie(" },
  },
  "warlock::Undying Nature": { subclass: "The Undying", narrated: "Needs no food, water, breath or sleep, and ages slowly: roleplay, nothing in a fight changes." },

  // ---- wizard ----
  "wizard::Abjuration Savant": { subclass: "School of Abjuration", narrated: "Copying abjuration spells costs half the time and gold: downtime the GM charges." },
  "wizard::Improved Abjuration": {
    subclass: "School of Abjuration",
    narrated: "The proficiency bonus on the ability check of an abjuration spell (counterspell, dispel magic): the GM adds it to that check.",
  },
  "wizard::Conjuration Savant": { subclass: "School of Conjuration", narrated: "Copying conjuration spells costs half the time and gold: downtime the GM charges." },
  "wizard::Minor Conjuration": { subclass: "School of Conjuration", narrated: "Conjuring a small nonmagical object for an hour: an item the GM adds and removes." },
  "wizard::Focused Conjuration": {
    subclass: "School of Conjuration",
    effects: [{ kind: "concentration_guard", school: "conjuration", tempHp: "0" }],
  },
  "wizard::Divination Savant": { subclass: "School of Divination", narrated: "Copying divination spells costs half the time and gold: downtime the GM charges." },
  "wizard::Expert Divination": {
    subclass: "School of Divination",
    effects: [{ kind: "slot_refund", school: "divination", minLevel: 2, maxLevel: 5 }],
  },
  "wizard::Enchantment Savant": { subclass: "School of Enchantment", narrated: "Copying enchantment spells costs half the time and gold: downtime the GM charges." },
  "wizard::Split Enchantment": {
    subclass: "School of Enchantment",
    effects: [{ kind: "twin_spell", school: "enchantment", minLevel: 1, maxLevel: 9 }],
  },
  "wizard::Alter Memories": { subclass: "School of Enchantment", narrated: "Making a charmed creature forget: the GM rolls its save and narrates what it loses." },
  "wizard::Illusion Savant": { subclass: "School of Illusion", narrated: "Copying illusion spells costs half the time and gold: downtime the GM charges." },
  "wizard::Improved Minor Illusion": {
    subclass: "School of Illusion",
    heldBy: SPELL_TABLE,
    narrated: "Sound and an image with the same casting is the GM's to allow.",
  },
  "wizard::Malleable Illusions": { subclass: "School of Illusion", narrated: "Reshaping a lasting illusion with an action: the GM narrates the change." },
  "wizard::Necromancy Savant": { subclass: "School of Necromancy", narrated: "Copying necromancy spells costs half the time and gold: downtime the GM charges." },
  "wizard::Grim Harvest": {
    subclass: "School of Necromancy",
    effects: [{ kind: "grim_harvest" }],
  },
  "wizard::Undead Thralls": {
    subclass: "School of Necromancy",
    narrated: "Animate dead raises one more corpse, and the undead gain the wizard level in hit points and the proficiency bonus on weapon damage: the GM writes those onto their stat blocks.",
  },
  "wizard::Command Undead": {
    subclass: "School of Necromancy",
    spends: [
      {
        name: "Command Undead",
        action: "action",
        does: {
          kind: "save_effect",
          save: "cha",
          dcAbility: "spell",
          condition: "charmed",
          rangeFt: 60,
          sight: true,
          types: ["undead"],
          advantageAt: { ability: "int", atLeast: 8 },
          commands: true,
          onFail: "obeys the wizard until they use this again (one of Intelligence 12 or more saves again at the end of every hour, which the GM rolls when an hour passes)",
        },
      },
    ],
  },
  "wizard::Transmutation Savant": { subclass: "School of Transmutation", narrated: "Copying transmutation spells costs half the time and gold: downtime the GM charges." },
  "wizard::Minor Alchemy": { subclass: "School of Transmutation", narrated: "Changing a material for an hour: crafting the GM narrates." },
  "wizard::Master Transmuter": {
    subclass: "School of Transmutation",
    narrated: "Spending the Transmuter's Stone on a major transformation, a cure, youth or a raising: the GM resolves the one chosen.",
  },
  "wizard::Tactical Wit": { subclass: "War Magic", effects: [{ kind: "init_ability", ability: "int" }] },
  "wizard::Deflecting Shroud": {
    subclass: "War Magic",
    narrated: "When Arcane Deflection is used, up to three creatures within 60 feet take half the wizard level in force: the GM applies it with apply_damage.",
  },
  "wizard::Song of Victory": {
    subclass: "Bladesinging",
    effects: [{ kind: "damage_ability", ability: "int", when: "melee", requiresCondition: "bladesong" }],
  },
  "wizard::Temporal Awareness": { subclass: "Chronurgy Magic", effects: [{ kind: "init_ability", ability: "int" }] },
  "wizard::Gravity Well": {
    subclass: "Graviturgy Magic",
    narrated: "Moving a creature a spell affected 5 feet: a move_token (forced) the GM makes.",
  },
  "wizard::Awakened Spellbook": {
    subclass: "Order of Scribes",
    narrated: "Swapping a spell's damage type to one in the book, and casting a ritual at its normal time once a day: the GM applies both when the wizard asks.",
  },

  // ---- artificer ----
  "artificer::Alchemical Savant": {
    subclass: "Alchemist",
    effects: [
      {
        kind: "spell_rider",
        dice: (_level: number, mods: Record<string, number>) => Math.max(1, mods.int ?? 0),
        classes: ["artificer"],
        damageTypes: ["acid", "fire", "necrotic", "poison"],
        healing: true,
        // "When you cast a spell with alchemist's supplies as your
        // spellcasting focus": none carried, nothing is added (the bonus
        // landed on Fire Bolt and Cure Wounds with no supplies at all).
        itemNames: ["alchemist's supplies"],
        note: "One roll of a spell cast through alchemist's supplies.",
      },
    ],
  },
  "artificer::Arcane Armor": { subclass: "Armorer", narrated: "Armor that needs no Strength, stays on and replaces limbs: nothing in a fight changes." },
  "artificer::Armor Modifications": { subclass: "Armorer", narrated: "The armor's parts take infusions as separate items: picks of the Infuse Item list (options.json)." },
  "artificer::Fortified Position": {
    subclass: "Artillerist",
    narrated: "Two cannons at once, and half cover within 10 feet of one: +2 AC the GM adds with set_effect while it holds.",
  },
  "artificer::Battle Ready": {
    subclass: "Battle Smith",
    effects: [{ kind: "weapon_ability", ability: "int", magicOnly: true }],
  },
};
