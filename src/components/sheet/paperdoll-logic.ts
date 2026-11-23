// The sheet's paperdoll: the places on a character's body, what is worn in
// each and what in the pack could go there. The wear rules were all here
// already (src/lib/srd/wear-slots.ts, src/lib/dm/gear-hands.ts), but the
// sheet listed worn gear as one flat run of rows, so a player learned that a
// place exists only when two cloaks collided. The doll shows every place,
// filled or empty, and opening one lists what goes there.
//
// A place is where the engines already put a row: its wear slot, the shield
// arm, or the hands for a weapon and for the wand, staff or rod a caster
// holds as a focus (src/lib/dm/cast-rules.ts reads it there). Armor and a
// robe share the body, as the item form's own "Body (a robe)" says. A row
// nothing places (loot the GM invents, an orb attuned to and never put on)
// goes in one last tile, Other, so the doll is one size whatever a character
// owns. Pure (no React): scripts/test-paperdoll-logic.mjs drives it.
import { gearWornState, isAttunable, isWeaponRow, isWornGear, wearLock, wearableGear } from "@/components/sheet/sheet-state";
import type { ItemTag } from "@/lib/schemas/item-tags";
import type { EquipmentItem } from "@/lib/schemas/sheet";
import { wearingIsExplicit } from "@/lib/srd/armor";
import { hasItemTag } from "@/lib/srd/item-tags";
import { isTack, rowIsOn } from "@/lib/srd/tack";
import { wearSlotOf, type WearSlot } from "@/lib/srd/wear-slots";
import { WORN_PLACE_BLURBS } from "@/lib/srd/worn-places";

export type DollPlaceId = "head" | "cloak" | "wrists" | "hands" | "feet" | "eyes" | "neck" | "body" | "waist" | "ring" | "held" | "shield" | "other" | "mount";
// In the order the tiles are drawn: the left side, the right, the row below.
export const DOLL_PLACES: readonly DollPlaceId[] = ["head", "cloak", "wrists", "hands", "feet", "eyes", "neck", "body", "waist", "ring", "held", "shield", "other", "mount"];

export type DollPlace = {
  id: DollPlaceId;
  // The part of the body, as the tile names it.
  label: string;
  // What goes there, said on an empty tile.
  goes: string;
  // How many count there at once, in the SRD's words (SRD 5.1, Magic Items,
  // Multiple Items of the Same Kind; Armor; Actions in Combat).
  rule: string;
  // Beside the figure on its left or right, or in the row under it.
  side: "left" | "right" | "below";
  // Where the place sits on the figure (its 80 by 200 drawing), or null for
  // the hands' row, which the figure does not point at.
  at: { x: number; y: number } | null;
};

// Each side reads from the head down, as the body does.
export const DOLL_PLACE: Record<DollPlaceId, DollPlace> = {
  head: { id: "head", label: "Head", goes: "A hat, helm or circlet", rule: WORN_PLACE_BLURBS.head, side: "left", at: { x: 40, y: 7 } },
  cloak: { id: "cloak", label: "Shoulders", goes: "A cloak or cape", rule: WORN_PLACE_BLURBS.cloak, side: "left", at: { x: 21, y: 43 } },
  wrists: { id: "wrists", label: "Wrists", goes: "Bracers", rule: WORN_PLACE_BLURBS.wrists, side: "left", at: { x: 14, y: 86 } },
  hands: { id: "hands", label: "Hands", goes: "Gloves or gauntlets", rule: WORN_PLACE_BLURBS.hands, side: "left", at: { x: 14, y: 100 } },
  feet: { id: "feet", label: "Feet", goes: "Boots or slippers", rule: WORN_PLACE_BLURBS.feet, side: "left", at: { x: 29, y: 188 } },
  eyes: { id: "eyes", label: "Eyes", goes: "Goggles or lenses", rule: WORN_PLACE_BLURBS.eyes, side: "right", at: { x: 45, y: 17 } },
  neck: { id: "neck", label: "Neck", goes: "An amulet or necklace", rule: WORN_PLACE_BLURBS.neck, side: "right", at: { x: 40, y: 32 } },
  body: {
    id: "body",
    label: "Body",
    goes: "Armor or a robe",
    rule: "One suit of armor counts at a time. A robe has no limit beyond attunement.",
    side: "right",
    at: { x: 40, y: 62 },
  },
  waist: { id: "waist", label: "Waist", goes: "A belt", rule: WORN_PLACE_BLURBS.waist, side: "right", at: { x: 40, y: 96 } },
  ring: { id: "ring", label: "Fingers", goes: "Rings", rule: WORN_PLACE_BLURBS.ring, side: "right", at: { x: 66, y: 102 } },
  held: {
    id: "held",
    label: "In hand",
    goes: "Weapons, a wand, staff or rod",
    // The two-hands rule counts weapons and shields (src/lib/dm/gear-hands.ts
    // heldRows), so the place says a focus is no part of it.
    rule: "A character has two hands: a two-handed weapon takes both, and a shield takes one. A wand, staff or rod held to cast with does not stop a weapon being drawn.",
    side: "below",
    at: null,
  },
  shield: { id: "shield", label: "Shield arm", goes: "A shield", rule: "One shield counts at a time, and it takes a hand.", side: "below", at: null },
  other: {
    id: "other",
    label: "Other items",
    goes: "Magic with no place on the body",
    rule: "Carried, or attuned to and kept close. No limit beyond attunement.",
    side: "below",
    at: null,
  },
  // Not on the body at all: what the character's mount wears, kept as rows
  // in their pack (src/lib/srd/tack.ts).
  mount: {
    id: "mount",
    label: "On your mount",
    goes: "A saddle, barding, saddlebags, a bit and bridle",
    rule: "What your mount wears weighs nothing for you. Packed, it does nothing and you carry its weight.",
    side: "below",
    at: null,
  },
};

// The foci a caster holds in a hand, by the row's tags and never by a word
// in its name (cast-rules.ts asks the same three).
const HELD_FOCI: readonly ItemTag[] = ["staff", "rod", "wand"];

export function isHeldFocus(item: EquipmentItem): boolean {
  return HELD_FOCI.some((tag) => hasItemTag(item, tag));
}

const SLOT_PLACE: Record<WearSlot, DollPlaceId> = {
  armor: "body",
  robe: "body",
  shield: "shield",
  cloak: "cloak",
  head: "head",
  feet: "feet",
  hands: "hands",
  wrists: "wrists",
  neck: "neck",
  waist: "waist",
  ring: "ring",
  eyes: "eyes",
};

// Where a carried row goes on the doll, or null for one the doll has no
// tile for. A suit and a shield are placed by the armor engine; a weapon is
// held, as the sheet's own toggle reads it ("In hand" or "Packed"), before
// any place its author gave it; a wand, staff or rod with no place of its
// own is held too. What is left goes under Other while it has something to
// press (wear, or attune); a row with neither is only the chip above the
// doll, where a bare line under it said nothing.
export function dollPlaceOf(item: EquipmentItem): DollPlaceId | null {
  const slot = wearSlotOf(item);
  if (slot === "armor" || slot === "shield") {
    return SLOT_PLACE[slot];
  }
  if (isWeaponRow(item)) {
    return "held";
  }
  if (slot) {
    return SLOT_PLACE[slot];
  }
  if (isHeldFocus(item)) {
    return "held";
  }
  if (isTack(item)) {
    return "mount";
  }
  return isWornGear(item) || isAttunable(item) ? "other" : null;
}

// The place a carried row may be dragged onto, or null for a row that cannot
// be dragged: one already on, one with nothing to put on (an orb is attuned
// to, never worn), and one the fight will not let change now, which the
// row's own button refuses too (sheet-state.ts wearLock). A row goes only to
// its own place, so a drag lights one tile and a drop anywhere else does
// nothing. Only a row the doll lists (dollView reads wearableGear) can be
// dragged: a stick the GM tagged a wand is worn gear with no row on the
// doll, so a drop put it in hand with no button anywhere to stow it again.
export function dollDropPlace(
  item: EquipmentItem,
  equipment: EquipmentItem[],
  when: { inCombat: boolean; myTurn: boolean },
): DollPlaceId | null {
  if (!isWornGear(item) || !wearableGear([item]).length || rowIsOn(item, equipment) || wearLock(item, when)) {
    return null;
  }
  return dollPlaceOf(item);
}

export type DollTile = {
  place: DollPlace;
  // Every carried row that goes here, in the pack's order.
  fits: EquipmentItem[];
  // The ones worn (or in hand) now; of rows that are only attuned to, the
  // attuned ones.
  worn: EquipmentItem[];
  // Worn, but the place is full and their magic does not count.
  idle: EquipmentItem[];
};

export type DollView = {
  tiles: Record<DollPlaceId, DollTile>;
  // Nobody has said what this character wears, so the engines read every
  // carried piece as worn (src/lib/srd/armor.ts isWorn).
  unsaid: boolean;
};

// `armor` is the suit and the shield the armor class counted
// (acBreakdownFor): of two suits worn, the other one is idle.
export function dollView(equipment: EquipmentItem[], armor: { armorName: string | null; shieldName: string | null }): DollView {
  const tiles = {} as Record<DollPlaceId, DollTile>;
  for (const id of DOLL_PLACES) {
    tiles[id] = { place: DOLL_PLACE[id], fits: [], worn: [], idle: [] };
  }
  const wearable = wearableGear(equipment);
  for (const item of wearable) {
    const id = dollPlaceOf(item);
    if (!id) {
      continue;
    }
    const tile = tiles[id];
    tile.fits.push(item);
    // Worn and idle as the rows under the tile say it (gearWornState). An
    // orb is never put on: it is in use while attuned.
    const state = gearWornState(item, equipment, armor);
    if (isWornGear(item) ? state.worn : Boolean(item.attuned)) {
      tile.worn.push(item);
    }
    if (state.idle) {
      tile.idle.push(item);
    }
  }
  return { tiles, unsaid: wearable.length > 0 && !wearingIsExplicit(equipment) };
}

type Translator = (key: string, vars?: Record<string, string | number>) => string;
const passthrough: Translator = (key, vars) =>
  vars ? key.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : key;

// What a tile says under its label: the worn rows by name, else what waits
// in the pack, else what goes there. Fingers, a neck or a waist hold as many
// as are put on (the SRD limits them only by attunement), and a tile is one
// size whatever it holds: past two it names the first and counts the rest,
// which the open place lists in full.
export function dollTileLine(
  tile: DollTile,
  t: Translator = passthrough,
  itemLabel: (name: string) => string = (name) => name,
): string {
  if (tile.worn.length > 2) {
    return t("{item} and {count} more", { item: itemLabel(tile.worn[0].name), count: tile.worn.length - 1 });
  }
  if (tile.worn.length) {
    return dollTileNames(tile, itemLabel);
  }
  if (tile.fits.length) {
    return tile.fits.length === 1 ? t("1 in the pack") : t("{count} in the pack", { count: tile.fits.length });
  }
  return t(tile.place.goes);
}

// Everything worn in the place, by name: the hover of a tile that counts.
export function dollTileNames(
  tile: DollTile,
  itemLabel: (name: string) => string = (name) => name,
): string {
  return tile.worn.map((item) => itemLabel(item.name)).join(", ");
}

// The whole tile for a screen reader: "Shoulders: Cloak of Protection,
// attuned." or "Head: empty. A hat, helm or circlet."
export function dollTileLabel(
  tile: DollTile,
  t: Translator = passthrough,
  itemLabel: (name: string) => string = (name) => name,
): string {
  const label = t(tile.place.label);
  const goes = t(tile.place.goes);
  if (!tile.worn.length) {
    const waiting = tile.fits.length ? ` ${dollTileLine(tile, t, itemLabel)}.` : "";
    return t("{label}: empty. {goes}.{waiting}", { label, goes, waiting });
  }
  const idle = new Set(tile.idle);
  const names = tile.worn.map(
    (item) => `${itemLabel(item.name)}${item.attuned ? t(", attuned") : ""}${idle.has(item) ? t(", not in effect") : ""}`,
  );
  return t("{label}: {names}.", { label, names: names.join("; ") });
}
