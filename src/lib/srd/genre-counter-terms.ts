// What a genre counter's own words ask of it beyond its uses, written per
// counter id: the rows of src/lib/classes/resources.json are generated from
// the catalogs' prose (scripts/generate-class-resources.mjs) and carry only
// the uses, the rest, the guidance and a parsed fx. A counter the server
// spends on a trigger of its own (passive), a cost the prose does not parse,
// a recharge that changes with the level: each genre package writes its
// counters' terms in a file of its own and spreads it here with one line.
// class-resources.ts lays these over the generated rows (CUSTOM_RESOURCE_DEFS).
//
// Type-only imports: class-resources.ts imports this module's values.
import type { CustomResourceRow, ResourceDef } from "@/lib/srd/class-resources";
import { GENRE_A_COUNTER_TERMS, GENRE_A_EXTRA_COUNTERS, GENRE_A_EXTRA_TERMS } from "@/lib/srd/genre-a-counter-terms";

export type CounterTerms = Partial<Pick<ResourceDef, "passive" | "options" | "outOfFight" | "fightOnly" | "action" | "guidance" | "rechargeFor" | "upgrades" | "extraAction" | "recovers" | "noRefill" | "effect" | "requires">>;

export const GENRE_COUNTER_TERMS: Record<string, CounterTerms> = {
  ...GENRE_A_COUNTER_TERMS,
  ...GENRE_A_EXTRA_TERMS,
};

// Counters the generator writes no row for: a limit stated in words it does
// not read ("1/week", "one favor per day", "craft two per rest"). Each genre
// package lists its own and spreads them here with one line.
export const GENRE_EXTRA_COUNTERS: CustomResourceRow[] = [...GENRE_A_EXTRA_COUNTERS];
