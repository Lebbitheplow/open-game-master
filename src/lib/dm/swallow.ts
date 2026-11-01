// Swallowed whole (SRD 5.1: the behir, the kraken, the purple worm, the
// remorhaz, the tarrasque, the giant frog and the giant toad), played by the
// engine whichever way the swallow came: a Swallow action, a bite that
// swallows, or a legendary action that uses either (issue 685).
//
// A swallowed character carries "swallowed" beside the blinded and
// restrained it lays, each with the swallower as source. While inside they
// have total cover against everything outside it and reach nothing but it
// (swallowCover); they take its acid at the start of each of its turns
// (swallowTurnStart); damage they deal it is counted for the turn, and at the
// turn's end enough of it forces its Constitution save or it regurgitates
// everyone, prone beside it (swallowTurnEnd); and when it dies they are no
// longer restrained and climb out of the corpse with the feet of movement
// the block prints, exiting prone (freeFromCorpse, swallowWalk). The numbers
// are the block's own (swallow-logic.ts).
//
// Must not import encounter-tools, enemy-attack or pc-attack: they call in
// here.

import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, listEnemies, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { getBattleMapForEncounter, getTokenByRef, listTokens, moveToken, type BattleMap } from "@/lib/db/battle-maps";
import { footprintLookup, occupiedTiles, pcMoveBudget } from "@/lib/battlemap/view";
import { footprintForSize } from "@/lib/battlemap/footprint";
import { chebyshev, inBounds, tileIndex, type BattleToken } from "@/lib/battlemap/types";
import { removeConditionInstances, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { swallowRuleOf, type SwallowRule } from "@/lib/dm/swallow-logic";
import { handleSetCondition } from "@/lib/dm/set-condition";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { withOpportunityTurn } from "@/lib/dm/opportunity-strike";
import { publicDie } from "@/lib/dm/between-io";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { publishEphemeral, publishPersisted } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolResult } from "@/lib/dm/tool-errors";

export const SWALLOWED = "swallowed";

type Holder = { conditions: string[]; conditionMeta?: unknown };
type Party = { kind: "sheet" | "enemy"; id: string };

const held = (holder: Holder, name: string) => holder.conditions.find((entry) => entry.toLowerCase() === name);
const metaOf = (holder: Holder) => (holder.conditionMeta ?? {}) as ConditionMetaMap;

// The creature a character is inside, or null.
export function swallowerOf(holder: Holder): string | null {
  const name = held(holder, SWALLOWED);
  return name ? (metaOf(holder)[name]?.source ?? null) : null;
}

function insideOf(party: Party | null): string | null {
  if (party?.kind !== "sheet") {
    return null;
  }
  const sheet = getSheetById(party.id);
  return sheet ? swallowerOf(sheet) : null;
}

const nameOf = (party: Party) => (party.kind === "sheet" ? getSheetById(party.id)?.name : getEnemy(party.id)?.displayName) ?? "That creature";
const swallowerName = (id: string) => getEnemy(id)?.displayName ?? "the creature that swallowed them";

// Total cover (SRD 5.1): a swallowed creature "has total cover against
// attacks and other effects outside" its swallower, and reaches only it from
// in there. Null when `from` may reach `to`; else the refusal. `from` null is
// an effect with no creature behind it (a trap's): it is outside too.
export function swallowCover(from: Party | null, to: Party): string | null {
  const toInside = insideOf(to);
  const fromInside = insideOf(from);
  if (toInside && fromInside !== toInside) {
    return `${nameOf(to)} is inside ${swallowerName(toInside)}: total cover against attacks and other effects from outside it.`;
  }
  if (fromInside && from && !(to.kind === "enemy" && to.id === fromInside) && toInside !== fromInside) {
    return `${nameOf(from)} is inside ${swallowerName(fromInside)}: from there only ${swallowerName(fromInside)} can be reached.`;
  }
  return null;
}

// The characters inside a creature, read fresh.
export function swallowedBy(campaignId: string, enemyId: string): CharacterSheet[] {
  return listSheets(campaignId)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((sheet) => swallowerOf(sheet) === enemyId);
}

function grappledBy(sheet: CharacterSheet, enemyId: string): boolean {
  const name = held(sheet, "grappled");
  if (!name) {
    return false;
  }
  const entry = metaOf(sheet)[name];
  return entry?.source === enemyId || (entry?.others ?? []).some((other) => other.source === enemyId);
}

// Before a Swallow action is rolled: what keeps it from swallowing at all.
export function swallowRefusal(campaignId: string, enemy: EncounterEnemy, target: CharacterSheet, rule: SwallowRule): string | null {
  if (rule.grappledOnly && !grappledBy(target, enemy.id)) {
    return `${target.name} is not grappled by ${enemy.displayName}; its ${rule.entry} takes a creature it is grappling.`;
  }
  if (rule.onlyOne && swallowedBy(campaignId, enemy.id).some((sheet) => sheet.id !== target.id)) {
    return `${enemy.displayName} already has a creature swallowed, and can have only one at a time.`;
  }
  return null;
}

function withoutFrom(sheet: CharacterSheet, names: string[], sourceId: string): { conditions: string[]; meta: ConditionMetaMap } {
  let conditions = sheet.conditions;
  let meta = metaOf(sheet);
  for (const name of names) {
    const out = removeConditionInstances(conditions, meta, name, (entry) => entry.source === sourceId);
    conditions = out.conditions;
    meta = out.meta;
  }
  return { conditions, meta };
}

function save(campaign: Campaign, sheetId: string, next: { conditions: string[]; meta: ConditionMetaMap }) {
  const updated = patchSheet(sheetId, { conditions: next.conditions, conditionMeta: next.meta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// A hit (or a failed save) that swallows: blinded, restrained and swallowed,
// each held by the creature, and the grapple ends. Returns the result's
// sentence, or why it did not swallow.
export function swallowCreature(campaign: Campaign, turnId: string, enemy: EncounterEnemy, target: CharacterSheet, rule: SwallowRule | null): { swallowed: string } | { notSwallowed: string } {
  const live = getSheetById(target.id) ?? target;
  // A second swing of the same turn finds them inside already.
  if (swallowerOf(live)) {
    return { notSwallowed: `${live.name} is already swallowed.` };
  }
  const refused = rule ? swallowRefusal(campaign.id, enemy, live, rule) : null;
  if (refused) {
    return { notSwallowed: `${refused} ${live.name} is not swallowed.` };
  }
  for (const condition of ["blinded", "restrained", SWALLOWED]) {
    handleSetCondition(campaign, turnId, getSheetById(live.id) ?? live, { condition, sourceEnemyId: enemy.id }, `swallowed by ${enemy.displayName}`, {
      spellEffect: { source: enemy.id },
    });
  }
  const now = getSheetById(live.id) ?? live;
  save(campaign, now.id, withoutFrom(now, ["grappled"], enemy.id));
  const acid = rule?.acid ? `, and takes ${rule.acid.dice} ${rule.acid.type} damage at the start of each of its turns` : "";
  const out = rule?.regurgitate
    ? ` ${rule.regurgitate.damage} damage dealt it from inside in one turn makes it save (DC ${rule.regurgitate.dc} Constitution) at that turn's end or regurgitate them.`
    : "";
  return { swallowed: `${now.name} is swallowed: blinded and restrained inside ${enemy.displayName}, with total cover against everything outside it${acid}.${out}` };
}

// The acid at the start of each of the swallower's turns.
export function swallowTurnStart(campaign: Campaign, enemy: EncounterEnemy): string[] {
  const rule = swallowRuleOf(enemy.stats);
  if (!rule?.acid) {
    return [];
  }
  const lines: string[] = [];
  for (const sheet of swallowedBy(campaign.id, enemy.id)) {
    if (sheet.deathSaves?.dead) {
      continue;
    }
    const amount = publicDie(campaign, sheet, rule.acid.dice, `${sheet.name}: ${rule.acid.type} inside ${enemy.displayName}`);
    const acid = rule.acid;
    withOpportunityTurn(campaign.id, (turn) => applyPcDamage(campaign, turn.id, getSheetById(sheet.id) ?? sheet, { amount, type: acid.type, reason: `swallowed by ${enemy.displayName}` }));
    lines.push(`${sheet.name}, swallowed, takes ${amount} ${acid.type} damage as ${enemy.displayName}'s turn starts (before resistances).`);
  }
  return lines;
}

// Damage a character dealt the creature that swallowed them, counted toward
// the turn's regurgitation save.
export function noteBlowFromInside(enemyId: string, byId: string | undefined, amount: number) {
  const sheet = byId ? getSheetById(byId) : null;
  const name = sheet ? held(sheet, SWALLOWED) : undefined;
  if (!sheet || !name || amount <= 0 || swallowerOf(sheet) !== enemyId) {
    return;
  }
  const meta = metaOf(sheet);
  const entry = meta[name] ?? {};
  patchSheet(sheet.id, { conditionMeta: { ...meta, [name]: { ...entry, swallow: { ...(entry.swallow ?? {}), hurt: (entry.swallow?.hurt ?? 0) + Math.floor(amount) } } } });
}

// An open square beside a creature's footprint, nearest the character.
function besideSquare(encounterId: string, map: BattleMap, mover: BattleToken, beside: BattleToken, size: number): { x: number; y: number } | null {
  const enemiesById = new Map(listEnemies(encounterId).map((enemy) => [enemy.id, enemy]));
  const occupied = occupiedTiles(map, listTokens(map.id), mover, footprintLookup(enemiesById));
  let best: { x: number; y: number } | null = null;
  for (let x = beside.x - 1; x <= beside.x + size; x += 1) {
    for (let y = beside.y - 1; y <= beside.y + size; y += 1) {
      const under = x >= beside.x && x < beside.x + size && y >= beside.y && y < beside.y + size;
      if (under || !inBounds(map.width, map.height, x, y) || occupied.has(tileIndex(map.width, x, y))) {
        continue;
      }
      if (!best || chebyshev(mover.x, mover.y, x, y) < chebyshev(mover.x, mover.y, best.x, best.y)) {
        best = { x, y };
      }
    }
  }
  return best;
}

// Out of the creature, prone in a space beside it (within 10 feet: SRD 5.1).
// Returns where they landed, or null off the board.
function outProne(campaign: Campaign, encounterId: string, sheet: CharacterSheet, swallower: EncounterEnemy, names: string[]): string | null {
  const live = getSheetById(sheet.id) ?? sheet;
  const freed = withoutFrom(live, names, swallower.id);
  const prone = freed.conditions.some((entry) => entry.toLowerCase() === "prone") ? freed : { conditions: [...freed.conditions, "prone"], meta: freed.meta };
  save(campaign, live.id, prone);
  const map = getBattleMapForEncounter(encounterId);
  const token = map ? getTokenByRef(map.id, live.id) : null;
  const body = map ? getTokenByRef(map.id, swallower.id) : null;
  const square = map && token && body ? besideSquare(encounterId, map, token, body, footprintForSize(swallower.stats.size)) : null;
  if (map && token && square) {
    moveToken(token.id, square.x, square.y, token.movedThisRound);
    publishEphemeral(campaign.id, "battle_map_updated", {});
    return `(${square.x},${square.y})`;
  }
  return null;
}

// The end of a turn: a swallower dealt enough from inside it this turn saves
// or regurgitates everyone it holds, and the count starts again.
export function swallowTurnEnd(campaign: Campaign, encounter: Encounter): string[] {
  const lines: string[] = [];
  const hurt = new Map<string, number>();
  for (const sheet of listSheets(campaign.id).map((stale) => getSheetById(stale.id) ?? stale)) {
    const name = held(sheet, SWALLOWED);
    const entry = name ? metaOf(sheet)[name] : undefined;
    if (!name || !entry?.source || !entry.swallow?.hurt) {
      continue;
    }
    hurt.set(entry.source, Math.max(hurt.get(entry.source) ?? 0, entry.swallow.hurt));
    // The count is the turn's: it starts again at nothing.
    const reset = { ...entry, swallow: { ...entry.swallow, hurt: 0 } };
    patchSheet(sheet.id, { conditionMeta: { ...metaOf(sheet), [name]: reset } });
  }
  for (const [enemyId, amount] of hurt) {
    const swallower = getEnemy(enemyId);
    const rule = swallower ? swallowRuleOf(swallower.stats) : null;
    if (!swallower || swallower.status !== "alive" || !rule?.regurgitate || amount < rule.regurgitate.damage) {
      continue;
    }
    const roll = rollEnemySave(campaign.id, swallower, "con", rule.regurgitate.dc, { record: { detail: `${swallower.displayName}: holding down what it swallowed (CON save)` } });
    if (roll.success) {
      lines.push(`${swallower.displayName} took ${amount} damage from inside this turn and keeps it down (CON save ${roll.total} vs DC ${rule.regurgitate.dc}).`);
      continue;
    }
    const out = swallowedBy(campaign.id, enemyId).map((sheet) => {
      const at = outProne(campaign, encounter.id, sheet, swallower, [SWALLOWED, "blinded", "restrained"]);
      return `${sheet.name}${at ? ` at ${at}` : ""}`;
    });
    lines.push(`${swallower.displayName} took ${amount} damage from inside this turn and fails its CON save (${roll.total ?? "failed"} vs DC ${rule.regurgitate.dc}): it regurgitates ${out.join(", ")}, prone beside it.`);
  }
  return lines;
}

// A swallower that dies: no longer restrained by it, the creatures inside
// climb out of the corpse with the feet of movement the block prints.
export function freeFromCorpse(campaign: Campaign, enemy: EncounterEnemy): string | null {
  const inside = swallowedBy(campaign.id, enemy.id);
  if (!inside.length) {
    return null;
  }
  const feet = swallowRuleOf(enemy.stats)?.escapeFeet ?? 5;
  for (const sheet of inside) {
    const freed = withoutFrom(sheet, ["restrained"], enemy.id);
    const name = held(sheet, SWALLOWED) ?? SWALLOWED;
    const entry = freed.meta[name] ?? {};
    save(campaign, sheet.id, { conditions: freed.conditions, meta: { ...freed.meta, [name]: { ...entry, swallow: { ...(entry.swallow ?? {}), escapeFeet: feet } } } });
  }
  return `${inside.map((sheet) => sheet.name).join(", ")} ${inside.length === 1 ? "is" : "are"} no longer restrained by ${enemy.displayName}: ${feet} feet of movement climbs out of the corpse, exiting prone.`;
}

// A swallowed character's walk: none while the creature lives, and once it
// is dead the walk is the climb out (its feet of movement, exiting prone).
// Null for a character nothing holds inside.
export function swallowWalk(campaign: Campaign, encounter: Encounter, map: BattleMap, sheet: CharacterSheet, token: BattleToken): ToolResult | null {
  const id = swallowerOf(sheet);
  const swallower = id ? getEnemy(id) : null;
  if (!id || !swallower) {
    return null;
  }
  if (swallower.status === "alive") {
    return { error: `${sheet.name} is swallowed inside ${swallower.displayName}, restrained there: no walking until it regurgitates them or dies.`, refused: "rules" };
  }
  const name = held(sheet, SWALLOWED) ?? SWALLOWED;
  const feet = metaOf(sheet)[name]?.swallow?.escapeFeet ?? swallowRuleOf(swallower.stats)?.escapeFeet ?? 5;
  const left = pcMoveBudget(campaign.id, encounter, map, sheet, token).fullTiles;
  const tiles = Math.ceil(feet / 5);
  if (left < tiles) {
    return { error: `${sheet.name} needs ${feet} feet of movement to climb out of ${swallower.displayName}'s corpse and has ${left * 5} left this turn.`, refused: "rules" };
  }
  const at = outProne(campaign, encounter.id, sheet, swallower, [SWALLOWED, "blinded"]);
  const moved = getTokenByRef(map.id, sheet.id);
  if (moved) {
    moveToken(moved.id, moved.x, moved.y, token.movedThisRound + tiles);
  }
  return {
    ok: true,
    name: sheet.name,
    escaped: `${sheet.name} climbs out of ${swallower.displayName}'s corpse with ${feet} feet of movement and lands prone${at ? ` at ${at}` : ""}.`,
  };
}
