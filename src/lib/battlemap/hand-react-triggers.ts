// The cards for the reactions and triggered uses whose trigger is not a hit
// (src/lib/srd/trigger-table.ts holds the table): dealt when one of
// their triggers is open in the encounter's view (PublicEncounter.lastHits and
// lastSaves, the same records the engine's door reads), and never as a card
// on the holder's own turn with nothing to answer. Misty Escape after damage,
// Tokens of the Departed after a death, Skirmisher and Perfected Armor after
// an enemy's turn ends beside them, Hurl Through Hell after a hit.
//
// Pure; hand-react.ts reactionCards deals these with the hit reactions.
import type { PublicLastHit, PublicSave } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { costGate, gated, standingGate, type HandCard, type HandCost, type HandTarget, type HandTurn } from "@/lib/battlemap/hand-core";
import { eventOfRecord, openFor, quarryOf, TRIGGERED_COUNTERS, triggerKey, triggerSpecFor, type TriggerEvent, type TriggerSpec } from "@/lib/srd/trigger-table";
import { resourceDef } from "@/lib/srd/class-resources";
import { gateHolds, heldAuthored } from "@/lib/srd/authored-effects";
import { findNamed, textKey } from "@/lib/language/text-logic";
import type { Gate } from "@/lib/battlemap/hand-core";

// A hit as the trigger table reads it. The view keeps no advantage, so a
// roll's edge (Restore Balance) is the engine's to see; the card waits for it.
function eventOfHit(hit: PublicLastHit): TriggerEvent {
  return {
    id: hit.id ?? `${hit.characterId}:${hit.attackerId ?? ""}`,
    kind: hit.hit ? "hit" : "miss",
    characterId: hit.characterId,
    creatureId: hit.attackerId,
    creatureName: hit.attacker,
    damaged: hit.hit && hit.damage > 0,
    melee: !hit.ranged,
    answered: hit.answeredBy ?? hit.answered,
  };
}

const costOf = (action: string | undefined): HandCost => (action === "reaction" ? "reaction" : action === "bonus" ? "bonus" : action === "none" ? "free" : "action");

function card(sheet: CharacterSheet, turn: HandTurn, input: { id: string; name: string; cost: HandCost; spec: TriggerSpec; event: TriggerEvent; intent: HandCard["intent"]; rules: string; resource: string; onAlly?: boolean }): HandCard {
  const { event, spec } = input;
  const target: HandTarget = input.onAlly ? "ally" : spec.aimsAt && event.creatureId ? "enemy" : "none";
  const base: HandCard = {
    id: `reaction:${textKey(input.name).replace(/\s+/g, "-")}:${event.id}`,
    type: "ward",
    name: input.name,
    cost: input.cost,
    range: target === "none" ? "Self" : "",
    dice: "",
    roll: "no roll",
    rules: input.rules,
    resource: input.resource,
    condition: "",
    icon: { kind: "feature", key: input.name, family: null },
    target,
    toHit: null,
    damage: null,
    damageType: "",
    heals: false,
    save: null,
    melee: false,
    disabled: null,
    spent: false,
    compose: false,
    intent: input.intent,
    prompt: `${event.creatureName}: ${spec.what}`,
    ...(event.creatureId ? { answers: { characterId: event.characterId || sheet.id, attackerId: event.creatureId, attacker: event.creatureName } } : {}),
  };
  const kind = input.cost === "reaction" ? "reaction" : input.cost === "bonus" ? "bonus" : input.cost === "free" ? "free" : "action";
  return gated(base, standingGate(sheet, turn, kind), costGate(input.cost, turn, sheet, input.name));
}

// Every trigger card the moment offers this character, one per open trigger.
export function triggerCards(
  sheet: CharacterSheet,
  turn: HandTurn,
  hits: PublicLastHit[],
  saves: PublicSave[],
  near: (id: string, feet: number) => boolean,
  // Who on the board the character cannot see (hand-react.ts reactionCards):
  // a reaction whose text needs its creature seen (authored `sees: "attacker"`,
  // Halo of Spores) is not dealt for them, as authored-reactions.ts refuses it.
  unseen?: { has(id: string): boolean },
): HandCard[] {
  const events = [...hits.map(eventOfHit), ...saves.map(eventOfRecord)];
  if (!events.length) return [];
  const context = (label: string) => ({ holderId: sheet.id, near, quarry: (mark: string) => quarryOf(sheet, mark), label });
  const cards: HandCard[] = [];
  for (const id of TRIGGERED_COUNTERS) {
    const state = sheet.resources[id];
    const def = resourceDef(id);
    const spec = triggerSpecFor(def?.displayName ?? id, { counterId: id });
    if (!state || !def || !spec || state.max <= state.used) continue;
    const cost = costOf(def.action);
    // A use that lands on another creature (Cosmic Omen's die) answers a roll
    // that creature made; the engine refuses the holder's own.
    const onAlly = def.effect.kind === "inspire" || (def.effect.kind === "buff" && def.effect.target === "ally");
    for (const event of openFor(spec, events, context(triggerKey(id, sheet.id))).slice(-2)) {
      if (onAlly && (!event.characterId || event.characterId === sheet.id)) continue;
      cards.push(card(sheet, turn, {
        id,
        name: def.displayName,
        cost,
        spec,
        event,
        intent: cost === "reaction" ? { card: "reaction", feature: def.displayName } : { card: "feature", resourceId: id },
        rules: def.guidance.split(". ")[0].replace(/\.?$/, "."),
        resource: def.atWill ? "" : `Uses ${state.max - state.used}/${state.max}`,
        onAlly,
      }));
    }
  }
  for (const held of heldAuthored(sheet)) {
    for (const reaction of held.entry.reactions ?? []) {
      if ((reaction.usedBy ?? "holder") !== "holder" || !gateHolds(reaction.gate, sheet, held)) continue;
      // A bond's reaction for the pet's own damage (Reflexive Resistance for the
      // drake): its card names the pet, which the engine answers.
      const does = reaction.does;
      if (does.kind === "resist_instance" && does.bond) {
        const pool = reaction.pool;
        const left = !pool || !("id" in pool) || (sheet.resources[pool.id]?.max ?? 0) - (sheet.resources[pool.id]?.used ?? 0) >= (pool.amount ?? 1);
        const petSpec: TriggerSpec = { on: [{ kind: "pet_damage" }], what: `damage your ${does.bond} has just taken` };
        for (const event of left ? openFor(petSpec, events, context(triggerKey(textKey(reaction.name), sheet.id))).slice(-1) : []) {
          cards.push(card(sheet, turn, { id: reaction.name, name: reaction.name, cost: "reaction", spec: petSpec, event: { ...event, creatureId: null, creatureName: event.petName ?? does.bond }, intent: { card: "reaction", feature: reaction.name, variant: event.petName ?? does.bond }, rules: `Resistance to the damage your ${does.bond} just took: half of it comes back.`, resource: "" }));
        }
      }
      const spec = triggerSpecFor(reaction.name, { gateCondition: reaction.gate?.condition });
      const pool = reaction.pool;
      if (!spec || (pool && "id" in pool && (sheet.resources[pool.id]?.max ?? 0) - (sheet.resources[pool.id]?.used ?? 0) < (pool.amount ?? 1))) continue;
      for (const event of openFor(spec, events, context(triggerKey(textKey(reaction.name), sheet.id))).slice(-2)) {
        if (reaction.sees === "attacker" && event.creatureId && unseen?.has(event.creatureId)) continue;
        cards.push(card(sheet, turn, { id: reaction.name, name: reaction.name, cost: "reaction", spec, event, intent: { card: "reaction", feature: reaction.name }, rules: `${reaction.name} answers ${spec.what}.`, resource: "" }));
      }
    }
  }
  return cards;
}

// Whether an authored reaction is dealt here rather than by the hit cards.
export function dealtByTrigger(name: string, gateCondition?: string): boolean {
  return triggerSpecFor(name, { gateCondition }) !== null;
}

// The moments a card comes up for (hand-react.ts). Counterspell names the spell it
// answers, which no card can yet, so it is asked for in words as it always was.
const COMES_UP_WHEN = [
  { spell: "Shield", when: "an attack hits you" },
  { spell: "Hellish Rebuke", when: "a creature damages you" },
  { spell: "Feather Fall", when: "you fall" },
];

// A reaction spell's card in the fan, from a ring or the caster's own slots
// (hand-spells.ts spellCard): shut, since the reaction strip deals it when its
// moment comes (hand-react.ts), and open there it was refused in every state.
export function waitsForTrigger(spell: string, fromRing = true): Gate {
  const moment = findNamed(COMES_UP_WHEN, spell, (row) => [row.spell]);
  return {
    reason: moment
      ? `${spell} is cast as a reaction: its card comes up when ${moment.when}.`
      : `${spell} is cast as a reaction: say so in your own words when its trigger comes${fromRing ? ", and it is cast from the ring" : ""}.`,
    spent: false,
  };
}
