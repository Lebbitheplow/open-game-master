// What the druid's and the Land circle's text says that the engine left to
// the telling (SRD 5.1):
//
//   - Beast Spells (druid 18): "You can perform the somatic and verbal
//     components of a druid spell while in a beast shape, but you aren't able
//     to provide material components." A spell whose material is still asked
//     of the caster is refused in the shape. An Archdruid's druid spells ask
//     for no costless material in either shape (cast-rules.ts
//     componentsAsCast), so only a material with a price or one the spell
//     consumes is left to refuse them.
//   - Land's Stride (Circle of the Land 6, ranger 8): "advantage on saving
//     throws against plants that are magically created or manipulated to
//     impede movement, such those created by the entangle spell."
//
// Pure: the sheet and the spell in, the refusal or the claim out.

import { holdsFeature } from "@/lib/srd/feature-names";
import type { SpellFacts } from "@/lib/srd/spell-facts";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";

// The material a beast's body cannot provide, for a caster wearing a Wild
// Shape form. `cast` is the spell as this caster casts it (the components an
// Archdruid or an invocation waives already gone).
export function beastShapeMaterialProblem(sheet: Pick<CharacterSheet, "name" | "wildShape">, cast: SpellFacts | null): ToolError | null {
  if (!cast?.material || !sheet.wildShape || sheet.wildShape.kind === "polymorph") {
    return null;
  }
  return {
    error: `${cast.name} has a material component${cast.materialText ? ` (${cast.materialText.replace(/\.$/, "")})` : ""}, and ${sheet.name} cannot provide one as a ${sheet.wildShape.form}: Beast Spells gives a beast shape the words and the gestures only. A spell with no material component can still be cast, or they revert first (use_resource Wild Shape with variant 'revert'). Nothing was spent.`,
    refused: "rules",
  };
}

// The SRD 5.1 spells whose save is against plants made or moved by magic to
// hold a creature in place: Entangle (its own example), Wall of Thorns and
// Grasping Vine.
const IMPEDING_PLANTS = /\b(entangle|wall of thorns|grasping vine)\b/i;

// Land's Stride on a save the engine rolls: `what` is the save's own line
// (the spell or effect it names).
export function landsStrideClaim(sheet: { features?: ReadonlyArray<{ name: string }> }, what: string): { advantage: "advantage"; reason: string } | null {
  if (!IMPEDING_PLANTS.test(what) || !holdsFeature({ features: [...(sheet.features ?? [])] }, "land's stride")) {
    return null;
  }
  return { advantage: "advantage", reason: "Land's Stride: advantage against plants magic made to impede movement" };
}
