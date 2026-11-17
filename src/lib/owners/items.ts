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
import { getCampaignById } from "@/lib/db/campaigns";
import { npcThings } from "@/lib/db/cast-sheets";
import { getCurrentLocation } from "@/lib/db/locations";
import { getNpcAway, getNpcTier } from "@/lib/db/npc-minds";
import { listNpcs } from "@/lib/db/npcs";
import { ownerWrite, splitOwnedFields } from "@/lib/db/owner-gate";
import { insertSheetAudit, listAuditForTurn } from "@/lib/db/sheet-audit";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import { holdIfFree } from "@/lib/dm/gear-hands";
import { addRowMath, handedOverRow, removeItemMath } from "@/lib/dm/mutation-math";
import { thingNamed } from "@/lib/dm/npc-stage-logic";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { withoutLeadingStopWords } from "@/lib/language/language";
import type { CharacterSheet, EquipmentItem, FullPatchSheetInput } from "@/lib/schemas/sheet";

// The fields this owner writes, and nothing else: a caller whose change also
// touches hit points, conditions or resources writes those itself
// (src/lib/db/owner-gate.ts splitItemFields) and only the things here.
export type ItemFields = Pick<FullPatchSheetInput, "equipment" | "gold" | "copper">;

// The write itself.
export function writeItems(
  sheetId: string,
  patch: ItemFields,
  options: { restoring?: boolean; guessing?: boolean } = {},
): CharacterSheet | null {
  const { owned, rest } = splitOwnedFields("items", patch as Record<string, unknown>);
  const strays = Object.keys(rest);
  if (strays.length > 0) {
    // Not a thing: its writer belongs elsewhere (src/lib/dm/sheet-patch.ts).
    throw new Error(`writeItems writes equipment, gold and copper only, not ${strays.join(", ")}`);
  }
  return ownerWrite("items", () => patchSheet(sheetId, owned, options));
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

// A thing a first-tier character in the scene holds does not appear on a
// hero's sheet out of nothing: taken or received from them, it moves (give),
// or the table holds two of it (the Zattera, 2026-11-16: Brakk wrested the
// compass from Kranz, grant_item put one on Brakk and Kranz kept his). Only
// those in the scene count: a rope bought in town is not the one a sailor
// three islands away keeps.
export function heldInScene(campaignId: string, target: CharacterSheet, things: readonly string[]): ToolResult | null {
  if (target.userId.startsWith("cast_") || things.length === 0) {
    return null;
  }
  const language = getCampaignById(campaignId)?.gameSettings.tableLanguage ?? "english";
  const keyOf = (thing: string) => withoutLeadingStopWords(textKey(thing), language);
  const here = getCurrentLocation(campaignId)?.name ?? "";
  for (const npc of listNpcs(campaignId)) {
    if (npc.archived || npc.companionSheetId || getNpcTier(npc.id) !== "primary" || getNpcAway(npc.id) || !(npc.state.withParty || (here && npc.location === here))) {
      continue;
    }
    const held = npcThings(npc).map((thing) => thing.replace(/ x\d+$/, ""));
    for (const thing of things) {
      const line = thingNamed(held, thing, keyOf);
      if (line) {
        return {
          error: `${npc.name} has "${line}". If ${target.name} took it or got it from ${npc.name}, it moves, it is not made: at a staged table narrate it plainly and it is recorded from your words when the turn ends; elsewhere send handle_item with action "hand", characterId "${npc.name}", item "${line}", toCharacterId "${target.name}". If it is another one of ${target.name}'s own, grant it under a name that tells it apart.`,
          retry: true,
        };
      }
    }
  }
  return null;
}

// The same rule asked before a grant_item call is run or offered to a player
// (src/lib/dm/turn.ts, src/lib/dm/invoke-dispatch.ts), so nothing is proposed
// that the write would refuse.
export function grantRefusal(campaignId: string, toolName: string, rawArguments: string, sheetsById: Map<string, CharacterSheet>): ToolResult | null {
  if (toolName !== "grant_item") {
    return null;
  }
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return null;
  }
  const target = typeof args.characterId === "string" ? sheetsById.get(args.characterId) : undefined;
  if (!target) {
    return null;
  }
  const things = [args.item, ...(Array.isArray(args.items) ? args.items.map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>).item : entry)) : [])].filter(
    (item): item is string => typeof item === "string" && Boolean(item.trim()),
  );
  return heldInScene(campaignId, target, things);
}

// A new thing on a sheet, made rather than moved: refused while someone in
// the scene holds it.
export function grant(campaignId: string, sheet: CharacterSheet, thing: string, equipment: EquipmentItem[]): ToolResult | null {
  const held = heldInScene(campaignId, sheet, [thing]);
  if (held) {
    return held;
  }
  writeItems(sheet.id, { equipment });
  return null;
}
