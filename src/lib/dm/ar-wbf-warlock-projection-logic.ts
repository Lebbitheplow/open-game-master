// Spirit Projection (Undead patron 14), the clause its row left to the GM:
// "your conjuration and necromancy spells need no verbal or somatic
// components, nor material ones without a cost". While the projection runs
// (the condition its counter lays), a spell of either school is cast as an
// Archdruid casts a druid spell: no words, no gestures, and no material
// unless it has a price. cast-rules.ts componentsAsCast asks, the one place
// every cast reads its components from, so silence, full hands and a missing
// pouch stop none of these spells and still stop every other.
//
// Pure: no database, so the Hand's spell cards read the same components.
import { textKey } from "@/lib/language/text-logic";
import { holdsFeature } from "@/lib/srd/feature-names";
import { bundledSpellSchool } from "@/lib/srd/spell-facts";

const FEATURE = "Spirit Projection";
const PROJECTED = "spirit projection";
const SCHOOLS = ["conjuration", "necromancy"];

type Projector = { features?: ReadonlyArray<{ name: string }>; feats?: readonly string[]; conditions: string[] };
type Components = { name: string; school?: string | null; verbal: boolean; somatic: boolean; material: boolean; materialCostGp?: number | null };

export function projectedComponents<F extends Components>(sheet: Projector, facts: F): F {
  const projected = holdsFeature(sheet, FEATURE) && sheet.conditions.some((entry) => textKey(entry) === PROJECTED);
  // The school the facts carry, else the bundled list's (a fact sheet built
  // from a bare name has none).
  const school = projected ? textKey(facts.school || bundledSpellSchool(facts.name) || "") : "";
  if (!SCHOOLS.includes(school)) {
    return facts;
  }
  return { ...facts, verbal: false, somatic: false, material: facts.material && Boolean(facts.materialCostGp) };
}
