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
import { isNamed, nameChoice } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";

type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

export type FeatureCast = {
  source: string;
  spell: string;
  slot: "free";
  ability?: Ability;
  ritualOnly?: boolean;
};

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
      const chosen = textKey(nameChoice(feature.name) ?? "");
      const cantrip = row.cantrips.find((name) => textKey(name) === chosen);
      if (cantrip && textKey(feature.name.replace(/\s*\([^()]*\)\s*$/, "")) === textKey(row.feature)) {
        out.push({ source: row.feature, spell: cantrip, slot: "free", ability: row.ability });
      }
    }
  }
  return out;
}
