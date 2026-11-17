// A sheet change that touches what a character carries and other fields at
// once (an undo, a rest, a player's own edit): the things go through their
// owner (src/lib/owners/items.ts), the rest is written here, still directly,
// until its own owner exists (docs/specs/ogm-domain-owners.md). The files that
// call this are counted with the direct writers in scripts/test-domain-owners.mjs.
import { splitOwnedFields } from "@/lib/db/owner-gate";
import { patchSheet } from "@/lib/db/sheets";
import { writeItems } from "@/lib/owners/items";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";

export function patchWithItems(
  sheetId: string,
  patch: FullPatchSheetInput,
  options: { restoring?: boolean; guessing?: boolean } = {},
): CharacterSheet | null {
  const { owned, rest } = splitOwnedFields("items", patch);
  // An empty change still writes: the sheet's derived values are taken again.
  const written = Object.keys(rest).length > 0 || Object.keys(owned).length === 0 ? patchSheet(sheetId, rest, options) : null;
  return Object.keys(owned).length > 0 ? writeItems(sheetId, owned, options) : written;
}
