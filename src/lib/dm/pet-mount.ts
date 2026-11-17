// A drake its ranger rides (Bond of Fang and Scale: "it can carry you as a
// mount") is the mount and the pet at once. mount_up copied the drake's
// Armor Class and hit points onto the mount record (pet-command.ts
// drakeMount), and from then on the two were kept apart: an attack aimed at
// the mount took the record's hit points and never the drake's, ignoring
// its essence immunity and its Dodge, and a fireball struck it twice, once
// as the mount (mount-area.ts) and once as the pet (pet-save.ts areaOnPets).
// Here the mount's doors hand a ridden drake to its own record, and the
// rider falls when the drake drops to 0 hit points and is gone (Drake
// Companion), as from a mount knocked prone (SRD 5.1, Mounted Combat: "If
// your mount is knocked prone, you can use your reaction to dismount it as
// it falls and land on your feet. Otherwise, you are dismounted and fall
// prone").

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getMounts } from "@/lib/db/mounts";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";
import type { MountState } from "@/lib/srd/mounts";
import { handleDismount } from "@/lib/dm/mount-tools";

// The mount record pet-command.ts drakeMount writes for a drake.
const PET_MOUNT = "pet:";

// The pet a rider's mount is, or null for a beast the record holds alone.
export function mountedPet(rider: Pick<CharacterSheet, "pets">, mount: Pick<MountState, "ref"> | undefined): SheetPet | null {
  if (!mount?.ref.startsWith(PET_MOUNT)) {
    return null;
  }
  const key = mount.ref.slice(PET_MOUNT.length);
  return rider.pets.find((pet) => textKey(pet.name) === key) ?? null;
}

// Whether `pet` is the mount its owner sits on now.
export function ridesPet(campaignId: string, ownerId: string, pet: Pick<SheetPet, "name">): boolean {
  return getMounts(campaignId)[ownerId]?.ref === `${PET_MOUNT}${textKey(pet.name)}`;
}

// The rider comes down from a drake that dropped: the mount-prone fall, its
// reaction to land on their feet included (mount-tools.ts handleDismount).
export function fallFromPet(campaign: Campaign, ownerId: string, turn?: DmTurn): unknown {
  const sheets = listSheets(campaign.id).map((sheet) => getSheetById(sheet.id) ?? sheet);
  return handleDismount(campaign, JSON.stringify({ characterId: ownerId, cause: "mount-prone" }), sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])), turn);
}
