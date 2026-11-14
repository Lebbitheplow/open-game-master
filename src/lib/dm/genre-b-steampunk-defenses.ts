// What the acting caster's features make of a creature's immunity to one type
// of their damage (WAVE2 D5: the genre text is the rule, played on the SRD 5.1
// engine):
//
//   Universal Solvent (alchemist 14)        "Your acid formulae treat immunity
//                                            as resistance"
//   Heart of the Storm (aether channeler 14) "Your lightning arts ignore
//                                            resistance and treat immunity as
//                                            resistance"
//
// Each is a `soften_immune` row (src/lib/srd/authored-effects-genre-b-steampunk.ts);
// Heart of the Storm's "ignore resistance" is its `ignore_resist` row, which
// src/lib/dm/authored-saves.ts authoredIgnoresResistance already reads. A
// formula or an art is the class's spell, so only a spell's damage is softened.
// src/lib/dm/enemy-defenses.ts enemyDefenseLines asks here once per type, after
// any resistance has been set aside: the immunity moves to the resistance line,
// so a creature immune to acid takes half of an alchemist's acid formula, and
// a resistance to lightning the art ignores is not given back by an immunity.
//
// Before this both features were their sentence in the GM's prompt (and Heart
// of the Storm answered as the Storm Sorcery feature of the same name, giving
// the channeler a resistance its text does not).
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { actingSheetId } from "@/lib/dm/authored-saves";
import { activeAuthored } from "@/lib/srd/authored-effects";

// The feature that turns the acting character's immunity-blocked damage of
// this type into resisted damage, or null.
export function authoredSoftensImmunity(campaignId: string, damageType: string | undefined, spell: boolean): string | null {
  const type = (damageType ?? "").trim().toLowerCase();
  if (!type) {
    return null;
  }
  const actorId = actingSheetId(getActiveEncounter(campaignId));
  const actor = actorId ? getSheetById(actorId) : null;
  if (!actor) {
    return null;
  }
  const held = activeAuthored(actor, "soften_immune").find(({ effect }) => effect.types.includes(type) && (!effect.spells || spell));
  return held ? held.held.feature : null;
}

// The lines with the type's immunity read as a resistance. Only the type's own
// word leaves the immunity line; the rest of it stands.
export function softenedLines(lines: { resist: string; immune: string }, type: string): { resist: string; immune: string } {
  const word = new RegExp(`\\b${type}\\b`, "i");
  if (!lines.immune.split(";").some((clause) => word.test(clause))) {
    return lines;
  }
  return {
    immune: lines.immune.replace(new RegExp(`\\b${type}\\b`, "gi"), ""),
    resist: `${lines.resist}; ${type}`,
  };
}
