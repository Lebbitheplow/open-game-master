// The items owner (docs/specs/ogm-domain-owners.md): the one place that writes
// what a character carries (equipment, gold, copper) on any sheet: a hero, a
// companion, a first-tier character's cast sheet. The master's tools, the
// stage, the rules and the sheet routes decide; they ask here, and only here
// is the sheet written (src/lib/db/owner-gate.ts refuses any other path).
//
// A thing changes hands once per turn: a hand-over this turn already recorded
// (the same giver, taker and thing in the turn's audit) is not done again,
// whoever asks for it the second time: the master and then the stage, or the
// stage twice.
import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { ownerWrite } from "@/lib/db/owner-gate";
import { insertSheetAudit, listAuditForTurn } from "@/lib/db/sheet-audit";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import { holdIfFree } from "@/lib/dm/gear-hands";
import { addRowMath, handedOverRow, removeItemMath } from "@/lib/dm/mutation-math";
import type { CharacterSheet, EquipmentItem, FullPatchSheetInput } from "@/lib/schemas/sheet";

// The write itself. A patch may carry other fields beside the item ones while
// their own owners do not exist yet (the spec's later slices split them).
export function writeItems(
  sheetId: string,
  patch: FullPatchSheetInput,
  options: { restoring?: boolean; guessing?: boolean } = {},
): CharacterSheet | null {
  return ownerWrite("items", () => patchSheet(sheetId, patch, options));
}

// A sheet's equipment saved with its audit row, announced to the table.
export function saveEquipment(
  campaign: Campaign,
  turn: DmTurn | null,
  sheet: CharacterSheet,
  equipment: EquipmentItem[],
  kind: string,
  delta: Record<string, unknown>,
  reason: string,
) {
  const updated = writeItems(sheet.id, { equipment });
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId: turn?.id ?? null,
    kind,
    delta,
    reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch: { equipment },
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

export type ThingKey = (thing: string) => string;

// This turn already moved this thing from this giver to this taker. The thing
// may be told in other words than the sheet's line ("il quarto di pesce" for
// "Quarto di pesce crudo"): keyOf is the table language's reading of a name.
export function handedThisTurn(
  campaignId: string,
  turn: DmTurn | null,
  from: CharacterSheet,
  thing: string,
  toName: string,
  keyOf: ThingKey = textKey,
): boolean {
  const wanted = keyOf(thing);
  if (!turn || !wanted) {
    return false;
  }
  return listAuditForTurn(campaignId, turn.id).some((entry) => {
    const done = typeof entry.delta.name === "string" ? keyOf(entry.delta.name) : "";
    return (
      entry.characterId === from.id &&
      entry.kind === "hand_item" &&
      !entry.revertedBy &&
      typeof entry.delta.to === "string" &&
      textKey(entry.delta.to) === textKey(toName) &&
      Boolean(done) &&
      (done.includes(wanted) || wanted.includes(done))
    );
  });
}

export type Given = { ok: true; already: boolean; qty: number } | { ok: false; error: string };

// One thing from one sheet to another, both halves in one step.
export function give(
  campaign: Campaign,
  turn: DmTurn | null,
  from: CharacterSheet,
  to: CharacterSheet,
  row: EquipmentItem,
  qty: number,
  reason: string,
): Given {
  if (handedThisTurn(campaign.id, turn, from, row.name, to.name)) {
    return { ok: true, already: true, qty: 0 };
  }
  const removal = removeItemMath(from.equipment, row.name, qty);
  if (!removal) {
    return { ok: false, error: `${from.name} carries no "${row.name}".` };
  }
  const receiver = getSheetById(to.id) ?? to;
  const received = holdIfFree(addRowMath(receiver.equipment, handedOverRow(row, removal.removed)), row.name);
  saveEquipment(campaign, turn, from, removal.equipment, "hand_item", { name: row.name, to: to.name, qty: removal.removed }, reason || `Handed ${row.name} to ${to.name}`);
  saveEquipment(campaign, turn, receiver, received.equipment, "hand_item", { name: row.name, from: from.name, qty: removal.removed }, reason || `Received ${row.name} from ${from.name}`);
  return { ok: true, already: false, qty: removal.removed };
}
