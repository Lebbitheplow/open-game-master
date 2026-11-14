// Squire of Bones (grave knight 17), wired by the 2026-11-13 creator audit's
// second genre pass: "1/long rest, raise one slain foe as a loyal skeletal
// squire for 8 hours (uses its stats, obeys you)". Resolved as the genre_cc
// play "squire" (src/lib/dm/genre-cc-a-spends.ts).
//
// Rulings:
//   - "one slain foe" is an enemy of this campaign the table has marked dead,
//     named by targetEnemyId; a living, fled or already raised one is refused
//     with nothing spent;
//   - "uses its stats" is the foe's own block as the fight held it: the
//     enemy row's armor class and full hit points (a GM may have set them),
//     its speeds, scores, every attack and its defences, the proficiency of
//     its challenge rating (the summon's level). It is undead now: "skeletal";
//   - "obeys you": a companion of the knight's, acting right after them in
//     the order (the summon store's "caster" initiative), for 8 hours (4800
//     rounds) unless destroyed first.
import { randomUUID } from "node:crypto";
import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { parseSpeed } from "@/lib/bestiary/kit";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { summonRecord } from "@/lib/dm/summon-rules";
import { spawnSummons } from "@/lib/dm/summon-store";
import type { CreatureAbility } from "@/lib/srd/creature-attacks";
import type { CreatureSize } from "@/lib/srd/srd-creatures";
import type { SummonForm } from "@/lib/srd/summon-forms";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";
import { RAISED_SQUIRE as RAISED } from "@/lib/srd/genre-cc-a-conditions";

export const SQUIRE_OF_BONES = "Squire of Bones";
const EIGHT_HOURS = 4800;
const SIZES: CreatureSize[] = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
const ABILITIES: CreatureAbility[] = ["str", "dex", "con", "int", "wis", "cha"];

// The foe's block as a summon form. Pure.
export function squireForm(enemy: Pick<EncounterEnemy, "displayName" | "ac" | "maxHp" | "cr" | "stats">): SummonForm {
  const { stats } = enemy;
  const speeds = parseSpeed(stats.speed);
  const size = SIZES.find((entry) => textKey(entry) === textKey(stats.size ?? "")) ?? "Medium";
  const abilities = Object.fromEntries(
    ABILITIES.map((ability) => [ability, stats.abilities?.[ability] ?? (ability === "dex" ? 10 + 2 * stats.dexMod : 10)]),
  ) as Record<CreatureAbility, number>;
  return {
    name: `Skeletal ${enemy.displayName}`.slice(0, 50),
    type: "undead",
    size,
    cr: enemy.cr,
    ac: enemy.ac || stats.ac,
    hp: enemy.maxHp || stats.maxHp,
    speed: speeds.walk,
    ...(speeds.fly ? { fly: speeds.fly } : {}),
    ...(speeds.swim ? { swim: speeds.swim } : {}),
    ...(speeds.climb ? { climb: speeds.climb } : {}),
    ...(speeds.burrow ? { burrow: speeds.burrow } : {}),
    abilities,
    attacks: stats.attacks
      .filter((attack) => !attack.bonusAction)
      .map((attack) => ({
        name: attack.name,
        toHit: attack.toHit,
        damage: attack.damage,
        type: attack.type.split("/")[0] || attack.type,
        ...(attack.reach ? { reach: attack.reach } : {}),
        ...(attack.range ? { range: attack.range.normal, longRange: attack.range.long } : {}),
        ...(attack.mode === "both" ? { thrown: true } : {}),
        ...(attack.riders?.length ? { riders: attack.riders.map((rider) => ({ dice: rider.dice, type: rider.type })) } : {}),
      })),
    attacksPerTurn: stats.attacksPerTurn ?? 1,
    resist: stats.resist,
    immune: stats.immune,
    vulnerable: stats.vulnerable,
    conditionImmune: stats.conditionImmune,
    traits: `${enemy.displayName}, slain and raised as a skeletal squire; it obeys the grave knight who raised it.`,
  };
}

export function raiseSquire(campaign: Campaign, sheet: CharacterSheet, enemyId: string | undefined): ToolError | { result: Record<string, unknown> } {
  const enemy = enemyId ? getEnemy(enemyId) : null;
  if (!enemy || enemy.campaignId !== campaign.id) {
    return { error: `${SQUIRE_OF_BONES} raises one slain foe: name it by targetEnemyId. Nothing was spent.`, retry: true };
  }
  if (enemy.status !== "dead") {
    return { error: `${enemy.displayName} is not slain; ${SQUIRE_OF_BONES} raises a foe that has died. Nothing was spent.`, refused: "rules" };
  }
  if (enemy.conditions.some((entry) => isConditionNamed(entry, RAISED))) {
    return { error: `${enemy.displayName}'s bones already rose as a squire. Nothing was spent.`, refused: "rules" };
  }
  const form = squireForm(enemy);
  const record = summonRecord(form, { spell: SQUIRE_OF_BONES, casterId: sheet.id, casterName: sheet.name, concentration: false, castId: randomUUID().slice(0, 8) });
  const [made] = spawnSummons(campaign, sheet, { form, count: 1, record, rounds: EIGHT_HOURS, slotLevel: null, initiative: "caster" });
  if (!made) {
    return { error: `${SQUIRE_OF_BONES} found no way to raise ${enemy.displayName}. Nothing was spent.`, refused: "rules" };
  }
  patchEnemyConditions(enemy.id, [...enemy.conditions, RAISED], { ...((enemy.conditionMeta ?? {}) as ConditionMetaMap) } as typeof enemy.conditionMeta);
  return {
    result: {
      summoned: [{ characterId: made.id, name: made.name, hp: `${made.currentHp}/${made.maxHp}`, ac: made.ac }],
      creature: `${form.name}: undead, ${form.hp} HP, AC ${form.ac}${form.attacks.length ? `, ${form.attacks.map((attack) => `${attack.name} +${attack.toHit} (${attack.damage} ${attack.type})`).join(", ")}` : ", no attack"}`,
      note: `${made.name} obeys ${sheet.name} for 8 hours, acting right after them; it attacks with pc_attack under its own characterId.`,
    },
  };
}
