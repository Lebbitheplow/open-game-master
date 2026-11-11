// The spends of a limited-use feature whose payload the server resolves
// itself, beyond the effect kinds use_resource runs for every counter
// (src/lib/dm/resource-tools.ts): Channel Divinity's options, where the
// variant names which one, and Indomitable's reroll of the save just failed.
//
// Before this the counter was spent and the model was handed a sentence:
// Turn Undead told it to "apply the frightened condition", which skipped the
// saving throw the SRD gates it behind, and Indomitable told it to roll the
// save again by hand. Each spend here checks, charges the turn, spends the
// use and applies the result, in that order, so a refusal costs nothing.
//
// Called from the use_resource arm of src/lib/dm/mutations.ts before the
// generic path. Must not import mutations.ts (which imports it).
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, listEnemies, patchEnemyConditions } from "@/lib/db/encounters";
import { listRecentRolls } from "@/lib/db/rolls";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { tilesApart } from "@/lib/dm/board-reach";

import { computeSheetDerived } from "@/lib/srd";
import { matchResource } from "@/lib/srd/class-resources";
import { classLevelOf, holdsFeature } from "@/lib/srd/trait-rules";
import { effectiveMaxHp, incapacitatedBy, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { activeAuthored } from "@/lib/srd/authored-effects";
import { foesOfSheet, resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { VOW_OF_ENMITY } from "@/lib/srd/vow-of-enmity";
import { seesOnBoard, unseenBecause, withinFeet } from "@/lib/dm/authored-saves";
import { rollFeatureSave } from "@/lib/dm/contest-roll";
import { canRegain, regainHitPoints } from "@/lib/dm/regain";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { turnDefence } from "@/lib/dm/turn-defiance";
import { prepareResourceCharge, type ResourceCharge } from "@/lib/dm/resource-turn";
import { commandersStrike, commandersStrikeCharge, knowsManeuver, rally } from "@/lib/dm/maneuver-uses";
import type { ResourceAction } from "@/lib/srd/class-resources";
import { fieldedSheets } from "@/lib/dm/roster";
import { chooseFiendishResilience, stillnessOfMind } from "@/lib/dm/feature-hooks";
import { sacredWeaponMeta, shedLight } from "@/lib/dm/mt-srd-paladin";
import { seesOrHears, undeadOrConstruct } from "@/lib/dm/mt-srd-reach";

// Re-exported for the callers that reached it here first.
export { applyInitiativeRefills } from "@/lib/dm/feature-hooks";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { ToolError, ToolResult } from "@/lib/dm/tool-errors";
import { familyOf, isConditionNamed, isNamed, nameChoice } from "@/lib/srd/feature-names";
import { DESTRUCTIVE_WRATH, holdsDestructiveWrath } from "@/lib/dm/destructive-wrath";
import { TURNED } from "@/lib/dm/flee-logic";
import { ultimateMercy } from "@/lib/dm/ultimate-mercy";
import { DEAD_TARGET_COUNTERS } from "@/lib/srd/dead-targets";
import { channelOptions } from "@/lib/dm/option-costs";
import { CHANNEL_FEAR, channelFear } from "@/lib/dm/channel-fear";
import { swallowCoverBetween } from "@/lib/dm/swallow";
import { classSaveDc, controlUndead } from "@/lib/dm/command-undead";

type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

// The turnings beyond Turn Undead and Turn the Unholy, each by its own creature
// types, within 30 feet. Arcane Abjuration from 5th level banishes instead: "a
// creature that fails, isn't on its plane of origin, and has a challenge
// rating at or below a limit (1/2 at 5th level, 1 at 8th, 2 at 11th, 3 at
// 14th, 4 at 17th) is banished for a minute instead". No stat block records a
// plane of origin: a celestial, elemental, fey or fiend on the table is taken
// to be away from its own, the world's plane being the Material. Before this
// the banishment was only a sentence for the GM, and the creature was turned.
const CHANNEL_TURNINGS = [
  { name: "Turn the Faithless", beyond: true, ability: "cha" as const, types: /fey|fiend/i, note: "A creature that failed drops any disguise or illusion: its true form shows." },
  { name: "Abjure the Extraplanar", beyond: true, ability: "cha" as const, types: /aberration|celestial|elemental|fey|fiend/i },
  { name: "Arcane Abjuration", beyond: true, ability: "wis" as const, types: /celestial|elemental|fey|fiend/i, single: true, banish: true },
];

// Destroy Undead's challenge rating threshold by cleric level (SRD 5.1).
export function destroyUndeadCr(clericLevel: number): number | null {
  if (clericLevel >= 17) return 4;
  if (clericLevel >= 14) return 3;
  if (clericLevel >= 11) return 2;
  if (clericLevel >= 8) return 1;
  if (clericLevel >= 5) return 0.5;
  return null;
}

// The condition a turned undead carries: it spends its turns moving away,
// takes no reactions, and may only Dash or try to escape. Taking damage ends
// it. Kept as its own name so a frightened from elsewhere is not confused
// with it; its row (condition-effects-last.ts) takes its attacks, spells and
// reactions, and src/lib/dm/flee-logic.ts runs its turn (issue #621).
export { TURNED };

const TURN_RANGE_FEET = 30;

function audit(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  delta: Record<string, unknown>,
  reason: string,
  patch: Record<string, unknown>,
) {
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId,
    kind: "use_resource",
    delta,
    reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
}

function publishSheet(campaign: Campaign, sheetId: string) {
  const updated = patchSheet(sheetId, {});
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// Whether two combatants are within `feet` of each other on the live board.
// With no board there is nothing to measure and the fiction decides.
function within(campaignId: string, fromRef: string, toRef: string, feet: number): boolean {
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (!map) {
    return true;
  }
  const from = getTokenByRef(map.id, fromRef);
  const to = getTokenByRef(map.id, toRef);
  if (!from || !to) {
    return false;
  }
  return tilesApart(from, to) <= Math.floor(feet / 5);

}

// How far a Channel Divinity option reaches when it makes the creatures it
// reaches save (a turning, a fear, Control Undead), for a watch stop before
// the call (src/lib/dm/foresight-saves.ts); null for an option that asks no
// save. Read as featureVariantSpend below reads the option.
export function channelSaveReach(resourceName: string, variant: string | undefined): number | null {
  if (matchResource(resourceName)?.id !== "channel_divinity") {
    return null;
  }
  const wanted = variant ?? nameChoice(resourceName) ?? "";
  if (isNamed(wanted, "turn the unholy", "turn undead", "destroy undead", "control undead") || CHANNEL_TURNINGS.some((entry) => isNamed(wanted, entry.name))) {
    return TURN_RANGE_FEET;
  }
  return CHANNEL_FEAR.find((entry) => isNamed(wanted, entry.name))?.rangeFt ?? null;
}

// A use_resource call this module resolves, or null for the generic path.
export function featureVariantSpend(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  resourceName: string,
  variant: string | undefined,
  targetId: string | undefined,
  reason: string,
  targetEnemyId?: string,
  targetEnemyIds?: string[],
): ToolResult | null {
  if (isNamed(familyOf(resourceName), "Fiendish Resilience")) {
    return chooseFiendishResilience(campaign, turnId, sheet, variant, reason);
  }
  if (isNamed(resourceName, "Stillness of Mind")) {
    return stillnessOfMind(campaign, turnId, sheet, reason);
  }
  const def = matchResource(resourceName);
  // The option the variant names whole (src/lib/srd/feature-names.ts).
  // The sheet's own name carries the option too ("Channel Divinity: Vow of
  // Enmity"): without it the generic path spent the use and did nothing.
  const wanted = variant ?? nameChoice(resourceName) ?? "";
  if (def?.id === "channel_divinity") {
    if (isNamed(wanted, "turn the unholy")) {
      return spend(campaign, turnId, sheet, def.id, "action", reason, () =>
        turnUndead(campaign, turnId, sheet, { types: /undead|fiend/i, destroy: false, name: "Turn the Unholy", ability: "cha" }),
      );
    }
    // The other turnings run as Turn the Unholy does. Each is refused to a sheet
    // that does not hold it, so a call cannot spend the use on another's option.
    const turning = CHANNEL_TURNINGS.find((entry) => isNamed(wanted, entry.name));
    const fear = CHANNEL_FEAR.find((entry) => isNamed(wanted, entry.name));
    if ((turning || fear) && !channelOptions(sheet).some((entry) => isNamed(entry.name, (turning ?? fear)!.name))) {
      return { error: `${sheet.name} does not hold ${(turning ?? fear)!.name}. Nothing was spent.`, refused: "rules" };
    }
    if (turning) {
      return spend(campaign, turnId, sheet, def.id, "action", reason, () => turnUndead(campaign, turnId, sheet, { ...turning, destroy: false, target: targetEnemyId }));
    }
    if (fear) {
      return spend(campaign, turnId, sheet, def.id, "action", reason, () => channelFear(campaign, getSheetById(sheet.id) ?? sheet, fear, targetEnemyId, targetEnemyIds));
    }
    if (isNamed(wanted, "control undead")) {
      if (!channelOptions(sheet).some((entry) => isNamed(entry.name, "control undead"))) {
        return { error: `${sheet.name} does not hold Control Undead. Nothing was spent.`, refused: "rules" };
      }
      // Outside a fight there is no creature row to command: the generic
      // path spends the use and the GM plays the undead's obedience.
      if (getActiveEncounter(campaign.id)) {
        return spend(campaign, turnId, sheet, def.id, "action", reason, () => controlUndead(campaign, turnId, sheet, targetEnemyId));
      }
      return null;
    }
    if (isNamed(wanted, "turn undead", "destroy undead")) {
      return spend(campaign, turnId, sheet, def.id, "action", reason, () => turnUndead(campaign, turnId, sheet));
    }
    if (isNamed(wanted, DESTRUCTIVE_WRATH)) {
      if (!channelOptions(sheet).some((entry) => isNamed(entry.name, DESTRUCTIVE_WRATH))) {
        return { error: `${sheet.name} does not hold Destructive Wrath. Nothing was spent.`, refused: "rules" };
      }
      if (holdsDestructiveWrath(sheet)) {
        return { error: `${sheet.name} already holds Destructive Wrath for their next lightning or thunder damage. Nothing was spent.`, refused: "rules" };
      }
      return spend(campaign, turnId, sheet, def.id, "none", reason, () => ({
        patch: { conditions: [...sheet.conditions, DESTRUCTIVE_WRATH] },
        result: { applied: "Destructive Wrath: their next lightning or thunder damage before a rest is dealt at its maximum." },
      }));
    }
    if (isNamed(wanted, "sacred weapon")) {
      const imbued = spend(campaign, turnId, sheet, def.id, "action", reason, () => sacredWeapon(sheet));
      if (!("error" in imbued)) {
        // "bright light in a 20-foot radius and dim light 20 feet beyond that".
        shedLight(campaign.id, sheet.id, 20, 20, 1);
      }
      return imbued;
    }
    if (isNamed(wanted, "vow of enmity")) {
      // Inside the spend, so a use or bonus action already gone answers first.
      return spend(campaign, turnId, sheet, def.id, "bonus", reason, () =>
        vowRefusal(campaign, sheet, targetEnemyId) ?? vowOfEnmity(sheet, targetEnemyId!),
      );
    }
    if (isNamed(wanted, "preserve life")) {
      return spend(campaign, turnId, sheet, def.id, "action", reason, () =>
        preserveLife(campaign, turnId, sheet, targetId, reason),
      );
    }
    return null;
  }
  // Rally and Commander's Strike (src/lib/dm/maneuver-uses.ts), known only.
  const maneuver = def?.id === "sub_superiority_dice" ? (isNamed(wanted, "rally") ? "rally" : isNamed(wanted, "commander's strike", "commanders strike") ? "commander's strike" : null) : null;
  if (maneuver && !knowsManeuver(sheet, maneuver)) {
    return { error: `${sheet.name} does not know the ${maneuver === "rally" ? "Rally" : "Commander's Strike"} maneuver. Nothing was spent.`, refused: "rules" };
  }
  if (def?.id === "sub_superiority_dice" && maneuver === "rally") {
    return spend(campaign, turnId, sheet, def.id, "bonus", reason, () => rally(campaign, turnId, sheet, targetId));
  }
  if (def?.id === "sub_superiority_dice" && maneuver === "commander's strike") {
    return spend(campaign, turnId, sheet, def.id, (fresh) => commandersStrikeCharge(campaign, fresh, targetId), reason, () =>
      commandersStrike(campaign, sheet, targetId),
    );
  }
  // Hand of Ultimate Mercy brings back the dead its heal path refused
  // (src/lib/dm/ultimate-mercy.ts): the use, 5 ki and the action.
  if (def && DEAD_TARGET_COUNTERS.includes(def.id)) {
    return spend(campaign, turnId, sheet, def.id, "action", reason, () => ultimateMercy(campaign, turnId, getSheetById(sheet.id) ?? sheet, targetId));
  }
  if (def?.id === "eldritch_master") {
    return spend(campaign, turnId, sheet, def.id, "none", reason, () => eldritchMaster(sheet));
  }
  if (def?.id === "indomitable") {
    return spend(campaign, turnId, sheet, def.id, ANSWERS_A_FAILED_SAVE, reason, () => indomitable(campaign, sheet));
  }
  if (def?.id === "ki" && isNamed(wanted, "diamond soul")) {
    // Diamond Soul (monk 14): 1 ki rerolls a failed save, as Indomitable does.
    if (!holdsFeature(sheet, "diamond soul")) {
      return { error: `${sheet.name} does not have Diamond Soul.`, refused: "rules" };
    }
    return spend(campaign, turnId, sheet, def.id, ANSWERS_A_FAILED_SAVE, reason, () => indomitable(campaign, sheet));
  }
  if (def?.id === "ki" && isNamed(wanted, "empty body")) {
    // Empty Body (monk 18): 4 ki, an action, invisible for a minute and
    // resistant to all damage but force.
    if (!holdsFeature(sheet, "empty body")) {
      return { error: `${sheet.name} does not have Empty Body.`, refused: "rules" };
    }
    return spend(campaign, turnId, sheet, def.id, "action", reason, () => emptyBody(sheet), 4);
  }
  return null;
}

type Resolution = ToolError | { result: Record<string, unknown>; patch?: FullPatchSheetInput };

// The shared order: the feature is held with a use left, the character can
// act, the turn is charged, the effect resolves, and only then the use is
// spent. A resolution that refuses costs nothing.
// A reroll of the save just failed answers that roll, on whoever's turn it
// was failed: "you can reroll a saving throw that you fail" (SRD 5.1, Fighter:
// Indomitable; Diamond Soul the same). It costs nothing of the turn, so it is
// not held to the holder's own turn as a free action is: refused off their
// turn, a save failed on a goblin's turn (where nearly every save is made)
// could be rerolled only once the failure had stood the whole round (finding
// spends-indomitable-own-turn-only). indomitable() still asks for the failed
// save on record.
const ANSWERS_A_FAILED_SAVE = (): ResourceCharge => ({ commit: () => ({}) });

function spend(
  campaign: Campaign,
  turnId: string,
  stale: CharacterSheet,
  resourceId: string,
  // What the use costs of the turn, or a charge of its own (Commander's
  // Strike forgoes an attack as well as the bonus action).
  cost: ResourceAction | ((sheet: CharacterSheet) => ResourceCharge),
  reason: string,
  resolve: () => Resolution,
  amount = 1,
): ToolResult {
  const sheet = getSheetById(stale.id) ?? stale;
  const def = matchResource(resourceId)!;
  const state = sheet.resources?.[resourceId];
  if (!state) {
    return { error: `${sheet.name} has no ${def.displayName}.`, refused: "rules" };
  }
  if (state.max - state.used < amount) {
    return {
      error: `${sheet.name} has ${state.max - state.used}/${state.max} ${def.displayName} left and this takes ${amount}; it comes back on a ${def.recharge === "short" ? "short or long" : "long"} rest.`,
      refused: "rules",
    };
  }
  if (sheet.deathSaves?.dead || sheet.currentHp <= 0) {
    return { error: `${sheet.name} is down and cannot use ${def.displayName}.`, refused: "rules" };
  }
  // An action or a bonus action needs someone able to take one; a reroll
  // (Indomitable) does not.
  const stoppedBy = cost !== "none" && cost !== "reaction" && cost !== ANSWERS_A_FAILED_SAVE ? incapacitatedBy(sheet.conditions) : null;
  if (stoppedBy) {
    return { error: `${sheet.name} is ${stoppedBy} and cannot use ${def.displayName} until the condition ends.`, refused: "rules" };
  }
  const charge = typeof cost === "function" ? cost(sheet) : prepareResourceCharge(campaign, sheet, resourceId, cost);
  if ("error" in charge) {
    return charge;
  }
  const outcome = resolve();
  if ("error" in outcome) {
    return outcome;
  }
  const now = getSheetById(sheet.id) ?? sheet;
  const resources = {
    ...now.resources,
    [resourceId]: { max: state.max, used: state.used + amount },
  };
  const patch = { ...(outcome.patch ?? {}), resources };
  patchSheet(sheet.id, patch);
  audit(campaign, turnId, now, { resource: def.displayName, spent: amount }, reason, patch);
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    resource: def.displayName,
    spent: amount,
    left: `${state.max - state.used - amount}/${state.max}`,
    ...outcome.result,
    ...charge.commit(),
  };
}

// Turn Undead (cleric 2) and Destroy Undead (cleric 5): every undead within
// 30 feet makes a WIS save against the cleric's spell DC. A failure turns it
// for a minute, or destroys it outright at or under the Destroy Undead CR.
// Turn the Unholy (Oath of Devotion 3) is the same save against fiends and
// undead, at the paladin's DC, with nothing destroyed.
function turnUndead(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  // `beyond`: a turning of other creatures than undead (CHANNEL_TURNINGS).
  // `ability`: the class's spellcasting ability the DC is read with (a
  // cleric's Wisdom, a paladin's Charisma), so a multiclass sheet whose first
  // caster class is another does not lend that class's DC.
  kind: { types: RegExp; destroy: boolean; name: string; single?: boolean; target?: string; note?: string; beyond?: boolean; ability?: Ability; banish?: boolean } = { types: /undead/i, destroy: true, name: "Turn Undead", ability: "wis" },
): Resolution {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: `${kind.name} needs something to turn: start the encounter first.`, retry: true };
  }
  const dc = classSaveDc(sheet, kind.ability ?? "wis");
  const destroyAt = kind.destroy ? destroyUndeadCr(classLevelOf(sheet, "cleric")) : null;
  // The same ladder of challenge ratings bounds Arcane Abjuration's banishment.
  const banishAt = kind.banish ? destroyUndeadCr(classLevelOf(sheet, "cleric")) : null;
  // Nothing across a swallower's wall sees or hears the cleric (swallow.ts).
  const named = kind.single && kind.target ? resolveTargetFoe(campaign.id, encounter, kind.target) : null;
  if (kind.single && !named) {
    return { error: `${kind.name} names one creature in the fight: pass targetEnemyId. Channel Divinity was not spent.`, retry: true };
  }
  const undead = (kind.beyond ? foesOfSheet(campaign.id, encounter, sheet.id) : listEnemies(encounter.id)).filter(
    (enemy) =>
      enemy.status === "alive" &&
      (!kind.beyond || (enemy.currentHp > 0 && seesOnBoard(encounter.id, sheet.id, enemy.id))) &&
      (!named || enemy.id === named.id) &&
      kind.types.test(String(enemy.stats.type ?? "")) &&
      within(campaign.id, sheet.id, enemy.id, TURN_RANGE_FEET) &&
      // "That can see or hear you" (SRD 5.1, Turn Undead; Arcane Abjuration):
      // a creature both deafened and unable to see the cleric is left out
      // (mt-srd-reach.ts seesOrHears, which every turning asks).
      seesOrHears(encounter.id, enemy, sheet) &&
      !swallowCoverBetween(sheet.id, enemy.id),
  );
  if (!undead.length) {
    return { error: `Nothing ${kind.name} affects is within ${TURN_RANGE_FEET} feet of ${sheet.name}; Channel Divinity was not spent.`, refused: "rules" };
  }
  const turn = getDmTurn(turnId);
  const sheets = listSheets(campaign.id);
  const byId = new Map(sheets.map((entry) => [entry.id, entry]));
  const outcomes: string[] = [];
  const fielded = listEnemies(encounter.id);
  for (const enemy of undead) {
    // Its block's own answer to turning, and an ally's Turn Defiance.
    // Those lines answer effects that turn undead, not these.
    const defence: ReturnType<typeof turnDefence> = kind.beyond ? {} : turnDefence(encounter.id, enemy, fielded);
    if (defence.immune) {
      outcomes.push(`${enemy.displayName} cannot be turned (${defence.immune}).`);
      continue;
    }
    // Turned: a legendary creature spends a resistance to stand its ground.
    const save = rollEnemySave(campaign.id, enemy, "wis", dc, { channel: true, resist: true, advantage: Boolean(defence.advantage), disadvantage: Boolean(defence.disadvantage), ...(kind.beyond ? { magical: true, against: TURNED, record: { detail: `${enemy.displayName}: WIS save against ${kind.name}` } } : {}) });
    const lean = [defence.advantage ? `advantage from ${defence.advantage}` : "", defence.disadvantage ? `disadvantage from ${defence.disadvantage}` : ""].filter(Boolean).join(", ");
    if (save.success) {
      outcomes.push(`${enemy.displayName} resists (WIS ${save.total ?? "failed outright"} vs DC ${dc}${lean ? `, ${lean}` : ""})${save.legendaryResistance ? " with Legendary Resistance" : ""}.`);
      continue;
    }
    const cr = Number(enemy.stats.cr ?? enemy.cr ?? 99);
    if (banishAt !== null && cr <= banishAt) {
      const standing = resolveTargetFoe(campaign.id, encounter, enemy.id) ?? enemy;
      patchEnemyConditions(enemy.id, [...standing.conditions.filter((entry) => entry !== "banished"), "banished"], {
        ...(standing.conditionMeta as ConditionMetaMap),
        banished: { rounds: 10, source: sheet.id },
      });
      outcomes.push(`${enemy.displayName} is banished for a minute (WIS ${save.total ?? "failed"} vs DC ${dc}; CR ${cr} at or under ${banishAt}).`);
      continue;
    }
    if (destroyAt !== null && cr <= destroyAt && turn) {
      applyEnemyDamage(campaign, turn, encounter, enemy, Math.max(1, enemy.currentHp), sheets, byId, undefined, {
        magical: true,
      });
      outcomes.push(`${enemy.displayName} is destroyed (CR ${cr} at or under ${destroyAt}).`);
      continue;
    }
    // As it stands after the save, which can spend a condition it held (Unsettling
    // Words' die): the read before the save would write that back.
    const standing = resolveTargetFoe(campaign.id, encounter, enemy.id) ?? enemy;
    const conditions = standing.conditions.includes(TURNED) ? standing.conditions : [...standing.conditions, TURNED];
    const meta: ConditionMetaMap = {
      ...(standing.conditionMeta as ConditionMetaMap),
      // "If the creature takes any damage" the turning ends (SRD 5.1): the
      // damage path ends what is marked so (spell-effects.ts settleOnDamage).
      [TURNED]: { rounds: 10, source: sheet.id, endsOnDamage: true },
    };
    patchEnemyConditions(enemy.id, conditions, meta);
    outcomes.push(`${enemy.displayName} is turned for a minute (WIS ${save.total ?? "failed"} vs DC ${dc}).`);
  }
  publishEncounter(campaign.id);
  return {
    result: {
      turnUndead: outcomes,
      ...(kind.note ? { also: kind.note } : {}),
      note: (kind.beyond ? "A turned creature runs from whoever turned it on its turns:" : "A turned undead runs from the cleric on its turns:") + " take_action dash with its enemyId, then move_token away (cornered, take_action dodge). It makes no attacks or reactions; any damage ends it. A turn you skip runs it for you. Do not set frightened by hand.",
    },
  };
}

// Eldritch Master (warlock 20): every expended Pact Magic slot back. A
// multiclass sheet keeps its pact slots apart (spellcasting.pact); a
// warlock's own slots are the pact slots.
function eldritchMaster(sheet: CharacterSheet): Resolution {
  const casting = sheet.spellcasting;
  if (!casting) {
    return { error: `${sheet.name} has no Pact Magic slots to restore.`, refused: "rules" };
  }
  if (casting.pact) {
    return {
      patch: { spellcasting: { ...casting, pact: { ...casting.pact, used: 0 } } },
      result: { restored: "every Pact Magic slot" },
    };
  }
  const slots = Object.fromEntries(
    Object.entries(casting.slots).map(([level, slot]) => [level, { max: slot.max, used: 0 }]),
  );
  return { patch: { spellcasting: { ...casting, slots } }, result: { restored: "every Pact Magic slot" } };
}

// Empty Body (monk 18): invisible and resistant to all damage but force for
// a minute (the "empty body" row in condition-effects.ts).
function emptyBody(sheet: CharacterSheet): Resolution {
  const held = sheet.conditions.filter((entry) => !["invisible", "empty body"].includes(entry.toLowerCase()));
  return {
    patch: {
      conditions: [...held, "invisible", "empty body"],
      conditionMeta: { ...sheet.conditionMeta, invisible: { rounds: 10 }, "empty body": { rounds: 10 } },
    },
    result: { applied: "invisible and resistant to all damage except force, for a minute" },
  };
}

// Vow of Enmity (Oath of Vengeance 3): a creature within 10 feet, and advantage
// on the paladin's attacks against it for a minute (authored-hooks.ts reads the
// vow). Before this the use was spent and nothing changed.
function vowRefusal(campaign: Campaign, sheet: CharacterSheet, enemyId: string | undefined): ToolError | null {
  const encounter = getActiveEncounter(campaign.id);
  const enemy = encounter && enemyId ? resolveTargetFoe(campaign.id, encounter, enemyId) : null;
  if (!encounter || !enemy || enemy.status !== "alive") {
    return { error: "Vow of Enmity names a living creature in the fight: pass targetEnemyId. Nothing was spent.", retry: true };
  }
  if (!withinFeet(encounter.id, sheet.id, enemy.id, 10)) {
    return { error: `${enemy.displayName} is beyond 10 feet of ${sheet.name}; Vow of Enmity reaches 10 feet. Nothing was spent.`, refused: "rules" };
  }
  // "A creature you can see", as Abjure Enemy beside it (channel-fear.ts).
  const unseen = unseenBecause(encounter.id, sheet, enemy);
  if (unseen) {
    return { error: `${sheet.name} cannot see ${enemy.displayName} (${unseen}), and Vow of Enmity takes a creature they can see. Nothing was spent.`, refused: "rules" };
  }
  return null;
}

function vowOfEnmity(sheet: CharacterSheet, enemyId: string): Resolution {
  const held = sheet.conditions.filter((entry) => !isConditionNamed(entry, VOW_OF_ENMITY));
  return {
    patch: {
      conditions: [...held, VOW_OF_ENMITY],
      conditionMeta: { ...sheet.conditionMeta, [VOW_OF_ENMITY]: { rounds: 10, quarry: enemyId } },
    },
    result: { applied: `${sheet.name} has advantage on attacks against that creature for 10 rounds.` },
  };
}

// Sacred Weapon (Oath of Devotion 3): the paladin's Charisma modifier (at
// least +1) on weapon attack rolls for a minute. The bonus rides the
// condition's name, which the attack engine reads (condition-effects.ts).
function sacredWeapon(sheet: CharacterSheet): Resolution {
  const bonus = Math.max(1, computeSheetDerived(sheet).abilityMods.cha);
  const condition = `sacred weapon (+${bonus})`;
  const held = sheet.conditions.filter((entry) => !isConditionNamed(entry, "sacred weapon"));
  return {
    patch: {
      conditions: [...held, condition],
      conditionMeta: { ...sheet.conditionMeta, [condition]: sacredWeaponMeta(sheet, 10) },
    },
    result: { applied: `${condition} for 10 rounds: +${bonus} to weapon attack rolls, and the weapon sheds bright light for 20 feet and dim light 20 feet beyond.` },
  };
}

// Preserve Life (Life Domain 2): up to five times the cleric level in hit
// points, split among creatures within 30 feet, none above half its maximum.
// The named target first; the rest goes to the most hurt allies in reach.
function preserveLife(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  targetId: string | undefined,
  reason: string,
): Resolution {
  let pool = 5 * Math.max(1, classLevelOf(sheet, "cleric"));
  const party = fieldedSheets(campaign, listSheets(campaign.id))
    .map((entry) => getSheetById(entry.id) ?? entry)
    // One Chill Touch grips, or one suffocating, regains nothing (regain.ts).
    // "You can't use this feature on an undead or a construct" (mt-srd-reach.ts).
    .filter((entry) => canRegain(entry) && !undeadOrConstruct(entry) && within(campaign.id, sheet.id, entry.id, 30) && !swallowCoverBetween(sheet.id, entry.id));
  const room = (entry: CharacterSheet) =>
    Math.max(0, Math.floor(effectiveMaxHp(entry) / 2) - entry.currentHp);
  const ordered = [
    ...party.filter((entry) => entry.id === targetId),
    ...party.filter((entry) => entry.id !== targetId).sort((a, b) => a.currentHp - b.currentHp),
  ].filter((entry) => room(entry) > 0);
  if (!ordered.length) {
    return { error: "Preserve Life heals only creatures below half their hit points, and nobody in reach is. Channel Divinity was not spent.", refused: "rules" };
  }
  const healed: string[] = [];
  for (const target of ordered) {
    if (pool <= 0) {
      break;
    }
    const amount = Math.min(pool, room(target));
    pool -= amount;
    const gained = regainHitPoints(campaign, turnId, target, amount, reason || "Preserve Life");
    healed.push(`${target.name} +${gained} (${(getSheetById(target.id) ?? target).currentHp}/${effectiveMaxHp(target)})`);
  }
  return { result: { healed } };
}

// Indomitable (fighter 9): the save the fighter last failed is rolled again,
// and the new roll stands. On a success, the conditions that failure put on
// them (those that end on that same save) come off.
function indomitable(campaign: Campaign, sheet: CharacterSheet): Resolution {
  const failed = listRecentRolls(campaign.id, 60).find(
    (roll) =>
      roll.characterId === sheet.id &&
      roll.kind === "saving_throw" &&
      roll.dc !== null &&
      roll.total < roll.dc,
  );
  const ability = failed
    ? ((/\b(str|dex|con|int|wis|cha)\b/i.exec(failed.detail)?.[1] ?? "").toLowerCase() as Ability | "")
    : "";
  if (!failed || !ability) {
    return { error: `${sheet.name} has no failed saving throw to reroll; Indomitable was not spent.`, refused: "rules" };
  }
  const dc = failed.dc!;
  const against = /\bvs\.? (.+)$/i.exec(failed.detail)?.[1];
  const save = rollFeatureSave(campaign, sheet, ability, dc, "Indomitable reroll", against);
  const bulwark = bulwarkReroll(campaign, sheet, ability, dc, against);
  if (!save.success) {
    return { result: { indomitable: `The reroll fails too (${ability.toUpperCase()} ${save.total ?? "failed"} vs DC ${dc}); the failure stands.`, ...bulwark } };
  }
  const now = getSheetById(sheet.id) ?? sheet;
  const meta = now.conditionMeta as ConditionMetaMap;
  const lifted = now.conditions.filter((name) => {
    const ends = meta[name]?.saveEnds;
    return ends && ends.ability === ability && ends.dc === dc;
  });
  const cleared = removeConditions(now.conditions, now.conditionMeta, lifted);
  return {
    patch: lifted.length ? { conditions: cleared.conditions, conditionMeta: cleared.meta } : {},
    result: {
      indomitable: `The reroll succeeds (${ability.toUpperCase()} ${save.total} vs DC ${dc})${
        lifted.length ? `: ${lifted.join(", ")} no longer holds them` : ""
      }.`,
      ...bulwark,
    },
  };
}

// Bulwark (Banneret 18): with an Intelligence, Wisdom or Charisma save
// rerolled and the fighter not incapacitated, one ally in range that failed
// the same save rerolls it too, and an effect that save ends lets go.
function bulwarkReroll(campaign: Campaign, sheet: CharacterSheet, ability: Ability, dc: number, against: string | undefined): { bulwark?: string } {
  const held = activeAuthored(sheet, "indomitable_ally")[0];
  if (!held || !["int", "wis", "cha"].includes(ability) || incapacitatedBy(sheet.conditions)) {
    return {};
  }
  const encounter = getActiveEncounter(campaign.id);
  const failed = listRecentRolls(campaign.id, 60).find((roll) => {
    if (roll.characterId === sheet.id || roll.kind !== "saving_throw" || roll.dc !== dc || roll.total >= dc) {
      return false;
    }
    const rolledAbility = (/\b(str|dex|con|int|wis|cha)\b/i.exec(roll.detail)?.[1] ?? "").toLowerCase();
    return rolledAbility === ability && (!encounter || withinFeet(encounter.id, sheet.id, roll.characterId ?? "", held.effect.rangeFt));
  });
  const ally = failed?.characterId ? getSheetById(failed.characterId) : null;
  if (!ally || ally.campaignId !== campaign.id) {
    return {};
  }
  const save = rollFeatureSave(campaign, ally, ability, dc, "Bulwark reroll", against);
  if (!save.success) {
    return { bulwark: `Bulwark: ${ally.name} rerolls too and fails again (${save.total ?? "failed"} vs DC ${dc}).` };
  }
  const meta = ally.conditionMeta as ConditionMetaMap;
  const lifted = ally.conditions.filter((name) => meta[name]?.saveEnds?.ability === ability && meta[name]?.saveEnds?.dc === dc);
  if (lifted.length) {
    const cleared = removeConditions(ally.conditions, ally.conditionMeta, lifted);
    const updated = patchSheet(ally.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  return { bulwark: `Bulwark: ${ally.name} rerolls and succeeds (${save.total} vs DC ${dc})${lifted.length ? `: ${lifted.join(", ")} no longer holds them` : ""}.` };
}
