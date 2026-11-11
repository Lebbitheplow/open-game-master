// Transmuter's Stone (School of Transmutation 6): "Craft a stone granting one
// of darkvision, 10 feet of speed, proficiency in Constitution saves, or
// resistance to an element, changeable when you cast a transmutation spell."
//
// Before this module the stone's choice was a spend held to "outside a
// fight" that asked for no spell: out of a fight the benefit changed at will,
// and in one it could not change even on a transmutation spell. Looser and
// stricter than the text at once.
//
// Ruling (the maintainer's delegate, round 5 of the arcane repair): the
// stone's first benefit is chosen freely out of a fight (the stone is made
// over time). CHANGING it needs a transmutation spell of 1st level or higher
// just cast by the holder, in a fight or out, which opens one change; without
// one the change is refused with nothing spent.
//
// How it is kept: a casting that qualifies leaves a mark on its caster
// (STONE_CHANGE), laid after the casting's own time has gone by; the change
// spends the mark. The mark lasts to the end of the caster's turn in a fight,
// and out of one until time passes (the clock ends turn-bound marks,
// condition-tick.ts), which is what "just cast" comes to. A cantrip opens
// nothing, nor does a spell of another school.
//
// Called by cast-guard.ts castSpell (openStoneChange, once a casting is paid
// and timed), authored-spends.ts (choiceChange, beside the fight gate and
// before anything is spent) and authored-spend-effects.ts (changeSpent, with
// the choice). The rule is read from the row (choose.changeAfterCast), so
// another choice that changes on a casting needs the field and nothing here.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { ownTurnOf } from "@/lib/dm/held-turn";
import type { ToolError } from "@/lib/dm/tool-errors";
import { publishPersisted } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { heldAuthored, type AuthoredSpend, type HeldAuthored } from "@/lib/srd/authored-effects";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { isConditionNamed } from "@/lib/srd/feature-names";

export const STONE_CHANGE = "stone change ready";

type Choose = Extract<SpendDoes, { kind: "choose" }>;

const ruleOf = (does: SpendDoes): NonNullable<Choose["changeAfterCast"]> | null => (does.kind === "choose" ? (does.changeAfterCast ?? null) : null);
const marked = (sheet: Pick<CharacterSheet, "conditions">) => sheet.conditions.some((entry) => isConditionNamed(entry, STONE_CHANGE));

// A casting by this character is paid and done: when they hold a choice that
// changes on a spell of this school and level, and have made it, one change
// opens. Returns the line for the cast's result, or null.
export function openStoneChange(campaign: Campaign, casterId: string, spell: { school: string | null; level: number }): string | null {
  const sheet = getSheetById(casterId);
  if (!sheet) {
    return null;
  }
  const school = textKey(spell.school ?? "");
  const opened = heldAuthored(sheet).find((held) =>
    Boolean(held.choice) &&
    (held.entry.spends ?? []).some((spend) => {
      const rule = ruleOf(spend.does);
      return Boolean(rule && textKey(rule.school) === school && spell.level >= rule.minLevel);
    }),
  );
  if (!opened) {
    return null;
  }
  const conditions = marked(sheet) ? sheet.conditions : [...sheet.conditions, STONE_CHANGE];
  // Cast on their own turn, the opening ends with that turn; cast off it (a
  // reaction's Feather Fall), with their next one (turn-end.ts).
  const encounter = getActiveEncounter(campaign.id);
  const waits = Boolean(encounter) && !ownTurnOf(encounter, sheet.id);
  const updated = patchSheet(sheet.id, {
    conditions,
    conditionMeta: { ...(sheet.conditionMeta as ConditionMetaMap), [STONE_CHANGE]: { source: sheet.id, untilTurnEndOf: sheet.id, ...(waits ? {} : { turnBegun: true }) } },
  });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return `${opened.feature}: ${sheet.name} may change its benefit now (it is ${opened.choice}): use_resource "${opened.feature}" with the new one in variant, before their turn ends.`;
}

// A choice asked of this spend: null when it is no change (the spend carries
// no rule, nothing is chosen yet, or the option named is the one held), which
// leaves the spend's own rules to decide; `open` when a casting has opened
// the change, in a fight too; the refusal when none has.
export function choiceChange(sheet: CharacterSheet, spend: AuthoredSpend, held: Pick<HeldAuthored, "choice" | "feature">, variant: string | undefined): { open: true } | ToolError | null {
  const rule = ruleOf(spend.does);
  if (!rule || !held.choice || textKey(variant ?? "") === textKey(held.choice)) {
    return null;
  }
  if (marked(sheet)) {
    return { open: true };
  }
  return {
    error: `${sheet.name}'s ${held.feature} is ${held.choice}, and it changes only when they cast a ${rule.school} spell of level ${rule.minLevel} or higher: none was just cast. Cast one, then name the new benefit. Nothing was spent.`,
    refused: "rules",
  };
}

// The change is made: the opening is spent with it. What to add to the
// choice's patch (nothing for a first choice, which no casting opened).
export function changeSpent(sheet: CharacterSheet, does: SpendDoes): { conditions?: string[]; conditionMeta?: CharacterSheet["conditionMeta"] } {
  if (!ruleOf(does) || !marked(sheet)) {
    return {};
  }
  const meta = { ...(sheet.conditionMeta as ConditionMetaMap) };
  for (const name of sheet.conditions.filter((entry) => isConditionNamed(entry, STONE_CHANGE))) {
    delete meta[name];
  }
  return { conditions: sheet.conditions.filter((entry) => !isConditionNamed(entry, STONE_CHANGE)), conditionMeta: meta as CharacterSheet["conditionMeta"] };
}
