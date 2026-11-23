// The creatures the Hand's Mount card offers: the ones mount_up would take
// for this character right now (src/lib/dm/mount-tools.ts handleMountUp).
//
// Dismount had a card and mounting had none, so a rider thrown from the
// saddle in a fight typed their way back on and waited for the GM's model
// to make the call. The card is dealt only where it can be played: beside a
// creature this character called up that is large enough to carry them
// (mount-link.ts summonedSteed, srd/mounts.ts checkCreatureMount), or with
// a drake that Bond of Fang and Scale lets them ride (pet-command.ts
// drakeMount). A mount the table keeps only as a record (a bought warhorse)
// stands on no token, so nothing can say it is within reach: mounting it
// stays a line typed to the GM.
//
// Pure: sheets and numbers in, names out.

import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature } from "@/lib/srd/feature-names";
import { canCarry, mountSizeOf, riderSizeOf } from "@/lib/srd/mounts";

export type HandSteed = { name: string };

type Rider = Pick<CharacterSheet, "id" | "race" | "pets" | "features" | "feats">;
type Creature = Pick<CharacterSheet, "id" | "name" | "currentHp" | "deathSaves" | "summon">;

// `feet`: the board's distance from the rider to each creature, by sheet
// id; absent off the board, where mount_up measures nothing either
// (steedOutOfReach) and the GM judges it.
export function mountableSteeds(rider: Rider, sheets: readonly Creature[], feet?: Readonly<Record<string, number>>): HandSteed[] {
  const size = riderSizeOf(rider.race);
  const made = sheets.filter((sheet) => sheet.summon && !sheet.summon.unbound && sheet.summon.casterId === rider.id && !sheet.deathSaves?.dead && sheet.currentHp > 0);
  const steeds = made.filter((sheet) => {
    const carries = mountSizeOf(sheet.summon?.size ?? "Medium");
    // mount_up finds a creature by its name, and two of one name are found
    // by neither: those are told apart in words to the GM.
    const alone = made.filter((other) => textKey(other.name) === textKey(sheet.name)).length === 1;
    const near = feet?.[sheet.id];
    return Boolean(carries) && canCarry(carries!, size) && alone && (near === undefined || near <= 5);
  });
  // The drake is a pet on the rider's own sheet with no token of its own:
  // it is offered whenever it is out and may carry them.
  const drakes = holdsFeature(rider, "Bond of Fang and Scale") ? rider.pets.filter((pet) => pet.kind === "drake" && pet.hp > 0) : [];
  return [...steeds, ...drakes].map((creature) => ({ name: creature.name }));
}
