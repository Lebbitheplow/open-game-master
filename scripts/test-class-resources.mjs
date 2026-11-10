// SRD class-resource tables: per-level maxima, feature matching, spend
// preservation, and rest refills.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  RESOURCE_DEFS,
  matchResource,
  populateResources,
  rageDamageBonus,
  resourceDef,
  spendRelentlessEndurance,
} = await import("../src/lib/srd/class-resources.ts");
const { refillResources } = await import("../src/lib/srd/resource-refills.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const mods = { str: 1, dex: 2, con: 2, int: 0, wis: 1, cha: 3 };

test("rage uses scale with level", () => {
  const def = resourceDef("rage");
  assert.equal(def.maxFor(1, mods), 2);
  assert.equal(def.maxFor(3, mods), 3);
  assert.equal(def.maxFor(6, mods), 4);
  assert.equal(def.maxFor(12, mods), 5);
  assert.equal(def.maxFor(17, mods), 6);
});

test("ki equals level; action surge doubles at 17; channel divinity steps", () => {
  assert.equal(resourceDef("ki").maxFor(7, mods), 7);
  assert.equal(resourceDef("action_surge").maxFor(16, mods), 1);
  assert.equal(resourceDef("action_surge").maxFor(17, mods), 2);
  assert.equal(resourceDef("channel_divinity").maxFor(2, mods), 1);
  assert.equal(resourceDef("channel_divinity").maxFor(6, mods), 2);
  assert.equal(resourceDef("channel_divinity").maxFor(18, mods), 3);
});

test("bardic inspiration = CHA mod (min 1); lay on hands = 5x level", () => {
  assert.equal(resourceDef("bardic_inspiration").maxFor(4, mods), 3);
  assert.equal(resourceDef("bardic_inspiration").maxFor(4, { cha: -1 }), 1);
  assert.equal(resourceDef("lay_on_hands").maxFor(6, mods), 30);
});

test("populateResources grants only matching features", () => {
  const out = populateResources(
    [{ name: "Rage" }, { name: "Unarmored Defense" }, { name: "Reckless Attack" }],
    3,
    mods,
    undefined,
  );
  assert.deepEqual(Object.keys(out), ["rage"]);
  assert.deepEqual(out.rage, { max: 3, used: 0 });
});

test("populateResources preserves spent uses across level-ups, clamped", () => {
  const existing = { rage: { max: 3, used: 3 } };
  const up = populateResources([{ name: "Rage" }], 6, mods, existing);
  assert.deepEqual(up.rage, { max: 4, used: 3 });
  const down = populateResources([{ name: "Rage" }], 1, mods, existing);
  assert.deepEqual(down.rage, { max: 2, used: 2 });
});

test("populateResources drops resources whose feature is gone", () => {
  const out = populateResources([{ name: "Second Wind" }], 5, mods, {
    rage: { max: 3, used: 1 },
  });
  assert.deepEqual(Object.keys(out), ["second_wind"]);
});

test("matchResource is fuzzy", () => {
  assert.equal(matchResource("Rage").id, "rage");
  assert.equal(matchResource("ki points").id, "ki");
  assert.equal(matchResource("Ki").id, "ki");
  assert.equal(matchResource("sorcery_points").id, "sorcery_points");
  assert.equal(matchResource("Channel Divinity").id, "channel_divinity");
  assert.equal(matchResource("nonsense"), null);
});

test("refillResources: long refills all, short only short-recharge", () => {
  const spent = {
    rage: { max: 3, used: 2 },
    second_wind: { max: 1, used: 1 },
  };
  const short = refillResources(spent, "short");
  assert.equal(short.rage.used, 2);
  assert.equal(short.second_wind.used, 0);
  const long = refillResources(spent, "long");
  assert.equal(long.rage.used, 0);
  assert.equal(long.second_wind.used, 0);
});

test("every def has match terms and positive max at level 5", () => {
  for (const def of RESOURCE_DEFS) {
    assert.ok(def.match.length > 0, def.id);
    assert.ok(def.maxFor(5, mods) >= 1, def.id);
  }
});

test("word-boundary matching: racial traits never grant class pools", () => {
  // Half-elf fighter regression: "Skill Versatility" contains "ki" as a
  // substring and once granted monk Ki.
  const halfElfFighter = populateResources(
    [{ name: "Second Wind" }, { name: "Skill Versatility" }, { name: "Darkvision" }],
    5,
    mods,
    undefined,
  );
  assert.equal(halfElfFighter.ki, undefined);
  assert.ok(halfElfFighter.second_wind);
  // Real monk Ki still matches.
  assert.ok(populateResources([{ name: "Ki" }], 5, mods, undefined).ki);
});

test("exact matching: Road Rage is not barbarian Rage", () => {
  const roadWarrior = populateResources([{ name: "Road Rage" }], 14, mods, undefined);
  assert.equal(roadWarrior.rage, undefined);
  assert.ok(populateResources([{ name: "Rage" }], 3, mods, undefined).rage);
});

test("paladin Channel Divinity feature grants the pool", () => {
  const paladin = populateResources([{ name: "Channel Divinity" }], 3, mods, undefined);
  assert.ok(paladin.channel_divinity);
});

test("every def carries an effect and guidance the model can read", () => {
  for (const def of RESOURCE_DEFS) {
    assert.ok(def.effect?.kind, def.id);
    assert.ok(def.guidance && def.guidance.length > 20, def.id);
  }
});

test("Second Wind heals 1d10 + fighter level", () => {
  const effect = resourceDef("second_wind").effect;
  assert.equal(effect.kind, "heal_self");
  assert.equal(effect.dice(1, mods), "1d10+1");
  assert.equal(effect.dice(11, mods), "1d10+11");
});

test("Lay on Hands heals straight from its pool", () => {
  assert.equal(resourceDef("lay_on_hands").effect.kind, "heal_pool");
});

test("Rage applies the raging condition for 10 rounds", () => {
  const effect = resourceDef("rage").effect;
  assert.equal(effect.kind, "condition");
  assert.equal(effect.condition, "raging");
  assert.equal(effect.rounds, 10);
});

test("rage damage bonus steps at 9 and 16", () => {
  assert.equal(rageDamageBonus(1), 2);
  assert.equal(rageDamageBonus(8), 2);
  assert.equal(rageDamageBonus(9), 3);
  assert.equal(rageDamageBonus(15), 3);
  assert.equal(rageDamageBonus(16), 4);
});

test("Bardic Inspiration die grows with bard level", () => {
  const die = resourceDef("bardic_inspiration").effect.die;
  assert.equal(die(1), "d6");
  assert.equal(die(5), "d8");
  assert.equal(die(10), "d10");
  assert.equal(die(15), "d12");
});

test("Breath Weapon routes to the AoE engine with growing dice", () => {
  const effect = resourceDef("breath_weapon").effect;
  assert.equal(effect.kind, "aoe");
  assert.equal(effect.dice(1), "2d6");
  assert.equal(effect.dice(6), "3d6");
  assert.equal(effect.dice(16), "5d6");
});

// Passive: never spent with use_resource. Relentless Endurance and
// Relentless Rage are burned by the damage path; Inspiration is spent by the
// roll it gives advantage to (useInspiration).
test("the passive defs are the ones something else spends", () => {
  const passive = RESOURCE_DEFS.filter((def) => def.passive).map((def) => def.id);
  // Signature Spells and Overchannel are spent by the cast itself
  // (src/lib/dm/caster-features.ts). The Arcane Ward's pool and its
  // raised-today mark are kept by the abjuration cast and the damage path.
  // Psionic Recovery is spent by its authored spend, which returns a die.
  // Shadow Martyr is spent by its reaction, when an ally's hit offers it.
  // Runic Shield is spent by its reaction, when a hit on an ally offers it.
  // Glorious Defense is spent by its reaction, when a hit offers it.
  // Undying Sentinel is burned by the damage path, as Relentless Endurance is.
  // Warding Flare, Wrath of the Storm, Entropic Ward and Illusory Self are spent by
  // their reactions, when a hit offers them.
  // Sentinel at Death's Door is spent by its reaction, when a critical offers it.
  // Searing Vengeance is spent in place of a death save (searing-vengeance.ts).
  // Faithful Summons is spent by the incapacity watch as the druid falls (faithful-summons.ts).
  // WAVE1 R10: a pool spent only through another tool refuses a bare spend
  // (sorcery points, Lucky's points, Hurl Through Hell, Psionic Energy, the
  // drake, the after-roll counters), and a counter whose use is a spell is
  // spent by the cast (src/lib/srd/counter-casts.ts, Mystic Arcanum).
  assert.deepEqual(passive, ["sorcery_points", "luck_points", "relentless_endurance", "stroke_of_luck", "inspiration", "relentless_rage", "signature_spell_1", "signature_spell_2", "overchannel", "hurl_through_hell", "mystic_arcanum_6", "mystic_arcanum_7", "mystic_arcanum_8", "mystic_arcanum_9", "sub_psionic_energy", "sub_psionic_recovery", "sub_runic_shield", "sub_shadow_martyr", "sub_warding_flare", "sub_wrath_of_the_storm", "sub_sentinel_at_deaths_door", "sub_faithful_summons", "sub_star_map", "sub_blazing_revival", "sub_walker_in_dreams", "sub_consult_the_spirits", "sub_entropic_ward", "sub_searing_vengeance", "sub_grasping_tentacles", "sub_favored_by_the_gods", "sub_strength_of_the_grave", "sub_lunar_free_cast", "sub_waxing_and_waning", "sub_portent", "sub_illusory_self", "sub_shapechanger", "sub_fey_reinforcements", "sub_drake_companion", "sub_master_duelist", "sub_glorious_defense", "sub_undying_sentinel", "art_restorative_reagents", "sub_telekinetic_master", "sub_arcane_ward", "sub_arcane_ward_raised"]);
});

test("Relentless Endurance spends once, then refuses", () => {
  const first = spendRelentlessEndurance({ relentless_endurance: { max: 1, used: 0 } });
  assert.deepEqual(first.relentless_endurance, { max: 1, used: 1 });
  assert.equal(spendRelentlessEndurance(first), null);
  // Absent feature: nothing to burn.
  assert.equal(spendRelentlessEndurance({ rage: { max: 3, used: 0 } }), null);
  assert.equal(spendRelentlessEndurance(undefined), null);
});

const { fontOfMagicDirection } = await import("../src/lib/dm/resource-tools.ts");

test("Font of Magic's two conversions are fixed variants; anything else is a Metamagic spend", () => {
  assert.equal(fontOfMagicDirection("create slot"), "create_slot");
  assert.equal(fontOfMagicDirection("Convert Slot"), "recover_points");
  // Words are not read for a direction, in English or any table language.
  for (const variant of ["create a 2nd-level slot", "convert my 3rd-level slot into points", "crea uno slot", "convertir un emplacement", "quickened spell", undefined]) {
    assert.equal(fontOfMagicDirection(variant), null, String(variant));
  }
});

// What a use costs of the turn (ResourceDef.action), charged by use_resource
// (src/lib/dm/resource-turn.ts). A feature whose text names a cost carries
// it, or is listed here with the reason the turn is someone else's to charge.
// The costs are the books' (2014 rules), the genre classes' their catalogs'.
const NAMES_A_COST = /\b(?:bonus[- ]action|reaction|an action|action:)/i;
const CHARGED_ELSEWHERE = {
  ki: "each use (Flurry, Patient Defense, Step of the Wind) costs its own",
  channel_divinity: "each option costs its own",
  sub_superiority_dice: "each maneuver costs its own",
  cyberpunk_surge_momentum: "the cantrip's cast is the cost",
  horror_the_rite_remembers: "the cantrip's cast is the cost",
  post_apocalyptic_surge_of_change: "the cantrip's cast is the cost",
  steampunk_surge_casting: "the cantrip's cast is the cost",
  dark_fantasy_the_crown_descends: "the reactions named are the enemies'",
  steampunk_arc_coil: "the reactions named are the target's",
  horror_last_one_out: "the reactions named are the allies'",
  mystery_general_strike: "the reactions named are the party's attacks",
  horror_adrenaline_surge: "take_action's bonus route charges the bonus action and spends the use",
  mystery_vanish: "take_action's bonus route charges the bonus action and spends the use",
  // The bonus attack is pc_attack's to charge, and it spends the use
  // (src/lib/dm/feature-bonus-attacks.ts).
  sub_war_priest: "the bonus attack, not the use, costs the bonus action",
  race_hungry_jaws: "the bonus attack, not the use, costs the bonus action",
  sub_unwavering_mark: "the bonus attack, not the use, costs the bonus action",
  sub_embodiment_of_the_law: "the enchantment spell's cast is the cost (the use marks it for the bonus action)",
};

// Sorcery points, Lucky's points, Psionic Energy, Telekinetic Master and
// Waxing and Waning left the list above as passive: a pool spent only through
// another call refuses a bare spend (WAVE1 R10), and a counter whose use is a
// spell is spent by the cast (src/lib/srd/counter-casts.ts).
test("every feature whose text names a cost carries it", () => {
  const uncosted = RESOURCE_DEFS.filter((def) => !def.action && !def.passive && NAMES_A_COST.test(def.guidance)).map((def) => def.id);
  assert.deepEqual(uncosted.sort(), Object.keys(CHARGED_ELSEWHERE).sort());
  for (const def of RESOURCE_DEFS) {
    assert.ok([undefined, "action", "bonus", "reaction", "none"].includes(def.action), def.id);
  }
});

test("a cost matches the text that names it", () => {
  const leads = [
    [/^A bonus[- ]action\b/, "bonus"],
    [/^A reaction\b/, "reaction"],
    [/^An action\b/, "action"],
  ];
  for (const def of RESOURCE_DEFS) {
    const lead = leads.find(([pattern]) => pattern.test(def.guidance));
    if (lead && !CHARGED_ELSEWHERE[def.id]) {
      assert.equal(def.action, lead[1], def.id);
    }
  }
  assert.equal(resourceDef("sub_hexblades_curse").action, "bonus");
  assert.equal(resourceDef("sub_healing_light").action, "bonus");
  assert.equal(resourceDef("sub_warding_flare").action, "reaction");
  assert.equal(resourceDef("divine_sense").action, "action");
  // The genre catalogs' prose, read by scripts/generate-class-resources.mjs.
  assert.equal(resourceDef("cyberpunk_bullet_time").action, "reaction");
  assert.equal(resourceDef("horror_blood_ward").action, "reaction");
  assert.equal(resourceDef("dark_fantasy_vanish_below").action, "reaction");
  assert.equal(resourceDef("cyberpunk_static_shield").action, "bonus");
  assert.equal(resourceDef("post_apocalyptic_regenerative_strain").action, "bonus");
  assert.equal(resourceDef("horror_rite_of_repulsion").action, "action");
  assert.equal(resourceDef("horror_stitch_the_tear").action, "action");
  assert.equal(resourceDef("steampunk_full_throttle").action, undefined);
});

// The authored summaries named no cost, or the wrong one, for these; each is
// the book's own (2014 rules).
test("the costs the authored summaries got wrong are the books'", () => {
  const books = {
    sub_call_the_hunt: "none", // Tasha's: used when entering the rage
    sub_eyes_of_night: "action",
    sub_shadow_lore: "action",
    sub_bolstering_magic: "action",
    sub_fathomless_plunge: "action",
    sub_spirit_projection: "action",
    sub_genies_vessel: "action", // Bottled Respite
    sub_limited_wish: "action",
    sub_clockwork_cavalcade: "action",
    sub_warping_implosion: "action",
    sub_benign_transposition: "action",
    sub_momentary_stasis: "action",
    sub_event_horizon: "action",
    sub_detect_portal: "action",
    sub_drake_companion: "action",
    sub_drakes_breath: "action",
    sub_psychic_veil: "action",
    sub_wholeness_of_body_mercy: "action", // Hand of Ultimate Mercy
    race_healing_hands: "action",
    sub_trance_of_order: "bonus",
    sub_lunar_phenomenon: "bonus",
    race_celestial_revelation: "bonus", // Monsters of the Multiverse
    sub_necrotic_husk: "reaction",
    sub_one_with_the_word: "reaction",
    sub_hidden_paths: "bonus",
  };
  for (const [id, cost] of Object.entries(books)) {
    assert.equal(resourceDef(id).action, cost, id);
  }
});

// A subclass counter's free cast is held by the subclass feature, never by a
// species trait of the same name: a changeling's Shapechanger alters their
// looks and casts no polymorph (src/lib/srd/counter-casts.ts).
const { counterCastsHeld } = await import("../src/lib/srd/counter-casts.ts");
test("a species trait named like a subclass counter casts nothing", () => {
  const changeling = [{ name: "Shapechanger (alter your appearance as an action, no action economy cost to revert)", source: "race" }];
  assert.deepEqual(counterCastsHeld(changeling), []);
  const transmuter = [{ name: "Shapechanger", source: "srd" }];
  assert.deepEqual(counterCastsHeld(transmuter).map((entry) => entry.spell), ["Polymorph"]);
});

console.log(`test-class-resources: ${passed} tests passed`);
