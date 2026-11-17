// The item tools reach a first-tier NPC's cast sheet (src/lib/db/cast-sheets.ts,
// docs/specs/ogm-npc-cast-sheet.md): grant_item, remove_item, use_item and
// handle_item find a sheet by the NPC's name, alias or sheet id as well as
// among the heroes and companions, so "Volodar hands Brakk the key" is one
// handle_item hand and the server moves it. Every other tool still sees the
// heroes and companions only: no heal, spell or attack lands on a cast sheet.

import { listNpcs, type Npc } from "@/lib/db/npcs";
import { getNpcTier } from "@/lib/db/npc-minds";
import { castSheetFor } from "@/lib/db/cast-sheets";
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
