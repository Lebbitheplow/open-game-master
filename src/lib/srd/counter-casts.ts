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
import { textKey } from "@/lib/language/text-logic";

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
  note?: string;
};

const LUNAR = { "full moon": "Shield", "new moon": "Ray of Sickness", "crescent moon": "Color Spray" };

export const COUNTER_CASTS: CounterCast[] = [
  { counter: "sub_star_map", features: ["Star Map"], spells: ["Guiding Bolt"], rest: "long" },
  { counter: "sub_consult_the_spirits", features: ["Consult the Spirits"], spells: ["Augury", "Clairvoyance"], rest: "short", noMaterial: true },
  { counter: "art_restorative_reagents", features: ["Restorative Reagents"], spells: ["Lesser Restoration"], rest: "long" },
  { counter: "sub_fey_reinforcements", features: ["Fey Reinforcements"], spells: ["Summon Fey"], rest: "long", noMaterial: true },
  { counter: "sub_grasping_tentacles", features: ["Grasping Tentacles"], spells: ["Black Tentacles", "Evard's Black Tentacles"], rest: "long", note: "Casting it gives the warlock temporary hit points equal to their warlock level, and damage cannot break their concentration on it." },
  { counter: "sub_shapechanger", features: ["Shapechanger"], spells: ["Polymorph"], rest: "short", selfOnly: true, noMaterial: true, note: "Only into a beast of challenge rating 1 or lower." },
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
export function counterCastsHeld(features: ReadonlyArray<{ name: string }>): Array<{ row: CounterCast; spell: string }> {
  const out: Array<{ row: CounterCast; spell: string }> = [];
  for (const row of COUNTER_CASTS) {
    const holding = features.filter((feature) => isNamed(feature.name, ...row.features));
    if (!holding.length) continue;
    if (row.byChoice) {
      // "Lunar Embodiment (Full Moon)": the phase chosen picks the spell.
      const chosen = holding.map((feature) => /\(([^)]+)\)\s*$/.exec(feature.name)?.[1] ?? "").map(textKey).find((key) => key in row.byChoice!);
      if (chosen) out.push({ row, spell: row.byChoice[chosen] });
      continue;
    }
    for (const spell of row.spells) out.push({ row, spell });
  }
  return out;
}
