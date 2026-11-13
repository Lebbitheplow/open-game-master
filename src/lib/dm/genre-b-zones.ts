// The areas a genre spend lays (WAVE2 D5), by their rows in
// src/lib/battlemap/zones-genre-b.ts: Gear Swarm's gears and Dissolving
// Mist's fog thrown onto a creature within the feature's reach, Dawnlight's
// sunlight standing on the preacher. Every genre spend that puts an area on
// the board comes through layGenreZone, so its reach is checked before the
// use is paid and its DC rides the area for the zone triggers.
//
// Off a board the use is paid and the GM places the area in the story.

import { getBattleMapForEncounter, getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import { getActiveBoard, getEnemy } from "@/lib/db/encounters";
import { chebyshev } from "@/lib/battlemap/types";
import { placeSpellZone } from "@/lib/dm/zone-cast";
import { computeSheetDerived } from "@/lib/srd";
import type { GenreZoneSpec } from "@/lib/srd/authored-effects-types";
import type { Campaign } from "@/lib/db/campaigns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { isNamed } from "@/lib/srd/feature-names";

type Lay = { campaign: Campaign; sheet: CharacterSheet; name: string; targetEnemyId?: string };

// Where a thrown area lands: on the creature named, else on the nearest foe,
// held to the feature's reach. Null for an area that stands on its holder.
function landing(input: Lay, spec: GenreZoneSpec): ToolError | { x: number; y: number } | null {
  if (!spec.rangeFt) {
    return null;
  }
  const encounter = getActiveBoard(input.campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const own = map ? getTokenByRef(map.id, input.sheet.id) : null;
  if (!map || !own) {
    return null;
  }
  const alive = (refId: string) => getEnemy(refId)?.status === "alive";
  const foes = listTokens(map.id).filter((token) => token.kind === "enemy" && alive(token.refId));
  const apart = (token: { x: number; y: number }) => chebyshev(own.x, own.y, token.x, token.y);
  const named = input.targetEnemyId ? foes.find((token) => token.refId === input.targetEnemyId) : null;
  if (input.targetEnemyId && !named) {
    return { error: `${input.name} is thrown onto a creature on the board, and ${input.targetEnemyId} is none standing. Name another targetEnemyId. Nothing was spent.`, retry: true };
  }
  const at = named ?? foes.reduce<(typeof foes)[number] | null>((best, token) => (!best || apart(token) < apart(best) ? token : best), null);
  if (!at) {
    return { x: own.x, y: own.y };
  }
  if (apart(at) * 5 > spec.rangeFt) {
    return { error: `${input.name} reaches ${spec.rangeFt} feet, and the creature it would land on is ${apart(at) * 5} feet from ${input.sheet.name}. Name a creature within ${spec.rangeFt} feet. Nothing was spent.`, refused: "rules" };
  }
  return { x: at.x, y: at.y };
}

// Checks the reach, then lays the area. Returns the refusal (nothing laid,
// nothing to pay) or the lines for the spend's result.
export function layGenreZone(input: Lay, spec: GenreZoneSpec): ToolError | string[] {
  const at = landing(input, spec);
  if (at && "error" in at) {
    return at;
  }
  const lays = spec.upgrade && input.sheet.features.some((feature) => isNamed(feature.name, spec.upgrade!.feature)) ? spec.upgrade.lays : spec.lays;
  const derived = computeSheetDerived(input.sheet);
  const dc = spec.dcAbility ? 8 + derived.proficiencyBonus + derived.abilityMods[spec.dcAbility] : undefined;
  const line = placeSpellZone(input.campaign, {
    spell: input.name,
    runsAs: lays,
    caster: { kind: "pc", id: input.sheet.id, name: input.sheet.name },
    ...(dc ? { dc } : {}),
    ...(at ? { at } : {}),
  });
  return [line ?? `${input.name}: there is no board, so the GM places the area in the story.`];
}
