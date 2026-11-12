// Arcane Deflection's price (wizard, War Magic 2): "at the cost of casting
// only cantrips on your next turn" (src/lib/srd/subclasses.json,
// wizard::Arcane Deflection). The rule it condenses: once the reaction is
// used, the wizard casts no spell but a cantrip until the end of their next
// turn.
//
// The reaction leaves a mark on the wizard (src/lib/dm/ar-ws-deflection.ts
// lays it, to the end of their next turn), and this module says what the mark
// refuses. Asked by the one cast door (src/lib/dm/cast-guard.ts castSpell)
// before anything is spent, and by the Hand's spell, reaction-spell and
// summoning cards, so a card is shut exactly when the door would refuse it.
//
// Rulings. The mark stops a new casting: a spell from a slot, from sorcery
// points, a free cast, a ritual, a reaction spell (Shield, Counterspell). It
// does not stop what is no new casting of the wizard's own: the later rays of
// a spell already cast this turn, a held spell's repeated effect (Call
// Lightning's bolt), a readied spell's release, and a spell an item casts,
// whose charge use_item has already taken when the door hears of it.
//
// The reaction's other half answers a save just failed (ar-ws-deflection.ts),
// and is judged as the wizard stood before that failure: beforeFailedSave
// takes off the conditions the failure laid which that same save ends, so a
// wizard a failed save has just paralyzed may still turn it, as Shield is
// judged before the hit that dropped its caster. The engine's reaction gate
// and the Hand's card both ask it.
//
// Pure: no database, so the Hand imports it.
import { isConditionNamed } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";

// The mark's condition, as the sheet shows it.
export const DEFLECTED = "arcane deflection";

type Caster = Pick<CharacterSheet, "name" | "conditions" | "spellcasting">;

export function casterDeflected(sheet: Pick<CharacterSheet, "conditions">): boolean {
  return sheet.conditions.some((entry) => isConditionNamed(entry, DEFLECTED));
}

// The refusal of a spell that is not a cantrip while the mark holds, or null.
// `level` is the spell's own level when the content knows it; a spell nobody
// published is a cantrip when the sheet lists it among its cantrips.
export function deflectionCastProblem(sheet: Caster, spell: string, level: number | null | undefined): ToolError | null {
  if (!casterDeflected(sheet)) {
    return null;
  }
  const listed = [sheet.spellcasting, ...(sheet.spellcasting?.casters ?? [])].some((entry) =>
    (entry?.cantrips ?? []).some((name) => textKey(name) === textKey(spell)),
  );
  if (level === 0 || (level === null || level === undefined ? listed : false)) {
    return null;
  }
  return {
    error: `${sheet.name} used Arcane Deflection and casts only cantrips until the end of their next turn, so ${spell} is not cast. Nothing was spent.`,
    refused: "rules",
  };
}

// The sheet as it stood before a save was failed: without the conditions that
// save ends (its ability, and its DC where the record kept one).
export function beforeFailedSave<T extends Pick<CharacterSheet, "conditions" | "conditionMeta">>(sheet: T, ability: string, dc: number | null | undefined): T {
  const meta = (sheet.conditionMeta ?? {}) as Record<string, { saveEnds?: { ability: string; dc: number } } | undefined>;
  const laid = (entry: string) => {
    const ends = meta[entry]?.saveEnds;
    return Boolean(ends) && ends!.ability === ability && (dc === null || dc === undefined || ends!.dc === dc);
  };
  return sheet.conditions.some(laid) ? { ...sheet, conditions: sheet.conditions.filter((entry) => !laid(entry)) } : sheet;
}
