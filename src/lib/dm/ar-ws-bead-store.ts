// An Arcane Abeyance bead on a sheet: made, broken, faded
// (src/lib/srd/ar-ws-conjured.ts says what a bead is).
//
// The store door (cast-guard.ts castSpell with `storing`, the one a Ring of
// Spell Storing is filled through) asks ring-store.ts whether the spell fits
// and then puts it there. Asked for BEAD_SLOT it comes here instead: a spell
// cast with a slot of 4th level or lower fits, and putting it makes the bead,
// a new row on the holder's pack with the spell, the slot's level and the
// wizard's numbers, and the minute of the campaign clock it fades at. A held
// casting (a spell of a minute or more begun in a fight) reaches the same two
// functions when it completes.
//
// The bead is cast from like a ring (use_item, then the spell's own tool:
// src/lib/dm/spell-storing.ts releaseStoredSpell), and ring-store.ts
// takeFromRing drops the row as its spell is cast. The clock fades the beads
// whose hour has run out (src/lib/db/clock.ts advanceClock calls fadeBeads).
//
// Must not import cast-guard.ts or clock.ts: both reach this module.

import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { writeCharges } from "@/lib/dm/item-charges";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { EquipmentItem } from "@/lib/schemas/sheet";
import { BEAD_MAX_LEVEL, BEAD_MINUTES, beadName, freeRowName, isBead, withoutFadedBeads } from "@/lib/srd/ar-ws-conjured";
import type { StoredSpell } from "@/lib/srd/spell-storing";

// Why this spell at this slot level cannot go into a bead for this holder, or null.
export function beadStoreRefusal(holderId: string, spell: string, level: number): ToolError | null {
  if (!getSheetById(holderId)) {
    return { error: `Nobody at the table is there to hold the bead of ${spell}. Nothing was spent.`, retry: true };
  }
  if (level < 1 || level > BEAD_MAX_LEVEL) {
    return { error: `Arcane Abeyance stores a spell cast with a slot of 4th level or lower, and ${spell} at level ${level} is not one. Nothing was spent.`, refused: "rules" };
  }
  return null;
}

// Makes the bead on the holder's pack. Asked first with beadStoreRefusal.
export function putInBead(campaign: Campaign, turnId: string | null, holderId: string, entry: StoredSpell) {
  const holder = getSheetById(holderId);
  if (!holder) {
    return;
  }
  // Read here: the cast that fills the bead may have moved the clock (a spell of minutes).
  const now = (getCampaignById(campaign.id) ?? campaign).clock.instant;
  const bead: EquipmentItem = {
    name: freeRowName(holder.equipment, beadName(entry.spell)),
    qty: 1,
    storedSpells: [entry],
    conjured: { kind: "bead", until: now + BEAD_MINUTES },
  };
  writeCharges(campaign.id, holder, [...holder.equipment, bead], "use_spell_slot", `${entry.spell} held in a bead by Arcane Abeyance`, turnId);
}

// The bead of this spell made last on a sheet, for the line that names it.
export function newestBead(holderId: string, spell: string): EquipmentItem | null {
  const held = (getSheetById(holderId)?.equipment ?? []).filter((item) => isBead(item) && item.storedSpells?.some((entry) => entry.spell === spell));
  return held[held.length - 1] ?? null;
}

// The clock has reached `now`: every bead whose hour is over is gone, written
// with its audit row so the turn's revert gives it back with the time.
export function fadeBeads(campaignId: string, now: number): string[] {
  const faded: string[] = [];
  for (const sheet of listSheets(campaignId)) {
    const kept = withoutFadedBeads(sheet.equipment, now);
    if (!kept) {
      continue;
    }
    const gone = sheet.equipment.filter((item) => !kept.includes(item)).map((item) => item.name);
    patchSheetAudited(campaignId, sheet.id, { equipment: kept }, { kind: "use_item", reason: "an Arcane Abeyance bead's hour ran out", delta: { faded: gone } });
    faded.push(...gone.map((name) => `${sheet.name}: ${name}`));
  }
  return faded;
}
