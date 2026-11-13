// The cyberpunk, dark fantasy and horror counters' terms beyond their uses
// (src/lib/srd/genre-counter-terms.ts says what each field is for). A passive
// counter is spent by the engine at its trigger, so use_resource refuses a
// bare spend of it with the guidance below, spending nothing (WAVE1 R10).
import type { CounterTerms } from "@/lib/srd/genre-counter-terms";
import type { CustomResourceRow } from "@/lib/srd/class-resources";

// Spent by src/lib/dm/genre-drop-holds.ts the moment the hit point drop lands.
const HELD_AT_THE_DROP = (feature: string, what: string): CounterTerms => ({
  passive: true,
  guidance: `${feature}: ${what} The server spends the use itself when the damage lands (apply_damage, a foe's attack, a spell), before the creature falls; no call spends it.`,
});

// The counters src/lib/dm/genre-drop-holds.ts spends, which state their hit
// points and execute them there, not at use_resource.
export const DROP_HOLD_COUNTERS = [
  "horror_won_t_die_here", "horror_the_one_who_lives", "dark_fantasy_martyr_s_endurance", "dark_fantasy_deathless_vigor",
  "horror_the_last_candle", "cyberpunk_one_more_dawn", "horror_final_benediction",
];

// A reaction the authored row plays (use_reaction answers the open hit record);
// use_resource has no hit to answer.
const BY_REACTION = (feature: string, what: string): CounterTerms => ({
  passive: true,
  action: "reaction",
  guidance: `${feature}: ${what} Played with use_reaction when the trigger comes (the Hand deals its card then), which spends the use; use_resource does not.`,
});

// Given back by take_rest as a short rest ends (rest-tools.ts applySlotRecovery).
const BY_REST = (feature: string, what: string): CounterTerms => ({
  passive: true,
  guidance: `${feature}: ${what} The server gives the slots back and spends the use when take_rest ends a short rest; no call spends it.`,
});

export const GENRE_A_COUNTER_TERMS: Record<string, CounterTerms> = {
  // "take one additional action on your turn": Action Surge's grant.
  cyberpunk_adrenal_override: { extraAction: true, action: "none" },
  cyberpunk_bullet_time: BY_REACTION("Bullet Time", "+3 AC against one ranged attack the street samurai can see, which may turn it into a miss."),
  cyberpunk_overwatch: BY_REACTION("Overwatch", "the attack that hit an ally the netrunner can see is rolled again at disadvantage."),
  horror_blood_ward: BY_REACTION("Blood Ward", "when the apostate is hit, they resist that hit's damage."),
  horror_pain_tolerance: BY_REACTION("Pain Tolerance", "the damage of one hit against the survivor is halved."),
  horror_won_t_die_here: HELD_AT_THE_DROP("Won't Die Here", "once a day, when the survivor drops to 0 hit points but is not killed outright, they drop to 1 instead (from 20th level twice a day, each use also restoring five times their Constitution modifier)."),
  horror_the_one_who_lives: HELD_AT_THE_DROP("The One Who Lives", "Won't Die Here's second use of the day; each use also restores five times the Constitution modifier in hit points."),
  dark_fantasy_martyr_s_endurance: {
    ...HELD_AT_THE_DROP("Martyr's Endurance", "once a long rest (a short rest from 17th level, Sainted Scars), when the penitent drops to 0 hit points but is not killed outright, they drop to 1 instead (from 17th level gaining temporary hit points equal to their level)."),
    rechargeFor: (level: number) => (level >= 17 ? "short" : "long"),
  },
  dark_fantasy_deathless_vigor: HELD_AT_THE_DROP("Deathless Vigor", "once a long rest, when the grave knight drops to 0 hit points but is not killed outright, they drop to 1 instead and gain temporary hit points equal to their level."),
  horror_the_last_candle: HELD_AT_THE_DROP("The Last Candle", "once a long rest, when the exorcist would drop to 0 hit points but is not killed outright, they drop to 1 instead and their Candlelight Vigil burns again for a minute, at double radius."),
  // Upgrades a later feature's text states for an earlier feature's counter
  // ("Street Contacts has 2 uses"), read by populateResources.
  cyberpunk_street_contacts: { upgrades: [{ match: "favor network", uses: 2 }, { match: "shadow network", uses: 3 }] },
  cyberpunk_jury_rig: { upgrades: [{ match: "omni-tool mastery", uses: 4 }] },
  // Requiem d8 (5th level): "regain all uses on a short rest"; Requiem d8,
  // d10 and d12 (5th, 10th, 15th): "Requiem Inspiration die becomes a d8".
  dark_fantasy_requiem_inspiration: {
    rechargeFor: (level: number) => (level >= 5 ? "short" : "long"),
    effect: { kind: "inspire", die: (level: number) => (level >= 15 ? "d12" : level >= 10 ? "d10" : level >= 5 ? "d8" : "d6") },
  },
  // Stim Injector 1d6 + WIS, Boosted Dosage (6th) 2d6, Stim Injector
  // (ranged) (11th) 3d6; its reach and riders: src/lib/dm/genre-a-heals.ts.
  cyberpunk_stim_injector: {
    effect: { kind: "heal_target", dice: (level: number, mods: Record<string, number>) => `${level >= 11 ? 3 : level >= 6 ? 2 : 1}d6+${mods.wis ?? 0}` },
  },
  // "1/long rest while below half HP, bonus action to regain 10 + level HP"
  cyberpunk_wired_soul: { requires: "below_half" },
  // Slots given back (src/lib/dm/genre-a-slots.ts): on a short rest, by the
  // spend itself, or the moment the text names.
  cyberpunk_the_net_remembers: { ...BY_REST("The Net Remembers", "once a day, a short rest gives the netrunner back 4 expended spell slot levels."), effect: { kind: "recover_slots", levels: () => 4 } },
  cyberpunk_nanite_reserve: { ...BY_REST("Nanite Reserve", "once a day, a short rest gives the trauma doc back one expended spell slot of 3rd level or lower."), effect: { kind: "recover_slots", levels: () => 3, most: 1, maxLevel: 3 } },
  // "Regain one 1st-level slot on a short rest": every short rest, so its
  // one use comes back with the rest that spends it.
  cyberpunk_psi_font: { ...BY_REST("Psi Font", "each short rest gives the esper back one expended 1st-level spell slot."), effect: { kind: "recover_slots", levels: () => 1, most: 1, maxLevel: 1 } },
  // "Each drone regains 2d6 HP at the start of your turn, once per rest
  // each": one use per drone (src/lib/dm/genre-a-cyberpunk-drones.ts).
  cyberpunk_self_repair_protocol: {
    passive: true,
    guidance: "Self-Repair Protocol: each damaged drone regains 2d6 hit points as the rigger's turn starts, once per rest each. The server mends the drones and spends the uses itself; no call spends it.",
    upgrades: [{ match: "drone swarm", uses: 2 }, { match: "drone legion", uses: 3 }],
  },
  cyberpunk_overmind: { effect: { kind: "recover_slots", levels: (_level, mods) => Math.max(1, mods?.cha ?? 0), now: true } },
  dark_fantasy_the_tomb_provides: { effect: { kind: "recover_slots", levels: (_level, mods) => Math.max(1, mods?.cha ?? 0), now: true } },
  horror_unfinished_ritual: {
    passive: true,
    guidance: "Unfinished Ritual: once a long rest, when the apostate drops below half their hit points, they regain expended spell slot levels equal to their Charisma modifier. The server gives the slots back and spends the use as the damage lands; no call spends it.",
  },
  horror_the_debt_comes_due: {
    passive: true,
    guidance: "The Debt Comes Due: once a long rest, when the occultist expends their last spell slot, it comes straight back. The server gives it back and spends the use as the cast is paid; no call spends it.",
  },
  // Spent by the cast of the spell they pay for (src/lib/dm/genre-a-casts.ts).
  horror_apocrypha: { passive: true, guidance: "Apocrypha: the occultist's 6th level warlock spell, cast once a long rest without a slot. Cast it with the spell's own tool: the server pays with this use; no call spends it." },
  horror_seventh_seal: { passive: true, guidance: "Seventh Seal: the occultist's 7th level warlock spell, cast once a long rest without a slot. Cast it with the spell's own tool: the server pays with this use; no call spends it." },
  cyberpunk_one_more_dawn: HELD_AT_THE_DROP("One More Dawn", "once a long rest, an ally within 30 feet of the trauma doc who would drop to 0 hit points (not killed outright) drops to 1 instead."),
  horror_final_benediction: HELD_AT_THE_DROP("Final Benediction", "once a long rest, when an ally within 30 feet of the exorcist drops to 0 hit points (not killed outright), they drop instead to five times the exorcist's Wisdom modifier."),
};

// A limit the prose states that the generator writes no row for. "1/week":
// back after seven long rests, a day's rest each (ResourceDef.recovers, the
// marker src/lib/dm/rest-logic.ts counts down); the GM may give it back sooner.
const row = (id: string, displayName: string, classId: string, uses: number, recharge: "short" | "long", guidance: string): CustomResourceRow => ({
  id,
  displayName,
  // Compared keyed (textKey) by featureHolds.
  match: [displayName],
  classes: [classId],
  uses,
  ability: null,
  recharge,
  upgrades: [],
  guidance,
});
const WEEKLY = { recovers: "7" } as const;

export const GENRE_A_EXTRA_COUNTERS: CustomResourceRow[] = [
  row("cyberpunk_the_big_favor", "The Big Favor", "fixer", 1, "long", "1/week, a contact performs a genuinely dangerous service for the fixer (the GM says what it costs them)."),
  row("cyberpunk_lazarus_protocol", "Lazarus Protocol", "trauma_doc", 1, "long", "1/week, a creature dead less than 1 minute is restored to life at half its hit points."),
  row("cyberpunk_daemon_cache", "Daemon Cache", "netrunner", 1, "long", "The cached program (level 1-3, or 1-5 with two programs) is cast once without a slot; back after a long rest."),
  row("cyberpunk_psi_font", "Psi Font", "esper", 1, "short", "One expended 1st-level spell slot back on each short rest."),
  row("cyberpunk_autodoc_implant", "Autodoc Implant", "trauma_doc", 5, "long", "While below half HP, the trauma doc regains WIS-mod HP at the start of their turn, for 5 rounds per long rest."),
  row("dark_fantasy_gutter_king_s_word", "Gutter King's Word", "vermin_lord", 1, "long", "One favor per day from beggars, urchins and rat-folk, within their power."),
  row("horror_the_long_hunt", "The Long Hunt", "slayer", 1, "long", "1/week, a short rest gives the slayer the benefits of a long rest."),
  row("horror_stake_and_salt", "Stake and Salt", "slayer", 2, "short", "Two Hunter's Kit wardings crafted per rest, each covering the whole party."),
];

// Their terms: the weekly ones come back after seven long rests.
export const GENRE_A_EXTRA_TERMS: Record<string, CounterTerms> = {
  // Spent by the turn heal (authored-effects-genre-a.ts, authored-turns.ts).
  cyberpunk_autodoc_implant: {
    passive: true,
    guidance: "Autodoc Implant: while below half HP, the trauma doc regains WIS-mod HP at the start of their turn, 5 rounds per long rest. The server heals and spends the round itself as the turn starts; no call spends it.",
  },
  cyberpunk_the_big_favor: WEEKLY,
  cyberpunk_lazarus_protocol: WEEKLY,
  horror_the_long_hunt: WEEKLY,
};
