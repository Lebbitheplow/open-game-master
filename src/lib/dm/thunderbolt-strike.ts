// Thunderbolt Strike (Tempest Domain, 6th level): "Lightning damage you deal
// pushes a Large or smaller creature 10 feet away."
//
// Called from the one door damage to a creature lands through
// (enemy-damage.ts applyEnemyDamage), which knows whose call is running
// (acting-party.ts): a weapon, a spell, an area, Wrath of the Storm's
// reaction or a feature's spend all push alike. Before this the row was a
// note asking the GM to move the token.

import { getSheetById } from "@/lib/db/sheets";
import type { Campaign } from "@/lib/db/campaigns";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { sizeRank } from "@/lib/bestiary/enemy-numbers";
import { currentActor } from "@/lib/dm/acting-party";
import { pushStraightAway } from "@/lib/dm/ar-ws-storm-fury";
import { holdsFeature } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";

const PUSH_FEET = 10;
const LARGEST = "large";
const LIGHTNING = "lightning";

// The line for the table when the blow pushes, else null. `types`: every
// damage type of the blow; `lost`: the hit points it took.
export function thunderboltPush(campaign: Campaign, encounterId: string, enemy: EncounterEnemy, types: ReadonlyArray<string | null | undefined>, lost: number): string | null {
  const actor = currentActor();
  if (!actor || actor.kind !== "sheet" || lost <= 0 || enemy.status !== "alive" || !types.some((type) => textKey(type ?? "") === textKey(LIGHTNING))) {
    return null;
  }
  const dealer = getSheetById(actor.ref);
  if (!dealer || !holdsFeature(dealer, "thunderbolt strike")) {
    return null;
  }
  const size = typeof enemy.stats.size === "string" ? enemy.stats.size : "medium";
  if (sizeRank(size) > sizeRank(LARGEST)) {
    return `Thunderbolt Strike: ${enemy.displayName} is larger than Large and is not pushed.`;
  }
  return `Thunderbolt Strike: ${pushStraightAway(campaign, encounterId, dealer, enemy, PUSH_FEET)}`;
}
