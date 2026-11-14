// What a horror caster's casting feature says of their spellcasting focus
// (cc1113 genre-c pass, WAVE2 D5: the genre text is the rule), read by the
// one focus check every cast and every spell card asks
// (src/lib/dm/cast-materials.ts focusProblem), beside the cyberpunk casters'
// rules (src/lib/srd/genre-a-cyberpunk-focus.ts):
//   Liturgy (exorcist 2), "a holy symbol or ritual kit is the focus": a holy
//     symbol, or a line named Ritual Kit (the class's own "holy kit" answers
//     too). An arcane focus is not one.
//   Pact of the Page (occultist 2), "the grimoire is the focus": a book the
//     occultist carries, named Grimoire, Spellbook or Book.
//   Applied Theory (parapsychologist 2), "the kit is the focus": the field
//     instruments the class starts with.
// A component pouch still stands in for any of them (SRD 5.1, Components).
// Without the feature (a 1st-level holder casts nothing yet) the SRD's own
// rule stands. Pure.
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { hasItemTag } from "@/lib/srd/item-tags";
import { lineNamed, type RowItem } from "@/lib/srd/item-row";
import type { ItemTag } from "@/lib/schemas/item-tags";

export type HorrorFocus = { classId: string; feature: string; names: string[]; tag?: ItemTag; label: string };

const HORROR_FOCUS: ReadonlyArray<HorrorFocus> = [
  { classId: "exorcist", feature: "Liturgy", names: ["Ritual Kit", "Holy Kit"], tag: "holy_symbol", label: "a holy symbol or a ritual kit" },
  { classId: "occultist", feature: "Pact of the Page", names: ["Grimoire", "Spellbook", "Book"], label: "their grimoire (a Grimoire, Spellbook or Book on the sheet)" },
  { classId: "parapsychologist", feature: "Applied Theory", names: ["Field Instruments"], label: "their field instruments" },
];

type Holder = { class: string; classes?: ReadonlyArray<{ id: string }>; features?: ReadonlyArray<{ name: string }> };

// The horror focus rules this sheet's features give (a multiclassed caster
// may hold more than one), none for any other caster.
export function horrorFocusOf(sheet: Holder): HorrorFocus[] {
  return HORROR_FOCUS.filter((rule) => holdsGenreFeature({ class: sheet.class, classes: (sheet.classes ?? []) as never, features: (sheet.features ?? []) as never }, rule.classId, rule.feature));
}

export function carriesHorrorFocus(items: readonly RowItem[], rule: HorrorFocus): boolean {
  return rule.names.some((name) => lineNamed(items, name) >= 0) || Boolean(rule.tag && items.some((item) => hasItemTag(item as never, rule.tag!)));
}
