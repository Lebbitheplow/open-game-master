// Cauterizing Flames (Circle of Wildfire 10): "When a Small or larger creature
// dies within 30 feet of you or your wildfire spirit, a harmless spectral
// flame springs forth in the dead creature's space and flickers there for 1
// minute. When a creature you can see enters that space, you can use your
// reaction to extinguish the spectral flame there and either heal the
// creature or deal fire damage to it."
//
// Before this the reaction was taken with nobody dead and nothing burning,
// and its card sat open on the druid's own turn. Now a death lays the flame
// (enemy-damage.ts calls layFlamesOnDeath where it records the death), the
// druid keeps the flames on their sheet (the condition's meta, so a turn's
// revert takes them back with the sheet row), and the reaction is taken only
// on a creature standing in one of them, which goes out with it
// (authored-spend-divine.ts cauterizing). The flame's place is a square of
// the board; "enters that space" is read as standing in it when the reaction
// is called, since the move that took it there is already made.
import { getActiveEncounter, type Encounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import { sizeRank } from "@/lib/bestiary/enemy-numbers";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";

import { FLAME_FEET, FLAME_MARK, FLAME_ROUNDS, heldFlames, metaOf, type SpectralFlame } from "@/lib/dm/cauterizing-flames-logic";

export { FLAME_MARK, heldFlames, type SpectralFlame } from "@/lib/dm/cauterizing-flames-logic";


function writeFlames(campaignId: string, sheet: CharacterSheet, flames: SpectralFlame[]) {
  const others = sheet.conditions.filter((entry) => !isConditionNamed(entry, FLAME_MARK));
  const meta = { ...((sheet.conditionMeta ?? {}) as Record<string, unknown>) };
  delete meta[FLAME_MARK];
  const patch: FullPatchSheetInput = flames.length
    ? { conditions: [...others, FLAME_MARK], conditionMeta: { ...meta, [FLAME_MARK]: { flames } } as FullPatchSheetInput["conditionMeta"] }
    : { conditions: others, conditionMeta: meta as FullPatchSheetInput["conditionMeta"] };
  const updated = patchSheet(sheet.id, patch);
  if (updated) publishPersisted(campaignId, "sheet_updated", { sheet: updated });
}

const live = (flames: SpectralFlame[], encounter: Pick<Encounter, "round">) => flames.filter((flame) => flame.untilRound >= encounter.round);

const feetBetween = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 5;

// A creature died at its token's square: every Wildfire druid within 30 feet
// of it gains a flame there. A Tiny creature leaves none. (The wildfire
// spirit's own 30 feet waits on the spirit standing on the board as a token
// of its own; until then the druid's place is measured.)
export function layFlamesOnDeath(campaignId: string, dead: { id: string; size?: string | null }) {
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const where = map ? getTokenByRef(map.id, dead.id) : null;
  if (!encounter || !map || !where) return;
  if (dead.size && sizeRank(dead.size) < sizeRank("small")) return;
  const tokens = listTokens(map.id);
  for (const stale of listSheets(campaignId)) {
    const druid = getSheetById(stale.id) ?? stale;
    if (druid.deathSaves?.dead || !holdsFeature(druid, "Cauterizing Flames")) continue;
    const own = tokens.find((token) => token.refId === druid.id);
    if (!own || feetBetween(own, where) > FLAME_FEET) continue;
    const flames = live(heldFlames(druid), encounter).filter((flame) => flame.x !== where.x || flame.y !== where.y);
    writeFlames(campaignId, druid, [...flames, { x: where.x, y: where.y, untilRound: encounter.round + FLAME_ROUNDS }]);
  }
}

// The flame the creature `ref` stands in, among the druid's live ones.
export function flameUnder(campaignId: string, druid: CharacterSheet, ref: string): SpectralFlame | null {
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, ref) : null;
  if (!encounter || !token) return null;
  return live(heldFlames(druid), encounter).find((flame) => flame.x === token.x && flame.y === token.y) ?? null;
}

// The flame goes out.
export function quenchFlame(campaignId: string, druid: CharacterSheet, flame: SpectralFlame) {
  const fresh = getSheetById(druid.id) ?? druid;
  writeFlames(campaignId, fresh, heldFlames(fresh).filter((entry) => entry.x !== flame.x || entry.y !== flame.y));
}

