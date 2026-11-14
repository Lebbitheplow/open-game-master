// Chained Hook (road warrior 3, Highway Reaver): "A hooked chain (1d8
// piercing, 15-ft reach): on hit, drag the target 10 ft toward you"
// (src/lib/classes/post-apocalyptic-features.json; WAVE2 D5: the genre text is
// the rule, played on the SRD 5.1 engine).
//
// The chain is a weapon the feature itself is (authored-effects-genre-gb.ts,
// natural_weapon "Chained Hook": 1d8 piercing, proficient). Its reach is
// three squares (src/lib/dm/pc-attack-profile.ts reads hookReachTiles), and a
// hit drags the creature two squares straight toward the warrior, stopping
// beside them, by the board's own pull (src/lib/dm/map-tools.ts
// pullTokenToward; src/lib/dm/attack-blow.ts calls hookDrag after the blow).
import type { AttackRecord } from "@/lib/dm/attack-record";
import type { SwingScene } from "@/lib/dm/attack-swing";
import { getActiveEncounter } from "@/lib/db/encounters";
import { pullTokenToward } from "@/lib/dm/map-tools";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";

export const CHAINED_HOOK = "Chained Hook";
const REACH_TILES = 3;
const DRAG_STEPS = 2;

const isHook = (sheet: Pick<CharacterSheet, "class" | "features"> & Partial<Pick<CharacterSheet, "classes">>, weapon: string | null | undefined) =>
  textKey(weapon ?? "") === textKey(CHAINED_HOOK) && holdsGenreFeature(sheet, "road_warrior", CHAINED_HOOK);

// The chain's reach in squares, or null for any other weapon.
export function hookReachTiles(sheet: Pick<CharacterSheet, "class" | "features"> & Partial<Pick<CharacterSheet, "classes">>, weapon: string | null | undefined): number | null {
  return isHook(sheet, weapon) ? REACH_TILES : null;
}

export function hookDrag(scene: SwingScene, record: AttackRecord): string | null {
  const { campaign, sheet, enemy } = scene;
  if (!isHook(sheet, record.weapon)) {
    return null;
  }
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return null;
  }
  let steps = 0;
  let stopped = "";
  for (let step = 0; step < DRAG_STEPS; step += 1) {
    const pulled = pullTokenToward(campaign, encounter.id, sheet.id, enemy.id);
    if (!pulled.moved) {
      stopped = pulled.reason;
      break;
    }
    steps += 1;
  }
  return steps
    ? `Chained Hook: ${enemy.displayName} is dragged ${steps * 5} feet toward ${sheet.name}${stopped ? ` (${stopped})` : ""}.`
    : `Chained Hook: ${enemy.displayName} is not dragged${stopped ? ` (${stopped})` : ""}.`;
}
