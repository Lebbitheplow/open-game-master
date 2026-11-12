// A Phantom rogue's soul trinkets (wave 2, part mr). "A reaction forms a Tiny
// soul trinket in your free hand (you can hold up to your proficiency bonus
// of them)"; one is destroyed to use Wails from the Grave without spending a
// use, to ask its spirit a question, or to walk as a ghost once the free use
// is gone; and Death's Friend leaves one in hand at a long rest's end when
// none is carried. Before this the trinket was one condition with no count,
// nothing spent it and nothing gave it at a rest.
//
// The trinkets are the "soul trinket" condition, its count in its name once
// there is more than one ("soul trinket (2)"), so the gate that reads the
// condition (Tokens of the Departed's advantage) holds for any number.
// Everything that gives or takes a trinket goes through here.

import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { holdsRow } from "@/lib/dm/mt-mr-turn";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { isConditionNamed } from "@/lib/srd/feature-names";

export const SOUL_TRINKET = "soul trinket";
// A day of rounds, as the reaction's row wrote it: the trinkets have no end
// of their own, and a condition with no duration is the GM's to clear.
const TRINKET_ROUNDS = 14400;

type Carried = Pick<CharacterSheet, "conditions" | "conditionMeta">;

const carriedName = (sheet: Carried) => sheet.conditions.find((entry) => isConditionNamed(entry, SOUL_TRINKET)) ?? null;

export function trinketCount(sheet: Carried): number {
  const name = carriedName(sheet);
  if (!name) {
    return 0;
  }
  const counted = /\((\d+)\)\s*$/.exec(name);
  return counted ? Math.max(1, Number(counted[1])) : 1;
}

// The conditions and meta with `count` trinkets carried.
export function withTrinkets(sheet: Carried, count: number): Carried {
  const old = carriedName(sheet);
  const meta = { ...(sheet.conditionMeta as Record<string, unknown>) };
  const kept = old ? meta[old] : undefined;
  if (old) {
    delete meta[old];
  }
  const conditions = sheet.conditions.filter((entry) => entry !== old);
  if (count <= 0) {
    return { conditions, conditionMeta: meta as CharacterSheet["conditionMeta"] };
  }
  const name = count === 1 ? SOUL_TRINKET : `${SOUL_TRINKET} (${count})`;
  return { conditions: [...conditions, name], conditionMeta: { ...meta, [name]: kept ?? { rounds: TRINKET_ROUNDS } } as CharacterSheet["conditionMeta"] };
}

function write(campaign: Pick<Campaign, "id">, sheet: CharacterSheet, count: number) {
  const updated = patchSheet(sheet.id, withTrinkets(sheet, count));
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// Tokens of the Departed's reaction: one more trinket, up to the proficiency
// bonus. At the limit it is refused, where it once rewrote the one condition.
export function gainTrinket(campaign: Pick<Campaign, "id">, stale: CharacterSheet): ToolError | { applied: string } {
  const sheet = getSheetById(stale.id) ?? stale;
  const cap = computeSheetDerived(sheet).proficiencyBonus;
  const held = trinketCount(sheet);
  if (held >= cap) {
    return { error: `${sheet.name} holds ${held} soul trinkets, as many as their proficiency bonus allows. Nothing was spent.`, refused: "rules" };
  }
  write(campaign, sheet, held + 1);
  return { applied: `${sheet.name} gains a soul trinket (${held + 1} of ${cap}).` };
}

// One trinket destroyed, on the freshest sheet. False when none is carried.
export function destroyTrinket(campaign: Pick<Campaign, "id">, sheetId: string): number | null {
  const sheet = getSheetById(sheetId);
  const held = sheet ? trinketCount(sheet) : 0;
  if (!sheet || held < 1) {
    return null;
  }
  write(campaign, sheet, held - 1);
  return held - 1;
}

// Death's Friend: "at the end of a long rest a soul trinket appears in your
// hand if you have none". Called by the long rest (rest-tools.ts).
export function soulTrinketAtRestEnd(campaign: Pick<Campaign, "id">, restedIds: string[]): void {
  for (const id of restedIds) {
    const sheet = getSheetById(id);
    if (sheet && !sheet.deathSaves?.dead && holdsRow(sheet, "rogue::Death's Friend") && trinketCount(sheet) === 0) {
      write(campaign, sheet, 1);
    }
  }
}
