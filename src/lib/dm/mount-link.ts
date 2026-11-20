// A mount that is a creature the table already keeps as a sheet (issue 986).
//
// A mount was only a record on its rider (db/mounts.ts), so the steed Find
// Steed made and the "Warhorse" its paladin then mounted were two creatures
// with two sets of hit points: the steed stood in the party with its own
// token and turn while its maker rode a copy, and a blow to one never
// reached the other. A mount record may now name the sheet it is
// (MountState.sheetId). The record keeps what riding needs (the speed, the
// size, who rides); the creature's Armor Class and hit points stay on its
// sheet, where damage, healing and the spell's end already reach them.
//
// Database-level only: summon-store.ts calls into it when a creature goes,
// so it must not import anything that reaches summon-store.ts.

import { getMounts, setMount } from "@/lib/db/mounts";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { independentMount, type MountState } from "@/lib/srd/mounts";
import { carriedBarding } from "@/lib/srd/barding";
import { SRD_CREATURES } from "@/lib/srd/srd-creatures";

// The creature `rider` called up that `ref` names, by its own name
// ("Warhorse 2") or, when no creature of theirs has that name, by its form
// ("warhorse"), or null. Never a guess: with two elk called up, "elk" names
// neither and each is mounted by its own name. Only the rider's own: it does
// as its maker directs, so it carries its maker.
export function summonedSteed(campaignId: string, rider: Pick<CharacterSheet, "id">, ref: string): CharacterSheet | null {
  const wanted = textKey(ref);
  if (!wanted) {
    return null;
  }
  const made = listSheets(campaignId).filter((sheet) => sheet.summon && !sheet.summon.unbound && sheet.summon.casterId === rider.id && !sheet.deathSaves?.dead && sheet.currentHp > 0);
  const byName = made.filter((sheet) => textKey(sheet.name) === wanted);
  const fits = byName.length ? byName : made.filter((sheet) => textKey(sheet.summon?.form ?? "") === wanted);
  return fits.length === 1 ? fits[0] : null;
}

// The barding a rider carries for their mount, when it protects the mount
// better than its own hide does (src/lib/srd/barding.ts). The mount's
// Dexterity is its sheet's or its stat block's; a mount with neither has no
// Armor Class to better.
export function mountBarding(rider: Pick<CharacterSheet, "equipment">, mount: MountState, ownAc: number): { name: string; ac: number } | null {
  const dex = mount.sheetId
    ? getSheetById(mount.sheetId)?.abilities.dex
    : SRD_CREATURES.find((creature) => creature.slug === mount.ref)?.abilities.dex;
  const barding = dex === undefined ? null : carriedBarding(rider.equipment, dex);
  return barding && barding.ac > ownAc ? barding : null;
}

// The mount's Armor Class and hit points as they stand: its sheet's when it
// is one, else the record's own. Null for a mount with no numbers (a beast
// the GM wrote by hand) and for a record whose creature is gone.
export function mountVitals(mount: MountState): { ac: number; hp: number; maxHp: number } | null {
  if (mount.sheetId) {
    const sheet = getSheetById(mount.sheetId);
    return sheet ? { ac: sheet.ac, hp: sheet.currentHp, maxHp: sheet.maxHp } : null;
  }
  return mount.ac === undefined || mount.hp === undefined ? null : { ac: mount.ac, hp: mount.hp, maxHp: mount.maxHp ?? mount.hp };
}

// The party's creatures that are not carrying a rider: the ones that stand
// on a token of their own. One that carries a rider shares its rider's
// square, so it stands on no token until its rider gets down.
export function onFoot<T extends { id: string }>(campaignId: string, sheets: T[]): T[] {
  const ridden = new Set(Object.values(getMounts(campaignId)).flatMap((mount) => (mount.sheetId ? [mount.sheetId] : [])));
  return ridden.size ? sheets.filter((sheet) => !ridden.has(sheet.id)) : sheets;
}

// The party's creatures that take a turn of their own. A controlled mount
// does not ("The initiative of a controlled mount changes to match yours
// when you mount it", SRD 5.1, Controlling a Mount): it rolls no initiative
// and takes no slot in the order. An independent one "retains its place in
// the initiative order" and is asked its roll like anyone (issue 1036).
export function takesOwnTurn<T extends { id: string }>(campaignId: string, sheets: T[]): T[] {
  const led = new Set(Object.values(getMounts(campaignId)).flatMap((mount) => (mount.sheetId && mount.controlled ? [mount.sheetId] : [])));
  return led.size ? sheets.filter((sheet) => !led.has(sheet.id)) : sheets;
}

// The independent mount this rider sits on, or null: a rider on foot, and
// one on a controlled mount, moves on their own turn.
export function independentMountOf(campaignId: string, riderId: string): (MountState & { sheetId: string }) | null {
  const mount = getMounts(campaignId)[riderId];
  return independentMount(mount) ? mount : null;
}

// Who this creature carries as an independent mount, or null. The pair
// stands on that rider's token (db/battle-maps.ts getTokenByRef), and the
// creature's turn starts that token's movement again.
export function riderCarriedBy(campaignId: string, sheetId: string): string | null {
  for (const [riderId, mount] of Object.entries(getMounts(campaignId))) {
    if (independentMount(mount) && mount.sheetId === sheetId) {
      return riderId;
    }
  }
  return null;
}

// Who rides this creature now.
export function ridersOf(campaignId: string, sheetId: string): string[] {
  return Object.entries(getMounts(campaignId)).flatMap(([riderId, mount]) => (mount.sheetId === sheetId ? [riderId] : []));
}

// The creature is gone (0 hit points, its spell's end, a new casting in its
// place): whoever rode it rides nothing. Returns the riders' ids.
export function unseatRidersOf(campaignId: string, sheetId: string): string[] {
  const riders = ridersOf(campaignId, sheetId);
  for (const riderId of riders) {
    setMount(campaignId, riderId, null);
  }
  if (riders.length) {
    publishPersisted(campaignId, "mounts_updated", { mounts: getMounts(campaignId) });
  }
  return riders;
}
