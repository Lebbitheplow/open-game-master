// The steampunk classes' own spends (src/lib/srd/genre-b-steampunk-types.ts),
// sent here by src/lib/dm/authored-spend-effects.ts resolveSpendEffect for the
// "steampunk" kind. Each refuses before anything is spent when it would do
// nothing.
//
//   rearm  Backup Rig (gadgeteer 13): "1/long rest, ignore being disarmed".
//     A disarmed character, on this engine, is one whose weapon lies on the
//     ground where it fell (handle_item drop: "use this ... for anything set
//     down, knocked away or let fall", src/lib/dm/gear-ground.ts), or one
//     carrying the "disarmed" mark a Disarming Attack leaves. The rig takes
//     both back: the last thing the gadgeteer let fall here is in their hand
//     again, wherever on the board it lies and at no cost of the turn, and the
//     mark is gone. The ground keeps no word of HOW a thing left the hand, so
//     a weapon thrown reads as one let fall; the use is the player's to call.
//
// Before this the counter moved and nothing else did.
import { getActiveBattleMap } from "@/lib/battlemap/view";
import { listDroppedItems, takeFromDroppedItem } from "@/lib/db/dropped-items";
import { getCurrentLocation } from "@/lib/db/locations";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { removeConditions } from "@/lib/dm/condition-logic";
import { holdIfFree } from "@/lib/dm/gear-hands";
import { saveEquipment } from "@/lib/dm/gear-store";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { addRowMath, handedOverRow } from "@/lib/dm/mutation-math";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { DISARMED } from "@/lib/srd/genre-b-steampunk-attacks";
import type { SteampunkSpend } from "@/lib/srd/genre-b-steampunk-types";
import { boardingAction, extraTurn, grapnelAce } from "@/lib/dm/genre-gb-aeronaut";
import { fieldFabricator } from "@/lib/dm/genre-gb-fabricator";

type Outcome = ToolError | { result: Record<string, unknown>; patch?: import("@/lib/schemas/sheet").FullPatchSheetInput };

export function steampunkSpend(ctx: SpendContext, does: SteampunkSpend): Outcome {
  switch (does.what) {
    case "rearm":
      return rearm(ctx);
    case "grapnel":
      return grapnelAce(ctx, does.mode);
    case "extra_turn":
      return extraTurn(ctx, ctx.spend.name);
    case "boarding":
      return boardingAction(ctx);
    case "fabricate":
      return fieldFabricator(ctx);
  }
}

function rearm(ctx: SpendContext): Outcome {
  const { campaign, sheet } = ctx;
  const map = getActiveBattleMap(campaign.id);
  const here = textKey(getCurrentLocation(campaign.id)?.name ?? "");
  // What the holder let fall and nobody has taken up: on this board, or, with
  // none up, at this place. The last to fall is the one the rig holds.
  const fallen = listDroppedItems(campaign.id)
    .filter((entry) => !entry.heldByEnemy && textKey(entry.droppedBy) === textKey(sheet.name))
    .filter((entry) => (map ? entry.mapId === map.id : textKey(entry.place) === here))
    .at(-1);
  const marked = sheet.conditions.filter((entry) => isConditionNamed(entry, DISARMED));
  if (!fallen && !marked.length) {
    return { error: `${sheet.name} has not been disarmed: nothing they held lies where it fell, and they carry no disarmed mark. ${ctx.spend.name} waits for that. Nothing was spent.`, refused: "rules" };
  }
  const lines: string[] = [];
  if (fallen) {
    takeFromDroppedItem(fallen.id, fallen.item.qty);
    const fresh = getSheetById(sheet.id) ?? sheet;
    const hold = holdIfFree(addRowMath(fresh.equipment, handedOverRow(fallen.item, fallen.item.qty)), fallen.item.name);
    saveEquipment(campaign, ctx.turn, fresh, hold.equipment, "pick_up_item", { name: fallen.item.name, taken: fallen.item.qty }, `${ctx.spend.name}: ${fallen.item.name} never left the hand`);
    publishBattleMapUpdate(campaign.id);
    lines.push(`${ctx.spend.name}: ${fallen.item.name} snaps back on its line${hold.held ? ` into ${sheet.name}'s hand` : `; ${sheet.name}'s hands are full, so it hangs at the belt`}, at no cost of the turn.`);
  }
  if (marked.length) {
    const fresh = getSheetById(sheet.id) ?? sheet;
    const left = removeConditions(fresh.conditions, fresh.conditionMeta, marked);
    const updated = patchSheet(fresh.id, { conditions: left.conditions, conditionMeta: left.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    lines.push(`${ctx.spend.name}: ${sheet.name} is no longer disarmed.`);
  }
  return { result: { applied: lines } };
}
