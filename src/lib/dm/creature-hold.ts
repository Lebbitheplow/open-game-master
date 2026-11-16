// What a creature's hit restrains a target with, and how it ends (SRD 5.1,
// Giant Spider, Web: "As an action, the restrained target can make a DC 12
// Strength check, bursting the webbing on a success. The webbing can also be
// attacked and destroyed (AC 10; hp 5; vulnerability to fire damage;
// immunity to bludgeoning, poison, and psychic damage)."). Before this a
// webbed hero's escape was refused as "not grappled", and only the GM's
// clear_condition ended the restraint.
//
// The hit lays the restraint with the hold on its instance
// (enemy-hit.ts resolveOnHit, meta `hold`, read from the block by
// hold-text.ts), so only that instance ends here and a grapple or a spell
// holding the same creature stays. The escape is take_action escape
// (grapple.ts); a blow at the webbing is damage_object naming it
// (object-damage.ts), its AC, hit points and defences the block's own.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, listEnemies, patchEnemyConditions, saveEncounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { d20Expression } from "@/lib/dice";
import { publishPersisted } from "@/lib/events";
import type { CreatureHold } from "@/lib/bestiary/hold-text";
import { instancesOf, packInstances, removeConditionInstances, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { canEnemyAct } from "@/lib/dm/can-act";
import { spendEnemyAction } from "@/lib/dm/enemy-approach";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { dmRoll } from "@/lib/dm/roll-card";
import { toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const RESTRAINED = "restrained";

type Held = { conditions: string[]; conditionMeta: unknown };

// The hold on a restrained creature, or null.
export function holdOn(held: Held): CreatureHold | null {
  const meta = held.conditionMeta as ConditionMetaMap | undefined;
  for (const name of held.conditions.filter((entry) => isConditionNamed(entry, RESTRAINED))) {
    const found = instancesOf(meta?.[name]).find((entry) => entry.hold);
    if (found?.hold) {
      return found.hold;
    }
  }
  return null;
}

// The creature with the hold's own restraint taken off; others stay.
function withoutHold(held: Held): { conditions: string[]; meta: ConditionMetaMap } {
  const cleared = removeConditionInstances(held.conditions, held.conditionMeta as ConditionMetaMap, RESTRAINED, (entry) => Boolean(entry.hold));
  return { conditions: cleared.conditions, meta: cleared.meta };
}

export type HeldCreature = { kind: "enemy"; enemy: EncounterEnemy } | { kind: "pc"; sheet: CharacterSheet };
export const heldId = (held: HeldCreature) => (held.kind === "enemy" ? held.enemy.id : held.sheet.id);
const heldName = (held: HeldCreature) => (held.kind === "enemy" ? held.enemy.displayName : held.sheet.name);
const heldOf = (held: HeldCreature): Held => (held.kind === "enemy" ? held.enemy : held.sheet);

function everyHeld(campaignId: string): HeldCreature[] {
  const encounter = getActiveEncounter(campaignId);
  const enemies: HeldCreature[] = (encounter ? listEnemies(encounter.id) : []).filter((enemy) => enemy.status === "alive" && holdOn(enemy)).map((enemy) => ({ kind: "enemy", enemy }));
  const sheets: HeldCreature[] = listSheets(campaignId)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((sheet) => holdOn(sheet))
    .map((sheet) => ({ kind: "pc", sheet }));
  return [...enemies, ...sheets];
}

// What damage_object's name means when it names a hold: its own name
// ("webbing") with one creature held by such, or "webbing on <creature>".
// Null when the name is no hold's; refused when it fits several.
export function holdObject(campaignId: string, name: string): { held: HeldCreature; hold: CreatureHold } | ToolError | null {
  const wanted = textKey(name);
  const fits = everyHeld(campaignId).filter((held) => {
    const hold = holdOn(heldOf(held))!;
    const own = textKey(hold.name);
    return wanted === own || wanted === textKey(`${hold.name} on ${heldName(held)}`) || wanted === textKey(`${heldName(held)}'s ${hold.name}`);
  });
  if (fits.length === 1) {
    return { held: fits[0], hold: holdOn(heldOf(fits[0]))! };
  }
  if (!fits.length) {
    return null;
  }
  return {
    error: `${fits.map((held) => `${holdOn(heldOf(held))!.name} on ${heldName(held)}`).join(", ")}: name the one struck that way. Nothing was rolled.`,
    retry: true,
  };
}

// The hold ends on the creature: burst or destroyed.
export function freeFromHold(campaign: Campaign, held: HeldCreature, destroyed: boolean): string {
  const hold = holdOn(heldOf(held));
  if (held.kind === "enemy") {
    const cleared = withoutHold(held.enemy);
    patchEnemyConditions(held.enemy.id, cleared.conditions, cleared.meta);
    publishEncounter(campaign.id);
  } else {
    const fresh = getSheetById(held.sheet.id) ?? held.sheet;
    const cleared = withoutHold(fresh);
    const updated = patchSheet(fresh.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  const thing = hold?.name ?? "hold";
  return destroyed ? `The ${thing} is destroyed: ${heldName(held)} is free.` : `${heldName(held)} bursts free of the ${thing}.`;
}

// A character's action to break the hold: the check the block prints. The
// caller has priced the action; `spend` pays it.
export function characterHoldEscape(campaign: Campaign, turn: DmTurn, sheet: CharacterSheet, spend: () => void): ToolResult {
  const hold = holdOn(sheet);
  if (!hold) {
    return { error: `${sheet.name} is held by nothing they can break free of.`, refused: "rules" };
  }
  spend();
  const check = rollCharacterCheck(campaign, sheet, { ability: hold.check.ability, dc: hold.check.dc }, `${sheet.name}: ${hold.check.ability.toUpperCase()} check to break free of the ${hold.name}`);
  if (check.rollId) {
    turn.rollIds.push(check.rollId);
  }
  const escaped = !check.autoFailed && check.total >= hold.check.dc;
  return {
    ok: true,
    action: "escape",
    check: `${check.total} vs DC ${hold.check.dc}`,
    success: escaped,
    note: escaped ? freeFromHold(campaign, { kind: "pc", sheet }, false) : `${sheet.name} is still restrained by the ${hold.name}.`,
  };
}

// An enemy's action to break the hold, with its own ability score.
export function enemyHoldEscape(campaign: Campaign, turn: DmTurn, enemy: EncounterEnemy): ToolResult {
  const hold = holdOn(enemy);
  const encounter = getActiveEncounter(campaign.id);
  if (!hold || !encounter) {
    return { error: `${enemy.displayName} is held by nothing it can break free of.`, retry: true };
  }
  const allowed = canEnemyAct({ enemy, encounter, kind: "action" });
  if (!allowed.ok) {
    return toolError(allowed);
  }
  spendEnemyAction(encounter, enemy.id);
  saveEncounter(encounter);
  const mod = Math.floor(((enemy.stats.abilities?.[hold.check.ability] ?? 10) - 10) / 2);
  const total = dmRoll(campaign.id, turn, "ability_check", `${enemy.displayName}: ${hold.check.ability.toUpperCase()} check to break free of the ${hold.name}`, d20Expression(mod)).total;
  const escaped = total >= hold.check.dc;
  return {
    ok: true,
    action: "escape",
    check: `${total} vs DC ${hold.check.dc}`,
    success: escaped,
    note: escaped ? freeFromHold(campaign, { kind: "enemy", enemy }, false) : `${enemy.displayName} strains against the ${hold.name} and stays restrained; its action is spent.`,
  };
}

// The hold laid with a hit's restraint: the instance the attacker's
// restraint just wrote carries it.
export function withHold(meta: ConditionMetaMap, condition: string, sourceId: string, hold: CreatureHold): ConditionMetaMap {
  const entry = meta[condition];
  if (!entry) {
    return meta;
  }
  const list = instancesOf(entry);
  const at = list.findIndex((instance) => instance.source === sourceId && !instance.hold);
  if (at < 0) {
    return meta;
  }
  return { ...meta, [condition]: packInstances(list.map((instance, index) => (index === at ? { ...instance, hold } : instance))) ?? entry };
}
