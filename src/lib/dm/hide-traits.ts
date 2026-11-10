// Racial traits that let a character hide where others cannot, read by the
// Hide action (src/lib/dm/action-tools.ts) before it refuses someone a
// watcher sees clearly.
//
// SRD 5.1:
//   - Naturally Stealthy (lightfoot halfling): can attempt to hide even when
//     obscured only by a creature at least one size larger.
//   - Mask of the Wild (wood elf): can attempt to hide even when only lightly
//     obscured by foliage, heavy rain, falling snow, mist and other natural
//     phenomena.
// A trait answers only for the watchers it covers; any other clear view
// still stops the hide.
import { hasSkulker } from "@/lib/srd/feat-combat";
import { zoneHidesFrom } from "@/lib/dm/zone-rules";
import { enemySenses } from "@/lib/dm/attack-light";
import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import { listEnemies } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { coverBetween, hasLineOfSight } from "@/lib/battlemap/los";
import { blockedLines } from "@/lib/battlemap/sight-lines";
import { chebyshev } from "@/lib/battlemap/types";
import { conditionSeesInvisible } from "@/lib/srd/condition-effect-queries";
import { normalizeClock } from "@/lib/dm/calendar";
import { sizeForRace } from "@/lib/srd";
import { holdsFeature } from "@/lib/srd/trait-rules";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { weatherPerceptionRider } from "@/lib/srd/weather";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";

const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const rank = (size: string | undefined) => {
  const at = SIZES.indexOf((size ?? "medium").toLowerCase());
  return at < 0 ? 2 : at;
};

// Mask of the Wild's cover: the sky's weather that lightly obscures (fog,
// heavy rain, driving snow), or dim light on an outdoor board.
function lightlyObscuredByNature(campaign: Campaign, map: { outdoors?: boolean; ambient?: string }): boolean {
  if (map.outdoors === false) {
    return false;
  }
  if (map.ambient === "dim") {
    return true;
  }
  return weatherPerceptionRider(normalizeClock(campaign.clock).weather).disadvantage;
}

// take_action's refusal of a Hide (SRD 5.1, Hiding: "You can't hide from a
// creature that can see you clearly"), or null. The board view sends it for
// the viewer's own token, so the Hand shuts its Hide cards in these words;
// before it the cards were open on a lit, open field and the engine refused.
export function hideRefusal(campaign: Campaign, encounterId: string, sheet: CharacterSheet): ToolError | null {
  const watcher = seenClearlyDespiteTraits(campaign, encounterId, sheet);
  return watcher
    ? { error: `${sheet.name} cannot hide: ${watcher} sees them clearly. They move out of its sight, behind cover or into darkness first, then hide.`, refused: "rules" }
    : null;
}

// The name of a watcher who sees this character clearly and whom no trait
// of theirs answers, or null when nobody does.
export function seenClearlyDespiteTraits(
  campaign: Campaign,
  encounterId: string,
  sheet: CharacterSheet,
): string | null {
  const map = getBattleMapForEncounter(encounterId);
  const hider = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!map || !hider) {
    return null;
  }
  const masked = holdsFeature(sheet, "mask of the wild") && lightlyObscuredByNature(campaign, map);
  if (masked) {
    return null;
  }
  // Skulker: lightly obscured is enough to hide, indoors or out (feat-combat.ts).
  if (hasSkulker(sheet) && (map.ambient === "dim" || lightlyObscuredByNature(campaign, map))) {
    return null;
  }
  const stealthy = holdsFeature(sheet, "naturally stealthy");
  const mySize = rank(sizeForRace(sheet.race));
  const tokens = listTokens(map.id);
  // A creature one size larger than the hider standing in the sight lines.
  const screened = (fromX: number, fromY: number) =>
    tokens.some((token) => {
      if (token.refId === sheet.id || (token.x === fromX && token.y === fromY)) {
        return false;
      }
      const other = getSheetById(token.refId);
      const enemy = other ? null : listEnemies(encounterId).find((entry) => entry.id === token.refId);
      const size = other ? sizeForRace(other.race) : (enemy?.stats.size as string | undefined);
      return (
        rank(size) > mySize &&
        blockedLines([{ x: fromX, y: fromY }], [{ x: hider.x, y: hider.y }], (x, y) => x === token.x && y === token.y) > 0
      );
    });
  // "For the purpose of hiding, the creature is heavily obscured" (SRD 5.1,
  // Conditions, Invisible): only a watcher that sees the invisible (See
  // Invisibility, truesight) or needs no sight (blindsight) in range sees it.
  const invisible = sheet.conditions.some((name) => isConditionNamed(name, "invisible"));
  for (const enemy of listEnemies(encounterId)) {
    if (enemy.status !== "alive" || enemy.conditions.some((name) => name.toLowerCase() === "blinded")) {
      continue;
    }
    const token = getTokenByRef(map.id, enemy.id);
    if (!token) {
      continue;
    }
    if (invisible && !conditionSeesInvisible(enemy.conditions)) {
      const senses = enemySenses(enemy);
      const apart = chebyshev(token.x, token.y, hider.x, hider.y);
      if (apart > senses.truesight && apart > senses.blindsight) {
        continue;
      }
    }
    const sighted = hasLineOfSight(map.terrain, map.width, token.x, token.y, hider.x, hider.y);
    const cover = coverBetween(map.terrain, map.width, map.height, token.x, token.y, hider.x, hider.y);
    const dark = map.ambient === "dark" && hider.lightRadius <= 0;
    // A fog cloud or magical darkness between them hides as darkness does (zone-rules.ts).
    if (!sighted || cover > 0 || dark || zoneHidesFrom(map, token, hider, enemySenses(enemy))) {
      continue;
    }
    if (stealthy && screened(token.x, token.y)) {
      continue;
    }
    return enemy.displayName;
  }
  return null;
}
