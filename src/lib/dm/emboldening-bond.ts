// The board's side of Emboldening Bond (src/lib/dm/emboldening-bond-logic.ts):
// whether another bonded creature stands within reach of the roller, the turn
// a die is spent in, and the stamp a spent die leaves. Every d20 roll of a
// character goes through one of the two doors that call this: saves and
// checks through rollExtrasFor (forced-save.ts), attacks through
// pc-attack-situation.ts.
import { getActiveEncounter, turnKey, type Encounter } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { withinFeet } from "@/lib/dm/authored-saves";
import { classLevelOf, holdsFeature } from "@/lib/srd/trait-rules";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { BOND_FEET, BOND_SPEND, EXPANSIVE_BOND_FEET, bondCondition, bondRiderFor, bondSpentMeta, type BondRider } from "@/lib/dm/emboldening-bond-logic";

const turnOf = (encounter: Encounter | null) => (encounter ? `${encounter.id}:${turnKey(encounter)}` : null);

// 30 feet, or 60 once the cleric who made the bond holds Expansive Bond (17th).
function reachOf(sheet: CharacterSheet, held: string): number {
  const source = sheet.conditionMeta?.[held]?.source;
  const cleric = source ? getSheetById(source) : null;
  return cleric && (holdsFeature(cleric, "Expansive Bond") || classLevelOf(cleric, "cleric") >= 17) ? EXPANSIVE_BOND_FEET : BOND_FEET;
}

// The die the roller adds to this roll, or null. Off the board the fiction
// keeps them together, as withinFeet reads it.
export function bondRider(campaignId: string, sheet: CharacterSheet): BondRider | null {
  const held = bondCondition(sheet);
  if (!held) {
    return null;
  }
  const encounter = getActiveEncounter(campaignId);
  const feet = reachOf(sheet, held);
  const near = listSheets(campaignId).some(
    (other) =>
      other.id !== sheet.id &&
      !other.deathSaves?.dead &&
      bondCondition(other) !== null &&
      (!encounter || withinFeet(encounter.id, sheet.id, other.id, feet)),
  );
  return bondRiderFor(sheet, near, turnOf(encounter));
}

// The meta a roll's spent carriers leave on the bond: the turn stamped on it,
// or null when the roll spent no bond die. For a caller that writes the
// sheet's meta itself (forced-save.ts spendRollCarriers), in the same patch.
export function bondStamped(campaignId: string, sheet: { conditions: string[]; conditionMeta?: CharacterSheet["conditionMeta"] }, spent: readonly string[]): CharacterSheet["conditionMeta"] | null {
  return spent.includes(BOND_SPEND) ? bondSpentMeta(sheet, turnOf(getActiveEncounter(campaignId))) : null;
}

// After the roll: a spent die stamps the turn on the bond (`spent` is the
// roll's list of carriers).
export function markBondSpent(campaignId: string, sheetId: string, spent: readonly string[]) {
  if (!spent.includes(BOND_SPEND)) {
    return;
  }
  const sheet = getSheetById(sheetId);
  const meta = sheet ? bondSpentMeta(sheet, turnOf(getActiveEncounter(campaignId))) : null;
  if (!sheet || !meta) {
    return;
  }
  const updated = patchSheet(sheet.id, { conditionMeta: meta });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
}
