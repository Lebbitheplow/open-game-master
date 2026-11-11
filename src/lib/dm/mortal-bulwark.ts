// Mortal Bulwark (Oath of the Watchers, 20th level), the part a hit carries:
// "When you hit a creature with an attack and deal damage to it, you can also
// force it to make a Charisma saving throw against your spell save DC. On a
// failed save, the creature is magically banished to its native plane of
// existence if it isn't there already. On a successful save, the creature
// can't be banished by this feature for 24 hours." Only an aberration,
// celestial, elemental, fey or fiend, the creatures the feature names. Its
// truesight and advantage are rows of their own (authored-conditions.ts,
// authored-effects-data2.ts). Called from the damage stage both dice paths
// run (attack-blow.ts landSwingBlow), so a hit by real dice asks it too.

import { getEnemy, patchEnemyConditions } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import type { SwingScene } from "@/lib/dm/attack-swing";
import { isSheetFoe } from "@/lib/dm/combat-sides-logic";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { sendHome } from "@/lib/dm/spell-planes";
import { textKey } from "@/lib/language/text-logic";
import { computeSheetDerived } from "@/lib/srd";

export const MORTAL_BULWARK = "mortal bulwark";
// The mark a made save leaves, its source the paladin it was made against
// (a condition row in authored-conditions.ts says what it means).
export const BULWARK_WITHSTOOD = "withstood mortal bulwark";
export const BULWARK_TYPES = ["aberration", "celestial", "elemental", "fey", "fiend"];
// 24 hours in rounds of six seconds.
const DAY_ROUNDS = 14400;

const holds = (conditions: string[], name: string) => conditions.find((entry) => textKey(entry) === name);

// The line for the table, or null when the hit asks nothing: the paladin is
// not under Mortal Bulwark, the hit dealt no damage, the creature is of
// another type, already gone or banished, or withstood this paladin's
// banishment in the last 24 hours.
export function bulwarkBanish(scene: SwingScene, damage: number): string | null {
  const { campaign, turn } = scene;
  const sheet = getSheetById(scene.sheet.id) ?? scene.sheet;
  if (damage <= 0 || !holds(sheet.conditions, MORTAL_BULWARK)) {
    return null;
  }
  const enemy = getEnemy(scene.enemy.id);
  if (!enemy || enemy.status !== "alive" || isSheetFoe(enemy) || holds(enemy.conditions, "banished")) {
    return null;
  }
  const type = textKey(enemy.stats.type ?? "");
  if (!BULWARK_TYPES.some((kind) => type.includes(kind))) {
    return null;
  }
  const meta = enemy.conditionMeta as ConditionMetaMap;
  const withstood = holds(enemy.conditions, BULWARK_WITHSTOOD);
  if (withstood && meta[withstood]?.source === sheet.id) {
    return null;
  }
  const derived = computeSheetDerived(sheet);
  const dc = derived.spellSaveDc ?? 8 + derived.proficiencyBonus + (derived.abilityMods.cha ?? 0);
  // A banishment takes the creature out of the fight, so Legendary
  // Resistance answers a failure (resist), and Magic Resistance the save.
  const save = rollEnemySave(campaign.id, enemy, "cha", dc, {
    magical: true,
    resist: true,
    against: "banished",
    record: { turn, detail: `${enemy.displayName}: CHA save against ${sheet.name}'s Mortal Bulwark (banished on a failure)` },
  });
  if (save.success) {
    const kept = enemy.conditions.filter((entry) => textKey(entry) !== BULWARK_WITHSTOOD);
    patchEnemyConditions(enemy.id, [...kept, BULWARK_WITHSTOOD], {
      ...meta,
      [BULWARK_WITHSTOOD]: { source: sheet.id, rounds: DAY_ROUNDS },
    } as typeof enemy.conditionMeta);
    publishEncounter(campaign.id);
    const how = save.legendaryResistance ? "spends a Legendary Resistance" : `makes its Charisma save (${save.total ?? "no roll"} against DC ${dc})`;
    return `Mortal Bulwark: ${enemy.displayName} ${how} and stays; ${sheet.name}'s Mortal Bulwark cannot banish it for 24 hours.`;
  }
  const fresh = getEnemy(enemy.id) ?? enemy;
  const gone = sendHome(campaign, turn, fresh, BULWARK_TYPES, `${sheet.name}'s Mortal Bulwark`, scene.sheets, scene.sheetsById, "");
  publishEncounter(campaign.id);
  return gone ? `Mortal Bulwark: ${enemy.displayName} fails its Charisma save (DC ${dc}). ${gone}` : null;
}
