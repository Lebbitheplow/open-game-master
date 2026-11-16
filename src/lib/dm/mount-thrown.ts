// A rider knocked prone in the saddle.
//
// "If you're knocked prone while mounted, you must make the same saving
// throw" (SRD 5.1, Mounting and Dismounting): the DC 10 Dexterity save "or
// fall off the mount, landing prone in a space within 5 feet of it". Nothing
// asked for it unless the GM sent dismount with cause rider-prone: a rider
// laid prone by a blow, a spell, a hazard or 0 hit points stayed prone and
// mounted, riding on at the horse's speed.
//
// Prone reaches a sheet from many doors (set_condition, an enemy's blow, an
// area, a fall, the drop to 0), so this is asked where an engine call
// finishes (encounter-tools.ts settleTurn) rather than at each of them.

import type { Campaign } from "@/lib/db/campaigns";
import { getDmTurn } from "@/lib/db/dm-turns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getMounts, setMount } from "@/lib/db/mounts";
import { getSheetById } from "@/lib/db/sheets";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { rollCharacterSave } from "@/lib/dm/forced-save";
import { currentTurnId } from "@/lib/dm/job-control";
import { tableNoteSeq } from "@/lib/dm/narration-slot";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { DISMOUNT_SAVE_DC, riderKnockedProne } from "@/lib/srd/mounts";

const isProne = (conditions: readonly string[]) => conditions.some((entry) => isConditionNamed(entry, "prone"));

// The riders already prone as an engine call begins (encounter-tools.ts
// turnHolder): the call did not knock them prone, and a call the engine
// refuses must write nothing about them.
export function proneRiders(campaignId: string): string[] {
  return Object.keys(getMounts(campaignId)).filter((riderId) => isProne(getSheetById(riderId)?.conditions ?? []));
}

// What happened to each rider the call knocked prone, for the call's result
// and so for the model's narration.
export function settleProneRiders(campaign: Campaign, proneBefore: readonly string[]): string[] {
  const mounts = getMounts(campaign.id);
  const happened: string[] = [];
  let changed = false;
  for (const [riderId, mount] of Object.entries(mounts)) {
    const sheet = getSheetById(riderId);
    if (!sheet || !riderKnockedProne(proneBefore.includes(riderId), isProne(sheet.conditions))) {
      continue;
    }
    const turnId = currentTurnId();
    const save = rollCharacterSave(campaign, turnId ? getDmTurn(turnId) : null, sheet, "dex", DISMOUNT_SAVE_DC, `${sheet.name}: DEX save to stay in the saddle`);
    if (save.success) {
      happened.push(`${sheet.name} was knocked prone while riding ${mount.name} and kept the saddle (DEX save ${save.total ?? "made"} against DC ${DISMOUNT_SAVE_DC}): still mounted, still prone.`);
      continue;
    }
    setMount(campaign.id, riderId, null);
    changed = true;
    const seq = tableNoteSeq(campaign.id);
    const message = insertCampaignMessage({
      campaignId: campaign.id,
      seq,
      authorType: "system",
      glyph: "cue-travel",
      content: `${sheet.name} is knocked prone and falls from ${mount.name}.`,
    });
    publishWithSeq(campaign.id, seq, "message_added", { message });
    happened.push(`${sheet.name} was knocked prone while riding ${mount.name} and fell off (DEX save ${save.total ?? "failed with no roll"} against DC ${DISMOUNT_SAVE_DC}): no longer mounted, prone within 5 feet of ${mount.name}.`);
  }
  if (changed) {
    publishPersisted(campaign.id, "mounts_updated", { mounts: getMounts(campaign.id) });
  }
  return happened;
}
