// SRD 5.1, Unconscious: "The creature drops whatever it's holding." A hero
// knocked out (to 0 hit points, by Sleep, a drow's poison, any door that
// lays the condition) kept sword and shield in hand: the Hand and GAME STATE
// showed them held, the shield still counted in the armor class, and nothing
// lay on the board for an enemy to take. Now, in a fight, what is in hand
// lies in the creature's square (the ground of issue #424, gear-ground.ts),
// attuned as it was (fallen-gear-logic.ts); taking it back up is the free
// object interaction, or the Use an Object action once that is spent
// (handle_item pick_up, the Hand's Pick up card); and whatever still lies
// there when the fight ends goes back into its owner's pack. Outside a fight,
// or with no square to lie in, it leaves the hands and stays in the pack.
//
// A creature holds only what the engine knows it took up (an enemy's
// handle_item pick_up); that falls with it. Its stat block's weapons are no
// inventory, and none is made up for it.
import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { insertDroppedItem, listDroppedItems, moveDroppedItem, takeFromDroppedItem, type DroppedItem } from "@/lib/db/dropped-items";
import { onFallUnconscious } from "@/lib/db/incapacity-watch";
import { placeName, standing } from "@/lib/dm/gear-ground";
import { saveEquipment } from "@/lib/dm/gear-store";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { addRowMath } from "@/lib/dm/mutation-math";
import { backInThePack, emptyHands, lettingGo } from "@/lib/dm/fallen-gear-logic";

onFallUnconscious((fall) => (fall.kind === "sheet" ? sheetLetsGo(fall.campaignId, fall.id) : creatureLetsGo(fall.id)));

function sheetLetsGo(campaignId: string, sheetId: string) {
  const campaign = getCampaignById(campaignId);
  const sheet = getSheetById(sheetId);
  if (!campaign || !sheet || sheet.deathSaves?.dead) {
    return;
  }
  const { map, token } = getActiveEncounter(campaignId) ? standing(campaignId, sheetId) : { map: null, token: null };
  if (!map || !token) {
    const packed = emptyHands(sheet.equipment);
    if (packed) {
      saveEquipment(campaign, null, sheet, packed, "drop_item", { name: heldNames(sheet.equipment, packed) }, `${sheet.name} lets go as they fall unconscious`);
    }
    return;
  }
  const out = lettingGo(sheet.equipment);
  if (!out) {
    return;
  }
  for (const row of out.fallen) {
    insertDroppedItem({ campaignId, mapId: map.id, x: token.x, y: token.y, place: placeName(campaignId), item: row, droppedBy: sheet.name, ownerId: sheet.id });
  }
  const names = out.fallen.map((row) => row.name).join(" and ");
  saveEquipment(campaign, null, sheet, out.equipment, "drop_item", { name: names }, `${sheet.name} drops ${names} as they fall unconscious`);
  publishBattleMapUpdate(campaignId);
}

// The names of the rows the hands held before and no longer hold.
function heldNames(before: readonly { name: string; equipped?: boolean }[], after: readonly { name: string; equipped?: boolean }[]): string {
  return before
    .filter((item, at) => item.equipped === true && after[at]?.equipped !== true)
    .map((item) => item.name)
    .join(" and ");
}

function creatureLetsGo(enemyId: string) {
  const enemy = getEnemy(enemyId);
  if (!enemy || enemy.status !== "alive") {
    return;
  }
  const held = listDroppedItems(enemy.campaignId).filter((entry) => entry.heldByEnemy === enemyId);
  if (!held.length) {
    return;
  }
  const { map, token } = standing(enemy.campaignId, enemyId);
  for (const entry of held) {
    moveDroppedItem(entry.id, { mapId: map && token ? map.id : null, x: token?.x ?? null, y: token?.y ?? null, heldByEnemy: null });
  }
  publishBattleMapUpdate(enemy.campaignId);
}

// The fight ends (enemy-damage.ts settleFightState, before the ground is
// settled): each row a fall let go of that still lies on the ground goes back
// into its owner's pack, attuned as it was. One an enemy took up stays with
// it (or with its body), as anything else an enemy holds does. Returns the
// lines the GM is told.
export function gatherFallenGear(campaign: Campaign): string[] {
  const owed = new Map<string, DroppedItem[]>();
  for (const entry of listDroppedItems(campaign.id)) {
    if (entry.ownerId && !entry.heldByEnemy) {
      owed.set(entry.ownerId, [...(owed.get(entry.ownerId) ?? []), entry]);
    }
  }
  const lines: string[] = [];
  for (const [ownerId, entries] of owed) {
    const sheet = getSheetById(ownerId);
    if (!sheet) {
      continue;
    }
    let equipment = sheet.equipment;
    for (const entry of entries) {
      takeFromDroppedItem(entry.id, entry.item.qty);
      equipment = addRowMath(equipment, backInThePack(entry.item));
    }
    const names = entries.map((entry) => entry.item.name).join(" and ");
    saveEquipment(campaign, null, sheet, equipment, "pick_up_item", { name: names }, `${names} gathered up after the fight`);
    lines.push(`${names} back in ${sheet.name}'s pack`);
  }
  return lines;
}
