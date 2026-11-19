// Tack: the gear that goes on a mount and not on its rider (issue #1038).
//
// A mount has no pack of its own, so a saddle stays a row in its rider's
// equipment. The row's wear mark says where it is: marked on, it is on the
// animal, gives what it gives and weighs nothing for the rider ("the saddle
// goes on the horse and is forgotten"); marked off, it is dead weight in the
// pack.
//
// A saddle nobody has spoken for is on the mount, on every sheet: only a
// player who packs it carries it. That differs from armor on purpose. A
// sheet that says what it wears reads an unmarked suit as off, because a
// second suit in the pack is common; a saddle in the pack is not, and a
// table that never opens the sheet should not be charged 30 lb for one.
//
// Only what the animal wears: cargo in the saddlebags is still its owner's
// to carry until animals hold items of their own.
import { matchGear } from "@/lib/srd/adventuring-gear";
import { isWorn } from "@/lib/srd/armor";
import { rowName, type RowItem } from "@/lib/srd/item-row";

// The SRD's rows under Tack, Harness, and Drawn Vehicles that an animal
// wears. Feed is eaten and a vehicle is not worn.
const TACK = new Set(
  ["Saddle, Exotic", "Saddle, Military", "Saddle, Pack", "Saddle, Riding", "Saddlebags", "Bit and Bridle"].map((name) => matchGear(name)),
);

export function isTack(item: RowItem): boolean {
  const gear = matchGear(rowName(item));
  return gear !== null && TACK.has(gear);
}

// Whether this row is on the animal now.
export function onMount(item: RowItem & { equipped?: boolean }): boolean {
  return isTack(item) && item.equipped !== false;
}

// Worn, as the sheet and the gear route read any row: tack by its own rule,
// everything else the armor engine's way (armor.ts isWorn).
export function rowIsOn(item: RowItem & { equipped?: boolean }, equipment: ReadonlyArray<{ equipped?: boolean }>): boolean {
  return isTack(item) ? item.equipped !== false : isWorn(item, equipment);
}
