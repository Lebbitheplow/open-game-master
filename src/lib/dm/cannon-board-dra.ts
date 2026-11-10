// The Artillerist's cannon on the board, for the two rules that read where it
// stands (src/lib/dm/feature-summons-dra.ts makes it):
//
//   Force Ballista: "a ranged spell attack at a creature within 120 feet for
//   2d8 force damage that pushes it 5 feet" (attack-blow.ts, on a hit), away
//   from the cannon. The damage landed and the creature stayed where it was.
//   Fortified Position: "you and your allies have half cover within 10 feet
//   of one" (attack-spatial.ts coverFor). Before this it was a +2 the GM was
//   to add with set_effect.

import type { Campaign } from "@/lib/db/campaigns";
import { getTokenByRef } from "@/lib/db/battle-maps";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { chebyshev } from "@/lib/battlemap/types";
import type { SpellZone } from "@/lib/battlemap/zones";
import { zoneKey } from "@/lib/battlemap/zones-spells";
import { textKey } from "@/lib/language/text-logic";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import { pushTokenAway } from "@/lib/dm/map-tools";
import { summonsOf } from "@/lib/dm/summon-store";

const CANNON = "eldritch cannon";

// The 5-foot push of a Force Ballista hit, or null for any other attack.
export function ballistaPush(campaign: Campaign, encounterId: string, sheetId: string, enemy: { id: string; displayName: string }, weapon: string): string | null {
  if (textKey(weapon) !== textKey("Force Ballista")) {
    return null;
  }
  const cannon = summonsOf(campaign.id, sheetId, "Eldritch Cannon")[0];
  const pushed = pushTokenAway(campaign, encounterId, cannon?.id ?? sheetId, enemy.id);
  return pushed.moved ? `Force Ballista: ${enemy.displayName} is pushed 5 feet, to (${pushed.at.x},${pushed.at.y})` : `Force Ballista: ${enemy.displayName} could not be pushed (${pushed.reason})`;
}

// Whether a character stands within 10 feet of a cannon whose artificer
// holds Fortified Position: half cover for them.
export function fortifiedCover(map: { id: string; campaignId: string; spellZones: SpellZone[] }, targetRef: string): boolean {
  const target = getSheetById(targetRef);
  const token = target ? getTokenByRef(map.id, target.id) : null;
  if (!target || !token || target.campaignId !== map.campaignId) {
    return false;
  }
  const cannons = map.spellZones.filter((zone) => zoneKey(zone) === CANNON);
  if (!cannons.length) {
    return false;
  }
  return listSheets(map.campaignId).some((stale) => {
    const artificer = getSheetById(stale.id) ?? stale;
    if (!holdsFeature(artificer, "fortified position") || !artificer.conditions.some((entry) => isConditionNamed(entry, CANNON))) {
      return false;
    }
    return cannons.some((zone) => zone.casterId === artificer.id && chebyshev(zone.origin.x, zone.origin.y, token.x, token.y) <= 2);
  });
}
