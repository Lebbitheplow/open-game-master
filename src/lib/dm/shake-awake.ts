// take_action wake: a creature spends its action to shake a sleeper awake,
// or a creature caught by Hypnotic Pattern out of its stupor (the rule and
// why: shake-awake-logic.ts). The same door for a hero, a commanded
// companion (both take_action with their characterId, the Hand's Wake card
// among them) and a creature for its ally (take_action with its enemyId,
// enemy-actions.ts). The act's own checks come before the action is spent: a
// sleeper named and within 5 feet.
// Must not import action-tools or enemy-actions (they import this).

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { withinFeet } from "@/lib/dm/authored-saves";
import { wallBetween } from "@/lib/dm/attack-spatial";
import { publishEncounter, resolveEnemyRef, unknownEnemyRef } from "@/lib/dm/enemy-damage";
import { resolveSheetRef, unknownSheetRef } from "@/lib/dm/rolls";
import { shakenAwake, wakeableSpells } from "@/lib/dm/shake-awake-logic";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { isConditionNamed } from "@/lib/srd/feature-names";

const REACH_FEET = 5;

type Sleeper = { kind: "sheet"; sheet: CharacterSheet } | { kind: "enemy"; enemy: EncounterEnemy };

export function shakeAwake(
  campaign: Campaign,
  actor: { id: string; name: string },
  args: { targetCharacterId?: string; targetEnemyId?: string },
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  spend: () => void,
): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  let sleeper: Sleeper;
  if (args.targetCharacterId?.trim()) {
    const found = resolveSheetRef(args.targetCharacterId, sheets, sheetsById);
    if (!found) {
      return unknownSheetRef("targetCharacterId", args.targetCharacterId, sheets);
    }
    sleeper = { kind: "sheet", sheet: getSheetById(found.id) ?? found };
  } else if (args.targetEnemyId?.trim()) {
    const found = encounter ? resolveEnemyRef(encounter.id, args.targetEnemyId) : null;
    if (!found || !encounter) {
      return encounter ? unknownEnemyRef(encounter.id, "targetEnemyId", args.targetEnemyId) : { error: "No fight is running: targetEnemyId names a creature of a fight. Nothing was spent.", retry: true };
    }
    sleeper = { kind: "enemy", enemy: found };
  } else {
    return { error: "Wake names the sleeper: targetCharacterId, or targetEnemyId for a creature. Nothing was spent.", retry: true };
  }
  const held = sleeper.kind === "sheet" ? sleeper.sheet : sleeper.enemy;
  const name = sleeper.kind === "sheet" ? sleeper.sheet.name : sleeper.enemy.displayName;
  if (held.id === actor.id) {
    return { error: `${actor.name} cannot shake themselves awake. Nothing was spent.`, retry: true };
  }
  const spells = wakeableSpells(held.conditions, held.conditionMeta as ConditionMetaMap);
  if (!spells.length) {
    return { error: `${name} is not asleep from Sleep or held by Hypnotic Pattern, and Wake shakes only those awake. Nothing was spent.`, retry: true };
  }
  // "Uses an action to shake or slap the sleeper": a hand on them. With no
  // board the fiction says where everyone stands.
  if (encounter && !withinFeet(encounter.id, actor.id, held.id, REACH_FEET)) {
    return { error: `${actor.name} is not within 5 feet of ${name}, and shaking a sleeper awake takes a hand on them. Move beside them first. Nothing was spent.`, refused: "rules" };
  }
  // Nor through a wall (SRD 5.1, Cover: total cover "can't be targeted
  // directly"). Within 5 feet the only wall between two squares is a diagonal
  // run of it pinching the corner they share; the distance alone let a
  // fighter shake an ally awake through it (Y21). The check is the one Help
  // and a grapple make for a hand on a creature (combat-actions.ts
  // wallBetween); attack-spatial.ts reachWalled, which leaves squares toe to
  // toe alone, never refuses anything at 5 feet. Off the board nothing is
  // measured.
  if (encounter && wallBetween(encounter.id, actor.id, held.id)) {
    return { error: `A wall stands between ${actor.name} and ${name}, and shaking a sleeper awake takes a hand on them. Move to their side of it first. Nothing was spent.`, refused: "rules" };
  }
  spend();
  const woken = shakenAwake(held.conditions, held.conditionMeta as ConditionMetaMap);
  if (sleeper.kind === "sheet") {
    const updated = patchSheet(held.id, { conditions: woken.conditions, conditionMeta: woken.meta as CharacterSheet["conditionMeta"] });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  } else {
    patchEnemyConditions(held.id, woken.conditions, woken.meta);
  }
  publishEncounter(campaign.id);
  const prone = woken.conditions.some((entry) => isConditionNamed(entry, "prone"));
  return {
    ok: true,
    action: "Wake",
    woken: name,
    applied: `${actor.name} shakes ${name} out of ${spells.join(" and ")}: no longer ${woken.ended.join(" or ")}.${prone ? ` ${name} is still prone; standing costs half their speed.` : ""}`,
  };
}
