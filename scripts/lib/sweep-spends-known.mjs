// What the "spends" sweep finds today (scripts/lib/sweep-spends-run.mjs), by
// row. A code listed here runs through gap(): the suite stays green while it
// is seen and fails the day it is not, so a fix moves its line out. A code
// seen with no line here fails the suite.
//
//   KNOWN[rowId][CODE] = { severity, note }
//   RULINGS[rowId][CODE] = where the ruling is written
//   SKIP[rowId] = why the row is not walked
export const KNOWN = {
  "spend:genre::ghost protocol::Ghost Protocol": { UNREACHED: { severity: "low", note: "the sweep stages no drone; Ghost Protocol hides the rigger's drone: the clause probe drone_ghost (scripts/lib/sweep-clauses-genre-a-cyberpunk.mjs) builds one and plays it" } },
  "spend:genre::grease the wheels::Grease the Wheels": { UNREACHED: { severity: "low", note: "the sweep stages no failed Charisma check, which Grease the Wheels rolls again: the clause probe grease (scripts/lib/sweep-clauses-genre-a-cyberpunk.mjs) plays it" } },
  "spend:genre::synaptic overload::Synaptic Overload": { UNREACHED: { severity: "low", note: "the sweep stages no spell attack hit, which Synaptic Overload answers: the clause probe synaptic plays it after a Fire Bolt hits" } },
  "spend:genre::purging flame::Purging Flame": { UNREACHED: { severity: "low", note: "the sweep stages no Hunter's Brand, and the spend rides one (refused with nothing spent while none is held): scripts/test-genre-a-dark-fantasy.mjs plays it on a branded creature" } },
  "spend:genre::judgment shot::Judgment Shot": { UNREACHED: { severity: "low", note: "the sweep stages no Hunter's Brand, and the spend rides one (refused with nothing spent while none is held): scripts/test-genre-a-dark-fantasy.mjs plays it on a branded creature" } },
  "spend:genre::song that ends::Song That Ends": { UNREACHED: { severity: "low", note: "the sweep stages foes of 300 hit points, and Song That Ends takes a creature below 50 (refused with nothing spent): scripts/test-genre-a-dark-fantasy.mjs plays it on one of 40" } },
  "reaction:genre::blood bond::Blood Bond": { UNREACHED: { severity: "low", note: "Blood Bond answers damage to the holder's own beast, and the sweep stages no beast (refused with nothing spent): the post-apocalyptic suites play it on a packmaster's bonded beast" } },
  "counter:cyberpunk_bullet_time": { UNREACHED: { severity: "low", note: "the sweep stages melee hits only, and Bullet Time answers a ranged attack: scripts/test-genre-a-spends.mjs and the clause probe reaction_cost play it after a shortbow" } },
  "counter:mystery_silver_tongue": { UNREACHED: { severity: "low", note: "the sweep stages no failed Deception or Persuasion check, which Silver Tongue rolls again (refused with nothing spent otherwise): scripts/test-genre-b-mystery-features.mjs plays it after a failed Persuasion check" } },
  "counter:cyberpunk_grease_the_wheels": { UNREACHED: { severity: "low", note: "the sweep stages no failed Charisma check, which Grease the Wheels rolls again: the clause probe grease (scripts/lib/sweep-clauses-genre-a-cyberpunk.mjs) plays it" } },
  "counter:dark_fantasy_candle_in_the_dark": { GUIDANCE_ONLY: { severity: "medium", note: "the use is spent and what the text states is left to the GM to apply by hand" } },
  "counter:dark_fantasy_flashfire_litany": { UNREACHED: { severity: "low", note: "the sweep stages a goblin's hits, and Flashfire Litany answers a fiend's or an undead's (refused with nothing spent otherwise): scripts/test-genre-a-dark-fantasy.mjs plays it after an undead's club" } },
  "counter:dark_fantasy_judgment_shot": { UNREACHED: { severity: "low", note: "the sweep stages no Hunter's Brand, and the spend rides one (refused with nothing spent while none is held): scripts/test-genre-a-dark-fantasy.mjs plays it on a branded creature" } },
  "counter:dark_fantasy_purging_flame": { UNREACHED: { severity: "low", note: "the sweep stages no Hunter's Brand, and the spend rides one (refused with nothing spent while none is held): scripts/test-genre-a-dark-fantasy.mjs plays it on a branded creature" } },
  "counter:dark_fantasy_song_that_ends": { UNREACHED: { severity: "low", note: "the sweep stages foes of 300 hit points, and Song That Ends takes a creature below 50 (refused with nothing spent): scripts/test-genre-a-dark-fantasy.mjs plays it on one of 40" } },
  "counter:dark_fantasy_the_rite_completed": { GUIDANCE_ONLY: { severity: "medium", note: "the use is spent and what the text states is left to the GM to apply by hand" } },
  "counter:dark_fantasy_vanish_below": { TRIGGER_UNCHECKED: { severity: "medium", note: "accepted with no trigger staged" }, TRIGGER_AS_CARD: { severity: "medium", note: "dealt as a card on the holder's own turn and accepted with nothing to react to" } },
  "counter:horror_grounding_rig": { GUIDANCE_ONLY: { severity: "medium", note: "the use is spent and what the text states is left to the GM to apply by hand" } },
  "counter:horror_peer_review": { GUIDANCE_ONLY: { severity: "medium", note: "the use is spent and what the text states is left to the GM to apply by hand" }, TRIGGER_AS_CARD: { severity: "medium", note: "dealt as a card on the holder's own turn and accepted with nothing to react to" } },
  "counter:horror_proof": { GUIDANCE_ONLY: { severity: "medium", note: "the use is spent and what the text states is left to the GM to apply by hand" } },
  "counter:horror_rite_of_severance": { GUIDANCE_ONLY: { severity: "medium", note: "the use is spent and what the text states is left to the GM to apply by hand" } },
  "counter:horror_the_final_chapter": { GUIDANCE_ONLY: { severity: "medium", note: "the use is spent and what the text states is left to the GM to apply by hand" } },
  "counter:post_apocalyptic_road_rage": { GUIDANCE_ONLY: { severity: "medium", note: "the use is spent and what the text states is left to the GM to apply by hand" }, TRIGGER_AS_CARD: { severity: "medium", note: "dealt as a card on the holder's own turn and accepted with nothing to react to" } },
  "counter:post_apocalyptic_witnessed": { SPENT_FOR_NOTHING: { severity: "low", note: "another path carries the effect; a plain spend takes the use without it" }, TRIGGER_AS_CARD: { severity: "medium", note: "dealt as a card on the holder's own turn and accepted with nothing to react to" } },
  "counter:steampunk_boarding_action": { GUIDANCE_ONLY: { severity: "medium", note: "the use is spent and what the text states is left to the GM to apply by hand" }, TRIGGER_AS_CARD: { severity: "medium", note: "dealt as a card on the holder's own turn and accepted with nothing to react to" } },
  "counter:cyberpunk_ghost_protocol": { UNREACHED: { severity: "low", note: "the sweep stages no drone; Ghost Protocol hides the rigger's drone: the clause probe drone_ghost (scripts/lib/sweep-clauses-genre-a-cyberpunk.mjs) builds one and plays it" } },
  "counter:cyberpunk_synaptic_overload": { UNREACHED: { severity: "low", note: "the sweep stages no spell attack hit, which Synaptic Overload answers: the clause probe synaptic plays it after a Fire Bolt hits" } },
  "reaction:genre::bullet time::Bullet Time": { UNREACHED: { severity: "low", note: "the sweep stages melee hits only, and Bullet Time answers a ranged attack: scripts/test-genre-a-spends.mjs and the clause probe reaction_cost play it after a shortbow" } },
  "reaction:genre::ice pick::ICE Pick": { UNREACHED: { severity: "low", note: "the sweep stages weapon and ability hits only, and ICE Pick answers a spell's attack: the clause probe ice (scripts/lib/sweep-clauses-genre-a-cyberpunk.mjs) plays it after a foe's Fire Bolt, and refuses a club" } },
  "counter:cyberpunk_daemon_cache": { GUIDANCE_ONLY: { severity: "medium", note: "the counter is held (1/long rest); the cached program's cast without a slot is not wired to the cast guard: no pick names the program (w2-genre-a handoff)" } },
  "reaction:genre::flashfire litany::Flashfire Litany": { UNREACHED: { severity: "low", note: "the sweep stages a goblin's hits, and Flashfire Litany answers a fiend's or an undead's (refused with nothing spent otherwise): scripts/test-genre-a-dark-fantasy.mjs plays it after an undead's club" } },
};

export const RULINGS = {
  "spend:genre::mortified flesh::Mortified Flesh": { TRIGGER_AS_CARD: "src/lib/dm/genre-a-dark-fantasy-spends.ts mortify: \"When you attack, you may pay HP up to your proficiency bonus; add the same amount to the damage\": paid on the penitent's own turn, and the next attack carries it, so its card is rightly open there" },
  "counter:sub_cosmic_omen": { UNREACHED: "Cosmic Omen: the maintainer's ruling on issue #908 and the coordinator's answer of 2026-11-11: it is used before the roll, at the holder's own hold (pending-rolls/[id]/before-roll) and the watch stop (src/lib/dm/foresight-before.ts), so use_resource refuses it with nothing spent (src/lib/dm/reaction-counters.ts planCounterReaction): a roll already on record gets none" },
  "counter:sub_restore_balance": { UNREACHED: "Restore Balance: the maintainer's ruling on issue #908 and the coordinator's answer of 2026-11-11: it is used before the roll, at the holder's own hold (pending-rolls/[id]/before-roll) and the watch stop (src/lib/dm/foresight-before.ts), so use_resource refuses it with nothing spent (src/lib/dm/reaction-counters.ts planCounterReaction): a roll already on record gets none" },
  "spend:ranger::Hunter's Sense::Hunter's Sense": { REPORTED_ONLY: "src/lib/dm/authored-spend-divine.ts revealDefenses: gap study WAVE2 D3, Hunter's Sense answers with the creature's stat block defences and spends the use; what it gives is knowledge, so nothing on the table is written" },
  "counter:sub_hunters_sense": { REPORTED_ONLY: "src/lib/dm/authored-spend-divine.ts revealDefenses: gap study WAVE2 D3, Hunter's Sense answers with the creature's stat block defences and spends the use; what it gives is knowledge, so nothing on the table is written" },
  "counter:cyberpunk_jury_rig": { GUIDANCE_ONLY: "scripts/test-feature-coverage.mjs NARRATIVE_WITH_DICE: \"Narrative counters whose dice ride a FOLLOW-UP tool the model must call ... or whose payload has no engine shape yet. Deliberate, not forgotten.\"" },
  "counter:post_apocalyptic_last_ride_of_the_reaver": { GUIDANCE_ONLY: "scripts/test-feature-coverage.mjs NARRATIVE_WITH_DICE: \"Narrative counters whose dice ride a FOLLOW-UP tool the model must call ... or whose payload has no engine shape yet. Deliberate, not forgotten.\"" },
  "counter:steampunk_the_great_work_walks": { GUIDANCE_ONLY: "scripts/test-feature-coverage.mjs NARRATIVE_WITH_DICE: \"Narrative counters whose dice ride a FOLLOW-UP tool the model must call ... or whose payload has no engine shape yet. Deliberate, not forgotten.\"" },
  "counter:sub_breath_of_the_dragon": { TRIGGER_AS_CARD: "/tmp/odm-gapstudy/MT-SPLIT.md, the maintainer's ruling on \"When you take the Attack action you can replace one attack with a 20-foot cone or a 30-foot line\": the breath replaces one attack of the Attack action and may be its first, so spending it starts the Attack action if it has not begun. It is an attack cost (src/lib/dm/resource-turn.ts replacesAttack), not a trigger, and its card is rightly open on the holder's own turn" },
};

const INTO = "pours into another counter (ResourceDef.into): no sheet holds a counter under this id, and its uses are walked as that counter's";
const BY_REST = "spent by take_rest as a short rest ends (use_resource refuses it, with nothing spent: seen)";
const BY_ATTACK = "spent by the bonus-action attack it buys (pc_attack with its feature; use_resource refuses it, with nothing spent: seen), which the dice package walks";
const BY_CAST = "needs a spell cast earlier in the same turn (the cast's own mark); refused with nothing spent without one (seen), and no staging here casts";
export const SKIP = {
  "counter:ki_inner_resilience": INTO,
  "counter:sorcery_points_metamagic_adept": INTO,
  "counter:superiority_dice_martial_adept": INTO,
  "counter:natural_recovery": BY_REST,
  "counter:arcane_recovery": BY_REST,
  "counter:sub_war_priest": BY_ATTACK,
  "counter:race_hungry_jaws": BY_ATTACK,
  "counter:sub_unwavering_mark": BY_ATTACK,
  "counter:elemental_affinity": BY_CAST,
  "counter:cyberpunk_surge_momentum": BY_CAST,
  "counter:horror_the_rite_remembers": BY_CAST,
  "counter:post_apocalyptic_surge_of_change": BY_CAST,
  "counter:steampunk_surge_casting": BY_CAST,
  "counter:inspiration": "awarded by the GM and spent by the roll it gives advantage to (useInspiration); no feature grants it, so no holder can be built from the tables",
  "counter:one_with_shadows": "held through an invocation pick (\"Invocation: One with Shadows\"), and no holder here carries invocation picks",
  "reaction:cleric::Protective Bond::Protective Bond": "needs Emboldening Bond laid on the reactor and the creature hit, which no staging lays (refused with nothing spent on every staged trigger: seen)",
  "reaction:paladin::Relentless Avenger::Relentless Avenger": "answers the holder's own opportunity attack hitting, and move_token resolves an opportunity attack itself, so no staging leaves one open (refused with nothing spent: seen)",
  "reaction:ranger::Perfected Bond::Reflexive Resistance": "needs the drake summoned and out (summon_pet), which no staging does (refused with nothing spent: seen); its counter's own row is walked",
  "reaction:rogue::Misdirection::Misdirection": "needs a creature standing between the attacker and the holder to give cover, which the staged line-up does not have (refused with nothing spent: seen)",
  "reaction:wizard::Projected Ward::Projected Ward": "needs the Arcane Ward raised by an abjuration spell cast first, which no staging casts (refused with nothing spent: seen)",
};
