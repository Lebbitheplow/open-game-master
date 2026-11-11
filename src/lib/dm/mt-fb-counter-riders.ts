// What rides a class counter's spend for the holder of a subclass feature:
// the features whose text says "X also ..." or "when you enter your rage ...".
// use_resource resolved the counter and left these to the GM (their rows were
// `narrated`): Arcane Charge's teleport on Action Surge, Rallying Cry's healing
// on Second Wind, a storm herald's aura waking with the rage. Called once by
// the use_resource arm of mutations.ts after the counter's own spend has gone
// through; every feature that rides a counter another feature owns goes here,
// so the counter's door stays one.
import type { Campaign } from "@/lib/db/campaigns";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { resolveSpendEffect, type SpendContext } from "@/lib/dm/authored-spend-effects";
import { withinFeet } from "@/lib/dm/authored-saves";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import { creditFeatureTeleport } from "@/lib/dm/feature-teleport";
import { canRegain, regainHitPoints } from "@/lib/dm/regain";
import { rollSurge } from "@/lib/dm/mt-fb-wild-surge";
import { computeSheetDerived } from "@/lib/srd";
import { authoredSpendFor } from "@/lib/srd/authored-effects";
import { holdsFeature } from "@/lib/srd/feature-names";
import { classLevelFor } from "@/lib/srd/multiclass";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type CounterRide = {
  campaign: Campaign;
  turnId: string;
  // The holder, as the spend left them.
  sheet: CharacterSheet;
  defId: string;
  args: { variant?: string; targetCharacterId?: string; targetEnemyId?: string; targetEnemyIds?: string[] };
  reason: string;
};

// The fields a counter's spend adds to its tool result for what rode it.
export function afterCounterSpend(ride: CounterRide): Record<string, unknown> {
  const sheet = getSheetById(ride.sheet.id) ?? ride.sheet;
  switch (ride.defId) {
    case "action_surge":
      return arcaneCharge(sheet);
    case "second_wind":
      return rallyingCry(ride, sheet);
    case "rage":
      // The storm herald's aura wakes; a wild magic barbarian's surge is rolled.
      return { ...stormAuraWakes(ride, sheet), ...(rollSurge({ campaign: ride.campaign, turn: getDmTurn(ride.turnId), sheet, args: ride.args }) ?? {}) };
    default:
      return {};
  }
}

// Arcane Charge (Eldritch Knight 15): "Action Surge also teleports you up to
// 30 feet." The teleport is credited as a feature's is (feature-teleport.ts),
// for move_token to make.
function arcaneCharge(sheet: CharacterSheet): Record<string, unknown> {
  if (!holdsFeature(sheet, "Arcane Charge")) {
    return {};
  }
  creditFeatureTeleport(sheet.id, "Arcane Charge", 30);
  return {
    arcaneCharge: `${sheet.name} may teleport up to 30 feet to an unoccupied space they can see, before or after the extra action: move their token with move_token, teleport true, spell "Arcane Charge" and casterCharacterId ${sheet.id}.`,
  };
}

// Rallying Cry (Banneret 3): "Second Wind also heals up to three allies within
// 60 feet for your fighter level." The ally named, then the most hurt.
function rallyingCry(ride: CounterRide, sheet: CharacterSheet): Record<string, unknown> {
  if (!holdsFeature(sheet, "Rallying Cry")) {
    return {};
  }
  const amount = Math.max(1, classLevelFor(sheet, "fighter"));
  const encounter = getActiveEncounter(ride.campaign.id);
  const missing = (ally: CharacterSheet) => effectiveMaxHp(ally) - ally.currentHp;
  const allies = listSheets(ride.campaign.id)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((ally) => ally.id !== sheet.id && !ally.deathSaves?.dead && canRegain(ally) && missing(ally) > 0)
    .filter((ally) => !encounter || withinFeet(encounter.id, sheet.id, ally.id, 60))
    .sort((a, b) => Number(b.id === ride.args.targetCharacterId) - Number(a.id === ride.args.targetCharacterId) || missing(b) - missing(a))
    .slice(0, 3);
  const lines = allies.map((ally) => `${ally.name} regains ${regainHitPoints(ride.campaign, ride.turnId || null, ally, amount, `Rallying Cry (${sheet.name})`)} hit points.`);
  return { rallyingCry: lines.length ? lines : `No wounded ally stands within 60 feet of ${sheet.name}.` };
}

// Storm Aura (Path of the Storm Herald): "When you enter your rage its 10-foot
// aura wakes." The aura's own spend resolves it, at no cost beyond the rage's
// bonus action. The sea's bolt goes to the creature named, else the nearest in
// the aura.
function stormAuraWakes(ride: CounterRide, sheet: CharacterSheet): Record<string, unknown> {
  const found = authoredSpendFor(sheet, "Storm Aura");
  if (!found || !found.held.choice) {
    return {};
  }
  const encounter = getActiveEncounter(ride.campaign.id);
  let targetEnemyId = ride.args.targetEnemyId;
  if (!targetEnemyId && encounter && found.held.choice === "sea") {
    targetEnemyId = listEnemies(encounter.id)
      .filter((enemy) => enemy.status === "alive")
      .map((enemy) => ({ id: enemy.id, apart: tilesBetween(encounter.id, sheet.id, enemy.id) ?? Infinity }))
      .filter((entry) => entry.apart <= 2)
      .sort((a, b) => a.apart - b.apart)[0]?.id;
    if (!targetEnemyId) {
      return { stormAura: "The sea's aura wakes with no creature in it to strike." };
    }
  }
  const ctx: SpendContext = {
    campaign: ride.campaign,
    turnId: ride.turnId,
    turn: getDmTurn(ride.turnId),
    encounter,
    sheet,
    held: found.held,
    spend: found.spend,
    args: { targetEnemyId },
    units: 0,
    mods: computeSheetDerived(sheet).abilityMods,
    reason: ride.reason,
  };
  const outcome = resolveSpendEffect(ctx, { kind: "storm_aura" });
  if ("error" in outcome) {
    return { stormAura: outcome.error };
  }
  if (outcome.patch) {
    const updated = patchSheet(sheet.id, outcome.patch);
    if (updated) {
      publishPersisted(ride.campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  return { stormAura: { wakes: "as the rage begins", ...outcome.result } };
}
