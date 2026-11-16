// A carried light and the record of its burn (SRD 5.1, Adventuring Gear):
// "A torch burns for 1 hour", a candle the same, and a lantern or a lamp
// "burns for 6 hours on a flask (1 pint) of oil". What burns is used up: a
// torch that has burned its hour is gone from the pack, a candle too, and a
// lantern's six hours take a flask of oil with them.
//
// The record sits on the item that sheds the light (EquipmentItem.litAt and
// burnLeft): the clock's minute it was lit and the minutes of burn it had
// then. Before it, a torch was lit fresh with its whole hour on every new
// board and burned only while a board was out, so a party that fought many
// short fights never used one up. The game clock now burns the record on and
// off the board alike, a new board carries the light as it stands, and a
// light put out keeps what is left of its burn.
//
// Pure: no database.

import type { EquipmentItem } from "@/lib/schemas/sheet";
import type { ItemTag } from "@/lib/schemas/item-tags";
import { hasItemTag } from "@/lib/srd/item-tags";

// Bright light and where the dim light ends, both in tiles from the bearer
// (most sources shed dim light for as far again as the bright, a lamp for
// twice as far again), and the minutes one burns (0: it never burns down).
export type LightSource = { tag: ItemTag; radius: number; dim: number; minutes: number; fuel?: ItemTag };

export const LIGHT_SOURCES: readonly LightSource[] = [
  { tag: "everburning_light", radius: 4, dim: 8, minutes: 0 },
  // The bullseye's 60-foot cone and 60 feet of dim light beyond it, drawn
  // as a circle: a token carries no facing.
  { tag: "bullseye_lantern", radius: 12, dim: 24, minutes: 360, fuel: "lamp_oil" },
  { tag: "lantern", radius: 6, dim: 12, minutes: 360, fuel: "lamp_oil" },
  { tag: "torch", radius: 4, dim: 8, minutes: 60 },
  // Lamp: "A lamp casts bright light in a 15-foot radius and dim light for an
  // additional 30 feet. Once lit, it burns for 6 hours on a flask (1 pint) of
  // oil." Its dim light ends 45 feet out, not at twice the bright as the
  // others' do (issue #570, EQP-03).
  { tag: "lamp", radius: 3, dim: 9, minutes: 360, fuel: "lamp_oil" },
  { tag: "candle", radius: 1, dim: 2, minutes: 60 },
];

// The light a pack gives: the item that sheds it (`lamp`), the source it is,
// and what burning it uses up (the torch or candle itself, or a lantern's
// oil; null for a light that never burns down). A light already lit comes
// first, so a lit candle is not passed over for an unlit torch. A lit
// lantern burns the oil already in it, so it gives light with no flask left
// in the pack; an unlit one needs a flask.
export type BurningSource = { source: LightSource; lamp: EquipmentItem; burns: EquipmentItem | null };

export function burningSource(equipment: readonly EquipmentItem[]): BurningSource | null {
  for (const source of LIGHT_SOURCES) {
    const lamp = equipment.find((item) => item.litAt !== undefined && hasItemTag(item, source.tag));
    if (lamp) {
      return { source, lamp, burns: source.fuel ? equipment.find((item) => item !== lamp && source.fuel && hasItemTag(item, source.fuel)) ?? null : lamp };
    }
  }
  for (const source of LIGHT_SOURCES) {
    const lamp = equipment.find((item) => hasItemTag(item, source.tag));
    if (!lamp) {
      continue;
    }
    if (!source.fuel) {
      return { source, lamp, burns: source.minutes > 0 ? lamp : null };
    }
    const fuel = equipment.find((item) => item !== lamp && source.fuel && hasItemTag(item, source.fuel));
    if (fuel) {
      return { source, lamp, burns: fuel };
    }
  }
  return null;
}

// Minutes of burn the light has before it is lit: what was left when it was
// put out, else a fresh one's whole burn.
function burnBefore(lamp: EquipmentItem, source: LightSource): number {
  return lamp.burnLeft !== undefined ? Math.max(0, Math.min(source.minutes, lamp.burnLeft)) : source.minutes;
}

// The lit light and the clock's minute it burns out, or null when none is
// lit (or the one carried never burns down).
export function litLight(equipment: readonly EquipmentItem[]): { index: number; endsAt: number; source: LightSource } | null {
  const found = burningSource(equipment);
  if (!found || found.source.minutes <= 0 || found.lamp.litAt === undefined) {
    return null;
  }
  return { index: equipment.indexOf(found.lamp), endsAt: found.lamp.litAt + burnBefore(found.lamp, found.source), source: found.source };
}

// The minutes of burn left at `now`, lit or not; null for a light that never
// burns down or none at all.
export function burnLeftAt(equipment: readonly EquipmentItem[], now: number): number | null {
  const found = burningSource(equipment);
  if (!found || found.source.minutes <= 0) {
    return null;
  }
  const lit = litLight(equipment);
  return lit ? Math.max(0, lit.endsAt - now) : burnBefore(found.lamp, found.source);
}

function withRow(equipment: readonly EquipmentItem[], index: number, row: EquipmentItem | null): EquipmentItem[] {
  return equipment.flatMap((item, at) => (at !== index ? [item] : row ? [row] : []));
}

function unmarked(item: EquipmentItem): EquipmentItem {
  const { litAt: _lit, burnLeft: _left, ...rest } = item;
  void _lit;
  void _left;
  return rest;
}

// The pack with its light lit at `now`, or null when there is nothing to
// light (no light, one that never burns down, one already lit, a burn spent).
export function lightIn(equipment: readonly EquipmentItem[], now: number): EquipmentItem[] | null {
  const found = burningSource(equipment);
  if (!found || found.source.minutes <= 0 || found.lamp.litAt !== undefined || burnBefore(found.lamp, found.source) <= 0) {
    return null;
  }
  const index = equipment.indexOf(found.lamp);
  return withRow(equipment, index, { ...found.lamp, litAt: now, burnLeft: burnBefore(found.lamp, found.source) });
}

// The pack with its lit light put out at `now`, keeping what is left of its
// burn for the next time it is lit; null when nothing is lit.
export function putOutIn(equipment: readonly EquipmentItem[], now: number): EquipmentItem[] | null {
  const lit = litLight(equipment);
  if (!lit) {
    return null;
  }
  const lamp = equipment[lit.index];
  const left = Math.max(0, lit.endsAt - now);
  const { litAt: _lit, ...rest } = lamp;
  void _lit;
  return withRow(equipment, lit.index, left < lit.source.minutes ? { ...rest, burnLeft: left } : unmarked(lamp));
}

// One light burned out: a torch or a candle leaves the stack, a lantern's
// flask of oil is used up, and the record goes (the next one is fresh).
function usedUp(equipment: readonly EquipmentItem[]): { equipment: EquipmentItem[]; burnt: string } | null {
  const found = burningSource(equipment);
  if (!found || found.lamp.litAt === undefined) {
    return null;
  }
  const lampIndex = equipment.indexOf(found.lamp);
  if (found.burns === found.lamp) {
    const qty = found.lamp.qty ?? 1;
    return { equipment: withRow(equipment, lampIndex, qty > 1 ? { ...unmarked(found.lamp), qty: qty - 1 } : null), burnt: found.lamp.name };
  }
  let next = withRow(equipment, lampIndex, unmarked(found.lamp));
  const burnt = found.burns?.name ?? found.lamp.name;
  if (found.burns) {
    const fuelIndex = next.indexOf(found.burns);
    const qty = found.burns.qty ?? 1;
    next = withRow(next, fuelIndex, qty > 1 ? { ...found.burns, qty: qty - 1 } : null);
  }
  return { equipment: next, burnt };
}

// Burns the pack's lit light to `now`: every light that has burned out is
// used up, and `relight(at)` says whether the next is lit as the last one
// gutters (a party still in the dark). Null when nothing changed.
export function burnDown(
  equipment: readonly EquipmentItem[],
  now: number,
  relight: (at: number) => boolean = () => false,
): { equipment: EquipmentItem[]; burnt: string[] } | null {
  let pack = [...equipment];
  const burnt: string[] = [];
  // A day's darkness is 24 torches; the bound only stops a bad row looping.
  for (let guard = 0; guard < 200; guard += 1) {
    const lit = litLight(pack);
    if (!lit || lit.endsAt > now) {
      break;
    }
    const spent = usedUp(pack);
    if (!spent) {
      break;
    }
    pack = spent.equipment;
    burnt.push(spent.burnt);
    if (relight(lit.endsAt)) {
      pack = lightIn(pack, lit.endsAt) ?? pack;
    }
  }
  return burnt.length ? { equipment: pack, burnt } : null;
}
