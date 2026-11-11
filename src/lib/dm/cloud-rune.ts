// The Cloud Rune (Rune Knight): "When you or a creature you can see within 30
// feet of you is hit by an attack roll, you can use your reaction to invoke
// the rune and choose a different creature within 30 feet of you, other than
// the attacker. The chosen creature becomes the target of the attack, using
// the same roll. This magic can transfer the attack's effects regardless of
// the attack's range."
//
// A reaction that redirects an effect acts before the outcome lands. When a
// foe's attack (enemy-attack.ts) hits the knight or a creature they see within
// 30 feet, the call stops at the hit, before its damage is rolled
// (held-call.ts stopAfterThrow, a watch stop of foresight.ts with the power
// "cloud_rune"): the knight's player picks the creature it turns onto, any
// within 30 feet of them but the attacker and the one hit, or lets it land.
// Their answer is laid on the knight's sheet (layCloudTurn) and the call runs
// again on the same dice to the same hit, where it is read (cloudRuneAtHit):
// the reaction and the rune's use are spent there, the hit is no hit on the
// first creature, and the damage is rolled for the chosen one alone
// (landTurnedBlow). Its AC is not asked: the roll stands.
//
// A seat no stop reaches is never asked: an agent's (it has no card), a
// companion's, a player away from the table or on the bench
// (chronal-shift.ts stopReaches). Nor is a hit with no held call to stop
// (an attack made outside a GM call), one in a call a player's roll has
// already landed in, or one under a Portent number or a Chronal Shift armed
// on its dice (held-call.ts canStopAfterThrow). There the attack lands as
// rolled, and nothing afterwards gives its damage back.

import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import { watchChoiceOf, type DmTurn, type WatchChoice, type WatchStop } from "@/lib/db/dm-turns";
import { getActiveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll } from "@/lib/db/rolls";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import type { EnemyAttack } from "@/lib/bestiary/statblock";
import { unseenBecause, withinFeet } from "@/lib/dm/authored-saves";
import { canReactNow, stopReaches } from "@/lib/dm/chronal-shift";
import { combatantDefeated, combatantsOf, resolveCombatant, type Combatant } from "@/lib/dm/combatant";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { blowByType, scaledParts } from "@/lib/dm/enemy-hit";
import { canStopAfterThrow, stopAfterThrow } from "@/lib/dm/held-call";
import { applyPcDamage, type BlowFlags } from "@/lib/dm/pc-damage";
import { reactionPatch } from "@/lib/dm/reaction-refund";
import { markReactionUsed } from "@/lib/dm/turn-budget";
import { publishWithSeq } from "@/lib/events";
import { rollAgainst } from "@/lib/roll-labels";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const NAME = "Cloud Rune";
// The rune's counter (authored-effects-w2-mt-fb.ts): once a rest, twice from 15th level.
const POOL = "sub_cloud_rune";
const REACH_FT = 30;
// The knight's answers, kept on their sheet until the call runs past the hit.
export const CLOUD_TURN = "cloud rune (answered)";

type CloudTurn = { attackerId: string; struckId: string; swing: number; onto: string | null };

function turnsOf(sheet: CharacterSheet): CloudTurn[] {
  return ((sheet.conditionMeta as ConditionMetaMap)[CLOUD_TURN]?.cloudTurns ?? []) as CloudTurn[];
}

const sameHit = (a: Omit<CloudTurn, "onto">, b: Omit<CloudTurn, "onto">) => a.attackerId === b.attackerId && a.struckId === b.struckId && a.swing === b.swing;

// The knight's answer at a Cloud Rune stop, laid before the held call runs
// again (turn.ts runHeldCalls, backstop-resume.ts runWatchedCalls): the
// creature picked, or null when they let it land or the stop ran out. Kept on
// the sheet, not in memory, so a run rolled back after it (a card parked for
// the creature it turned onto) finds it again; the fight's clock takes it
// after a round if no run reached the hit.
export function layCloudTurn(knightId: string, stop: WatchStop): void {
  const now = getSheetById(knightId);
  if (!now || stop.power !== "cloud_rune" || !stop.hit) {
    return;
  }
  const picked = stop.shift ? watchChoiceOf(stop) : null;
  const answer: CloudTurn = { ...stop.hit, onto: picked?.ref ?? null };
  const turns = [...turnsOf(now).filter((entry) => !sameHit(entry, answer)), answer].slice(-8);
  patchSheet(now.id, {
    conditions: [...now.conditions.filter((entry) => entry !== CLOUD_TURN), CLOUD_TURN],
    conditionMeta: { ...now.conditionMeta, [CLOUD_TURN]: { rounds: 1, cloudTurns: turns } },
  });
}

// The answer laid for this hit, taken off the knight's sheet.
function takeCloudTurn(campaignId: string, hit: Omit<CloudTurn, "onto">): { knight: CharacterSheet; onto: string | null } | null {
  for (const sheet of listSheets(campaignId)) {
    if (!sheet.conditions.includes(CLOUD_TURN)) continue;
    const turns = turnsOf(sheet);
    const found = turns.find((entry) => sameHit(entry, hit));
    if (!found) continue;
    const left = turns.filter((entry) => entry !== found);
    const meta = sheet.conditionMeta as ConditionMetaMap;
    const knight = left.length
      ? patchSheet(sheet.id, { conditionMeta: { ...meta, [CLOUD_TURN]: { ...meta[CLOUD_TURN], cloudTurns: left } } })
      : (() => {
          const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, [CLOUD_TURN]);
          return patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
        })();
    return { knight: knight ?? sheet, onto: found.onto };
  }
  return null;
}

function runeLeft(sheet: CharacterSheet): boolean {
  const state = sheet.resources?.[POOL];
  return Boolean(state && state.max - state.used >= 1);
}

// The creatures the knight may turn the hit onto: any within 30 feet of them,
// the knight too, but the attacker and the one it hit.
function takersFor(campaignId: string, encounter: Encounter, knight: CharacterSheet, attackerId: string, struckId: string): Combatant[] {
  return combatantsOf(campaignId, encounter).filter(
    (entry) => entry.id !== attackerId && entry.id !== struckId && !combatantDefeated(entry) && (entry.id === knight.id || withinFeet(encounter.id, knight.id, entry.id, REACH_FT)),
  );
}

// Whether this knight could invoke the rune on a hit on `struck` now.
function canInvoke(campaignId: string, encounter: Encounter, knight: CharacterSheet, struck: CharacterSheet): boolean {
  return (
    runeLeft(knight) &&
    canReactNow(campaignId, knight) &&
    (knight.id === struck.id || (withinFeet(encounter.id, knight.id, struck.id, REACH_FT) && !unseenBecause(encounter.id, knight, struck)))
  );
}

export type CloudHit = {
  campaign: Campaign;
  turn: DmTurn;
  encounter: Encounter;
  attacker: EncounterEnemy;
  attackName: string;
  struck: CharacterSheet;
  // Which swing of the call this is, so each hit of a routine is asked apart.
  swing: number;
  rolled: number;
};

// A foe's hit on a character, before its damage is rolled: the creature a
// knight's answer turns it onto, with the reaction and the rune's use spent;
// or null, and the hit lands as rolled. With no answer yet, a knight who could
// invoke the rune and whose player a stop reaches is asked: the call stops
// here and never returns.
export function cloudRuneAtHit(hit: CloudHit): { taker: Combatant; knight: CharacterSheet } | null {
  const { campaign, turn, encounter, attacker, struck } = hit;
  const key = { attackerId: attacker.id, struckId: struck.id, swing: hit.swing };
  const answer = takeCloudTurn(campaign.id, key);
  if (answer) {
    const knight = answer.knight;
    const taker = answer.onto ? resolveCombatant(campaign.id, encounter, answer.onto) : null;
    // Let land, or what was picked no longer stands where the rune reaches.
    if (!taker || !canInvoke(campaign.id, encounter, knight, getSheetById(struck.id) ?? struck) || !takersFor(campaign.id, encounter, knight, attacker.id, struck.id).some((entry) => entry.id === taker.id)) {
      return null;
    }
    const live = getActiveEncounter(campaign.id);
    if (live && !live.reactionsUsed.includes(knight.id)) {
      markReactionUsed(live, knight.id);
    }
    const state = knight.resources[POOL];
    reactionPatch(campaign, turn.id, knight.id, { resources: { ...knight.resources, [POOL]: { ...state, used: state.used + 1 } } }, `${NAME}: a use spent`);
    return { taker, knight };
  }
  if (!canStopAfterThrow()) {
    return null;
  }
  for (const knight of listSheets(campaign.id)) {
    if (!knight.resources?.[POOL] || !stopReaches(campaign.id, knight) || !canInvoke(campaign.id, encounter, knight, struck)) continue;
    const tag = { roller: "enemy" as const, kind: "attack" as const, who: attacker.displayName };
    const choices: WatchChoice[] = takersFor(campaign.id, encounter, knight, attacker.id, struck.id).map((entry) => ({ name: entry.name, ref: entry.id, rolls: [{ tag, reverse: "success" }] }));
    if (!choices.length) continue;
    stopAfterThrow(campaign, turn, { watcher: knight, power: "cloud_rune", choices, hit: key }, `${attacker.displayName}'s ${hit.attackName} hits ${struck.name} (${hit.rolled} to hit).`);
  }
  return null;
}

// The turned blow: its damage rolled for the creature it now targets, and
// dealt to them alone. What the swing tells the GM.
export function landTurnedBlow(input: {
  campaign: Campaign;
  turn: DmTurn;
  encounter: Encounter;
  attacker: EncounterEnemy;
  attack: EnemyAttack;
  taker: Combatant;
  knight: CharacterSheet;
  // The blow's dice, doubled already on a critical hit.
  expression: string;
  crit: boolean;
  // What the attacker's own state takes off the blow (Ray of Enfeeblement).
  shrink: (amount: number) => number;
  flags: BlowFlags;
  rolled: number;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
}): Record<string, unknown> {
  const { campaign, turn, encounter, attacker, attack, taker, crit } = input;
  const outcome = rollExpression(input.expression, undefined, { purpose: { roller: "enemy", kind: "damage", who: attacker.displayName } });
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: taker.kind === "sheet" ? taker.id : null,
    requestedBy: "dm",
    kind: "damage",
    detail: rollAgainst(attack.name, taker.name),
    result: outcome,
    attacker: { kind: "enemy", id: attacker.id, name: attacker.displayName },
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  turn.rollIds.push(roll.id);
  const blow = blowByType(attack, outcome, crit);
  const dealt = Math.min(input.shrink(blow.amount), 200);
  const by = `${input.knight.name}'s ${NAME}`;
  if (dealt > 0 && taker.kind === "sheet") {
    applyPcDamage(campaign, turn.id, getSheetById(taker.id) ?? taker.sheet, {
      amount: dealt,
      ...(blow.type ? { type: blow.type } : {}),
      ...(blow.parts ? { parts: scaledParts(blow.parts, dealt) } : {}),
      ...input.flags,
      ...(crit ? { crit: true } : {}),
      reason: `${attacker.displayName}'s ${attack.name}, turned by ${by}`,
    });
  } else if (dealt > 0 && taker.kind === "enemy") {
    applyEnemyDamage(campaign, turn, encounter, taker.enemy, dealt, input.sheets, input.sheetsById, blow.type, { ...(input.flags.magical ? { magical: true } : {}), ...(crit ? { crit: true } : {}) });
    publishEncounter(campaign.id);
  }
  return { attack: attack.name, rolled: input.rolled, hit: false, turnedBy: by, turnedOnto: taker.name, damage: dealt, ...(crit ? { crit: true } : {}) };
}
