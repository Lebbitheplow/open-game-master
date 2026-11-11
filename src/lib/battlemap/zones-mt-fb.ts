// The areas a fighter's or barbarian's feature lays on the board, by the name
// the feature lays them under (src/lib/battlemap/zones-spells.ts AREA_ROWS
// spreads these in, as it does the gear's and the creatures').
import type { ZoneRow } from "@/lib/battlemap/zones-spells";

export const MT_FB_ZONE_ROWS: Record<string, ZoneRow> = {
  // Wild Surge, effect 7: "the ground within 15 feet of you is difficult
  // terrain for your enemies", moving with the barbarian while the rage lasts
  // (a minute at most; src/lib/dm/mt-fb-wild-surge.ts ends it with the rage).
  "wild surge": {
    shape: "aura", feet: 15, level: 0, concentration: false, rounds: 10,
    halvesHostile: true, tone: "nature",
    summary: "difficult terrain for the barbarian's enemies",
  },
};
