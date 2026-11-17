// Manacles (SRD 5.1, Adventuring Gear): "These metal restraints can bind a
// Small or Medium creature. Escaping the manacles requires a successful DC
// 20 Dexterity check. Breaking them requires a successful DC 20 Strength
// check. Each set of manacles comes with one key. Without the key, a
// creature proficient with thieves' tools can pick the manacles' lock with
// a successful DC 15 Dexterity check. Manacles have 15 hit points." The GM
// laid a restraint by hand and chose every one of those DCs through
// request_roll.
//
// Bound is the restrained condition, its instance naming the manacles as
// its source, as a net's names the net (net-hold.ts). Restrained because
// the SRD calls manacles a restraint (Freedom of Movement escapes
// "nonmagical restraints, such as manacles"), and restrained is the
// condition the engine and the SRD's other restraint gear (the net) lay for
// a creature so held: speed 0, its attacks at disadvantage, attacks against
// it at advantage, its Dexterity saves at disadvantage. Grappled would let
// it fight freely; a condition of our own ("bound") no rule reads.
//
// The doors: take_action use_object with the Manacles and a target binds
// (or, on a creature already in a set, opens it with the key, which is with
// the side that put the set on): a character's call, an enemy's (enemyId,
// binding a character), or captors' out of a fight (no actor id);
// use_object with Thieves' Tools picks the lock; take_action escape slips them (Dexterity) or breaks them
// (Strength); damage_object on "Manacles" counts their 15 hit points
// (object-damage.ts).

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, listEnemies, patchEnemyConditions, saveEncounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { getTokenByRef } from "@/lib/db/battle-maps";
import { insertDroppedItem } from "@/lib/db/dropped-items";
import { getActiveBattleMap } from "@/lib/battlemap/view";
import { publishPersisted } from "@/lib/events";
import { sizeRank } from "@/lib/bestiary/enemy-numbers";
import { instancesOf, isIncapacitated, removeConditionInstances, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { handleSetCondition } from "@/lib/dm/set-condition";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { publishEncounter, resolveEnemyRef, unknownEnemyRef } from "@/lib/dm/enemy-damage";
import { rollEnemyAbilityCheck } from "@/lib/dm/enemy-trap";
import { canEnemyAct } from "@/lib/dm/can-act";
import { spendEnemyAction } from "@/lib/dm/enemy-approach";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { computeAbilityScore, toolProficiencyBonus } from "@/lib/dm/roll-riders";
import { findCarriedItem } from "@/lib/dm/item-logic";
import { saveEquipment } from "@/lib/owners/items";
import { placeName } from "@/lib/dm/gear-ground";
import { tilesApart } from "@/lib/dm/board-reach";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { resolveSheetRef, unknownSheetRef } from "@/lib/dm/rolls";
import { toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { abilityMod, sheetSize } from "@/lib/srd";
import { itemRow } from "@/lib/srd/item-tags";
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";

// The source a set of manacles' restraint records.
export const MANACLES_HOLD = "manacles";
const RESTRAINED = "restrained";
const SLIP_DC = 20;
const BREAK_DC = 20;
const PICK_DC = 15;
export const MANACLES_HP = 15;
// Iron (SRD 5.1, Objects: Object Armor Class, iron or steel 19).
export const MANACLES_AC = 19;
const MANACLES_ROW = "Manacles";
const THIEVES_TOOLS_ROW = "Thieves' tools";

type Held = { conditions: string[]; conditionMeta?: unknown };

// Whether a set of manacles binds this creature.
export function manaclesHold(held: Held): boolean {
  return setOn(held) !== null;
}

// The gear by its catalogue row (a carried line's slug when it has one), so
// "manacles" or "Manacles (iron)" is the set.
type Named = Parameters<typeof itemRow>[0];
const rowIs = (item: Named, row: string) => itemRow(item)?.name === row;
export const namesManacles = (item: Named) => rowIs(item, MANACLES_ROW);

export type Bound = { kind: "enemy"; enemy: EncounterEnemy } | { kind: "pc"; sheet: CharacterSheet };
const boundId = (bound: Bound) => (bound.kind === "enemy" ? bound.enemy.id : bound.sheet.id);
const boundName = (bound: Bound) => (bound.kind === "enemy" ? bound.enemy.displayName : bound.sheet.name);
const heldOf = (bound: Bound): Held => (bound.kind === "enemy" ? bound.enemy : bound.sheet);

// The set comes off the creature; where it goes is the caller's.
function release(campaign: Campaign, bound: Bound) {
  if (bound.kind === "enemy") {
    const fresh = getEnemy(bound.enemy.id) ?? bound.enemy;
    const cleared = removeConditionInstances(fresh.conditions, fresh.conditionMeta as ConditionMetaMap, RESTRAINED, (entry) => entry.source === MANACLES_HOLD);
    patchEnemyConditions(fresh.id, cleared.conditions, cleared.meta);
    publishEncounter(campaign.id);
    return;
  }
  const fresh = getSheetById(bound.sheet.id) ?? bound.sheet;
  const cleared = removeConditionInstances(fresh.conditions, fresh.conditionMeta as ConditionMetaMap, RESTRAINED, (entry) => entry.source === MANACLES_HOLD);
  const updated = patchSheet(fresh.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// Slipped, the set falls whole where the creature stands, for anyone to
// pick up (handle_item pick_up).
function dropAt(campaign: Campaign, bound: Bound): void {
  const map = getActiveBattleMap(campaign.id);
  const token = map ? getTokenByRef(map.id, boundId(bound)) : null;
  insertDroppedItem({ campaignId: campaign.id, mapId: map && token ? map.id : null, x: token?.x ?? null, y: token?.y ?? null, place: placeName(campaign.id), item: { name: MANACLES_ROW, qty: 1 }, droppedBy: boundName(bound) });
  if (map) {
    publishBattleMapUpdate(campaign.id);
  }
}

// Slipped by another way out (Freedom of Movement, ar-ws-squeeze.ts): the
// set lies at the creature's feet, as after the DC 20 slip.
export const manaclesFall = (campaign: Campaign, bound: Bound) => dropAt(campaign, bound);

function giveSet(campaign: Campaign, turn: DmTurn, sheet: CharacterSheet, delta: number, reason: string): void {
  const fresh = getSheetById(sheet.id) ?? sheet;
  const at = fresh.equipment.findIndex((item) => namesManacles(item));
  const equipment: EquipmentItem[] =
    at < 0
      ? delta > 0 ? [...fresh.equipment, { name: MANACLES_ROW, qty: delta }] : fresh.equipment
      : fresh.equipment.flatMap((item, index) => (index !== at ? [item] : (item.qty ?? 1) + delta > 0 ? [{ ...item, qty: (item.qty ?? 1) + delta }] : []));
  saveEquipment(campaign, turn, fresh, equipment, "use_item", { item: MANACLES_ROW, qty: delta }, reason);
}

// Whether the two stand within 5 feet on the board; with no board, the
// narration's to say.
function withinReach(campaignId: string, a: string, b: string): boolean {
  const map = getActiveBattleMap(campaignId);
  const one = map ? getTokenByRef(map.id, a) : null;
  const two = map ? getTokenByRef(map.id, b) : null;
  return !one || !two || tilesApart(one, two) <= 1;
}

// Small or Medium, after Enlarge/Reduce.
function sizeFits(bound: Bound): string | null {
  const conditions = heldOf(bound).conditions;
  const base = bound.kind === "enemy" ? sizeRank(bound.enemy.stats.size) : sizeRank(sheetSize(bound.sheet));
  const shift = (conditions.some((name) => isConditionNamed(name, "enlarged", "enlarge")) ? 1 : 0) - (conditions.some((name) => isConditionNamed(name, "reduced", "reduce")) ? 1 : 0);
  const rank = base + shift;
  const label = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"][Math.max(0, Math.min(5, rank))];
  return rank === sizeRank("small") || rank === sizeRank("medium") ? null : label;
}

function resolveBound(campaign: Campaign, args: { targetEnemyId?: string; targetCharacterId?: string }): Bound | ToolError {
  const enemyRef = args.targetEnemyId?.trim();
  if (enemyRef) {
    const encounter = getActiveEncounter(campaign.id);
    const enemy = encounter ? resolveEnemyRef(encounter.id, enemyRef) : null;
    if (!enemy || !encounter) {
      return encounter ? unknownEnemyRef(encounter.id, "targetEnemyId", enemyRef, " Nothing was spent.") : { error: "No active encounter: targetEnemyId names a creature in a fight. Nothing was spent.", retry: true };
    }
    return { kind: "enemy", enemy };
  }
  const sheets = listSheets(campaign.id);
  const stale = resolveSheetRef(args.targetCharacterId, sheets, new Map(sheets.map((entry) => [entry.id, entry])));
  return stale ? { kind: "pc", sheet: getSheetById(stale.id) ?? stale } : unknownSheetRef("targetCharacterId", args.targetCharacterId, sheets, " Nothing was spent.");
}

// Whose hands work the set: a character's (take_action with characterId),
// an enemy's (enemyId), or captors' out of a fight (neither id: the GM's
// people, who are no creature on record). "Each set of manacles comes with
// one key": the key is with the side that put the set on, so a set the
// party's foes lock on a hero is not the party's to open, and the restraint
// says so (keyWithFoes).
type Hands = { kind: "pc"; sheet: CharacterSheet } | { kind: "enemy"; enemy: EncounterEnemy } | { kind: "captors" };
const handsName = (hands: Hands) => (hands.kind === "pc" ? hands.sheet.name : hands.kind === "enemy" ? hands.enemy.displayName : "the captors");
const handsId = (hands: Hands) => (hands.kind === "pc" ? hands.sheet.id : hands.kind === "enemy" ? hands.enemy.id : null);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// The restraint a set of manacles lays on this creature, or null.
function setOn(held: Held): ConditionMeta | null {
  const meta = (held.conditionMeta ?? {}) as ConditionMetaMap;
  for (const name of held.conditions) {
    const found = isConditionNamed(name, RESTRAINED) ? instancesOf(meta[name]).find((entry) => entry.source === MANACLES_HOLD) : undefined;
    if (found) {
      return found;
    }
  }
  return null;
}

// The foes' key, once the party has taken it: a line of the opener's pack by
// this name (handle_item gives it).
const MANACLES_KEY = "Manacles key";
const carriesKey = (sheet: CharacterSheet) => findCarriedItem(sheet.equipment, MANACLES_KEY) !== null;

// take_action use_object with the Manacles or Thieves' Tools on a creature.
// Null when the call is about neither, so the plain Use an Object goes on.
export function manaclesUse(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  args: { item?: string; targetEnemyId?: string; targetCharacterId?: string },
  spend: () => void,
): ToolResult | null {
  return workSet(campaign, turn, { kind: "pc", sheet }, args, spend);
}

// The party's foes with a set: an enemy's take_action use_object
// (enemy-actions.ts), or captors' out of a fight (action-tools.ts). They put
// it on a character, or open one of their own with its key. Null when the
// call is not about the manacles.
export function foesManacles(
  campaign: Campaign,
  turn: DmTurn,
  hands: Exclude<Hands, { kind: "pc" }>,
  args: { item?: string; targetEnemyId?: string; targetCharacterId?: string },
  spend: () => void,
): ToolResult | null {
  return workSet(campaign, turn, hands, args, spend);
}

export const callsManacles = (item: string | undefined) => Boolean(item?.trim()) && namesManacles({ name: item?.trim() ?? "" });

function workSet(
  campaign: Campaign,
  turn: DmTurn,
  hands: Hands,
  args: { item?: string; targetEnemyId?: string; targetCharacterId?: string },
  spend: () => void,
): ToolResult | null {
  const item = args.item?.trim() ?? "";
  const manacles = callsManacles(item);
  const tools = Boolean(item) && rowIs({ name: item }, THIEVES_TOOLS_ROW);
  if ((!manacles && !tools) || (!args.targetEnemyId?.trim() && !args.targetCharacterId?.trim())) {
    return null;
  }
  if (hands.kind !== "pc") {
    // A stat block names no tool proficiency, and the foes' sets go on the
    // party (an enemy in the party's manacles is the party's to hold).
    if (tools) {
      return { error: `${capital(handsName(hands))} pick no lock here: a stat block names no tool proficiency. Nothing was spent.`, refused: "rules" };
    }
    if (!args.targetCharacterId?.trim()) {
      return { error: "Manacles the party's foes hold go on a character: send targetCharacterId. Nothing was spent.", retry: true };
    }
  }
  const bound = resolveBound(campaign, hands.kind === "pc" ? args : { targetCharacterId: args.targetCharacterId });
  if ("error" in bound) {
    return bound;
  }
  const name = boundName(bound);
  if (bound.kind === "enemy" && bound.enemy.status !== "alive") {
    return { error: `${name} is not alive to bind. Nothing was spent.`, refused: "rules" };
  }
  const by = handsId(hands);
  if (by && !withinReach(campaign.id, by, boundId(bound))) {
    return { error: `${name} is out of ${handsName(hands)}'s reach: manacles are put on, opened or picked from within 5 feet. Nothing was spent.`, refused: "rules" };
  }
  const set = setOn(heldOf(bound));
  if (tools && hands.kind === "pc") {
    return set ? pickLock(campaign, turn, hands.sheet, bound, spend) : null;
  }
  if (set) {
    return unlock(campaign, turn, hands, bound, set, spend);
  }
  return bind(campaign, turn, hands, bound, item, spend);
}

// The key opens the set, with no roll: the key of the side that put it on.
// A character's key goes back in the opener's pack with the set; the foes
// keep theirs.
function unlock(campaign: Campaign, turn: DmTurn, hands: Hands, bound: Bound, set: ConditionMeta, spend: () => void): ToolResult {
  const name = boundName(bound);
  const foesSet = set.keyWithFoes === true;
  if (hands.kind === "pc" && foesSet && !carriesKey(hands.sheet)) {
    return {
      error: `The key to the manacles on ${name} is with whoever locked them on, not the party. ${name} slips or breaks them with take_action escape (DC 20 Dexterity or Strength), or someone proficient picks the lock with use_object and Thieves' Tools (DC 15). A key taken from them is a "${MANACLES_KEY}" in the opener's pack (handle_item). Nothing was spent.`,
      refused: "rules",
    };
  }
  if (hands.kind !== "pc" && !foesSet) {
    return { error: `The key to the manacles on ${name} is the party's; ${handsName(hands)} hold none. Nothing was spent.`, refused: "rules" };
  }
  spend();
  release(campaign, bound);
  if (hands.kind === "pc") {
    giveSet(campaign, turn, hands.sheet, 1, `Unlocked the manacles on ${name}`);
    return { ok: true, action: "Use an Object", applied: `${hands.sheet.name} opens the manacles on ${name} with the key; ${name} is free and the set is in ${hands.sheet.name}'s pack.` };
  }
  return { ok: true, action: "Use an Object", applied: `${capital(handsName(hands))} open the manacles on ${name} with their key; ${name} is free.` };
}

// Whether the creature can be bound by these hands. SRD 5.1 gives no roll
// for putting manacles on, and a creature that can fight them off is not
// bound by a set held out at it; the nearest rule is the Dimensional
// Shackles', placed "on an incapacitated creature". So: incapacitated,
// restrained, or grappled by the binder. A character the party binds is
// taken as willing (their player is at the table). Captors out of a fight
// bind a character who has yielded or been beaten: a struggle is a fight,
// and in one the binding is a captor's own action (enemyId).
function cannotBeBound(hands: Hands, bound: Bound): string | null {
  if (hands.kind === "captors" || (hands.kind === "pc" && bound.kind === "pc")) {
    return null;
  }
  const held = heldOf(bound);
  const meta = held.conditionMeta as ConditionMetaMap | undefined;
  const by = handsId(hands);
  const ok =
    isIncapacitated(held.conditions) ||
    held.conditions.some((entry) => isConditionNamed(entry, RESTRAINED)) ||
    held.conditions.some((entry) => isConditionNamed(entry, "grappled") && instancesOf(meta?.[entry]).some((instance) => instance.source === by));
  return ok ? null : `${boundName(bound)} is free to fight them off: manacles go on a creature that is incapacitated, restrained, or grappled by ${handsName(hands)}. Nothing was spent.`;
}

function bind(campaign: Campaign, turn: DmTurn, hands: Hands, bound: Bound, item: string, spend: () => void): ToolResult {
  const name = boundName(bound);
  if (hands.kind === "pc") {
    const carried = findCarriedItem(hands.sheet.equipment, item);
    if (!carried || !namesManacles(carried)) {
      return { error: `${hands.sheet.name} carries no manacles. Nothing was spent.`, refused: "rules" };
    }
    if (boundId(bound) === hands.sheet.id) {
      return { error: `${hands.sheet.name} cannot put manacles on themselves. Nothing was spent.`, retry: true };
    }
  }
  const size = sizeFits(bound);
  if (size) {
    return { error: `${name} is ${size}: manacles bind only a Small or Medium creature. Nothing was spent.`, refused: "rules" };
  }
  const free = cannotBeBound(hands, bound);
  if (free) {
    return { error: free, refused: "rules" };
  }
  const foes = hands.kind !== "pc";
  if (bound.kind === "enemy") {
    layEnemyConditionInstance(campaign, getEnemy(bound.enemy.id) ?? bound.enemy, RESTRAINED, { source: MANACLES_HOLD });
  } else {
    // Laid before anything is spent: a character the restraint cannot hold
    // (immune to it) keeps the set and the action.
    const laid = handleSetCondition(campaign, turn.id, getSheetById(bound.sheet.id) ?? bound.sheet, { condition: RESTRAINED }, `Manacles put on by ${handsName(hands)}`, {
      spellEffect: { source: MANACLES_HOLD, ...(foes ? { keyWithFoes: true } : {}) },
      // Iron, no magic: Freedom of Movement does not keep it off, its slip
      // takes it off (ar-ws-squeeze.ts).
      nonmagical: true,
    });
    if ("error" in laid && laid.error) {
      return { error: `${laid.error} Nothing was spent.`, refused: "rules" };
    }
  }
  spend();
  if (hands.kind === "pc") {
    giveSet(campaign, turn, hands.sheet, -1, `Put manacles on ${name}`);
  }
  const key = foes ? `${handsName(hands)}'s key` : "the key";
  return {
    ok: true,
    action: "Use an Object",
    applied: `${capital(handsName(hands))} ${foes && hands.kind === "captors" ? "lock" : "locks"} a set of manacles on ${name}, who is restrained until ${key} opens them, a DC 15 Dexterity check with thieves' tools picks them, or ${name} uses an action on take_action escape: a DC 20 Dexterity check slips them, a DC 20 Strength check breaks them.`,
  };
}

// "Without the key, a creature proficient with thieves' tools can pick the
// manacles' lock with a successful DC 15 Dexterity check."
function pickLock(campaign: Campaign, turn: DmTurn, sheet: CharacterSheet, bound: Bound, spend: () => void): ToolResult {
  const name = boundName(bound);
  if (boundId(bound) === sheet.id) {
    return { error: `${sheet.name}'s own hands are in the manacles: the lock is picked by someone else, or the set slipped or broken with take_action escape. Nothing was spent.`, refused: "rules" };
  }
  const tools = findCarriedItem(sheet.equipment, THIEVES_TOOLS_ROW);
  if (!tools) {
    return { error: `${sheet.name} carries no thieves' tools. Nothing was spent.`, refused: "rules" };
  }
  if (!toolProficiencyBonus(sheet, THIEVES_TOOLS_ROW, 0)) {
    return { error: `${sheet.name} is not proficient with thieves' tools, and only a creature that is can pick the manacles' lock. Nothing was spent.`, refused: "rules" };
  }
  spend();
  const check = rollCharacterCheck(campaign, sheet, { ability: "dex", dc: PICK_DC, tool: THIEVES_TOOLS_ROW, about: "locks" }, `${sheet.name}: DEX check with thieves' tools to pick the manacles on ${name}`);
  if (check.rollId) {
    turn.rollIds.push(check.rollId);
  }
  const picked = !check.autoFailed && check.total >= PICK_DC;
  if (picked) {
    release(campaign, bound);
    giveSet(campaign, turn, sheet, 1, `Picked the manacles off ${name}`);
  }
  return {
    ok: true,
    action: "Use an Object",
    check: `${check.total} vs DC ${PICK_DC}`,
    success: picked,
    note: picked ? `${sheet.name} picks the lock: the manacles open, ${name} is free, and the set is in ${sheet.name}'s pack.` : `The lock holds; ${name} is still in the manacles.`,
  };
}

// Slipping (Dexterity) or breaking (Strength) them, DC 20 either way: the
// creature's choice, or its better ability when none is named.
function escapeOutcome(campaign: Campaign, bound: Bound, ability: "str" | "dex", total: number) {
  const dc = ability === "dex" ? SLIP_DC : BREAK_DC;
  const free = total >= dc;
  const name = boundName(bound);
  if (free) {
    release(campaign, bound);
    if (ability === "dex") {
      dropAt(campaign, bound);
    }
  }
  return {
    check: `${total} vs DC ${dc}`,
    success: free,
    note: free
      ? ability === "dex" ? `${name} slips out of the manacles; the set lies at their feet.` : `${name} breaks the manacles apart.`
      : `${name} ${ability === "dex" ? "twists" : "strains"} against the manacles and stays restrained.`,
  };
}

export function characterManaclesEscape(campaign: Campaign, turn: DmTurn, sheet: CharacterSheet, chosen: string | undefined, spend: () => void): ToolResult {
  const ability = chosen === "str" || chosen === "dex" ? chosen : computeAbilityScore(sheet, "str") > computeAbilityScore(sheet, "dex") ? "str" : "dex";
  spend();
  const check = rollCharacterCheck(campaign, sheet, { ability, dc: ability === "dex" ? SLIP_DC : BREAK_DC }, `${sheet.name}: ${ability.toUpperCase()} check to ${ability === "dex" ? "slip" : "break"} the manacles`);
  if (check.rollId) {
    turn.rollIds.push(check.rollId);
  }
  return { ok: true, action: "escape", ...escapeOutcome(campaign, { kind: "pc", sheet }, ability, check.autoFailed ? 0 : check.total) };
}

export function enemyManaclesEscape(campaign: Campaign, turn: DmTurn, enemy: EncounterEnemy, chosen?: string): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter: an enemy escapes manacles only in a fight.", retry: true };
  }
  const allowed = canEnemyAct({ enemy, encounter, kind: "action" });
  if (!allowed.ok) {
    return toolError(allowed);
  }
  spendEnemyAction(encounter, enemy.id);
  saveEncounter(encounter);
  const score = (key: "str" | "dex") => abilityMod(enemy.stats.abilities?.[key] ?? 10);
  const ability = chosen === "str" || chosen === "dex" ? chosen : score("str") > score("dex") ? "str" : "dex";
  const dc = ability === "dex" ? SLIP_DC : BREAK_DC;
  const total = rollEnemyAbilityCheck(campaign, turn, enemy, ability, dc, `${enemy.displayName}: ${ability.toUpperCase()} check to ${ability === "dex" ? "slip" : "break"} the manacles`);
  const outcome = escapeOutcome(campaign, { kind: "enemy", enemy }, ability, total);
  return { ok: true, action: "escape", ...outcome, note: outcome.success ? outcome.note : `${outcome.note} Its action is spent.` };
}

// What damage_object's "Manacles" is: the set on the creature `boundRef`
// names (damage_object's `bound`), else on the one creature bound in
// manacles (broken, it frees them unharmed), or a set lying loose. Its
// numbers are the set's either way. With several creatures bound and none
// named it is refused: the name alone cannot say which set (the prisoners'
// sets could not be struck at all before `bound`).
export function manaclesObject(campaignId: string, name: string, boundRef?: string): { bound: Bound | null } | ToolError | null {
  if (!namesManacles({ name })) {
    return null;
  }
  const encounter = getActiveEncounter(campaignId);
  const all: Bound[] = [
    ...(encounter ? listEnemies(encounter.id) : []).filter((enemy) => enemy.status === "alive" && manaclesHold(enemy)).map((enemy) => ({ kind: "enemy" as const, enemy })),
    ...listSheets(campaignId).map((stale) => getSheetById(stale.id) ?? stale).filter((entry) => manaclesHold(entry)).map((entry) => ({ kind: "pc" as const, sheet: entry })),
  ];
  const ref = boundRef?.trim();
  if (ref) {
    // By its id or its name, as every target is (enemy-damage.ts, rolls.ts).
    const sheets = listSheets(campaignId);
    const named = (encounter ? resolveEnemyRef(encounter.id, ref)?.id : undefined) ?? resolveSheetRef(ref, sheets, new Map(sheets.map((entry) => [entry.id, entry])))?.id;
    const found = all.find((entry) => boundId(entry) === named);
    return found
      ? { bound: found }
      : { error: `"${ref}" is in no manacles: bound names the creature a set binds (${all.length ? all.map((entry) => `${boundName(entry)}, ${boundId(entry)}`).join("; ") : "none is bound"}). Nothing was rolled.`, retry: true };
  }
  if (all.length > 1) {
    return { error: `Manacles bind ${all.map((entry) => `${boundName(entry)} (${boundId(entry)})`).join(", ")}: send bound with the id of the creature whose set is struck. Nothing was rolled.`, retry: true };
  }
  return { bound: all[0] ?? null };
}

// Broken by damage: the creature is free, unharmed.
export function breakManacles(campaign: Campaign, bound: Bound): string {
  release(campaign, bound);
  return `The manacles break: ${boundName(bound)} is free, unharmed.`;
}

export const manaclesKey = (bound: Bound | null) => (bound ? `manacles ${boundId(bound)}` : null);
