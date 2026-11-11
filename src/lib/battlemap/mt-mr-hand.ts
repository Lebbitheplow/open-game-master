// What shuts the card of a monk's or a rogue's subclass spend (wave 2, part
// mr): the Hand's reading of the preconditions the engine asks in
// src/lib/dm/mt-mr-needs.ts and src/lib/dm/mt-mr-spends.ts, from the turn's
// marks and the board's verdict on the holder's own square. A precondition
// added there is added here, or the Hand deals a card the engine refuses
// (scripts/test-enforce-sweep-hand-monk.mjs holds the two together).
//
// Pure.

import type { Gate, HandBoardFacts, HandTurn } from "@/lib/battlemap/hand-core";
import { SNEAK_HIT } from "@/lib/dm/action-budget";
import { BLADE_AT, UNARMED_IN_ACTION, holdsRow } from "@/lib/dm/mt-mr-turn";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { AuthoredSpend } from "@/lib/srd/authored-effects-types";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { kenseiHeld } from "@/lib/srd/mt-mr-kensei";

const shut = (reason: string): Gate => ({ reason, spent: false });

// The board's verdicts as the Hand may read them on this host: the light on
// the square (`bright`) is read only where the host says it sends it
// (src/lib/capabilities.ts handSquareLight). A host that does not offer the
// flag is read as before the field existed, whatever its payload holds, so
// the cards of dim light and darkness are dealt there as they always were.
export function boardFactsForHost(board: HandBoardFacts | undefined, offersSquareLight: boolean): HandBoardFacts | undefined {
  if (!board || offersSquareLight || board.bright === undefined) {
    return board;
  }
  const rest: HandBoardFacts = { ...board };
  delete rest.bright;
  return rest;
}

// The types a breath's card offers: Breath of the Dragon's, and each again
// "augmented" for a monk with Ascendant Aspect who has the 1 ki it takes on
// top of the breath's own cost (src/lib/dm/mt-mr-dragon.ts breathAugment,
// which reads the same counters). Any other counter's types come back as
// they went in.
export function breathChoices(sheet: CharacterSheet, counterId: string, types: string[]): string[] {
  if (counterId !== "sub_breath_of_the_dragon" || !holdsRow(sheet, "monk::Ascendant Aspect")) {
    return types;
  }
  const left = (id: string) => Math.max(0, (sheet.resources?.[id]?.max ?? 0) - (sheet.resources?.[id]?.used ?? 0));
  // With no use of the breath left it is bought with 2 ki first.
  const needs = left(counterId) > 0 ? 1 : 3;
  return left("ki") >= needs ? [...types, ...types.map((type) => `augmented ${type}`)] : types;
}

export function mrCardGate(sheet: CharacterSheet, turn: HandTurn, spend: AuthoredSpend, board: HandBoardFacts | undefined): Gate {
  const marks = turn.myTurn ? (turn.marks ?? []) : [];
  if (spend.needs === "shadows" && board?.bright) {
    return shut(`${spend.name} works only in dim light or darkness, and ${sheet.name} stands in bright light.`);
  }
  if (spend.needs === "unarmed_in_action") {
    if (!kenseiHeld(sheet, "melee").length) {
      return shut(`${spend.name} needs a kensei melee weapon in hand.`);
    }
    if (!marks.includes(UNARMED_IN_ACTION)) {
      return shut(`${spend.name} follows an unarmed strike made as part of the Attack action.`);
    }
  }
  if (spend.needs === "attack_action" && !(turn.myTurn && turn.attacksMade > 0 && !turn.castThisAction)) {
    return shut(`${spend.name} follows the Attack action: attack first.`);
  }
  const does = spend.does;
  if (does.kind !== "mr") {
    return null;
  }
  if (does.id === "flurry_healing" && !(turn.myTurn && (turn.flurryStrikes ?? 0) > 0)) {
    return shut(`${spend.name} takes the place of a Flurry of Blows strike: buy the flurry after the Attack action first.`);
  }
  if (does.id === "rend_mind" && !(marks.some((mark) => mark.startsWith(SNEAK_HIT)) && marks.some((mark) => mark.startsWith(BLADE_AT)))) {
    return shut(`${spend.name} answers a Sneak Attack made with a psychic blade: land one this turn first.`);
  }
  if (does.id === "question_spirit" && !sheet.conditions.some((entry) => isConditionNamed(entry, "soul trinket"))) {
    return shut(`${spend.name} destroys a soul trinket, and ${sheet.name} carries none.`);
  }
  if (does.id === "deft_strike" && !kenseiHeld(sheet).length) {
    return shut(`${spend.name} rides a hit with a kensei weapon, and ${sheet.name} holds none.`);
  }
  return null;
}
