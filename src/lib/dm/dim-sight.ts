// What spares a creature's Perception the dim-light disadvantage (SRD 5.1,
// Vision and Light: dim light is lightly obscured, "disadvantage on Wisdom
// (Perception) checks that rely on sight"): the Skulker feat and an authored
// feature's dim_sight (Aspect of the Beast, Eagle). Every door that lays the
// dim-light disadvantage asks this: request_roll's Perception (rolls.ts) and
// check_notice's passive score (check-tools.ts).

import { authoredDimSight, type AuthoredSheet } from "@/lib/srd/authored-effects";
import { hasSkulker } from "@/lib/srd/feat-combat";

export function dimLightSpares(sheet: AuthoredSheet & Parameters<typeof hasSkulker>[0]): string | null {
  return hasSkulker(sheet) ? "Skulker" : authoredDimSight(sheet);
}
