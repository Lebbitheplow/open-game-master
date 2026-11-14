// The horror classes' wards (cc1113 genre-c, WAVE2 D5: the genre text is the
// rule), plays of the authored spend kind "horror_spend" (rows in
// src/lib/srd/authored-effects-genre-gh.ts, areas in
// src/lib/battlemap/zones-genre-gh.ts):
//   Sanctified Ground (exorcist 5): "10 minutes of ritual wards a 30-ft area
//     for 8 hours"; Wax and Wick (Order of the Candle 3): "Your Sanctified
//     Ground ritual takes 1 minute instead of 10".
//   Warding Sigil (occultist 1): "1 minute of chalk-work wards a doorway or
//     5-ft line for 8 hours"; Rite of the Threshold (9): "can cover a 15-ft
//     radius and also blocks ethereal passage".
//   Grounding Rig (parapsychologist 11): "1/long rest, a 10-minute setup makes
//     a 20-ft radius immune to teleportation and phasing for 1 hour".
//
// Rulings:
//   - Each is minutes of work, so none is made in a fight (the spend's
//     fight: "out"). The world clock moves the minutes it takes.
//   - The ward is a condition on its setter for the hours it holds, which
//     the clock ticks down, recording the place it was set (the party's
//     current location). The area is laid on the scene board standing when
//     the work ends, and again on a fight's board when a fight begins at the
//     same place while the ward holds (layStandingWards, called by
//     src/lib/dm/encounter-tools.ts): a fight there is a fight in the ward.
//     Set somewhere else, the ward stays where it was and no fight board
//     shows it.
//   - A fight's board is laid fresh, so the area stands where its setter is
//     placed: the exorcist's ground and the rig around them, a sigil on the
//     square beside the occultist toward the nearest foe (the threshold
//     between them), or around them with Rite of the Threshold.
import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { advanceClock } from "@/lib/db/clock";
import { getBattleMapForEncounter, getTokenByRef, listTokens, type BattleMap } from "@/lib/db/battle-maps";
import { getActiveBoard, getEnemy } from "@/lib/db/encounters";
import { getCurrentLocation } from "@/lib/db/locations";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { chebyshev, type BattleToken } from "@/lib/battlemap/types";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { ToolError } from "@/lib/dm/tool-errors";
import { placeSpellZone } from "@/lib/dm/zone-cast";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { isConditionNamed, isNamed } from "@/lib/srd/feature-names";

type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };

type Ward = {
  feature: string;
  condition: string;
  zone: string;
  minutes: number;
  hours: number;
  quicker?: { feature: string; minutes: number };
  upgrade?: { feature: string; zone: string };
  // Laid on the square beside the setter toward the nearest foe.
  beside?: boolean;
};

const ROUNDS_PER_HOUR = 600;

export const GH_WARDS: Record<string, Ward> = {
  sanctified_ground: { feature: "Sanctified Ground", condition: "sanctified ground", zone: "sanctified ground", minutes: 10, hours: 8, quicker: { feature: "Wax and Wick", minutes: 1 } },
  warding_sigil: { feature: "Warding Sigil", condition: "warding sigil", zone: "warding sigil", minutes: 1, hours: 8, upgrade: { feature: "Rite of the Threshold", zone: "threshold sigil" }, beside: true },
  grounding_rig: { feature: "Grounding Rig", condition: "grounding rig", zone: "grounding rig", minutes: 10, hours: 1 },
};

const holds = (sheet: CharacterSheet, feature: string) => sheet.features.some((entry) => isNamed(entry.name, feature));

// The minutes the work takes this setter.
export function wardMinutes(sheet: CharacterSheet, ward: Ward): number {
  return ward.quicker && holds(sheet, ward.quicker.feature) ? ward.quicker.minutes : ward.minutes;
}

// The square beside the setter toward the nearest living foe (the setter's
// own square with none on the board).
function besideTowardFoe(map: BattleMap, own: BattleToken): { x: number; y: number } {
  const foes = listTokens(map.id).filter((token) => token.kind === "enemy" && getEnemy(token.refId)?.status === "alive");
  const foe = foes.reduce<BattleToken | null>((best, token) => (!best || chebyshev(own.x, own.y, token.x, token.y) < chebyshev(own.x, own.y, best.x, best.y) ? token : best), null);
  if (!foe) {
    return { x: own.x, y: own.y };
  }
  return { x: own.x + Math.sign(foe.x - own.x), y: own.y + Math.sign(foe.y - own.y) };
}

// Lays the ward's area on the board standing now, where its setter stands.
function layWard(campaign: Campaign, sheet: CharacterSheet, ward: Ward): string | null {
  const board = getActiveBoard(campaign.id);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  const own = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!map || !own) {
    return null;
  }
  const upgraded = Boolean(ward.upgrade && holds(sheet, ward.upgrade.feature));
  const derived = computeSheetDerived(sheet);
  const dc = 8 + derived.proficiencyBonus + Math.max(derived.abilityMods.int, derived.abilityMods.wis, derived.abilityMods.cha);
  return placeSpellZone(campaign, {
    spell: ward.feature,
    runsAs: upgraded && ward.upgrade ? ward.upgrade.zone : ward.zone,
    caster: { kind: "pc", id: sheet.id, name: sheet.name },
    dc,
    at: ward.beside && !upgraded ? besideTowardFoe(map, own) : { x: own.x, y: own.y },
    named: true,
    repeat: true,
  });
}

// The play: the minutes pass, the ward is set at this place, and its area is
// laid on a scene board standing now.
function setWard(ctx: SpendContext, ward: Ward): Resolution {
  const minutes = wardMinutes(ctx.sheet, ward);
  const moved = advanceClock(ctx.campaign.id, minutes, "minutes");
  if ("error" in moved) {
    return moved;
  }
  const now = getSheetById(ctx.sheet.id) ?? ctx.sheet;
  const place = getCurrentLocation(ctx.campaign.id)?.id;
  const meta: ConditionMetaMap = { ...(now.conditionMeta as ConditionMetaMap), [ward.condition]: { rounds: ward.hours * ROUNDS_PER_HOUR, ...(place ? { place } : {}) } };
  const conditions = [...now.conditions.filter((entry) => !isConditionNamed(entry, ward.condition)), ward.condition];
  // Written before the area is laid: the area holds while its setter carries the ward.
  const updated = patchSheet(now.id, { conditions, conditionMeta: meta });
  if (updated) {
    publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
  }
  const laid = layWard(ctx.campaign, updated ?? now, ward);
  return {
    result: {
      applied: `${ctx.sheet.name} spends ${minutes} minute${minutes === 1 ? "" : "s"} on ${ward.feature}; it holds here for ${ward.hours} hour${ward.hours === 1 ? "" : "s"}, and a fight that begins here is fought in it.`,
      ...(laid ? { area: laid } : {}),
    },
  };
}

export const GH_WARD_PLAYS: Record<string, (ctx: SpendContext) => Resolution> = Object.fromEntries(
  Object.entries(GH_WARDS).map(([play, ward]) => [play, (ctx: SpendContext) => setWard(ctx, ward)]),
);

// A fight begins: every ward still holding at the party's place is laid on
// its board. The lines say what was laid.
export function layStandingWards(campaignId: string): string[] {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return [];
  }
  const place = getCurrentLocation(campaignId)?.id;
  const lines: string[] = [];
  for (const sheet of listSheets(campaignId)) {
    const meta = sheet.conditionMeta as ConditionMetaMap;
    for (const ward of Object.values(GH_WARDS)) {
      const held = sheet.conditions.find((entry) => isConditionNamed(entry, ward.condition));
      if (!held || (meta[held]?.place ?? undefined) !== place) {
        continue;
      }
      const laid = layWard(campaign, sheet, ward);
      if (laid) {
        lines.push(laid);
      }
    }
  }
  return lines;
}
