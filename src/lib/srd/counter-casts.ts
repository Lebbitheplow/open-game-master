// The subclass counters whose use IS a spell cast without a slot: Star Map's
// guiding bolt, Consult the Spirits' augury, the Alchemist's lesser
// restoration, Fey Reinforcements' summon fey, the Fathomless warlock's black
// tentacles, the Transmuter's self-polymorph, the Psi Warrior's telekinesis,
// the Lunar sorcerer's phase spell. Spending one with use_resource moved the
// counter and cast nothing, and the spell's own tool asked for a slot.
//
// Each row here is a grant the cast guard reads (src/lib/srd/granted-casts.ts
// grantedCastsOf): the spell's tool casts it with no slot and spends the
// counter, and the Hand's spell card shows the free use. The counter itself is
// passive (src/lib/srd/authored-resources.json): a bare use_resource spend is
// refused with a pointer to the spell. A counter that casts a spell goes
// here, never as a narrative spend.
//
// Pure.
import { isNamed } from "@/lib/srd/feature-names";

export type CounterCast = {
  counter: string;
  // The feature names that hold it (the counter's own match terms).
  features: string[];
  spells: string[];
  // The feature's choice that picks the spell ("Lunar Embodiment (Full
  // Moon)"), when the spell depends on it.
  byChoice?: Record<string, string>;
  rest: "short" | "long";
  castAt?: number;
  selfOnly?: boolean;
  noMaterial?: boolean;
  // The casting ability the feature names (Consult the Spirits: "using Wisdom").
  ability?: "str" | "dex" | "con" | "int" | "wis" | "cha";
  note?: string;
  // What the free use is held to (the cast guard reads it, the cast tools
  // judge it): only on the holder, into a form of this challenge rating or
  // lower. `words` finish "casts it free only ...". A slot casts it freely.
  freeLimit?: FreeLimit;
};

export type FreeLimit = { selfOnly?: boolean; maxCr?: number; words: string };

const LUNAR = { "full moon": "Shield", "new moon": "Ray of Sickness", "crescent moon": "Color Spray" };

export const COUNTER_CASTS: CounterCast[] = [
  { counter: "sub_star_map", features: ["Star Map"], spells: ["Guiding Bolt"], rest: "long" },
  { counter: "sub_consult_the_spirits", features: ["Consult the Spirits"], spells: ["Augury", "Clairvoyance"], rest: "short", noMaterial: true, ability: "wis" },
  { counter: "art_restorative_reagents", features: ["Restorative Reagents"], spells: ["Lesser Restoration"], rest: "long" },
  // Chemical Mastery: "can cast greater restoration and heal once per long
  // rest each without a slot", one counter for each spell.
  { counter: "art_chemical_mastery_restoration", features: ["Chemical Mastery"], spells: ["Greater Restoration"], rest: "long" },
  { counter: "art_chemical_mastery_heal", features: ["Chemical Mastery"], spells: ["Heal"], rest: "long" },
  { counter: "sub_fey_reinforcements", features: ["Fey Reinforcements"], spells: ["Summon Fey"], rest: "long", noMaterial: true },
  { counter: "sub_grasping_tentacles", features: ["Grasping Tentacles"], spells: ["Black Tentacles", "Evard's Black Tentacles"], rest: "long", note: "Casting it gives the warlock temporary hit points equal to their warlock level, and damage cannot break their concentration on it." },
  // Not selfOnly: the wizard knows polymorph too, and a grant's selfOnly holds
  // the slot casts to the wizard as well (cast-buff.ts reads it). The free use
  // alone is held to the text's "targeting only yourself and becoming a beast
  // of challenge rating 1 or lower" (freeLimit).
  { counter: "sub_shapechanger", features: ["Shapechanger"], spells: ["Polymorph"], rest: "short", noMaterial: true, freeLimit: { selfOnly: true, maxCr: 1, words: "on themselves, into a beast of challenge rating 1 or lower" }, note: "The free casting is on the wizard themselves, into a beast of challenge rating 1 or lower." },
  { counter: "sub_telekinetic_master", features: ["Telekinetic Master"], spells: ["Telekinesis"], rest: "long" },
  { counter: "sub_walker_in_dreams", features: ["Walker in Dreams"], spells: ["Dream", "Scrying", "Teleportation Circle"], rest: "long", noMaterial: true },
  { counter: "sub_lunar_free_cast", features: ["Lunar Embodiment"], spells: Object.values(LUNAR), byChoice: LUNAR, rest: "long" },
  { counter: "sub_waxing_and_waning", features: ["Waxing and Waning"], spells: Object.values(LUNAR), rest: "long" },
];

// The counter a spell's cast spends, by its counter id.
export function counterCastOf(counter: string): CounterCast | null {
  return COUNTER_CASTS.find((row) => row.counter === counter) ?? null;
}

// The spells a sheet's features cast through these counters.
// Every row is a subclass counter, so a species trait or a background feature
// of the same name never holds one: a changeling's "Shapechanger (alter your
// appearance...)" is not the Transmuter's Shapechanger, and dealt them a
// polymorph card that cast_buff refused.
const NOT_A_SUBCLASS = new Set(["race", "background"]);

export function counterCastsHeld(features: ReadonlyArray<{ name: string; source?: string }>): Array<{ row: CounterCast; spell: string }> {
  const out: Array<{ row: CounterCast; spell: string }> = [];
  const held = features.filter((feature) => !NOT_A_SUBCLASS.has(feature.source ?? ""));
  for (const row of COUNTER_CASTS) {
    const holding = held.filter((feature) => isNamed(feature.name, ...row.features));
    if (!holding.length) continue;
    if (row.byChoice) {
      // "Lunar Embodiment (Full Moon)": the phase chosen picks the spell.
      const chosen = Object.entries(row.byChoice).find(([phase]) => holding.some((feature) => isNamed(feature.name, `${row.features[0]} (${phase})`)));
      if (chosen) out.push({ row, spell: chosen[1] });
      continue;
    }
    for (const spell of row.spells) out.push({ row, spell });
  }
  return out;
}
