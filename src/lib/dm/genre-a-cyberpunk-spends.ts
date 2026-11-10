// The cyberpunk counters whose spend does what no shared spend kind does
// (WAVE2 D5, R11), the authored spend kind "cyber_spend" of
// src/lib/srd/authored-effects-genre-a-cyberpunk.ts, resolved here from
// src/lib/dm/authored-spend-effects.ts. Each refuses with nothing spent when
// what it needs is not there.
//   ghost_protocol: "one drone turns invisible for 1 minute": the drone named
//     (or the rigger's first), never the rigger;
//   lazarus: "restore a creature dead less than 1 minute to life at half HP":
//     a dead character named, at half its maximum, its death saves cleared.
//     The app keeps no time of death, so "less than 1 minute" is the GM's to
//     say for a death outside this fight; a death in the fight running is
//     within the minute (ten rounds);
//   whirl: "Replace one attack with a spinning slash: weapon damage to every
//     foe within 5 ft": one attack of the Attack action spent, the held melee
//     weapon's damage rolled once and dealt to each enemy within 5 feet;
//   synaptic: "a creature hit by your psionic saves (WIS) or is stunned until
//     your next turn": a creature the esper's spell attack hit this turn, the
//     save rolled here against the esper's spell save DC.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, listEnemies, type Encounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { withinFeet } from "@/lib/dm/authored-saves";
import { riggerDrones } from "@/lib/dm/genre-a-summons";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { rollCard } from "@/lib/dm/roll-card";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { matchWeapon } from "@/lib/srd/weapons";
import { computeSheetDerived } from "@/lib/srd";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";

export type CyberSpend = "ghost_protocol" | "lazarus" | "whirl" | "synaptic";
export const SPELL_HIT = "spell-hit:";

type Ctx = {
  campaign: Campaign;
  sheet: CharacterSheet;
  label: string;
  args: { targetCharacterId?: string; targetEnemyId?: string };
};
type Out = ToolError | { result: Record<string, unknown> };

const refuse = (error: string): ToolError => ({ error: `${error} Nothing was spent.`, refused: "rules" });

// `then`: the shared spend kinds, for a spend that ends in one of them
// (Synaptic Overload's save is save_effect's).
export function resolveCyberSpend(ctx: Ctx, what: CyberSpend, then: (does: SpendDoes) => Out): Out {
  switch (what) {
    case "ghost_protocol":
      return ghostProtocol(ctx);
    case "lazarus":
      return lazarus(ctx);
    case "whirl":
      return whirl(ctx);
    case "synaptic":
      return synaptic(ctx, then);
  }
}

function addCondition(campaignId: string, target: CharacterSheet, condition: string, meta: Record<string, unknown>, reason: string) {
  const conditions = [...target.conditions.filter((entry) => textKey(entry) !== textKey(condition)), condition];
  const conditionMeta = { ...((target.conditionMeta as Record<string, unknown> | undefined) ?? {}), [condition]: meta };
  patchSheetAudited(campaignId, target.id, { conditions, conditionMeta: conditionMeta as never }, { kind: "set_condition", reason, delta: { condition } });
}

function ghostProtocol({ campaign, sheet, label, args }: Ctx): Out {
  const drones = riggerDrones(campaign.id, sheet.id);
  const drone = args.targetCharacterId ? drones.find((entry) => entry.id === args.targetCharacterId) : drones[0];
  if (!drone) {
    return refuse(args.targetCharacterId ? `${label} turns one of ${sheet.name}'s drones invisible, and that creature is none of them.` : `${sheet.name} has no drone on the board for ${label} to hide (Drone Companion builds them).`);
  }
  addCondition(campaign.id, getSheetById(drone.id) ?? drone, "invisible", { rounds: 10, source: sheet.id }, label);
  return { result: { applied: [`${label}: ${drone.name} is invisible for 1 minute.`] } };
}

function lazarus({ campaign, sheet, label, args }: Ctx): Out {
  const target = args.targetCharacterId ? getSheetById(args.targetCharacterId) : null;
  if (!target || target.campaignId !== campaign.id) {
    return refuse(`${label} restores a dead creature named by targetCharacterId.`);
  }
  if (!target.deathSaves?.dead) {
    return refuse(`${target.name} is not dead; ${label} restores a creature dead less than a minute.`);
  }
  const hp = Math.max(1, Math.floor(target.maxHp / 2));
  const conditions = target.conditions.filter((entry) => textKey(entry) !== "unconscious");
  patchSheetAudited(campaign.id, target.id, { currentHp: hp, deathSaves: { successes: 0, failures: 0, stable: false, dead: false }, conditions }, { kind: "heal", reason: `${label} by ${sheet.name}`, delta: { hp } });
  return { result: { applied: [`${label}: ${target.name} lives again at ${hp} hit points.`] } };
}

function heldMelee(sheet: CharacterSheet): { name: string; dice: string; type: string; finesse: boolean } | null {
  for (const item of sheet.equipment ?? []) {
    const weapon = item.equipped ? matchWeapon(item) : null;
    if (weapon && weapon.kind === "melee") {
      const [dice, type] = weapon.damage.split(" ");
      return { name: item.name, dice, type: type ?? "slashing", finesse: (weapon.properties ?? []).includes("finesse") };
    }
  }
  return null;
}

function holderBudget(encounter: Encounter, sheet: CharacterSheet) {
  return budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
}

function whirl({ campaign, sheet, label }: Ctx): Out {
  const encounter = getActiveEncounter(campaign.id);
  const budget = encounter ? holderBudget(encounter, sheet) : null;
  if (!encounter || !budget) {
    return refuse(`${label} replaces one attack of ${sheet.name}'s Attack action, on their own turn in a fight.`);
  }
  if (budget.castThisAction || (budget.actionUsed && budget.attacksMade >= budget.attacksAllowed)) {
    return refuse(`${sheet.name} has no attack of the Attack action left for ${label} to replace.`);
  }
  const weapon = heldMelee(sheet);
  if (!weapon) {
    return refuse(`${label} is a spinning slash with a melee weapon in hand, and ${sheet.name} holds none.`);
  }
  const foes = listEnemies(encounter.id).filter((enemy) => enemy.status === "alive" && withinFeet(encounter.id, sheet.id, enemy.id, 5));
  if (!foes.length) {
    return refuse(`No foe stands within 5 feet of ${sheet.name} for ${label}.`);
  }
  const mods = computeSheetDerived(sheet).abilityMods;
  const mod = weapon.finesse ? Math.max(mods.str, mods.dex) : mods.str;
  const rolled = rollCard(campaign, null, sheet.id, "damage", `${label} (${weapon.name})`, mod ? `${weapon.dice}${mod > 0 ? "+" : ""}${mod}` : weapon.dice, null).total;
  storeBudget(encounter, { ...budget, actionUsed: true, attacksMade: budget.attacksMade + 1 });
  const lines = foes.map((enemy) => hurtEnemy(campaign, getActiveEncounter(campaign.id) ?? encounter, getEnemy(enemy.id) ?? enemy, Math.max(0, rolled), weapon.type, label, true));
  return { result: { applied: lines, damage: rolled } };
}

function synaptic({ campaign, sheet, label, args }: Ctx, then: (does: SpendDoes) => Out): Out {
  const encounter = getActiveEncounter(campaign.id);
  const budget = encounter ? holderBudget(encounter, sheet) : null;
  const enemy = args.targetEnemyId && encounter ? getEnemy(args.targetEnemyId) : null;
  if (!encounter || !budget || !enemy || enemy.status !== "alive") {
    return refuse(`${label} answers a creature ${sheet.name}'s psionic hit this turn: name it by targetEnemyId.`);
  }
  if (!budget.oncePerTurn.includes(`${SPELL_HIT}${enemy.id}`)) {
    return refuse(`${sheet.name}'s psionic has hit no ${enemy.displayName} this turn: a spell attack (pc_attack with the spell) that hits comes first.`);
  }
  return then({ kind: "save_effect", save: "wis", dcAbility: "spell", condition: "stunned", rounds: 1, onFail: "is stunned until the esper's next turn" });
}

export const REALITY_REND = "reality rend";

// The mark taken off and the line for the cast, or null with no mark held.
export function spendRealityRend(campaign: Campaign, caster: CharacterSheet): string | null {
  const live = getSheetById(caster.id) ?? caster;
  if (!live.conditions.some((entry) => textKey(entry) === REALITY_REND)) {
    return null;
  }
  const conditions = live.conditions.filter((entry) => textKey(entry) !== REALITY_REND);
  const conditionMeta = { ...((live.conditionMeta as Record<string, unknown> | undefined) ?? {}) };
  delete conditionMeta[REALITY_REND];
  patchSheetAudited(campaign.id, live.id, { conditions, conditionMeta: conditionMeta as never }, { kind: "set_condition", reason: "Reality Rend spent on the cast", delta: { condition: REALITY_REND } });
  return "Reality Rend: the psionic deals its maximum damage.";
}
