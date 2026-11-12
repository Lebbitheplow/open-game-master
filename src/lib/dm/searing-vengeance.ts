// Searing Vengeance (The Celestial 14): "When you would make a death save,
// rise instead at half hit points, blinding and burning enemies within 30
// feet for 2d8 + Charisma radiant damage; recharges on a long rest." In a
// fight a dying warlock's death save is the start of their turn, so the
// initiative pointer stops on a warlock who can rise (encounter-tools.ts
// entryAlive) and the rise is the start of that turn (authored-turns.ts):
// they act on it, as the feature has them spring back to their feet and go
// on. Out of a fight the save game time rolls is answered the same way
// (death.ts rollDeathSave, through the stand-in registered here).
//
// Before this it was a resource the GM had to spend by hand at a moment the
// engine never stops at: the pointer walked past the dying warlock, rolled
// the save, and gave the turn away.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, listEnemies, patchEnemyConditions } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { withinFeet } from "@/lib/dm/authored-saves";
import { effectiveMaxHp, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { registerDeathSaveStandIn } from "@/lib/dm/death";
import { canRegain, regainHitPoints } from "@/lib/dm/regain";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { withActor } from "@/lib/dm/acting-party";
import { PRONE } from "@/lib/dm/vitals-logic";
import { computeSheetDerived } from "@/lib/srd";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const SEARING_VENGEANCE = "sub_searing_vengeance";
const BURST_FT = 30;
const BLINDED = "blinded";

// Whether this character's next death save is a rise instead: dying (not
// stable, not dead), holding the feature with its use, and able to regain
// hit points at all (Chill Touch keeps them down).
export function risesWithVengeance(sheet: CharacterSheet | null | undefined): boolean {
  if (!sheet || sheet.currentHp > 0 || !sheet.deathSaves || sheet.deathSaves.dead || sheet.deathSaves.stable) {
    return false;
  }
  const uses = sheet.resources?.[SEARING_VENGEANCE];
  return Boolean(uses && uses.used < uses.max) && holdsFeature(sheet, "searing vengeance") && canRegain(sheet);
}

// The rise: half their hit points, on their feet, the use spent, and each
// enemy within 30 feet burned and blinded until the end of this turn. One
// roll serves every enemy. The lines say what happened.
export function searingVengeance(campaign: Campaign, stale: CharacterSheet): string[] {
  const sheet = getSheetById(stale.id) ?? stale;
  const uses = sheet.resources?.[SEARING_VENGEANCE];
  if (!risesWithVengeance(sheet) || !uses) {
    return [];
  }
  patchSheetAudited(campaign.id, sheet.id, { resources: { ...sheet.resources, [SEARING_VENGEANCE]: { max: uses.max, used: uses.used + 1 } } }, { kind: "use_resource", reason: "Searing Vengeance, instead of a death save", delta: { resource: "Searing Vengeance", spent: 1 } });
  const gained = regainHitPoints(campaign, null, getSheetById(sheet.id) ?? sheet, Math.floor(effectiveMaxHp(sheet) / 2), "Searing Vengeance");
  // "Then you stand up if you so choose": a warlock who rose to fight stands.
  const up = getSheetById(sheet.id) ?? sheet;
  const prone = up.conditions.filter((entry) => isConditionNamed(entry, PRONE));
  if (prone.length) {
    const cleared = removeConditions(up.conditions, up.conditionMeta, prone);
    patchSheetAudited(campaign.id, up.id, { conditions: cleared.conditions, conditionMeta: cleared.meta }, { kind: "set_condition", reason: "Searing Vengeance: stands up", delta: { removed: PRONE } });
  }
  const lines = [`Searing Vengeance: instead of a death save, ${sheet.name} springs back up with ${gained} hit points in a burst of radiant light.`];
  const encounter = getActiveEncounter(campaign.id);
  const near = encounter ? listEnemies(encounter.id).filter((enemy) => enemy.status === "alive" && withinFeet(encounter.id, sheet.id, enemy.id, BURST_FT)) : [];
  if (!encounter || !near.length) {
    return lines;
  }
  const amount = rollCard(campaign, null, sheet.id, "damage", "Searing Vengeance", `2d8+${computeSheetDerived(sheet).abilityMods.cha}`, sheetAttacker(sheet)).total;
  for (const enemy of near) {
    const live = getEnemy(enemy.id);
    if (!live || live.status !== "alive") {
      continue;
    }
    // The warlock is whose damage it is (acting-party.ts).
    lines.push(withActor({ kind: "sheet", ref: sheet.id }, () => hurtEnemy(campaign, encounter, live, Math.max(0, amount), "radiant", "Searing Vengeance")));
    const after = getEnemy(enemy.id);
    if (after && after.status === "alive") {
      // Until the end of this turn, the warlock's, which has begun.
      const meta: ConditionMetaMap = { ...(after.conditionMeta as ConditionMetaMap), [BLINDED]: { source: sheet.id, untilTurnEndOf: sheet.id, turnBegun: true } };
      patchEnemyConditions(after.id, [...after.conditions.filter((entry) => !isConditionNamed(entry, BLINDED)), BLINDED], meta);
      lines.push(`${after.displayName} is blinded until the end of ${sheet.name}'s turn.`);
    }
  }
  return lines;
}

registerDeathSaveStandIn((campaign, sheet) => {
  const lines = searingVengeance(campaign, sheet);
  return lines.length ? lines.join(" ") : null;
});
