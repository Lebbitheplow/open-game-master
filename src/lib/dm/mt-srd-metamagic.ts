// The Metamagic options a sorcerer pays for with use_resource (sorcery
// points, the option as the variant), carried from the spend to the spell
// they are cast on (SRD 5.1, sorcerer, Metamagic):
//
//   - "You can use only one Metamagic option on a spell when you cast it,
//     unless otherwise noted." A second option paid before the spell is cast
//     is refused, spending nothing; Empowered Spell is the one noted ("even
//     if you have already used a different Metamagic option").
//   - Heightened Spell: "give one target of the spell disadvantage on its
//     first saving throw made against the spell."
//   - Subtle Spell: "cast it without any somatic or verbal components."
//
// The option paid is a mark on the sorcerer (a condition named for it) that
// the next spell takes: the save of a spell cast at a creature reads
// Heightened Spell, the components of any cast read Subtle Spell, and a cast
// that goes through clears what was paid for it. A mark not used lapses
// with the round. Quickened Spell keeps its own engine (bonus-actions.ts)
// and is marked here only so the one-option rule sees it.

import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { optionsOfKind } from "@/lib/srd/options";

const PREFIX = "metamagic: ";
// Compared as keys: the mark as it is stored, and as textKey reads it.
const PREFIX_KEY = textKey(PREFIX);
const markOf = (option: string) => textKey(`${PREFIX}${option}`);
const isMark = (entry: string) => textKey(entry).startsWith(PREFIX_KEY);
const EMPOWERED = markOf("Empowered Spell");
const HEIGHTENED = markOf("Heightened Spell");
const SUBTLE = markOf("Subtle Spell");

type Marked = { conditions: readonly string[] };

function paid(sheet: Marked): string[] {
  return sheet.conditions.filter(isMark).map(textKey);
}

// Why this option cannot be added to the spell being cast, or null.
export function secondOptionProblem(sheet: Marked & { name: string }, option: string, ownRepeat = false): ToolError | null {
  const mark = markOf(option);
  const waiting = paid(sheet);
  // Quickened Spell's own engine answers a second Quickened Spell (`ownRepeat`).
  if (waiting.includes(mark)) {
    if (ownRepeat) {
      return null;
    }
    return { error: `${sheet.name} has already paid for ${option} and has not cast the spell yet. Cast it first. Nothing more was spent.`, retry: true };
  }
  const other = waiting.find((entry) => entry !== EMPOWERED);
  if (!other || mark === EMPOWERED) {
    return null;
  }
  return {
    error: `${sheet.name} has already paid for ${other.slice(PREFIX_KEY.length).trim()} on the spell they are casting, and a spell takes one Metamagic option (Empowered Spell alone goes with another). Cast the spell first. Nothing was spent.`,
    refused: "rules",
  };
}

function write(campaign: Pick<Campaign, "id">, sheetId: string, change: (conditions: string[]) => string[], add?: string) {
  const fresh = getSheetById(sheetId);
  if (!fresh) {
    return;
  }
  const conditions = change(fresh.conditions);
  const meta = { ...(fresh.conditionMeta as ConditionMetaMap) };
  for (const key of Object.keys(meta)) {
    if (isMark(key) && !conditions.some((entry) => textKey(entry) === textKey(key))) {
      delete meta[key];
    }
  }
  if (add) {
    meta[add] = { rounds: 1 };
  }
  const updated = patchSheet(sheetId, { conditions, conditionMeta: meta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// The option is paid: the next spell takes it.
export function markMetamagic(campaign: Pick<Campaign, "id">, sheetId: string, option: string) {
  const mark = `${PREFIX}${option.toLowerCase()}`;
  write(campaign, sheetId, (conditions) => [...conditions.filter((entry) => textKey(entry) !== textKey(mark)), mark], mark);
}

// After a spend went through: a variant that names a Metamagic option is
// marked, any other variant is not one.
export function markPaidOption(campaign: Pick<Campaign, "id">, sheetId: string, variant: string | undefined) {
  const option = variant?.trim() ? optionsOfKind("metamagic").find((entry) => textKey(entry.n) === textKey(variant)) : undefined;
  if (option) {
    markMetamagic(campaign, sheetId, option.n);
  }
}

// Subtle Spell on the spell being cast: no words, no gestures.
export function subtleSpellPaid(sheet: Marked): boolean {
  return paid(sheet).includes(SUBTLE);
}

// Heightened Spell for the save a spell cast at one creature asks: the
// option on the roll, taken off the sorcerer as it is used.
export function heightenedSave(campaign: Pick<Campaign, "id">, casterId: string): { disadvantage?: true } {
  const sheet = getSheetById(casterId);
  if (!sheet || !paid(sheet).includes(HEIGHTENED)) {
    return {};
  }
  write(campaign, casterId, (conditions) => conditions.filter((entry) => textKey(entry) !== HEIGHTENED));
  return { disadvantage: true };
}

// A spell was cast: what was paid for it is used, but for Heightened Spell,
// which the spell's first save takes.
export function clearCastMarks(campaign: Pick<Campaign, "id">, casterId: string) {
  const sheet = getSheetById(casterId);
  if (!sheet || !paid(sheet).some((entry) => entry !== HEIGHTENED)) {
    return;
  }
  write(campaign, casterId, (conditions) => conditions.filter((entry) => !isMark(entry) || textKey(entry) === HEIGHTENED));
}
