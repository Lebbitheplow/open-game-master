// What a cyberpunk caster's class feature says of their spellcasting focus
// (WAVE2 D5: the genre text is the rule), read by the one focus check every
// cast and every spell card asks (src/lib/dm/cast-materials.ts focusProblem):
//   Deck Interface, "needs their cyberdeck as a focus": the netrunner's focus
//     is the cyberdeck and no other kind. The deck is the wizard's arcane
//     focus under the setting's name (the class plays the wizard's list and
//     starts with the wizard's kit), so a line named Cyberdeck or any arcane
//     focus on the sheet is it; a holy symbol or an instrument is not;
//   Wetware Surge, "needs no material focus": an esper's unpriced material
//     asks for no pouch and no focus. A material with a price is still the
//     material plan's to find (SRD 5.1: a focus never replaces a costly
//     component);
//   Machine Codex, "the drone is the focus": the rigger carries no focus
//     item; a drone of theirs on the board is it. Whether one stands is the
//     cast guard's to ask (src/lib/dm/genre-a-cyberpunk-drones.ts
//     droneFocusProblem), since this module reads the sheet alone.
// The dark fantasy casters with a rule of their own:
//   Mourning Song, "your voice is the instrument": a dirgesinger's unpriced
//     material asks for no pouch and no instrument;
//   Pharmacopoeia, "the kit and mask are the focus": a plague doctor's focus
//     is the doctor's kit (a herbalism kit, a healer's kit, or the beaked
//     mask that goes with it) and no other kind.
// Pure.
import { holdsFeature } from "@/lib/srd/feature-names";
import { lineNamed, type RowItem } from "@/lib/srd/item-row";

export type GenreFocus = { kind: "cyberdeck" | "none" | "drone" | "kit"; feature: string };

type Holder = { features?: ReadonlyArray<{ name: string }>; feats?: readonly string[] };

const FOCUS: ReadonlyArray<GenreFocus> = [
  { kind: "none", feature: "Wetware Surge" },
  { kind: "none", feature: "Mourning Song" },
  { kind: "drone", feature: "Machine Codex" },
  { kind: "cyberdeck", feature: "Deck Interface" },
  { kind: "kit", feature: "Pharmacopoeia" },
];

// The most forgiving focus rule a sheet's features give (a multiclassed esper
// netrunner needs none), or null for a caster of the SRD's own rule.
export function genreFocusOf(sheet: Holder): GenreFocus | null {
  return FOCUS.find((entry) => holdsFeature(sheet, entry.feature)) ?? null;
}

// Whether the sheet carries the deck by its name, in the table's words or the
// row's English ones (the carried-line rule of src/lib/srd/item-row.ts).
export function carriesCyberdeck(items: readonly RowItem[]): boolean {
  return lineNamed(items, "Cyberdeck") >= 0;
}

// The plague doctor's kit or mask, by the line's name (the same carried-line rule).
export const DOCTOR_KIT = ["Herbalism Kit", "Healer's Kit", "Plague Mask", "Beaked Mask"];
export function carriesDoctorKit(items: readonly RowItem[]): boolean {
  return DOCTOR_KIT.some((name) => lineNamed(items, name) >= 0);
}
