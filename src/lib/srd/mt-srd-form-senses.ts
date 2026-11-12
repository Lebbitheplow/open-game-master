// The senses of the form a character wears (SRD 5.1, Wild Shape): "you can't
// use any of your special senses, such as darkvision, unless your new form
// also has that sense." A druid as a wolf sees as a wolf does, a dwarf druid
// as a giant bat keeps no darkvision and perceives by the bat's blindsight.
//
// A worn form carries the senses its stat block lists (beast-forms.ts
// wildShapeRecord); a form recorded before they were kept reads as having
// none. Every reader of a character's senses asks formSenses first: the
// attack's sight (dm/attack-light.ts characterSenses) and the board's fog of
// war (battlemap/view.ts sheetSenses, sheetDarkvisionTiles).
//
// Pure.

import type { CharacterSheet } from "@/lib/schemas/sheet";
import { sensesFromBlock, type Senses } from "@/lib/srd/senses";

// The form's senses in tiles, or null for a character in their own body.
export function formSenses(sheet: { wildShape?: CharacterSheet["wildShape"] }): Senses | null {
  return sheet.wildShape ? sensesFromBlock(sheet.wildShape.senses) : null;
}
