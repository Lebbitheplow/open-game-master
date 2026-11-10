// What the mystery, post-apocalyptic and steampunk catalogs say about their
// counters beyond the row src/lib/classes/resources.json carries (written by
// scripts/generate-class-resources.mjs from the counter's own line): a later
// feature that raises a counter's uses or changes its rest ("The Scene
// Speaks: Keen Deduction has 3 uses per short rest", "Unbreakable: Hard to
// Kill recharges on a short rest"), and a counter the engine spends on its
// own (Hard to Kill holds the enforcer at 1 hit point as the blow lands), so a
// use_resource call of its own is refused. class-resources.ts CUSTOM_RESOURCE_DEFS
// lays these over the generated rows.
//
// Pure data.
import type { Recharge } from "@/lib/srd/class-resources";

type Terms = {
  upgrades?: Array<{ match: string; uses: number }>;
  rechargeFor?: (level: number) => Recharge;
  passive?: boolean;
};

const GENRE_B_COUNTER_TERMS: Record<string, Terms> = {
  mystery_keen_deduction: { upgrades: [{ match: "The Scene Speaks", uses: 3 }] },
  mystery_headline_instinct: { upgrades: [{ match: "The Rolodex", uses: 3 }] },
  mystery_front_page_pressure: { upgrades: [{ match: "Syndicated", uses: 2 }] },
  mystery_speak_with_the_departed: { upgrades: [{ match: "Deathless Counsel", uses: 3 }] },
  // "1/long rest, when you drop to 0 HP, drop to 1 instead" (src/lib/dm/pc-damage.ts
  // spends it); Unbreakable (17th): "Hard to Kill recharges on a short rest."
  mystery_hard_to_kill: { passive: true, rechargeFor: (level) => (level >= 17 ? "short" : "long") },
  // "when an ally within 30 ft drops to 0 HP, they instead drop to WIS-mod x 5
  // HP": the damage path spends it (src/lib/dm/genre-b-drops.ts).
  post_apocalyptic_stand_at_the_dawn: { passive: true },
  post_apocalyptic_rapid_adaptation: { upgrades: [{ match: "Second Adaptation", uses: 2 }] },
  steampunk_field_repair: { upgrades: [{ match: "Field Repair (2d8)", uses: 4 }] },
  steampunk_overpressure_valve: { upgrades: [{ match: "Perpetual Motion", uses: 2 }] },
  steampunk_catalyst_stone: { upgrades: [{ match: "Improved Catalyst", uses: 3 }] },
  steampunk_overclock: { upgrades: [{ match: "Fourth Gadget", uses: 2 }] },
};

// The terms one generated row takes, its own upgrade lines kept.
export function genreBCounterTerms(row: { id: string; upgrades: Array<{ match: string; uses: number }> }): Terms {
  const terms = GENRE_B_COUNTER_TERMS[row.id];
  if (!terms) return {};
  return { ...terms, ...(terms.upgrades ? { upgrades: [...row.upgrades, ...terms.upgrades] } : {}) };
}

// The genre counters that hold their holder at 1 hit point as a blow would
// drop them, spent by the damage path as Undying Sentinel's is
// (src/lib/dm/pc-damage.ts): Hard to Kill.
const HOLDS_AT_ONE: Array<{ id: string; name: string }> = [{ id: "mystery_hard_to_kill", name: "Hard to Kill" }];

export function spendGenreHold(resources: Record<string, { max: number; used: number }> | undefined): { resources: Record<string, { max: number; used: number }>; name: string } | null {
  for (const hold of HOLDS_AT_ONE) {
    const state = resources?.[hold.id];
    if (state && state.used < state.max) {
      return { resources: { ...resources, [hold.id]: { max: state.max, used: state.used + 1 } }, name: hold.name };
    }
  }
  return null;
}
