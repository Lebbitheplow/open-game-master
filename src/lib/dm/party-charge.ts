// The party's own Charge, Pounce and Trampling Charge (charge-logic.ts reads
// the trait from the block's line, as enemy-charge.ts plays it for an enemy):
// a druid in a tiger's form (Wild Shape, Polymorph), a creature a spell made
// (Conjure Animals' elk, Find Steed's warhorse) and a pet (a ranger's
// panther). Before this only an enemy's charge played: a tiger-shaped druid
// that bounded 20 feet and clawed knocked nobody down and had no bite after,
// and a conjured elk's ram after its run lacked its 2d6.
//
// The block is the SRD creature the sheet or pet is, by its name (every
// form, summon and pet is one: beast-forms.ts, summon-forms.ts, pet-build.ts).
// The run is the board's, measured as a character's own (mt-fb-charge.ts
// runToward): the sheet's own walk this turn, and for a pet its owner's (it
// stands with its owner, pet-place.ts). With no board, the call's `charged`.
//
// Once a turn: the first hit of the trait's attack after the run. A Pounce's
// bonus attack (a warhorse's second hooves) opens on the creature it struck
// while that creature lies prone, as the attacker's bonus action.

import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getActiveEncounter, getEnemy, type Encounter } from "@/lib/db/encounters";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { TurnBudget } from "@/lib/dm/action-budget";
import { chargeOnHit, type ChargeTrait } from "@/lib/dm/charge-logic";
import { runToward } from "@/lib/dm/mt-fb-charge";
import { resolveNaturalOnHit, type NaturalHit } from "@/lib/dm/natural-onhit";
import { chargeSpentKey, petPounceKey, pouncedKey, type Traits } from "@/lib/dm/party-charge-logic";
import type { ToolError } from "@/lib/dm/tool-errors";
import { pushStraightAway } from "@/lib/dm/ar-ws-storm-fury";
import { storeBudget } from "@/lib/dm/turn-budget";
import { OPEN_RUN } from "@/lib/srd/mt-fb-run";

// The feet the walker ran straight at the creature this turn.
export function partyRunFeet(encounter: Encounter, walkerId: string, enemyId: string, claimed: boolean): number {
  const map = getBattleMapForEncounter(encounter.id);
  if (!map || !getTokenByRef(map.id, walkerId) || !getTokenByRef(map.id, enemyId)) {
    return claimed ? OPEN_RUN : 0;
  }
  return runToward(encounter, walkerId, enemyId);
}

// The charge this hit would ride, once a turn, or null. Only on the owner's
// own turn: an opportunity attack follows no run of the creature's.
export function partyChargeFor(input: {
  encounter: Encounter;
  budget: TurnBudget | null;
  block: Traits | null;
  attack: string | null;
  who: string;
  walkerId: string;
  enemyId: string;
  claimed: boolean;
}): ChargeTrait | null {
  const { budget, block, attack } = input;
  if (!budget || !block || !attack || budget.oncePerTurn.includes(chargeSpentKey(input.who))) {
    return null;
  }
  return chargeOnHit(block, attack, partyRunFeet(input.encounter, input.walkerId, input.enemyId, input.claimed));
}

function markTurn(campaignId: string, ownerId: string, keys: string[]) {
  const encounter = getActiveEncounter(campaignId);
  const budget = encounter?.turnBudget;
  if (!encounter || !budget || budget.ownerId !== ownerId) {
    return;
  }
  const added = keys.filter((key) => !budget.oncePerTurn.includes(key));
  if (added.length) {
    storeBudget(encounter, { ...budget, oncePerTurn: [...budget.oncePerTurn, ...added] });
  }
}

// What the charge does once its hit has landed: the save its trait forces,
// rolled from the creature's own numbers (natural-onhit.ts), the push a
// failure brings (from `pusherId`'s square), the turn's marks, and the lines
// for the table. `bonusCall` says how the bonus attack is made.
export function partyChargeAfterHit(
  campaign: Campaign,
  turn: DmTurn,
  input: { attacker: NaturalHit["attacker"]; ownerId: string; pusherId: string; who: string; enemyId: string; trait: ChargeTrait; bonusCall: string },
): string[] {
  const { trait, who } = input;
  markTurn(campaign.id, input.ownerId, [chargeSpentKey(who)]);
  const lines = trait.extra ? [`${trait.name}: the run adds ${trait.extra.dice}${trait.extra.type ? ` ${trait.extra.type}` : ""} to the blow.`] : [];
  const save = trait.save && trait.prone
    ? resolveNaturalOnHit(campaign, {
        turn,
        attacker: input.attacker,
        holderId: null,
        attack: `${who}'s ${trait.name}`,
        used: { kind: "action", name: `${who}'s ${trait.name}` },
        enemyId: input.enemyId,
        onHit: { save: trait.save.ability, dc: trait.save.dc, condition: "prone" },
      })
    : null;
  lines.push(...(save?.lines ?? []));
  const enemy = getEnemy(input.enemyId);
  if (save?.saved === false && trait.pushFeet && enemy?.status === "alive") {
    lines.push(pushStraightAway(campaign, enemy.encounterId, { id: input.pusherId, name: who }, { id: enemy.id, displayName: enemy.displayName }, trait.pushFeet));
  }
  if (trait.bonus?.length && enemy?.status === "alive" && enemy.conditions.includes("prone")) {
    markTurn(campaign.id, input.ownerId, [pouncedKey(who, enemy.id)]);
    const names = trait.bonus.map((name) => `"${name}"`).join(" or ");
    lines.push(`${trait.name}: ${enemy.displayName} lies prone, so ${who} may make one ${names} attack at it as its bonus action (${input.bonusCall} ${names}).`);
  }
  return lines;
}

// What a pet's pounce bite costs: its own bonus action, once on its owner's
// turn (the trait gives the creature the bite, so commanding it spends
// nothing more of the owner's). Checked before the roll; commit() writes it.
export function petPounceCost(encounter: Encounter, ownerId: string, pet: string, trait: ChargeTrait): ToolError | { commit: () => string } {
  if (encounter.turnBudget?.ownerId !== ownerId) {
    return { error: `${pet}'s ${trait.name} bite is made on its owner's turn.`, refused: "rules" };
  }
  return {
    commit: () => {
      markTurn(encounter.campaignId, ownerId, [petPounceKey(pet)]);
      return `${pet}'s ${trait.name} attack is its own bonus action; its owner spends nothing more.`;
    },
  };
}
