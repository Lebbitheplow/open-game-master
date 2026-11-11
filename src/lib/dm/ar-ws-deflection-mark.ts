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
