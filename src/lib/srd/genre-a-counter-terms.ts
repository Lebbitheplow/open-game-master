// The cyberpunk, dark fantasy and horror counters' terms beyond their uses
// (src/lib/srd/genre-counter-terms.ts says what each field is for). A passive
// counter is spent by the engine at its trigger, so use_resource refuses a
// bare spend of it with the guidance below, spending nothing (WAVE1 R10).
import type { CounterTerms } from "@/lib/srd/genre-counter-terms";

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
  cyberpunk_one_more_dawn: HELD_AT_THE_DROP("One More Dawn", "once a long rest, an ally within 30 feet of the trauma doc who would drop to 0 hit points (not killed outright) drops to 1 instead."),
  horror_final_benediction: HELD_AT_THE_DROP("Final Benediction", "once a long rest, when an ally within 30 feet of the exorcist drops to 0 hit points (not killed outright), they drop instead to five times the exorcist's Wisdom modifier."),
};
