// The areas a class feature lays on the battle map rather than a spell: they
// run as the spell areas do (src/lib/battlemap/zones-spells.ts zoneRowFor
// reads these after the spells), laid by the feature's spend
// (src/lib/dm/authored-spend-effects.ts, a buff row's `zone`) and gone with
// the condition the spend lays. Pure data.

import type { ZoneRow } from "@/lib/battlemap/zones-spells";

export const FEATURE_ZONE_ROWS: Record<string, ZoneRow> = {
  // SRD 5.1 Oathbreaker, Dread Lord: "you can use an action to surround
  // yourself with an aura of gloom that lasts for 1 minute. The aura reduces
  // any bright light in a 30-foot radius around you to dim light." An aura,
  // so it follows the paladin's token (zones.ts withAnchors), and it ends
  // with the "dread lord" condition the spend lays, early or at its minute.
  "dread lord": {
    shape: "aura", feet: 30, level: 0, concentration: false, rounds: 10,
    whileCondition: "dread lord", dims: true, tone: "gloom",
    summary: "the oathbreaker's aura of gloom: bright light within 30 feet is dim",
  },
};
