// Inured to Undeath (School of Necromancy 10): "Resistance to necrotic
// damage, and your hit point maximum cannot be reduced."
//
// The resistance is the feature table's (src/lib/srd/feature-effects.ts). The
// second half is asked here: the name of the feature that holds this sheet's
// hit point maximum where it is, or null. Before this module nothing asked,
// and a wight's Life Drain, a GM's drain and exhaustion all lowered a
// necromancer's maximum as anybody's.
//
// Every door that lowers a character's maximum asks it:
//   - a drain that rides a condition ("max hp reduced (-7)": a creature's
//     Life Drain, a GM's set_condition), at the one place the stored maximum
//     follows such a condition (src/lib/db/sheets.ts patchSheet, through
//     ar-ws-inured.ts keptFromDrain), and src/lib/dm/enemy-hit.ts drainMaxHp
//     for what the table is told;
//   - an effect that lowers it (set_effect field maxHp, the only door that
//     makes effects: src/lib/dm/effect-tools.ts), refused with nothing changed;
//   - exhaustion level 4's halving (condition-logic.ts effectiveMaxHp).
// A new door that lowers a maximum asks it too.
//
// Rulings: "cannot be reduced" is every reduction, exhaustion's halving
// included (the text names no source). A bonus that ends (Aid, Heroes' Feast)
// is not a reduction: the maximum goes back to the character's own.
//
// Pure, and imports no rules module that reads it (condition-logic.ts does).

import { activeAuthored, type AuthoredSheet } from "@/lib/srd/authored-effects";

export function maxHpCannotFall(sheet: AuthoredSheet | null | undefined): string | null {
  return sheet ? (activeAuthored(sheet, "max_hp_fixed")[0]?.held.feature ?? null) : null;
}
