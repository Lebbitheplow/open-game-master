import { expireBurntLights, getBattleMapForEncounter, getTokenByRef, setTokenLight } from "@/lib/db/battle-maps";
import { getSheetById } from "@/lib/db/sheets";
import { getActiveEncounter } from "@/lib/db/encounters";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { withMoonlight } from "@/lib/dm/ar-ws-moonlight-logic";
import { burnDown, burningSource, burnLeftAt, lightIn, litLight, putOutIn } from "@/lib/dm/carried-light-logic";
import { publishFx } from "@/lib/dm/fx";
import { publishEphemeral } from "@/lib/events";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { RADIANT_LIGHT, radiantWeaponLit } from "@/lib/srd/infusions";

// Torch and lantern timers (docs/vtt-parity-implementation-plan.md 7.3).
// A carried light is read from equipment; a torch burns an hour, a candle
// too, a lantern six on one flask of oil, and the item that sheds it keeps
// when it was lit and the burn it has left (src/lib/dm/carried-light-logic.ts).
// Everburning things and a plain "light" spell entry are the caster's
// business and do not burn down.

// Bright light and where the dim light ends, both in tiles from the bearer,
// and the minutes a whole one burns.
export type CarriedLight = { radius: number; dim: number; minutes: number };

export function carriedLight(sheet: Pick<CharacterSheet, "equipment"> & { conditions?: readonly string[] }): CarriedLight {
  const found = burningSource(sheet.equipment);
  // A Lunar sorcerer's moonlight is carried too (ar-ws-moonlight-logic.ts),
  // and an artificer's Radiant Weapon lit in the hand: bright light 30 feet
  // and dim 30 more, burning nothing (src/lib/dm/infusion-charges.ts).
  const carried = withMoonlight(sheet, found ? { radius: found.source.radius, dim: found.source.dim, minutes: found.source.minutes } : { radius: 0, dim: 0, minutes: 0 });
  return radiantWeaponLit(sheet) && carried.radius < RADIANT_LIGHT.radius ? RADIANT_LIGHT : carried;
}

// The token fields for a light lit now, at `instant` on the clock.
export function lightPlacement(light: CarriedLight, instant: number): { lightRadius: number; lightDimRadius: number; burnsUntil: number; lightMinutes: number } {
  return {
    lightRadius: light.radius,
    lightDimRadius: light.radius > 0 ? light.dim : 0,
    burnsUntil: light.radius > 0 && light.minutes > 0 ? instant + light.minutes : 0,
    lightMinutes: light.radius > 0 && light.minutes > 0 ? light.minutes : 0,
  };
}

// The token fields for this character's light as they step onto a board at
// `instant`: a light already lit is carried as it stands, burning out when
// its record says (never refilled by the new board), and one not lit is lit
// now, the record written. A torch or lantern whose light a moonlight or a
// Radiant Weapon outshines is not lit for nothing.
export function boardLight(campaignId: string, held: CharacterSheet, instant: number): ReturnType<typeof lightPlacement> {
  // One that burned out since the clock last burned it is used up first.
  const sheet = burnOutLight(campaignId, held.id, instant).length ? getSheetById(held.id) ?? held : held;
  const light = carriedLight(sheet);
  const found = burningSource(sheet.equipment);
  const burns = found && found.source.minutes > 0 && light.minutes === found.source.minutes && light.radius === found.source.radius;
  if (!burns) {
    return lightPlacement(light, instant);
  }
  const lit = litLight(sheet.equipment);
  if (lit && lit.endsAt > instant) {
    return { ...lightPlacement(light, instant), burnsUntil: lit.endsAt };
  }
  const equipment = lightIn(sheet.equipment, instant);
  if (!equipment) {
    return lightPlacement({ radius: 0, dim: 0, minutes: 0 }, instant);
  }
  patchSheetAudited(campaignId, sheet.id, { equipment }, {
    kind: "use_item",
    reason: `${found.lamp.name} lit`,
    delta: { item: found.lamp.name, lit: true },
  });
  return { ...lightPlacement(light, instant), burnsUntil: instant + (burnLeftAt(equipment, instant) ?? light.minutes) };
}

// Burns this character's lit light down to `instant`: each one that burned
// out is used up (audited, so the turn that moved the clock puts it back with
// the hours, issue #622), and `relight` lights the next as one gutters.
// Returns what burned out.
export function burnOutLight(campaignId: string, sheetId: string, instant: number, relight?: (at: number) => boolean): string[] {
  const sheet = getSheetById(sheetId);
  const burned = sheet ? burnDown(sheet.equipment, instant, relight) : null;
  if (!sheet || !burned) {
    return [];
  }
  patchSheetAudited(campaignId, sheet.id, { equipment: burned.equipment }, {
    kind: "remove_item",
    reason: `${burned.burnt.join(", ")} burned out`,
    delta: { name: burned.burnt[0], removed: burned.burnt.length },
  });
  return burned.burnt;
}

// Lights or puts out this character's carried light (use_item on a torch,
// a candle, a lantern or a lamp), and the board's token with it. Null when
// what is named is not the light they carry.
export function toggleCarriedLight(campaignId: string, sheet: CharacterSheet, item: EquipmentItem, instant: number): { lit: boolean; minutesLeft: number; name: string } | null {
  const found = burningSource(sheet.equipment);
  if (!found || found.source.minutes <= 0 || (found.lamp !== item && found.burns !== item)) {
    return null;
  }
  const lit = litLight(sheet.equipment);
  const equipment = lit ? putOutIn(sheet.equipment, instant) : lightIn(sheet.equipment, instant);
  if (!equipment) {
    return null;
  }
  patchSheetAudited(campaignId, sheet.id, { equipment }, {
    kind: "use_item",
    reason: `${found.lamp.name} ${lit ? "put out" : "lit"}`,
    delta: { item: found.lamp.name, lit: !lit },
  });
  const minutesLeft = burnLeftAt(equipment, instant) ?? 0;
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, sheet.id) : null;
  if (token) {
    const shed = carriedLight({ ...sheet, equipment });
    if (lit) {
      setTokenLight(token.id, 0, 0, 0, 0);
    } else {
      setTokenLight(token.id, shed.radius, instant + minutesLeft, found.source.minutes, shed.dim);
    }
    publishEphemeral(campaignId, "battle_map_updated", {});
  }
  return { lit: !lit, minutesLeft, name: found.lamp.name };
}

// use_item on the torch or candle a character carries: it is lit (or put
// out), not used up on the spot; it leaves the pack when its hour has burned
// on the clock. Before, the call took the torch away at once and the board
// lit another, so one light was paid for twice. Null for anything else.
export function lightCarriedLight(campaignId: string, sheet: CharacterSheet, item: EquipmentItem | null, instant: number): Record<string, unknown> | null {
  const light = item ? toggleCarriedLight(campaignId, sheet, item, instant) : null;
  if (!light) {
    return null;
  }
  return {
    ok: true,
    used: light.name,
    lit: light.lit,
    minutesLeft: light.minutesLeft,
    applied: light.lit
      ? `${sheet.name} lights ${light.name}: it burns ${light.minutesLeft} more minutes on the game clock, then is used up.`
      : `${sheet.name} puts out ${light.name}, with ${light.minutesLeft} minutes of burn left in it.`,
  };
}

// What the bar shows: minutes left and the whole, or null for a light that
// does not burn down.
export function lightRemaining(token: { burnsUntil: number; lightMinutes: number; lightRadius: number }, instant: number): { remaining: number; total: number } | null {
  if (token.lightRadius <= 0 || token.burnsUntil <= 0 || token.lightMinutes <= 0) {
    return null;
  }
  return { remaining: Math.max(0, token.burnsUntil - instant), total: token.lightMinutes };
}

// Put out every light on the board that has burnt down by `instant`; the
// board redraws and the FX layer gutters each one out. What a character's
// light used up is the sheet's record's to say (burnOutLight, run on the
// same clock first), so a Light cantrip or an aura that ran out on a hero's
// token takes no torch from their pack.
export function gutterBurntLights(campaignId: string, instant: number): number {
  const guttered = expireBurntLights(campaignId, instant);
  if (!guttered.length) {
    return 0;
  }
  for (const token of guttered) {
    if (token.kind === "pc") {
      burnOutLight(campaignId, token.refId, instant);
    }
    publishFx(campaignId, {
      id: `gutter-${token.id}-${instant}`,
      kind: "gutter",
      to: { x: token.x, y: token.y },
      toTokenId: token.id,
      label: `${token.name}'s light gutters out`,
      numbers: "all",
      at: Date.now(),
    });
  }
  publishEphemeral(campaignId, "battle_map_updated", {});
  return guttered.length;
}
