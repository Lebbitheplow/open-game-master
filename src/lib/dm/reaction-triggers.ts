// The engine's door for a trigger-shaped reaction (src/lib/srd/trigger-table.ts
// holds the table): the events open now, read from the hit record
// (last-hit.ts), the other triggers (last-save.ts) and the running turn's own
// marks (a weapon hit, an Action Surge, Step of the Wind), and the refusal for
// a reaction that has nothing to answer.
//
// Every door that spends a reaction or a triggered use goes through
// triggerRefusal before anything is spent: use_reaction's authored rows
// (authored-reactions.ts), use_resource's counters (reaction-counters.ts
// planCounterReaction) and the authored spends that wait for a trigger
// (authored-spends.ts). The encounter's view projects the same events
// (triggerRecords), so the Hand deals a card exactly when this door would take it.
import { getActiveEncounter, listEnemies, orderEntryId, type Encounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { ACTION_SURGED, RAGE_ENTERED, WEAPON_HIT, WIND_STEP } from "@/lib/dm/action-budget";
import { withinFeet } from "@/lib/dm/authored-saves";
import { attackerFoeId, hitIdOf, openHits, type LastHit } from "@/lib/dm/last-hit";
import { answerSave, CALM_KINDS, calmTrigger, kindOf, openTriggers, type LastSave, type RecordedKind } from "@/lib/dm/last-save";
import { eventOfRecord, nothingToAnswer, openFor, quarryOf, triggerSpecFor, type TriggerEvent, type TriggerSpec } from "@/lib/srd/trigger-table";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

// The running turn's marks as triggers: what its owner hit, whether they
// surged, used Step of the Wind or entered their rage. Read off the budget, so nothing else writes them.
function turnMarks(encounter: Encounter): LastSave[] {
  const budget = encounter.turnBudget;
  if (!budget || budget.round !== encounter.round) return [];
  const owner = getSheetById(budget.ownerId);
  if (!owner) return [];
  const base = { characterId: owner.id, ability: "con" as const, encounterId: encounter.id, turn: "", at: "" };
  const names = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy.displayName]));
  return budget.oncePerTurn.flatMap((mark): LastSave[] => {
    if (mark.startsWith(WEAPON_HIT)) {
      const target = mark.slice(WEAPON_HIT.length);
      return [{ ...base, id: `mark:${mark}`, kind: "weapon_hit", forcer: { id: target, name: names.get(target) ?? "a creature" } }];
    }
    if (mark === ACTION_SURGED) return [{ ...base, id: `mark:${mark}:${owner.id}`, kind: "surge", forcer: { id: owner.id, name: owner.name } }];
    if (mark === WIND_STEP) return [{ ...base, id: `mark:${mark}:${owner.id}`, kind: "wind_step", forcer: { id: owner.id, name: owner.name } }];
    if (mark === RAGE_ENTERED) return [{ ...base, id: `mark:${mark}:${owner.id}`, kind: "rage_entered", forcer: { id: owner.id, name: owner.name } }];
    return [];
  });
}

// Every trigger open now that no hit record holds, with the creature now up
// when a turn's end is open (its turn has just begun), for the engine and the
// encounter's view.
export function triggerRecords(campaignId: string): LastSave[] {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) return [];
  const records = openTriggers(campaignId);
  const ended = records.find((record) => kindOf(record) === "turn_end");
  const current = encounter.order[encounter.turnIndex];
  const started: LastSave[] = [];
  if (ended && current) {
    const id = orderEntryId(current);
    const name = current.kind === "pc" ? (getSheetById(id)?.name ?? "a character") : (listEnemies(encounter.id).find((enemy) => enemy.id === id)?.displayName ?? "a creature");
    started.push({ ...ended, id: `${ended.id}:start`, kind: "turn_start", forcer: { id, name }, enemy: current.kind !== "pc" });
  }
  return [...records, ...started, ...turnMarks(encounter)];
}

function eventOfHit(record: LastHit): TriggerEvent {
  const landed = record.swings.some((swing) => swing.hit);
  const advantage = record.swings.find((swing) => swing.advantage && swing.advantage !== "none")?.advantage ?? "none";
  return {
    id: hitIdOf(record),
    kind: landed ? "hit" : "miss",
    characterId: record.characterId,
    creatureId: attackerFoeId(record),
    creatureName: record.attacker.name,
    damaged: record.swings.some((swing) => swing.hit && swing.raw > 0),
    melee: !record.ranged,
    spell: record.swings.some((swing) => Boolean(swing.flags?.spell)),
    advantage,
    answered: record.answered,
  };
}

// Every event open in the campaign's fight.
export function triggerEvents(campaignId: string): TriggerEvent[] {
  const hits = listSheets(campaignId).flatMap((sheet) => openHits(campaignId, sheet.id).filter((record) => record.source === "attack" || record.source === "missile"));
  return [...hits.map(eventOfHit), ...triggerRecords(campaignId).map((record) => eventOfRecord({ ...record, forcerId: record.forcer.id, forcer: record.forcer.name }))];
}

function unplaced(encounterId: string, a: string, b: string): boolean {
  const map = getBattleMapForEncounter(encounterId);
  return !map || !getTokenByRef(map.id, a) || !getTokenByRef(map.id, b);
}

// The creature under the holder's mark (Slayer's Prey), as a trigger row reads
// it: named on their own condition, or carrying the mark with them as its source.
export function quarryFor(encounterId: string, holder: CharacterSheet, mark: string): string | null {
  return quarryOf(holder, mark) ?? markedBy(encounterId, holder.id, mark);
}

function markedBy(encounterId: string, holderId: string, mark: string): string | null {
  const key = textKey(mark);
  const enemy = listEnemies(encounterId).find((entry) =>
    entry.status === "alive" &&
    entry.conditions.some((name) => (textKey(name) === key || textKey(name).startsWith(`${key} `)) && (entry.conditionMeta as Record<string, { source?: string } | undefined>)[name]?.source === holderId),
  );
  return enemy?.id ?? null;
}

export type TriggerAsk = {
  campaignId: string;
  // Who takes the reaction, and who holds the feature (Inspiring Surge's banneret).
  reactor: CharacterSheet;
  holder?: CharacterSheet;
  name: string;
  counterId?: string;
  gateCondition?: string;
  // The creature the call names.
  targetEnemyId?: string | null;
  label: string;
};

// The spec this reaction answers, or null when it is not trigger-shaped.
export function triggerSpecOf(ask: Pick<TriggerAsk, "name" | "counterId" | "gateCondition">): TriggerSpec | null {
  return triggerSpecFor(ask.name, { counterId: ask.counterId, gateCondition: ask.gateCondition });
}

// The open events this reaction answers, latest last.
// `anywhere`: every reach taken as met, to tell a trigger too far off from none.
export function openTriggersFor(ask: TriggerAsk, spec: TriggerSpec, anywhere = false): TriggerEvent[] {
  const encounter = getActiveEncounter(ask.campaignId);
  if (!encounter) return [];
  const reactor = getSheetById(ask.reactor.id) ?? ask.reactor;
  const named = ask.targetEnemyId?.trim() || null;
  return openFor(spec, triggerEvents(ask.campaignId), {
    holderId: reactor.id,
    featureHolderId: ask.holder?.id,
    // A creature with no token on the board (one that died, a fight with no
    // board) is measured by nobody: the trigger stands and the GM judges it.
    near: (id, feet) => anywhere || unplaced(encounter.id, reactor.id, id) || withinFeet(encounter.id, reactor.id, id, feet),
    // The creature under the holder's mark: named on their own condition, or
    // carrying the mark itself with them as its source (Slayer's Prey).
    quarry: (mark) => quarryOf(reactor, mark) ?? markedBy(encounter.id, reactor.id, mark),
    label: ask.label,
  }, named);
}

// Null when the reaction has something to answer (or is not trigger-shaped);
// otherwise the refusal, said before anything is spent.
export function triggerRefusal(ask: TriggerAsk): ToolError | null {
  const spec = triggerSpecOf(ask);
  if (!spec) return null;
  if (!getActiveEncounter(ask.campaignId)) {
    // A record kept out of a fight, where no turn keeps one (last-save.ts
    // recordCalmTrigger: a healing roll Empowered Healing rolls again). The
    // feature that answers it reads the record itself, with no reach to measure.
    if (spec.on.some((on) => CALM_KINDS.includes(on.kind) && calmTrigger(ask.campaignId, on.kind as RecordedKind))) return null;
    return { error: `${ask.name} answers ${spec.what}, which happens in a fight; there is no active encounter. Nothing was spent.`, refused: "rules" };
  }
  if (openTriggersFor(ask, spec).length) return null;
  // One on record beyond the reach is refused for the distance, which says more.
  const feet = spec.on.map((on) => ("rangeFt" in on ? on.rangeFt : undefined)).find((value) => value !== undefined);
  if (feet !== undefined && openTriggersFor(ask, spec, true).length) {
    return { error: `${ask.name} answers ${spec.what}, and the one on record is beyond ${feet} feet of ${ask.reactor.name}. Nothing was spent.`, refused: "rules" };
  }
  return { error: nothingToAnswer(ask.reactor.name, ask.name, spec, Boolean(ask.targetEnemyId?.trim())), refused: "rules" };
}

// What the reaction answered goes from its holder's cards: each record it
// answered keeps the holder's key (last-save.ts answerSave). A hit is settled
// by the reaction that changes it, so it is not marked here.
export function answerTriggers(ask: TriggerAsk) {
  const spec = triggerSpecOf(ask);
  if (!spec) return;
  const [latest] = openTriggersFor(ask, spec).slice(-1);
  if (latest && !latest.id.startsWith("mark:") && latest.kind !== "hit" && latest.kind !== "miss") {
    answerSave(ask.campaignId, latest.id.replace(/:start$/, ""), ask.label);
  }
}
