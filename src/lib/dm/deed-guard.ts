// A deed one character does with no fight on: a word with someone, a chase's
// exchange, a swing at a door, a lift, a stow in the party stash, a day's
// work, a check the GM asks for. The character has to be able to act, as
// canAct says for a fight: the dead do nothing, and SRD 5.1 says of the
// unconscious and the petrified that the creature "is incapacitated (see the
// condition), can't move or speak, and is unaware of its surroundings".
//
// Before this, use_item, use_resource, cast_buff, heal, haggle and stabilize
// each asked canAct, and the rest asked nothing or only whether the character
// was dead: a dead hero persuaded the fence and won a chase's exchange
// (findings of the 2026-11-09 gap sweep, doors-13 and doors-14). Every door the GM's calls
// come through asks here first (invoke-dispatch.ts for the console and
// connected agents, turn.ts for the AI's own calls): a new deed tool is one
// line in DEEDS. In a fight the fight's own gates decide.
//
// A trade is not among them: the GM settles a fallen friend's purchases and
// sales for whoever holds the purse, a ruling held at both doors by
// scripts/test-enforce-sweep-doors-block-quiet.mjs. A dead hero's dagger sold
// at the GM's word is that ruling at work, not a defect.

import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { canAct } from "@/lib/dm/can-act";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Args = Record<string, unknown>;

// The tool, the field naming who does the deed, and which of its calls are
// deeds at all (a saving throw is still made at 0 hit points).
const DEEDS: Record<string, { field: string; when?: (args: Args) => boolean }> = {
  social_check: { field: "characterId" },
  scene_check: { field: "characterId" },
  damage_object: { field: "characterId" },
  lift: { field: "characterId" },
  // Not a purchase: the GM settles a fallen friend's purchase and sale
  // through the engine (scripts/test-enforce-break-and-counter.mjs), so a
  // trade at a shop is the GM's to rule on for whoever holds the purse.
  party_stash: { field: "characterId", when: (args) => args.do === "stow" },
  mount_up: { field: "characterId" },
  request_roll: { field: "characterId", when: (args) => args.kind === "skill_check" || args.kind === "ability_check" },
  handle_item: { field: "characterId", when: (args) => args.action === "hand" || args.action === "drop" },
  downtime: { field: "characterId" },
};

export const DEED_TOOLS: readonly string[] = Object.keys(DEEDS);

function argsOf(raw: string): Args | null {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Args) : null;
  } catch {
    return null;
  }
}

// The refusal for a deed the character cannot do now, or null to let the
// handler run (and answer an unknown character itself).
export function deedRefusal(
  campaignId: string,
  name: string,
  rawArguments: string,
  sheets: readonly CharacterSheet[],
  sheetsById: ReadonlyMap<string, CharacterSheet>,
): ToolResult | null {
  const deed = DEEDS[name];
  const args = deed ? argsOf(rawArguments) : null;
  const ref = args?.[deed?.field ?? ""];
  if (!deed || !args || typeof ref !== "string" || (deed.when && !deed.when(args)) || getActiveEncounter(campaignId)) {
    return null;
  }
  const stale = resolveSheetRef(ref, sheets as CharacterSheet[], sheetsById as Map<string, CharacterSheet>);
  const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
  if (!sheet) {
    return null;
  }
  const able = canAct({ sheet, encounter: null, kind: "action" });
  return able.ok ? null : toolError(able);
}
