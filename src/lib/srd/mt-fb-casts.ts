// The spells a fighter's or barbarian's subclass feature casts, for classes
// that have no Spellcasting feature of their own: before this the cast guard
// refused every one ("has no Spellcasting feature and cannot cast spells"),
// and the rows were narrated.
//
//   Spirit Seeker   "Ritual casting of beast sense and speak with animals."
//   Spirit Walker   "Cast commune with nature as a ritual"
//   Giant's Power   "your choice of the druidcraft or thaumaturgy cantrip,
//                   cast with Wisdom" (the option chosen names the cantrip)
//   Arcane Archer Lore  "The prestidigitation or druidcraft cantrip"
//
// Read by src/lib/srd/granted-casts.ts grantedCastsOf, so the cast guard, the
// spell DC and the Hand's spell cards all see them as they see an
// invocation's spell. A ritual-only grant casts with `ritual` and no other
// way (src/lib/dm/cast-rules.ts). Pure.
import { choiceIn, isNamed, nameChoice } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";

type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

export type FeatureCast = {
  source: string;
  spell: string;
  slot: "free";
  ability?: Ability;
  ritualOnly?: boolean;
  // A cast once a rest without a slot, a slot of the caster's own paying
  // for the rest (a Smuggler's Legerdemain spell): its counter and rest.
  counter?: string;
  rest?: "long" | "short";
  slotsToo?: boolean;
};

// The spells a Smuggler rogue picked with Smuggler's Legerdemain (src/lib/
// srd/options.ts legerdemain kinds): the cantrips at will, each spell once
// a long rest without a slot, all cast with Intelligence.
const LEGERDEMAIN_CANTRIP = "Legerdemain Cantrip";
const LEGERDEMAIN_SPELLS = ["Legerdemain Spell", "Improved Legerdemain"];

// The counter of a Legerdemain spell's free cast: the one a feat's free
// cast of the same spell keeps (src/lib/srd/feat-spells.ts), so the
// counters read it by the spell.
export function legerdemainCounterId(spell: string): string {
  return `free_cast_${textKey(spell).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

// The Legerdemain spells a sheet holds, for the counters.
export function legerdemainSpellsHeld(features: ReadonlyArray<{ name: string }>): string[] {
  return features.flatMap((feature) => LEGERDEMAIN_SPELLS.map((family) => choiceIn(feature.name, family)).find(Boolean) ?? []);
}

const RITUALS: Array<{ feature: string; spells: string[] }> = [
  { feature: "Spirit Seeker", spells: ["Beast Sense", "Speak with Animals"] },
  { feature: "Spirit Walker", spells: ["Commune with Nature"] },
];
// The cantrip is the option chosen for the feature: "Giant's Power (Thaumaturgy)".
const CANTRIP_PICKS: Array<{ feature: string; cantrips: string[]; ability: Ability }> = [
  { feature: "Giant's Power", cantrips: ["Druidcraft", "Thaumaturgy"], ability: "wis" },
  { feature: "Arcane Archer Lore", cantrips: ["Prestidigitation", "Druidcraft"], ability: "int" },
];
const NOT_A_SUBCLASS = new Set(["race", "background"]);

export function featureCastsHeld(features: ReadonlyArray<{ name: string; source?: string }>): FeatureCast[] {
  const out: FeatureCast[] = [];
  const held = features.filter((feature) => !NOT_A_SUBCLASS.has(feature.source ?? ""));
  for (const row of RITUALS) {
    if (held.some((feature) => isNamed(feature.name, row.feature))) {
      for (const spell of row.spells) out.push({ source: row.feature, spell, slot: "free", ability: "wis", ritualOnly: true });
    }
  }
  for (const row of CANTRIP_PICKS) {
    for (const feature of held) {
      // "Giant's Power (Thaumaturgy)", the in-play choose's, or "Giant's
      // Power: Thaumaturgy", the pick the builder and the level-up write
      // (src/lib/srd/options.ts giant_cantrip).
      const picked = choiceIn(feature.name, row.feature);
      const chosen = textKey(picked ?? nameChoice(feature.name) ?? "");
      const cantrip = row.cantrips.find((name) => textKey(name) === chosen);
      if (cantrip && (picked !== null || textKey(feature.name.replace(/\s*\([^()]*\)\s*$/, "")) === textKey(row.feature))) {
        out.push({ source: row.feature, spell: cantrip, slot: "free", ability: row.ability });
      }
    }
  }
  for (const feature of features) {
    const cantrip = choiceIn(feature.name, LEGERDEMAIN_CANTRIP);
    if (cantrip) out.push({ source: "Smuggler's Legerdemain", spell: cantrip, slot: "free", ability: "int" });
  }
  for (const spell of legerdemainSpellsHeld(features)) {
    out.push({ source: "Smuggler's Legerdemain", spell, slot: "free", ability: "int", counter: legerdemainCounterId(spell), rest: "long", slotsToo: true });
  }
  return out;
}
