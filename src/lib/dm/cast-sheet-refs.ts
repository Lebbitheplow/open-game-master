// The item tools reach a first-tier NPC's cast sheet (src/lib/db/cast-sheets.ts,
// docs/specs/ogm-npc-cast-sheet.md): grant_item, remove_item, use_item and
// handle_item find a sheet by the NPC's name, alias or sheet id as well as
// among the heroes and companions, so "Volodar hands Brakk the key" is one
// handle_item hand and the server moves it. Every other tool still sees the
// heroes and companions only: no heal, spell or attack lands on a cast sheet.

import { listNpcs, type Npc } from "@/lib/db/npcs";
import { getNpcAway, getNpcTier } from "@/lib/db/npc-minds";
import { getCurrentLocation } from "@/lib/db/locations";
import { castSheetFor, npcThings } from "@/lib/db/cast-sheets";
import { getCampaignById } from "@/lib/db/campaigns";
import { thingNamed } from "@/lib/dm/npc-stage-logic";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { withoutLeadingStopWords } from "@/lib/language/language";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const CAST_ITEM_TOOLS = new Set(["grant_item", "remove_item", "use_item", "handle_item"]);

const REF_FIELDS = ["characterId", "toCharacterId"] as const;

function castNpcNamed(campaignId: string, ref: string): Npc | null {
  const key = textKey(ref);
  if (!key) {
    return null;
  }
  return (
    listNpcs(campaignId).find(
      (npc) =>
        !npc.archived &&
        !npc.companionSheetId &&
        npc.state.condition !== "dead" &&
        getNpcTier(npc.id) === "primary" &&
        (npc.id === ref || npc.castSheetId === ref || [npc.name, ...npc.aliases].some((name) => textKey(name) === key)),
    ) ?? null
  );
}

// The sheets an item call may name: the table's, and the cast sheet of any
// first-tier NPC its characterId or toCharacterId names (made now if it has
// none). Unchanged for every other tool or when nothing names an NPC.
export function withCastSheets<T extends { campaign: { id: string }; sheets: CharacterSheet[]; sheetsById: Map<string, CharacterSheet> }>(
  context: T,
  toolName: string,
  rawArguments: string,
): T {
  if (!CAST_ITEM_TOOLS.has(toolName)) {
    return context;
  }
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return context;
  }
  if (!args || typeof args !== "object") {
    return context;
  }
  const added: CharacterSheet[] = [];
  for (const field of REF_FIELDS) {
    const ref = typeof args[field] === "string" ? String(args[field]).trim() : "";
    if (!ref || context.sheetsById.has(ref) || context.sheets.some((sheet) => textKey(sheet.name) === textKey(ref))) {
      continue;
    }
    const npc = castNpcNamed(context.campaign.id, ref);
    if (!npc) {
      continue;
    }
    const sheet = castSheetFor(npc);
    added.push(sheet);
    // The model may name them by an alias: that word finds the sheet too.
    context = { ...context, sheetsById: new Map([...context.sheetsById, [ref, sheet]]) };
  }
  if (!added.length) {
    return context;
  }
  const sheets = [...context.sheets, ...added.filter((sheet) => !context.sheets.some((entry) => entry.id === sheet.id))];
  return { ...context, sheets, sheetsById: new Map([...context.sheetsById, ...sheets.map((sheet) => [sheet.id, sheet] as const)]) };
}

// A thing a first-tier character holds does not appear on a hero's sheet out
// of nothing: taken or received from them, it moves with handle_item hand,
// or the table holds two of it (the Zattera, 2026-11-16: Brakk wrested the
// compass from Kranz, grant_item put one on Brakk and Kranz kept his).
export function heldByCastRefusal(campaignId: string, toolName: string, rawArguments: string, sheetsById: Map<string, CharacterSheet>): ToolResult | null {
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
  if (!target || target.userId.startsWith("cast_")) {
    return null;
  }
  const items = [args.item, ...(Array.isArray(args.items) ? args.items.map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>).item : entry)) : [])].filter(
    (item): item is string => typeof item === "string" && Boolean(item.trim()),
  );
  if (!items.length) {
    return null;
  }
  const language = getCampaignById(campaignId)?.gameSettings.tableLanguage ?? "english";
  const keyOf = (thing: string) => withoutLeadingStopWords(textKey(thing), language);
  // Only those in the scene: a rope bought in town is not the one a sailor
  // three islands away keeps.
  const here = getCurrentLocation(campaignId)?.name ?? "";
  for (const npc of listNpcs(campaignId)) {
    if (npc.archived || npc.companionSheetId || getNpcTier(npc.id) !== "primary" || getNpcAway(npc.id) || !(npc.state.withParty || (here && npc.location === here))) {
      continue;
    }
    const things = npcThings(npc).map((thing) => thing.replace(/ x\d+$/, ""));
    for (const item of items) {
      const line = thingNamed(things, item, keyOf);
      if (line) {
        return {
          error: `${npc.name} has "${line}". If ${target.name} took it or got it from ${npc.name}, it moves, it is not made: send handle_item with action "hand", characterId "${npc.name}", item "${line}", toCharacterId "${target.name}". If it is another one of ${target.name}'s own, grant it under a name that tells it apart.`,
          retry: true,
        };
      }
    }
  }
  return null;
}
