// Swallowed whole (SRD 5.1: the behir, the kraken, the purple worm, the
// remorhaz, the tarrasque, the giant frog and the giant toad), played by the
// engine whichever way the swallow came: a Swallow action, a bite that
// swallows, or a legendary action that uses either (issue 685). A hero and a
// creature fighting on the party's side (a turncoat, a creature it
// dominates) are swallowed alike.
//
// The creature inside carries "swallowed" beside the blinded and restrained
// it lays, each with the swallower as source. While inside it has total
// cover against everything outside and reaches nothing but its swallower
// (swallowCover); it takes the acid at the start of each of the swallower's
// turns (swallowTurnStart); damage it deals the swallower is counted for the
// turn it lands in, whatever deals it (noteBlowFromInside, from
// applyEnemyDamage): the swallower's own (swallowTurnsStarted, turnRunning),
// the character's the pointer rests on, or another creature's, each apart;
// and at the turn's end enough of it forces the swallower's Constitution save
// or it regurgitates everyone, prone beside it (swallowTurnEnd); and when the
// swallower dies the creature is no longer restrained and climbs out of the
// corpse with the feet of movement the block prints, exiting prone
// (freeFromCorpse, swallowWalk, swallowRowWalk). A swallower that leaves the
// fight alive leaves them behind (leftBehind, swallowerAway), and the fight's
// end lets out whoever is still inside (swallowFightEnd). The numbers are the
// block's own (swallow-logic.ts).
//
// Every write goes through a writer "Revert this turn" reads: a character's
// through the sheet audit (audited-patch.ts, set-condition.ts), a creature's
// row and its token through the rows the turn keeps (turn-rows.ts).
//
// Must not import encounter-tools, enemy-attack, pc-attack or enemy-damage:
// they call in here.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, listEnemies, orderEntryId, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { getBattleMapForEncounter, getTokenByRef, listTokens, moveToken, type BattleMap } from "@/lib/db/battle-maps";
import { footprintLookup, occupiedTiles, pcMoveBudget } from "@/lib/battlemap/view";
import { footprintForSize } from "@/lib/battlemap/footprint";
import { chebyshev, inBounds, tileIndex, type BattleToken } from "@/lib/battlemap/types";
import { removeConditionInstances, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { swallowRuleOf, type SwallowRule } from "@/lib/dm/swallow-logic";
import { handleSetCondition } from "@/lib/dm/set-condition";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { withOpportunityTurn } from "@/lib/dm/opportunity-strike";
import { publicDie } from "@/lib/dm/between-io";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { currentActor, turnInHand } from "@/lib/dm/acting-party";
import { textKey } from "@/lib/language/text-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { publishEphemeral, publishPersisted } from "@/lib/events";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError, ToolResult } from "@/lib/dm/tool-errors";

export const SWALLOWED = "swallowed";

type Holder = { conditions: string[]; conditionMeta?: unknown };
export type Party = { kind: "sheet" | "enemy"; id: string };
type Inside = Party & { name: string; conditions: string[]; meta: ConditionMetaMap };

const held = (holder: Holder, name: string) => holder.conditions.find((entry) => entry.toLowerCase() === name);
const metaOf = (holder: Holder | Inside) => (("meta" in holder ? holder.meta : holder.conditionMeta) ?? {}) as ConditionMetaMap;

// The creature a character or a creature is inside, or null.
export function swallowerOf(holder: Holder | Inside): string | null {
  const name = held(holder, SWALLOWED);
  return name ? (metaOf(holder)[name]?.source ?? null) : null;
}

function read(party: Party): Inside | null {
  if (party.kind === "sheet") {
    const sheet = getSheetById(party.id);
    return sheet ? { ...party, name: sheet.name, conditions: sheet.conditions, meta: metaOf(sheet) } : null;
  }
  const row = getEnemy(party.id);
  return row ? { ...party, name: row.displayName, conditions: row.conditions, meta: metaOf(row) } : null;
}

const insideOf = (party: Party | null) => {
  const found = party ? read(party) : null;
  return found ? swallowerOf(found) : null;
};

const swallowerName = (id: string) => getEnemy(id)?.displayName ?? "the creature that swallowed them";

// Total cover (SRD 5.1): a swallowed creature "has total cover against
// attacks and other effects outside" its swallower, and reaches only it from
// in there. Null when `from` may reach `to`; else the refusal. `from` null is
// an effect with no creature behind it (a trap's): it is outside too.
export function swallowCover(from: Party | null, to: Party): string | null {
  const toInside = insideOf(to);
  const fromInside = insideOf(from);
  if (toInside && fromInside !== toInside) {
    return `${read(to)?.name ?? "That creature"} is inside ${swallowerName(toInside)}: total cover against attacks and other effects from outside it.`;
  }
  if (fromInside && from && !(to.kind === "enemy" && to.id === fromInside) && toInside !== fromInside) {
    return `${read(from)?.name ?? "That creature"} is inside ${swallowerName(fromInside)}: from there only ${swallowerName(fromInside)} can be reached.`;
  }
  return null;
}

// The same, from ids alone (a spell's reach, a healer's touch): a
// character's sheet or a creature's row, whichever the id names.
export function swallowCoverBetween(fromId: string, toId: string): string | null {
  const to = partyOf(toId);
  return to ? swallowCover(partyOf(fromId), to) : null;
}

// The refusal a tool returns when an act would cross a swallower's wall, or
// null. `fromId` null is an act with no creature of its own behind it (a
// familiar with no square of its own): outside. An id that names nobody is
// the caller's own refusal to make.
export function swallowCoverError(fromId: string | null, toId: string): ToolError | null {
  const from = fromId ? partyOf(fromId) : null;
  const to = partyOf(toId);
  const inside = to && (fromId === null || (from && fromId !== toId)) ? swallowCover(from, to) : null;
  return inside ? { error: `${inside} Nothing was spent.`, refused: "rules" } : null;
}

function partyOf(id: string): Party | null {
  if (getSheetById(id)) {
    return { kind: "sheet", id };
  }
  return getEnemy(id) ? { kind: "enemy", id } : null;
}

// Every character, and the rows of the fight (the one running, or the one
// `encounterId` names once it has ended).
function partiesOf(campaignId: string, encounterId?: string): Party[] {
  const fight = encounterId ?? getActiveEncounter(campaignId)?.id ?? null;
  return [
    ...listSheets(campaignId).map((sheet) => ({ kind: "sheet" as const, id: sheet.id })),
    ...(fight ? listEnemies(fight).map((row) => ({ kind: "enemy" as const, id: row.id })) : []),
  ];
}

// Everyone inside a creature, read fresh: characters, and the fight's rows.
export function swallowedBy(campaignId: string, enemyId: string, encounterId?: string): Inside[] {
  return partiesOf(campaignId, encounterId).map(read).filter((found): found is Inside => Boolean(found && swallowerOf(found) === enemyId));
}

function grappledBy(holder: Holder | Inside, enemyId: string): boolean {
  const name = held(holder, "grappled");
  const entry = name ? metaOf(holder)[name] : undefined;
  return Boolean(entry && (entry.source === enemyId || (entry.others ?? []).some((other) => other.source === enemyId)));
}

// Before a Swallow action is rolled: what keeps it from swallowing at all.
export function swallowRefusal(campaignId: string, enemy: EncounterEnemy, target: Party, rule: SwallowRule): string | null {
  const live = read(target);
  if (!live) {
    return null;
  }
  if (rule.grappledOnly && !grappledBy(live, enemy.id)) {
    return `${live.name} is not grappled by ${enemy.displayName}; its ${rule.entry} takes a creature it is grappling.`;
  }
  if (rule.onlyOne && swallowedBy(campaignId, enemy.id).some((inside) => inside.id !== target.id)) {
    return `${enemy.displayName} already has a creature swallowed, and can have only one at a time.`;
  }
  return null;
}

function without(conditions: string[], meta: ConditionMetaMap, names: string[], sourceId: string) {
  let next = { conditions, meta };
  for (const name of names) {
    const out = removeConditionInstances(next.conditions, next.meta, name, (entry) => entry.source === sourceId);
    next = { conditions: out.conditions, meta: out.meta };
  }
  return next;
}

// What swallowing lays, all of it ended when the creature comes out.
const INSIDE = [SWALLOWED, "blinded", "restrained"];

// What a write records in a character's trail, under the kinds the event log
// already reads for a condition (event-log-logic.ts describeKnownEntry): one
// laid, one ended, or the turn's count of damage from inside starting again
// (a quiet tick, folded with the turn's others).
type Change = { kind: "set_condition" | "clear_condition" | "condition_clock"; delta: Record<string, unknown>; reason: string };

// One door for both kinds, each to a writer the revert reads.
function write(campaign: Campaign, party: Party, next: { conditions: string[]; meta: ConditionMetaMap }, change: Change) {
  if (party.kind === "sheet") {
    patchSheetAudited(campaign.id, party.id, { conditions: next.conditions, conditionMeta: next.meta }, { kind: change.kind, delta: change.delta, reason: change.reason });
    return;
  }
  patchEnemyConditions(party.id, next.conditions, next.meta);
  publishPersisted(campaign.id, "encounter_updated", { encounter: activePublicEncounter(campaign.id) });
}

// A creature's row takes a condition held by `source`.
function laid(conditions: string[], meta: ConditionMetaMap, names: string[], source: string) {
  const next = { conditions: [...conditions], meta: { ...meta } };
  for (const name of names) {
    if (!next.conditions.some((entry) => entry.toLowerCase() === name)) {
      next.conditions.push(name);
      next.meta[name] = { source };
    }
  }
  return next;
}

// A hit (or a failed save) that swallows: blinded, restrained and swallowed,
// each held by the creature, and the grapple ends. Returns the result's
// sentence, or why it did not swallow.
export function swallowCreature(campaign: Campaign, turnId: string, enemy: EncounterEnemy, target: Party, rule: SwallowRule | null): { swallowed: string } | { notSwallowed: string } {
  const live = read(target);
  if (!live) {
    return { notSwallowed: "That creature is gone." };
  }
  // A second swing of the same turn finds them inside already.
  if (swallowerOf(live)) {
    return { notSwallowed: `${live.name} is already swallowed.` };
  }
  const refused = rule ? swallowRefusal(campaign.id, enemy, target, rule) : null;
  if (refused) {
    return { notSwallowed: `${refused} ${live.name} is not swallowed.` };
  }
  if (target.kind === "sheet") {
    for (const condition of ["blinded", "restrained", SWALLOWED]) {
      const sheet = getSheetById(target.id);
      if (sheet) {
        handleSetCondition(campaign, turnId, sheet, { condition, sourceEnemyId: enemy.id }, `swallowed by ${enemy.displayName}`, { spellEffect: { source: enemy.id } });
      }
    }
  } else {
    write(campaign, target, laid(live.conditions, live.meta, ["blinded", "restrained", SWALLOWED], enemy.id), {
      kind: "set_condition",
      delta: { condition: SWALLOWED },
      reason: `swallowed by ${enemy.displayName}`,
    });
  }
  const now = read(target) ?? live;
  // Inside, it is out of reach of everyone outside, and a grapple ends when
  // its creature leaves the grappler's reach (SRD 5.1, Grappled): every
  // grapple on it ends, not only the swallower's, and every grapple it held
  // on another. A grapple held from outside used to survive, and its escape
  // was a contest with a creature nothing inside can reach. With none there
  // is nothing to write, and no "no longer grappled" line for one never
  // grappled.
  const ungrappled = removeConditionInstances(now.conditions, now.meta, "grappled", () => true);
  if (ungrappled.removed) {
    write(campaign, target, ungrappled, { kind: "clear_condition", delta: { condition: "grappled" }, reason: `the grapple ends as ${enemy.displayName} swallows ${now.name}` });
  }
  for (const other of partiesOf(campaign.id)) {
    const held = other.id === target.id ? null : read(other);
    const freed = held ? removeConditionInstances(held.conditions, held.meta, "grappled", (entry) => entry.source === target.id) : null;
    if (held && freed?.removed) {
      write(campaign, held, freed, { kind: "clear_condition", delta: { condition: "grappled" }, reason: `${now.name} lets go, swallowed by ${enemy.displayName}` });
    }
  }
  const acid = rule?.acid ? `, and takes ${rule.acid.dice} ${rule.acid.type} damage at the start of each of its turns` : "";
  const out = rule?.regurgitate
    ? ` ${rule.regurgitate.damage} damage dealt it from inside in one turn makes it save (DC ${rule.regurgitate.dc} Constitution) at that turn's end or regurgitate them.`
    : "";
  return { swallowed: `${now.name} is swallowed: blinded and restrained inside ${enemy.displayName}, with total cover against everything outside it${acid}.${out}` };
}

// The acid at the start of each of the swallower's turns. A creature's row
// takes it through `hurtRow`, the engine's own damage to a creature, which
// this module may not import.
export function swallowTurnStart(campaign: Campaign, enemy: EncounterEnemy, hurtRow: (row: EncounterEnemy, amount: number, type: string) => void): string[] {
  const rule = swallowRuleOf(enemy.stats);
  const acid = rule?.acid;
  if (!acid) {
    return [];
  }
  const lines: string[] = [];
  for (const inside of swallowedBy(campaign.id, enemy.id)) {
    const sheet = inside.kind === "sheet" ? getSheetById(inside.id) : null;
    const row = inside.kind === "enemy" ? getEnemy(inside.id) : null;
    if ((sheet && sheet.deathSaves?.dead) || (row && row.status !== "alive")) {
      continue;
    }
    const amount = publicDie(campaign, sheet, acid.dice, `${inside.name}: ${acid.type} inside ${enemy.displayName}`);
    if (sheet) {
      withOpportunityTurn(campaign.id, (turn) => applyPcDamage(campaign, turn.id, getSheetById(sheet.id) ?? sheet, { amount, type: acid.type, reason: `swallowed by ${enemy.displayName}` }));
    } else if (row) {
      hurtRow(row, amount, acid.type);
    }
    lines.push(`${inside.name}, swallowed, takes ${amount} ${acid.type} damage as ${enemy.displayName}'s turn starts (before resistances).`);
  }
  return lines;
}

// The creature whose turn is running: the one at the pointer, unless the
// pointer's turn is held for the enemies before it (held-turn.ts). Then it
// is the one of those enemies that acted last (its turn runs until another
// acts or the turn is handed on), or, before any of them has, the first of
// them in the order, whose turn began as the pointer passed it. The same
// reading the legendary actions make of a creature's own turn
// (legendary-logic.ts legendaryOpening).
function turnRunning(encounter: Encounter): string | null {
  const entry = encounter.order[encounter.turnIndex];
  const pointer = entry ? orderEntryId(entry) : null;
  const { turnStart, due, handoff, acted } = encounter.legendary;
  if (!pointer || turnStart !== pointer) {
    return pointer;
  }
  const begun = new Set([...(due ?? []), ...(handoff?.enemyIds ?? [])]);
  const actedNow = acted?.round === encounter.round ? acted.ids : [];
  const last = [...actedNow].reverse().find((id) => begun.has(id));
  if (last) {
    return last;
  }
  // Walking back from the pointer, the last of them met is the first to act.
  let first: string | null = null;
  for (let step = 1; step < encounter.order.length; step += 1) {
    const id = orderEntryId(encounter.order[(encounter.turnIndex - step + encounter.order.length) % encounter.order.length]);
    if (begun.has(id)) {
      first = id;
    }
  }
  return first ?? pointer;
}

// Damage the swallower takes while the creature acting is inside it, from
// whatever the creature did (acting-party.ts): counted toward the
// regurgitation save of the turn it lands in. A readied attack released as
// the swallower acts is dealt on the swallower's turn, not on the turn of the
// character the pointer rests on after it; a mark that burns as the
// swallower's turn ends, on the swallower's (turnInHand).
export function noteBlowFromInside(campaign: Campaign, encounterId: string, enemyId: string, amount: number) {
  const actor = currentActor();
  if (!actor || amount <= 0) {
    return;
  }
  const party: Party | null =
    actor.kind === "sheet"
      ? (() => {
          const sheet = getSheetById(actor.ref) ?? listSheets(campaign.id).find((entry) => textKey(entry.name) === textKey(actor.ref));
          return sheet ? { kind: "sheet" as const, id: sheet.id } : null;
        })()
      : (() => {
          const row = getEnemy(actor.ref) ?? listEnemies(encounterId).find((entry) => textKey(entry.displayName) === textKey(actor.ref));
          return row ? { kind: "enemy" as const, id: row.id } : null;
        })();
  const inside = party ? read(party) : null;
  const name = inside ? held(inside, SWALLOWED) : undefined;
  if (!inside || !name || swallowerOf(inside) !== enemyId) {
    return;
  }
  const entry: ConditionMeta = inside.meta[name] ?? {};
  const encounter = getActiveEncounter(campaign.id);
  const turn = turnInHand() ?? (encounter ? turnRunning(encounter) : null) ?? enemyId;
  const turns = { ...(entry.swallow?.turns ?? {}) };
  const hurt = (turns[turn] ?? 0) + Math.floor(amount);
  turns[turn] = hurt;
  const swallower = swallowerName(enemyId);
  write(
    campaign,
    inside,
    { conditions: inside.conditions, meta: { ...inside.meta, [name]: { ...entry, swallow: { ...(entry.swallow ?? {}), turns } } } },
    {
      kind: "set_condition",
      delta: { condition: SWALLOWED, hurtInside: hurt, swallower },
      reason: `${hurt} damage dealt ${swallower} from inside ${turn === enemyId ? "on its own turn" : "this turn"}`,
    },
  );
}

// An open square beside a creature's footprint, nearest the mover.
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

// Out of the creature `sourceId` names, and prone. Two lines in the trail,
// as the table reads them: out, then prone.
function freeProne(campaign: Campaign, live: Inside, sourceId: string, names: string[], reason: string) {
  const ended = names.filter((name) => held(live, name));
  const freed = without(live.conditions, live.meta, names, sourceId);
  write(campaign, live, freed, { kind: "clear_condition", delta: { condition: ended.join(", ") || SWALLOWED }, reason });
  write(campaign, live, laid(freed.conditions, freed.meta, ["prone"], sourceId), { kind: "set_condition", delta: { condition: "prone" }, reason });
}

// Out of the creature, prone in a space beside it (within 10 feet: SRD 5.1).
// Returns where they landed, or null off the board.
function outProne(campaign: Campaign, encounterId: string, party: Party, swallower: EncounterEnemy, names: string[], reason: string, spentTiles = 0): string | null {
  const live = read(party);
  if (!live) {
    return null;
  }
  freeProne(campaign, live, swallower.id, names, reason);
  const map = getBattleMapForEncounter(encounterId);
  const token = map ? getTokenByRef(map.id, party.id) : null;
  const body = map ? getTokenByRef(map.id, swallower.id) : null;
  const square = map && token && body ? besideSquare(encounterId, map, token, body, footprintForSize(swallower.stats.size)) : null;
  if (map && token) {
    moveToken(token.id, square?.x ?? token.x, square?.y ?? token.y, token.movedThisRound + spentTiles);
    publishEphemeral(campaign.id, "battle_map_updated", {});
  }
  return square ? `(${square.x},${square.y})` : null;
}

// After the turns a pointer move starts have had their start-of-turn effects:
// what a creature inside dealt its swallower as the swallower's own turn
// began (a Spirit Guardians ring carried in with it) is that turn's. The
// counts were read and started again at nothing just before (swallowTurnEnd),
// so whatever was counted since was dealt as these turns began, while the
// fight still named the turn the pointer left. The swallower's turn is played
// in the GM turn after this move and ends with the next one, beside the turn
// the pointer rests on; summed with that turn, a 24 point ring at the worm's
// turn and a 13 point mace on the cleric's made 37 "on a single turn".
export function swallowTurnsStarted(campaign: Campaign, encounter: Encounter, starting: readonly string[]) {
  for (const party of partiesOf(campaign.id, encounter.id)) {
    const inside = read(party);
    const name = inside ? held(inside, SWALLOWED) : undefined;
    const entry = inside && name ? inside.meta[name] : undefined;
    const counted = Object.entries(entry?.swallow?.turns ?? {});
    if (!inside || !name || !entry?.source || !starting.includes(entry.source) || counted.every(([turn]) => turn === entry.source)) {
      continue;
    }
    const own = counted.reduce((sum, [, amount]) => sum + amount, 0);
    write(
      campaign,
      inside,
      { conditions: inside.conditions, meta: { ...inside.meta, [name]: { ...entry, swallow: { ...entry.swallow, turns: { [entry.source]: own } } } } },
      { kind: "condition_clock", delta: {}, reason: "the damage dealt it from inside as its turn began counts for its own turn" },
    );
  }
}

// The end of a turn: a swallower dealt enough from inside it on a single
// turn saves or regurgitates everyone it holds, and the counts start again.
// Its own turn, the turn the pointer rested on and any other creature's
// played between end at the same move, and each is held to the block's
// number alone.
export function swallowTurnEnd(campaign: Campaign, encounter: Encounter): string[] {
  const lines: string[] = [];
  // By swallower, and by the turn it was dealt in, the most one creature
  // inside dealt it ("from a creature inside it": SRD 5.1).
  const hurt = new Map<string, Map<string, number>>();
  for (const party of partiesOf(campaign.id, encounter.id)) {
    const inside = read(party);
    const name = inside ? held(inside, SWALLOWED) : undefined;
    const entry = inside && name ? inside.meta[name] : undefined;
    const counted = Object.entries(entry?.swallow?.turns ?? {}).filter(([, amount]) => amount > 0);
    if (!inside || !name || !entry?.source || !counted.length) {
      continue;
    }
    const most = hurt.get(entry.source) ?? new Map<string, number>();
    for (const [turn, amount] of counted) {
      most.set(turn, Math.max(most.get(turn) ?? 0, amount));
    }
    hurt.set(entry.source, most);
    // The counts are the turns': they start again at nothing.
    write(
      campaign,
      inside,
      { conditions: inside.conditions, meta: { ...inside.meta, [name]: { ...entry, swallow: { ...entry.swallow, turns: {} } } } },
      { kind: "condition_clock", delta: {}, reason: "the turn's count of damage from inside starts again" },
    );
  }
  for (const [enemyId, byTurn] of hurt) {
    const swallower = getEnemy(enemyId);
    const regurgitate = swallower ? swallowRuleOf(swallower.stats)?.regurgitate : null;
    if (!swallower || swallower.status !== "alive" || !regurgitate) {
      continue;
    }
    // Its own turn first: it came before the turn the pointer rested on.
    const turns = [...byTurn.entries()].sort(([a], [b]) => Number(b === enemyId) - Number(a === enemyId));
    for (const [turn, amount] of turns) {
      if (amount < regurgitate.damage) {
        continue;
      }
      const when = turn === enemyId ? "on its own turn" : "this turn";
      const roll = rollEnemySave(campaign.id, swallower, "con", regurgitate.dc, { record: { detail: `${swallower.displayName}: holding down what it swallowed (CON save)` } });
      if (roll.success) {
        lines.push(`${swallower.displayName} took ${amount} damage from inside ${when} and keeps it down (CON save ${roll.total} vs DC ${regurgitate.dc}).`);
        continue;
      }
      const out = swallowedBy(campaign.id, enemyId).map((inside) => {
        const at = outProne(campaign, encounter.id, inside, swallower, INSIDE, `regurgitated by ${swallower.displayName}`);
        return `${inside.name}${at ? ` at ${at}` : ""}`;
      });
      lines.push(`${swallower.displayName} took ${amount} damage from inside ${when} and fails its CON save (${roll.total ?? "failed"} vs DC ${regurgitate.dc}): it regurgitates ${out.join(", ")}, prone beside it.`);
      break;
    }
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
  for (const party of inside) {
    const freed = without(party.conditions, party.meta, ["restrained"], enemy.id);
    const name = held(party, SWALLOWED) ?? SWALLOWED;
    const entry = freed.meta[name] ?? {};
    write(
      campaign,
      party,
      { conditions: freed.conditions, meta: { ...freed.meta, [name]: { ...entry, swallow: { ...(entry.swallow ?? {}), escapeFeet: feet } } } },
      { kind: "clear_condition", delta: { condition: "restrained" }, reason: `${enemy.displayName} dies around them` },
    );
  }
  return `${inside.map((party) => party.name).join(", ")} ${inside.length === 1 ? "is" : "are"} no longer restrained by ${enemy.displayName}: ${feet} feet of movement climbs out of the corpse, exiting prone.`;
}

// A swallower gone from the fight alive (it fled, or a spell sent it off
// this plane) leaves what it swallowed behind: out of it, prone in a space
// beside where it stood. Called before its token leaves the board. Without
// this they stayed blinded, restrained and swallowed inside a creature no
// longer in the fight, reached by nothing and reaching nothing.
export function leftBehind(campaign: Campaign, encounterId: string, enemy: EncounterEnemy, going: string): string | null {
  const inside = swallowedBy(campaign.id, enemy.id, encounterId);
  if (!inside.length) {
    return null;
  }
  const out = inside.map((party) => {
    const at = outProne(campaign, encounterId, party, enemy, INSIDE, `left behind as ${enemy.displayName} ${going}`);
    return `${party.name}${at ? ` at ${at}` : ""}`;
  });
  return `${out.join(", ")} ${inside.length === 1 ? "is" : "are"} left behind as ${enemy.displayName} ${going}: out of it, prone where it was.`;
}

// The conditions that take a living creature off this plane (Banishment's
// demiplane, Maze's labyrinth): what it swallowed stays on this one.
const OFF_PLANE = ["banished", "mazed"];

// After conditions land on a creature: one now off this plane leaves its
// swallowed behind (leftBehind). Null when it is not, or held nobody.
export function swallowerAway(campaign: Campaign, enemyId: string): string | null {
  const enemy = getEnemy(enemyId);
  const away = enemy?.status === "alive" && enemy.conditions.some((entry) => isConditionNamed(entry, ...OFF_PLANE));
  return enemy && away ? leftBehind(campaign, enemy.encounterId, enemy, "vanishes from this plane") : null;
}

// The fight's end, however it came (its last foe down, a flight, a truce,
// end_encounter, the lead's Force-end): whoever is still inside comes out,
// prone, with what swallowing laid gone. The climb out of a corpse is a walk
// on the fight's board, and once the fight is over there is no board to
// walk: a hero swallowed by the fight's last foe stayed swallowed and
// blinded, and the next fight neither reached her nor let her reach anyone.
export function swallowFightEnd(campaign: Campaign, encounterId: string): string | null {
  const out: string[] = [];
  for (const party of partiesOf(campaign.id, encounterId)) {
    const live = read(party);
    const source = live ? swallowerOf(live) : null;
    if (!live || !source) {
      continue;
    }
    const swallower = getEnemy(source);
    const reason = `out of ${swallower?.displayName ?? "what swallowed them"} as the fight ends`;
    if (swallower) {
      outProne(campaign, encounterId, live, swallower, INSIDE, reason);
    } else {
      freeProne(campaign, live, source, INSIDE, reason);
    }
    out.push(`${live.name} out of ${swallower ? `${swallower.displayName}${swallower.status === "dead" ? "'s corpse" : ""}` : "what swallowed them"}`);
  }
  return out.length ? `As the fight ends: ${out.join(", ")}, prone.` : null;
}

// The way out of a living swallower, for the refusal that says why there is
// no walking.
function wayOut(swallower: EncounterEnemy): string {
  const rule = swallowRuleOf(swallower.stats);
  const corpse = `once it dies, ${rule?.escapeFeet ?? 5} feet of movement climbs out of its corpse`;
  return rule?.regurgitate
    ? `${rule.regurgitate.damage} damage dealt it from inside in one turn makes it save or regurgitate them, and ${corpse}`
    : `${corpse[0].toUpperCase()}${corpse.slice(1)}`;
}

// A swallowed creature's walk: none while the swallower lives, and once it
// is dead the walk is the climb out (its feet of movement, exiting prone).
// Null for one nothing holds inside.
function walkOut(campaign: Campaign, encounter: Encounter, party: Party, token: BattleToken, tilesLeft: () => number): ToolResult | null {
  const live = read(party);
  const id = live ? swallowerOf(live) : null;
  const swallower = id ? getEnemy(id) : null;
  if (!live || !swallower) {
    return null;
  }
  if (swallower.status === "alive") {
    return { error: `${live.name} is swallowed inside ${swallower.displayName}, restrained there: no walking. ${wayOut(swallower)}.`, refused: "rules" };
  }
  const name = held(live, SWALLOWED) ?? SWALLOWED;
  const feet = live.meta[name]?.swallow?.escapeFeet ?? swallowRuleOf(swallower.stats)?.escapeFeet ?? 5;
  const left = tilesLeft();
  const tiles = Math.ceil(feet / 5);
  if (left < tiles) {
    return { error: `${live.name} needs ${feet} feet of movement to climb out of ${swallower.displayName}'s corpse and has ${left * 5} left this turn.`, refused: "rules" };
  }
  const at = outProne(campaign, encounter.id, party, swallower, [SWALLOWED, "blinded"], `climbs out of ${swallower.displayName}'s corpse`, tiles);
  return {
    ok: true,
    name: live.name,
    escaped: `${live.name} climbs out of ${swallower.displayName}'s corpse with ${feet} feet of movement and lands prone${at ? ` at ${at}` : ""}.`,
  };
}

export function swallowWalk(campaign: Campaign, encounter: Encounter, map: BattleMap, sheet: CharacterSheet, token: BattleToken): ToolResult | null {
  return walkOut(campaign, encounter, { kind: "sheet", id: sheet.id }, token, () => pcMoveBudget(campaign.id, encounter, map, sheet, token).fullTiles);
}

// A creature's row (one fighting on the party's side), with the squares its
// own move has left.
export function swallowRowWalk(campaign: Campaign, encounter: Encounter, row: EncounterEnemy, token: BattleToken, tilesLeft: number): ToolResult | null {
  return walkOut(campaign, encounter, { kind: "enemy", id: row.id }, token, () => tilesLeft);
}
