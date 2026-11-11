// How a character who falls lands: prone, or on their feet. A fall's prone
// was laid at each door by itself, so a Cavalier thrown from a horse went
// down like anyone (Born to the Saddle: "If you fall off your mount and
// descend no more than 10 feet, you can land on your feet if you're not
// incapacitated"), and an Eagle totem barbarian's burst of flight never ended
// ("you fall if you end your turn in the air and nothing else is holding you
// aloft"). Every door that lays a fall's prone asks landsOnFeet: the rider
// thrown or brought down with the mount (mount-tools.ts), and the eagle's
// fall at the turn's end (eagleBurstFalls, turn-end.ts).

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef, setTokenMovement } from "@/lib/db/battle-maps";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { isIncapacitated } from "@/lib/dm/condition-logic";
import { aloftByMagic } from "@/lib/dm/flight-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { activeAuthored } from "@/lib/srd/authored-effects";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import { itemSpeeds } from "@/lib/srd/magic-items";

const SADDLE = "Born to the Saddle";

// The feature that lands them standing, or null when they fall prone.
// `offMount`: they came off a mount; `feet`: how far they dropped (a mount
// on the ground is under 10 feet; null when the board cannot say).
export function landsOnFeet(sheet: Pick<CharacterSheet, "features" | "conditions"> & Partial<Pick<CharacterSheet, "feats">>, fall: { offMount: boolean; feet: number | null }): string | null {
  if (fall.offMount && fall.feet !== null && fall.feet <= 10 && holdsFeature(sheet, SADDLE) && !isIncapacitated(sheet.conditions)) {
    return SADDLE;
  }
  return null;
}

// As a turn ends: a barbarian aloft on the Eagle's flight alone, with no
// spell, item or other magic holding them up, comes down prone. The board
// keeps no altitude, so the fall's damage is the GM's apply_hazard fall.
export function eagleBurstFalls(campaign: Campaign, combatantIds: string[]): string[] {
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (!map) return [];
  const lines: string[] = [];
  for (const id of combatantIds) {
    const token = getTokenByRef(map.id, id);
    const sheet = token?.movement === "fly" ? getSheetById(id) : null;
    if (!token || !sheet) continue;
    const eagle = activeAuthored(sheet, "move").some(({ held, effect }) => held.feature === "Totemic Attunement" && effect.fly !== undefined);
    if (!eagle || aloftByMagic(sheet.conditions, itemSpeeds(sheet.equipment, sheet, sheet.speed).fly)) continue;
    setTokenMovement(token.id, "walk");
    if (!sheet.conditions.some((entry) => isConditionNamed(entry, "prone"))) {
      const updated = patchSheet(sheet.id, { conditions: [...sheet.conditions, "prone"] });
      if (updated) publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    lines.push(`${sheet.name} ends their turn in the air on the eagle's burst of flight alone: they fall and land prone.`);
  }
  return lines;
}
