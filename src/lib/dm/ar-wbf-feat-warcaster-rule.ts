// War Caster's choice of spell as a sheet carries it, and the rule a spell
// must meet to be cast as an opportunity attack: pure, so the Hand's War
// Caster card (src/lib/battlemap/hand-feature-doors.ts) offers only the
// spells the door (ar-wbf-feat-warcaster.ts) would take. The cast guard's
// half, which needs the server's async context, is ar-wbf-feat-warcaster-logic.ts.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeat } from "@/lib/srd/feat-use";
import type { SpellMech } from "@/lib/srd/spell-mech-types";

const MARK = /^opportunity spell \((.+)\)$/i;

export const opportunityMark = (spell: string) => `opportunity spell (${spell.trim()})`;
export const isOpportunityMark = (condition: string) => MARK.test(condition.trim());

// The spell a War Caster's opportunity attacks cast, or null for the weapon.
export function opportunitySpellOf(sheet: Pick<CharacterSheet, "feats" | "conditions">): string | null {
  if (!holdsFeat(sheet, "War Caster")) {
    return null;
  }
  for (const entry of sheet.conditions) {
    const hit = MARK.exec(entry.trim());
    if (hit) {
      return hit[1];
    }
  }
  return null;
}

// "The spell must have a casting time of 1 action and must target only that
// creature": a spell attack, a save one creature makes, or one that strikes
// with no roll, and nothing with an area. The sentence that refuses, or null.
export function opportunitySpellProblem(name: string, castingTime: unknown, mech: Pick<SpellMech, "resolution" | "area"> | null): string | null {
  if (castingTime !== "action") {
    return `${name} does not have a casting time of 1 action, and War Caster's spell must.`;
  }
  if (!mech || mech.area || !(mech.resolution === "attack" || mech.resolution === "save" || mech.resolution === "auto")) {
    return `${name} is not a spell aimed at one creature alone (a spell attack, or a save that one creature makes), and War Caster's spell must target only the creature that provoked.`;
  }
  return null;
}
