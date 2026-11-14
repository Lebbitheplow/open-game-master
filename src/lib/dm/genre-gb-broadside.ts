// Broadside (Sky Corsair 11): "1/rest, fire at up to three targets in a
// 15-ft cone with a single attack roll each". The spend lays BROADSIDE on the
// corsair for the turn (src/lib/srd/authored-effects-genre-gb.ts); pc_attack
// with `volley` then takes it as Volley takes the Hunter's
// (src/lib/dm/srd-attacks.ts): the first ranged weapon attack spends the
// whole action and aims the cone, and each later one strikes a creature not
// struck yet, up to three. A 15-foot cone from the corsair holds a creature
// within 15 feet whose bearing is within the cone's spread of the first
// target's (a cone is as wide as it is long, so its edges lie about 26.6
// degrees either side of its line).
import { spendAction, type TurnBudget } from "@/lib/dm/action-budget";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { toolError, type ToolError } from "@/lib/dm/tool-errors";

export const BROADSIDE = "broadside";
const OPEN = "broadside:";
const STRUCK = "broadside-target:";
const SPREAD = 2 * Math.atan(0.5);

export const holdsBroadside = (sheet: Pick<CharacterSheet, "conditions">) => sheet.conditions.some((entry) => isConditionNamed(entry, BROADSIDE));

type Spot = { x: number; y: number };
function spots(campaignId: string, refs: string[]): Spot[] | null {
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (!map) return null;
  const found = refs.map((ref) => getTokenByRef(map.id, ref));
  return found.every(Boolean) ? found.map((token) => ({ x: token!.x, y: token!.y })) : null;
}

// Whether the creature stands in the cone the first one aimed: within 15
// feet and inside the spread. With no board the fiction decides.
export function inBroadsideCone(campaignId: string, holderId: string, firstId: string, enemyId: string): boolean {
  const at = spots(campaignId, [holderId, firstId, enemyId]);
  if (!at) return true;
  const [from, first, other] = at;
  const reach = Math.max(Math.abs(other.x - from.x), Math.abs(other.y - from.y));
  if (reach > 3) return false;
  const a = Math.atan2(first.y - from.y, first.x - from.x);
  const b = Math.atan2(other.y - from.y, other.x - from.x);
  const turn = Math.abs(((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  return turn <= SPREAD + 1e-9;
}

export function broadsideAttack(input: {
  sheet: CharacterSheet;
  budget: TurnBudget | null;
  profile: AttackProfile;
  weaponAttack: boolean;
  atRange: boolean;
  enemyId: string;
}): { refused: ToolError } | { budget: TurnBudget; note: string } {
  const { sheet, budget } = input;
  if (!budget) {
    return { refused: { error: `Broadside is the Attack action on ${sheet.name}'s own turn; it is not their turn.`, refused: "rules" } };
  }
  if (!input.weaponAttack || (!input.profile.ranged && !input.atRange)) {
    return { refused: { error: "Broadside fires ranged weapons; send the firearm as the weapon.", retry: true } };
  }
  const open = budget.oncePerTurn.find((key) => key.startsWith(OPEN));
  if (!open) {
    if (budget.attacksMade > 0 || budget.actionUsed) {
      return { refused: { error: `Broadside takes the whole Attack action, and ${sheet.name} has already attacked or used their action this turn.`, refused: "rules" } };
    }
    if (!inBroadsideCone(sheet.campaignId, sheet.id, input.enemyId, input.enemyId)) {
      return { refused: { error: "Broadside's cone reaches 15 feet; this creature is farther.", retry: true } };
    }
    const spent = spendAction(budget, "action", "Broadside", sheet.name);
    if (!spent.ok) {
      return { refused: toolError(spent) };
    }
    return {
      budget: { ...spent.budget, attacksMade: spent.budget.attacksAllowed, oncePerTurn: [...spent.budget.oncePerTurn, `${OPEN}${input.enemyId}`, `${STRUCK}${input.enemyId}`] },
      note: "Broadside: the action; one shot at each of up to three creatures in a 15-foot cone, this one first",
    };
  }
  const struck = budget.oncePerTurn.filter((key) => key.startsWith(STRUCK));
  if (struck.includes(`${STRUCK}${input.enemyId}`)) {
    return { refused: { error: `Broadside fires once at each creature, and ${sheet.name} has already fired at this one.`, retry: true } };
  }
  if (struck.length >= 3) {
    return { refused: { error: "Broadside fires at up to three creatures, and three are struck.", refused: "rules" } };
  }
  if (!inBroadsideCone(sheet.campaignId, sheet.id, open.slice(OPEN.length), input.enemyId)) {
    return { refused: { error: "Broadside's targets stand in the 15-foot cone the first shot aimed; this creature is outside it.", retry: true } };
  }
  return { budget: { ...budget, oncePerTurn: [...budget.oncePerTurn, `${STRUCK}${input.enemyId}`] }, note: "Broadside: another creature in the cone, no attack of the action spent" };
}
