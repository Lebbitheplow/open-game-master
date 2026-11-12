// Master Scrivener (Order of Scribes 10): "After a long rest you can create a
// magic scroll of a 1st- or 2nd-level wizard spell from your book with a
// casting time of an action; it is cast as if one level higher, and it
// vanishes once cast or when you finish a long rest."
//
// Before this the counter was guidance: the use went and no scroll was made.
// Now use_resource "Master Scrivener" with the spell as its variant writes the
// scroll onto the wizard's pack: a spell scroll like any other (tags scroll,
// its spell on the row), so use_item reads it through the scroll door
// (src/lib/dm/consumables.ts) and the Hand deals its card (hand-items.ts).
// The row's mark (src/lib/srd/ar-ws-conjured.ts) is what makes that door cast
// it one level higher, with the Spell Scroll table's save DC and attack bonus
// for the level it is cast at (SRD 5.1, Spell Scroll), and what takes it away
// at its holder's long rest (rest-logic.ts longRestPatch). Reading it uses it
// up, as reading any scroll does.
//
// A spell that is not in the book (src/lib/srd/ar-ws-spellbook.ts), is not of
// 1st or 2nd level, or is not cast with an action, is refused before the use
// is spent. Written out of a fight: the row says fight "out".
//
// Called by authored-spend-effects.ts resolveSpendEffect (kind scribe_scroll).

import { spellFactsFor } from "@/lib/content";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { EquipmentItem, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { freeRowName, scrivenerScrollName, scrollCastLevel } from "@/lib/srd/ar-ws-conjured";
import { inBook } from "@/lib/srd/ar-ws-spellbook";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { scrollNumbers } from "@/lib/srd/scrolls";

export function scribeScroll(ctx: SpendContext, does: Extract<SpendDoes, { kind: "scribe_scroll" }>): ToolError | { patch: FullPatchSheetInput; result: Record<string, unknown> } {
  const { sheet, campaign } = ctx;
  const named = (ctx.args.variant ?? "").trim();
  const levels = `${does.minLevel === does.maxLevel ? `level ${does.minLevel}` : `level ${does.minLevel} to ${does.maxLevel}`}`;
  if (!named) {
    return { error: `${ctx.spend.name} copies one spell of ${levels} from ${sheet.name}'s spellbook onto a scroll: pass the spell's name as variant. Ask the player which, unless they named one. Nothing was spent.`, retry: true };
  }
  const facts = spellFactsFor(named, spellAuthorsFor(campaign));
  if (!facts) {
    return { error: `The server does not know a spell called "${named}". Name it as the spell lists do. Nothing was spent.`, retry: true };
  }
  if (!inBook(sheet.spellcasting, facts.name) && !inBook(sheet.spellcasting, named)) {
    return { error: `${facts.name} is not in ${sheet.name}'s spellbook, and ${ctx.spend.name} copies a spell from it. Nothing was spent.`, refused: "rules" };
  }
  if (facts.level < does.minLevel || facts.level > does.maxLevel) {
    return { error: `${ctx.spend.name} copies a spell of ${levels}, and ${facts.name} is ${facts.level === 0 ? "a cantrip" : `level ${facts.level}`}. Nothing was spent.`, refused: "rules" };
  }
  if (facts.castingTime !== "action") {
    return { error: `${ctx.spend.name} copies a spell with a casting time of an action, and ${facts.name} is not cast with one. Nothing was spent.`, refused: "rules" };
  }
  const scroll: EquipmentItem = {
    name: freeRowName(sheet.equipment, scrivenerScrollName(facts.name)),
    qty: 1,
    tags: ["scroll"],
    spell: facts.name,
    conjured: { kind: "scroll" },
  };
  const castAt = scrollCastLevel(scroll, facts.level);
  const numbers = scrollNumbers(castAt);
  return {
    patch: { equipment: [...sheet.equipment, scroll] },
    result: {
      scroll: scroll.name,
      spell: facts.name,
      castAtLevel: castAt,
      note: `${sheet.name}'s quill writes ${scroll.name}. Reading it (use_item, an action) casts ${facts.name} as a level ${castAt} spell, one higher than its own, with save DC ${numbers.saveDc} and attack bonus +${numbers.attackBonus}, and uses the scroll up. It vanishes when its holder finishes a long rest.`,
    },
  };
}
