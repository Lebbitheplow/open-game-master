// A rider knocked prone in the saddle, or whose mount is moved against its
// will.
//
// "If an effect moves your mount against its will while you're on it, you
// must succeed on a DC 10 Dexterity saving throw or fall off the mount,
// landing prone in a space within 5 feet of it. If you're knocked prone while
// mounted, you must make the same saving throw" (SRD 5.1, Mounting and
// Dismounting). A success keeps the saddle; only a failure takes the rider
// off.
//
// Prone reaches a sheet from many doors (set_condition, an enemy's blow, an
// area, a fall, the drop to 0), so the prone save is asked where an engine
// call finishes (encounter-tools.ts settleTurn) rather than at each of them.
// The GM's dismount with a cause asks the same save through saddleSave, so
// a rider is asked once for one prone, whichever asks first: the save made
// is kept on the mount (keptSaddle) until they stand.

import type { Campaign } from "@/lib/db/campaigns";
import { getDmTurn, type DmTurn } from "@/lib/db/dm-turns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getMounts, setMount } from "@/lib/db/mounts";
import { getSheetById } from "@/lib/db/sheets";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { rollCharacterSave } from "@/lib/dm/forced-save";
import { currentTurnId } from "@/lib/dm/job-control";
import { tableNoteSeq } from "@/lib/dm/narration-slot";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { standBesideRider } from "@/lib/dm/summon-store";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { DISMOUNT_SAVE_DC, riderKnockedProne, type MountState } from "@/lib/srd/mounts";
import { matchGear } from "@/lib/srd/adventuring-gear";
import { rowName } from "@/lib/srd/item-row";

// "A military saddle braces the rider, helping you keep your seat on an
// active mount in battle. It gives you advantage on any check you make to
// remain mounted" (SRD 5.1, Tack, Harness, and Drawn Vehicles). The roll
// the rules ask to remain mounted is this save, so the saddle's advantage
// is on it. A saddle the rider carries is the one their mount wears, as the
// exotic saddle is read (mount-tools.ts).
const MILITARY_SADDLE = matchGear("Saddle, Military");
const ridesMilitarySaddle = (sheet: CharacterSheet) =>
  Boolean(MILITARY_SADDLE) && sheet.equipment.some((item) => matchGear(rowName(item)) === MILITARY_SADDLE);

export const isProne = (conditions: readonly string[]) => conditions.some((entry) => isConditionNamed(entry, "prone"));

// A kept saddle is for one prone: a rider no longer prone has stood, and the
// next time they are knocked down they save again. The mark goes quietly,
// as nothing the table sees changes with it.
function forgetStood(campaignId: string, riderId: string, mount: MountState, prone: boolean) {
  if (mount.keptSaddle && !prone) {
    const rest = { ...mount };
    delete rest.keptSaddle;
    setMount(campaignId, riderId, rest);
  }
}

// The riders already prone as an engine call begins (encounter-tools.ts
// turnHolder): the call did not knock them prone, and a call the engine
// refuses must write nothing about them. A rider who stood since they kept
// the saddle loses the mark here, so the call that lays them prone again
// asks again.
export function proneRiders(campaignId: string): string[] {
  const prone: string[] = [];
  for (const [riderId, mount] of Object.entries(getMounts(campaignId))) {
    const lying = isProne(getSheetById(riderId)?.conditions ?? []);
    forgetStood(campaignId, riderId, mount, lying);
    if (lying) {
      prone.push(riderId);
    }
  }
  return prone;
}

export type SaddleSave = {
  kept: boolean;
  total: number | string;
  // What happened, for the call's result and so for the model's narration.
  line: string;
};

// The DC 10 Dexterity save to stay mounted, rolled from the rider's sheet
// with what it resists named, so Born to the Saddle's advantage "on any
// saving throw you make to avoid falling off your mount" applies. A success
// keeps the saddle (and, for a prone rider, marks the prone saved); a
// failure takes them off, with a table note. Where they land is the
// caller's: a rider knocked prone is prone already, and one whose mount was
// moved lands prone unless Born to the Saddle lands them standing
// (mount-tools.ts).
export function saddleSave(
  campaign: Campaign,
  sheet: CharacterSheet,
  mount: MountState,
  turn: DmTurn | null,
  why: "knocked prone" | "mount moved",
): SaddleSave {
  const braced = ridesMilitarySaddle(sheet) ? { advantage: "advantage" as const, reason: "Military saddle: advantage to remain mounted" } : null;
  const save = rollCharacterSave(campaign, turn, sheet, "dex", DISMOUNT_SAVE_DC, `${sheet.name}: DEX save to stay in the saddle`, { against: "dismount" }, null, braced);
  const total = save.total ?? (save.success ? "made" : "failed with no roll");
  const how = why === "knocked prone" ? `was knocked prone while riding ${mount.name}` : `was on ${mount.name} as it was moved against its will`;
  if (save.success) {
    if (why === "knocked prone") {
      setMount(campaign.id, sheet.id, { ...mount, keptSaddle: true });
    }
    return {
      kept: true,
      total,
      line: `${sheet.name} ${how} and kept the saddle (DEX save ${total} against DC ${DISMOUNT_SAVE_DC}): still mounted${why === "knocked prone" ? ", still prone" : ""}.`,
    };
  }
  setMount(campaign.id, sheet.id, null);
  // A mount that is a creature's sheet has its own square and turn again
  // (mount-link.ts), whichever of the two threw its rider.
  const steed = mount.sheetId ? getSheetById(mount.sheetId) : null;
  if (steed) {
    standBesideRider(campaign, sheet, steed);
  }
  const seq = tableNoteSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    glyph: "cue-travel",
    content: why === "knocked prone" ? `${sheet.name} is knocked prone and falls from ${mount.name}.` : `${sheet.name} is thrown from ${mount.name}.`,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
  publishPersisted(campaign.id, "mounts_updated", { mounts: getMounts(campaign.id) });
  return {
    kept: false,
    total,
    line: `${sheet.name} ${how} and fell off (DEX save ${total} against DC ${DISMOUNT_SAVE_DC}): no longer mounted, ${why === "knocked prone" ? "prone " : ""}within 5 feet of ${mount.name}.`,
  };
}

// What happened to each rider the call knocked prone, for the call's result
// and so for the model's narration.
export function settleProneRiders(campaign: Campaign, proneBefore: readonly string[]): string[] {
  const happened: string[] = [];
  for (const [riderId, mount] of Object.entries(getMounts(campaign.id))) {
    const sheet = getSheetById(riderId);
    const lying = isProne(sheet?.conditions ?? []);
    forgetStood(campaign.id, riderId, mount, lying);
    if (!sheet || !riderKnockedProne(proneBefore.includes(riderId), lying, mount.keptSaddle)) {
      continue;
    }
    const turnId = currentTurnId();
    happened.push(saddleSave(campaign, sheet, mount, turnId ? getDmTurn(turnId) : null, "knocked prone").line);
  }
  return happened;
}
