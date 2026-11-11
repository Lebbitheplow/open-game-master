// Way of the Ascendant Dragon past the breath (wave 2, part mr): Aspect of
// the Wyrm's aura, Explosive Fury as it rises, and Augment Breath.
//
// "A bonus action creates a 10-foot aura for a minute that either frightens
// enemies or grants allies resistance to your damage type" (Aspect of the
// Wyrm). The spend laid a condition on the monk and nothing read it: no
// creature in the aura was ever frightened and no ally resisted anything.
// Now the frightening aura asks a Wisdom save against the ki save DC of each
// enemy that starts its turn within 10 feet (authored-turns.ts calls
// wyrmFrightens), and the ward's condition names its type for the row's
// aura_resist (authored-saves.ts authoredAuraResistances).
//
// "Explosive Fury: when you activate Aspect of the Wyrm, each creature of
// your choice in its aura makes a Dexterity save against your ki save DC or
// takes 3d10 damage of a type you choose for Draconic Strike" (Ascendant
// Aspect). It was a spend of its own, dealt as a card with nothing to answer;
// it rides the activation here.
//
// "Augment Breath: spending 1 ki when you use Breath of the Dragon makes it a
// 60-foot cone or a 90-foot line 5 feet wide that deals four rolls of your
// martial arts die." The breath's own call asks for it, the word "augmented"
// beside the damage type (resource-tools.ts, case "aoe", calls breathAugment):
// one call, one breath, the ki paid only if the breath is breathed.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { damageEnemy, type SpendContext } from "@/lib/dm/authored-spend-effects";
import { withinFeet } from "@/lib/dm/authored-saves";
import { incapacitatedBy, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { bindsWorthResisting } from "@/lib/dm/legendary-logic";
import { holdsRow } from "@/lib/dm/mt-mr-turn";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { foesOfSheet, resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { swallowCoverBetween } from "@/lib/dm/swallow";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { computeSheetDerived } from "@/lib/srd";
import { hasCondition } from "@/lib/srd/authored-effects";
import { martialArtsDie } from "@/lib/srd/feature-effects";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { DRACONIC_TYPES, draconicStrikeType } from "@/lib/srd/mt-mr-unarmed";

type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };

export const WYRM_FRIGHTEN = "aspect of the wyrm: frighten";
export const WYRM_WARD = "aspect of the wyrm: ward";
const AURA_FEET = 10;
const AURA_ROUNDS = 10;
// The word that asks for Augment Breath in the breath's variant, and the
// reach it gives ("a 60-foot cone or a 90-foot line": the engine measures the
// line, as it measures the plain breath's 30-foot one).
export const AUGMENTED = "augmented";
const AUGMENTED_FEET = 90;
const BREATH = "sub_breath_of_the_dragon";

// "Your ki save DC": 8 + proficiency + Wisdom.
function kiSaveDc(sheet: CharacterSheet): number {
  const derived = computeSheetDerived(sheet);
  return 8 + derived.proficiencyBonus + derived.abilityMods.wis;
}

// The creatures Explosive Fury catches: those named, each within the aura, or
// with none named every foe in it.
function furyTargets(ctx: SpendContext, encounter: Encounter): EncounterEnemy[] | ToolError {
  const { sheet } = ctx;
  const named = [...(ctx.args.targetEnemyIds ?? []), ...(ctx.args.targetEnemyId ? [ctx.args.targetEnemyId] : [])];
  if (!named.length) {
    return foesOfSheet(ctx.campaign.id, encounter, sheet.id).filter(
      (foe) => foe.status === "alive" && withinFeet(encounter.id, sheet.id, foe.id, AURA_FEET) && !swallowCoverBetween(sheet.id, foe.id),
    );
  }
  const out: EncounterEnemy[] = [];
  for (const ref of new Set(named)) {
    const enemy = resolveTargetFoe(ctx.campaign.id, encounter, ref);
    if (!enemy || enemy.status !== "alive") {
      return { error: `Explosive Fury needs living creatures in the fight: "${ref}" is none. Pass ids from GAME STATE. Nothing was spent.`, retry: true };
    }
    if (!withinFeet(encounter.id, sheet.id, enemy.id, AURA_FEET) || swallowCoverBetween(sheet.id, enemy.id)) {
      return { error: `${enemy.displayName} is outside the ${AURA_FEET}-foot aura of ${sheet.name}, and Explosive Fury catches creatures in it. Nothing was spent.`, refused: "rules" };
    }
    out.push(enemy);
  }
  return out;
}

// Explosive Fury on the creatures chosen: one roll of 3d10, a Dexterity save
// each, nothing on a success.
function explosiveFury(ctx: SpendContext, encounter: Encounter, targets: EncounterEnemy[], type: string): string[] {
  if (!targets.length) {
    return [];
  }
  const { sheet } = ctx;
  const dc = kiSaveDc(sheet);
  const rolled = rollCard(ctx.campaign, ctx.turn, sheet.id, "damage", "Explosive Fury", "3d10", sheetAttacker(sheet)).total;
  const lines: string[] = [];
  for (const target of targets) {
    const enemy = getEnemy(target.id) ?? target;
    const save = rollEnemySave(ctx.campaign.id, enemy, "dex", dc, {
      magical: true,
      origin: { ref: sheet.id },
      record: { turn: ctx.turn ?? undefined, detail: `${enemy.displayName}: DEX save against Explosive Fury` },
    });
    if (save.success) {
      lines.push(`Explosive Fury: ${enemy.displayName} saves (DEX ${save.total} vs DC ${dc}) and takes nothing.`);
      continue;
    }
    damageEnemy(ctx, enemy, rolled, type);
    lines.push(`Explosive Fury: ${enemy.displayName} fails (DEX ${save.total ?? "no roll"} vs DC ${dc}) and takes ${rolled} ${type}.`);
  }
  return lines;
}

// Aspect of the Wyrm, either aura. The ward's type is the word after "ward"
// in the variant; Explosive Fury deals the ward's type, or with the
// frightening aura the type chosen for Draconic Strike.
export function aspectOfTheWyrm(ctx: SpendContext, ward: boolean): Resolution {
  const { sheet } = ctx;
  const asked = textKey(ctx.args.variant ?? "").split(" ").pop() ?? "";
  const wardType = ward ? DRACONIC_TYPES.map(textKey).find((type) => type === asked) : null;
  if (ward && !wardType) {
    return { error: `${ctx.spend.name}'s ward takes a damage type: variant "ward acid", "ward cold", "ward fire", "ward lightning" or "ward poison". Nothing was spent.`, retry: true };
  }
  const encounter = getActiveEncounter(ctx.campaign.id);
  const fury = holdsRow(sheet, "monk::Ascendant Aspect") && encounter ? (wardType ?? draconicStrikeType(sheet)) : null;
  const caught = fury && encounter ? furyTargets(ctx, encounter) : [];
  if ("error" in caught) {
    return caught;
  }
  const unchosen = Boolean(encounter && holdsRow(sheet, "monk::Ascendant Aspect") && !fury);
  const condition = ward ? `${WYRM_WARD} (${wardType})` : WYRM_FRIGHTEN;
  const old = sheet.conditions.filter((entry) => isConditionNamed(entry, WYRM_FRIGHTEN, WYRM_WARD));
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, old);
  const lines = fury && encounter ? explosiveFury(ctx, encounter, caught, fury) : [];
  return {
    patch: {
      conditions: [...cleared.conditions, condition],
      conditionMeta: { ...cleared.meta, [condition]: { rounds: AURA_ROUNDS } } as CharacterSheet["conditionMeta"],
    },
    result: {
      applied: ward
        ? `For a minute, allies within ${AURA_FEET} feet of ${sheet.name} resist ${wardType} damage.`
        : `For a minute, an enemy that starts its turn within ${AURA_FEET} feet of ${sheet.name} makes a Wisdom save (DC ${kiSaveDc(sheet)}) or is frightened of them until its next turn starts.`,
      ...(lines.length ? { explosiveFury: lines } : {}),
      ...(unchosen ? { explosiveFury: [`Explosive Fury deals the type chosen for Draconic Strike, and ${sheet.name} has chosen none: use_resource "Draconic Strike" with the type as its variant before the next activation.`] } : {}),
    },
  };
}

// An enemy whose turn starts within 10 feet of a monk whose frightening aura
// is up: a Wisdom save against the ki save DC, or frightened of the monk
// until its next turn starts, when the aura asks again if it still stands
// there. `holders`: the characters standing in the fight.
export function wyrmFrightens(campaign: Campaign, encounter: Encounter, enemyId: string, holders: CharacterSheet[]): string[] {
  const lines: string[] = [];
  for (const holder of holders) {
    if (!hasCondition(holder, WYRM_FRIGHTEN) || incapacitatedBy(holder.conditions)) {
      continue;
    }
    const enemy = getEnemy(enemyId);
    if (!enemy || enemy.status !== "alive") {
      break;
    }
    if (!withinFeet(encounter.id, holder.id, enemyId, AURA_FEET) || !foesOfSheet(campaign.id, encounter, holder.id).some((foe) => foe.id === enemyId)) {
      continue;
    }
    if (immuneToCondition(enemy, "frightened")) {
      continue;
    }
    const dc = kiSaveDc(holder);
    const save = rollEnemySave(campaign.id, enemy, "wis", dc, {
      magical: true,
      resist: bindsWorthResisting(["frightened"]),
      against: "frightened",
      origin: { ref: holder.id },
      record: { detail: `${enemy.displayName}: WIS save against Aspect of the Wyrm` },
    });
    if (save.success) {
      lines.push(`Aspect of the Wyrm: ${enemy.displayName} holds its nerve (WIS ${save.total} vs DC ${dc}).`);
      continue;
    }
    layEnemyConditionInstance(campaign, enemy, "frightened", { source: holder.id, untilTurnOf: enemyId });
    lines.push(`Aspect of the Wyrm: ${enemy.displayName} is frightened of ${holder.name} until its next turn starts (WIS ${save.total ?? "no roll"} vs DC ${dc}).`);
  }
  return lines;
}

// Augment Breath, asked for in the breath's own call: the word "augmented"
// beside the damage type in its variant ("augmented fire"). Null for any
// other counter or a plain breath; else the type as the breath reads it, the
// four rolls and the longer reach, and the counters with the 1 ki paid
// (`resources` are the counters as the breath's own cost left them, so a
// breath bought with 2 ki needs a third).
export function breathAugment(
  sheet: CharacterSheet,
  counterId: string,
  variant: string | undefined,
  resources: CharacterSheet["resources"],
): { variant: string; dice: string; rangeFt: number; resources: CharacterSheet["resources"] } | ToolError | null {
  const words = textKey(variant ?? "").split(" ").filter(Boolean);
  if (counterId !== BREATH || !words.includes(AUGMENTED)) {
    return null;
  }
  const held = holdsRow(sheet, "monk::Ascendant Aspect");
  if (!held) {
    return { error: `Augment Breath comes with Ascendant Aspect at 17th level, which ${sheet.name} does not have: name the damage type alone. Nothing was spent.`, refused: "rules" };
  }
  const ki = resources?.ki;
  if (!ki || ki.max - ki.used < 1) {
    return { error: `Augment Breath takes 1 ki on top of the breath, and ${sheet.name} has none left for it: name the damage type alone for the plain breath. Nothing was spent.`, refused: "rules" };
  }
  return {
    variant: words.filter((word) => word !== AUGMENTED).join(" "),
    dice: `4${martialArtsDie(held.level)}`,
    rangeFt: AUGMENTED_FEET,
    resources: { ...resources, ki: { max: ki.max, used: ki.used + 1 } },
  };
}
