// Real dice for pc_attack: the to-hit roll is parked for the player, and each
// roll they enter runs the same stages the server's dice run
// (pc-attack-resolve.ts): attack-swing.ts when the d20 lands, attack-blow.ts
// when the damage lands. The attack's record (attack-record.ts) rides the
// parked rolls in between. Nothing here decides a rule: a rule lives in the
// stages, so it reaches both dice paths or neither.

import { getCampaignById } from "@/lib/db/campaigns";
import { createPendingRoll, dicePreferencesOf, getDmTurn, publicPendingRoll, type PendingAttack, type PendingRoll } from "@/lib/db/dm-turns";
import { parkReasonFor } from "@/lib/dice/held-rolls";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getRoll, type StoredRoll } from "@/lib/db/rolls";
import { publishPersisted } from "@/lib/events";
import { attackRecord, attackTurnOver, recordTargetAc, type AttackRecord, type DamageAsk } from "@/lib/dm/attack-record";
import { damageDiceNote, damageDiceSteps, landSwingBlow } from "@/lib/dm/attack-blow";
import { hitSwing, judgeSwing, missSwing, type SwingScene } from "@/lib/dm/attack-swing";
import type { HeldMote } from "@/lib/dm/authored-mote";
import { applyPendingDamageRoll } from "@/lib/dm/enemy-blow";
import type { AttackPlan } from "@/lib/dm/pc-attack-plan";
import { serverBlow, shiftedThrow, type Strike } from "@/lib/dm/pc-attack-resolve";
import { allyChoicesFor, reactionFreeFor, rollsCanWait } from "@/lib/dm/after-roll";
import { afterRollDeadline, armAfterRollKeep } from "@/lib/dm/after-roll-timer";
import { afterAttackOptions } from "@/lib/dm/after-roll-logic";
import { rollsWrathDice } from "@/lib/dm/destructive-wrath-logic";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { entryDice, type RollResult } from "@/lib/dice";
import { getFoe, resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { isKnockedOut } from "@/lib/dm/knockout";
import { rollAgainst } from "@/lib/roll-labels";

// A blow with no dice to roll (a Blowgun's 1 piercing, Contagion's 0) lands
// at once: parked, it asked for no faces, the route refuses an empty entry,
// and the turn waited until someone pressed Roll digitally (finding
// dice-paths-no-dice-damage-card of the 2026-11-09 gap sweep).
function noDiceIn(expression: string): boolean {
  try {
    return entryDice(expression).length === 0;
  } catch {
    return false;
  }
}

// The AC a parked roll meets when it lands (attack-record.ts recordTargetAc).
export function parkedTargetAc(campaignId: string, attack: PendingAttack): number {
  return recordTargetAc(campaignId, attack as AttackRecord);
}

// Physical dice: park the to-hit roll for the player, with the attack's record.
export function parkPcAttack(plan: AttackPlan, strike: Strike, toolCallId: string | null, mote: HeldMote | null = null) {
  const { campaign, turn, sheet, enemy, profile } = plan;
  const pending = createPendingRoll({
    campaignId: campaign.id,
    turnId: turn.id,
    toolCallId,
    userId: sheet.userId,
    characterId: sheet.id,
    kind: "attack",
    detail: strike.detail,
    expression: strike.toHitExpression,
    advantage: plan.advantage,
    dc: null,
    reason: `${profile.weapon} attack against ${enemy.displayName}`,
    attack: attackRecord(plan, strike, mote),
  });
  publishPersisted(campaign.id, "roll_pending", { pendingRoll: publicPendingRoll(pending) });
}

// The server's dice for a player whose rolls can wait (after-roll.ts
// rollsCanWait): the d20 is thrown, and when the attack misses as it stands
// and something they hold could turn it into a hit (a luck point, a held
// Bardic Inspiration die), the roll is parked thrown, with the attack's
// record, for the player to decide (after-roll route). Nothing is spent until
// they do. It lands as a real-dice roll does (resolvePendingPcAttack), and the
// server throws its damage. `thrown` when there is nothing to decide: the
// caller resolves the attack with that throw at once.
export function throwForChoice(plan: AttackPlan, strike: Strike, toolCallId: string | null, mote: HeldMote | null): { parked: PendingRoll } | { thrown: RollResult } | null {
  const { campaign, turn, sheet, enemy, profile } = plan;
  const fresh = getSheetById(sheet.id) ?? sheet;
  if (!rollsCanWait(fresh)) {
    return null;
  }
  const record = attackRecord(plan, strike, mote);
  const ac = recordTargetAc(campaign.id, record);
  const critRange = record.critRange ?? 20;
  const thrown = shiftedThrow(plan, strike, ac, critRange);
  const options = [
    ...afterAttackOptions(fresh, { outcome: thrown, ac, critRange, spent: record.luck ? ["lucky"] : [], reactionFree: reactionFreeFor(campaign.id, fresh.id), melee: record.melee === true && record.ranged !== true, wrathDice: rollsWrathDice(record.damageExpression, record.damageType, record.riders) }),
    // A wizard or a War cleric beside them may answer the miss (after-roll.ts).
    ...allyChoicesFor(campaign.id, fresh, { kind: "attack", outcome: thrown, ac, critRange }),
  ];
  if (!options.length) {
    return { thrown };
  }
  const parked = createPendingRoll({
    campaignId: campaign.id,
    turnId: turn.id,
    toolCallId,
    userId: sheet.userId,
    characterId: sheet.id,
    kind: "attack",
    detail: strike.detail,
    expression: strike.toHitExpression,
    advantage: plan.advantage,
    dc: null,
    reason: `${profile.weapon} attack against ${enemy.displayName}`,
    attack: { ...record, serverDice: true } as AttackRecord,
    parkedFor: "after_roll",
    thrown: { outcome: thrown, options, choosing: false, landing: { status: "fallback", physical: false, source: "digital" }, deadline: afterRollDeadline(campaign.id, sheet.userId) },
  });
  publishPersisted(campaign.id, "roll_pending", { pendingRoll: publicPendingRoll(parked) });
  armAfterRollKeep(parked.id, parked.thrown?.deadline);
  return { parked };
}

// The stage's world, read as the roll lands. A record parked by an older
// build names no attacker or round: the roll's character, on the turn now
// under way, as that build read it.
function sceneOf(pending: PendingRoll): { scene: SwingScene; record: AttackRecord } | null {
  const stored = pending.attack as AttackRecord | null;
  const campaign = getCampaignById(pending.campaignId);
  const turn = getDmTurn(pending.turnId);
  const encounter = getActiveEncounter(pending.campaignId);
  if (!stored || !campaign || !turn || !encounter || !pending.characterId) {
    return null;
  }
  const sheets = listSheets(pending.campaignId);
  const sheet = sheets.find((entry) => entry.id === pending.characterId);
  const enemy = resolveTargetFoe(pending.campaignId, encounter, stored.targetEnemyId);
  if (!sheet || !enemy) {
    return null;
  }
  const record: AttackRecord = stored.attackerId
    ? stored
    : { ...stored, attackerId: sheet.id, round: stored.blowRound ?? encounter.round };
  return { scene: { campaign, turn, sheet, enemy, sheets, sheetsById: new Map(sheets.map((entry) => [entry.id, entry])) }, record };
}

// Parks the damage roll a hit or a graze asks for, with the record it lands by.
function parkDamage(pending: PendingRoll, scene: SwingScene, record: AttackRecord, ask: DamageAsk, toHit: StoredRoll) {
  const attack: AttackRecord = { ...record, damage: ask, toHitRollId: toHit.id, riders: ask.riders, crit: ask.crit, ...(ask.half ? { halfOnMiss: true } : {}) };
  // The card shows the roll's reason under its title, so the feats' steps go
  // there for a player with dice in hand. A held roll is thrown by the server
  // and has no dice to reroll.
  const { dicePolicy, member } = dicePreferencesOf(pending.campaignId, pending.userId);
  const steps = parkReasonFor(dicePolicy, member) === "real_dice" ? damageDiceSteps(ask) : "";
  const reason = `${record.weapon} ${ask.half ? "half damage" : "damage"} against ${scene.enemy.displayName}`;
  const damagePending = createPendingRoll({
    campaignId: pending.campaignId,
    turnId: pending.turnId,
    // No paired tool call: the resumed turn pushes this result without an
    // id, which the conversation loop tolerates; the combat notes on both
    // stages carry the full story.
    toolCallId: null,
    userId: pending.userId,
    characterId: pending.characterId,
    kind: "damage",
    detail: rollAgainst(ask.half ? `${record.weapon} (half on a miss)` : record.weapon, scene.enemy.displayName),
    expression: ask.expression,
    advantage: "none",
    dc: null,
    reason: steps ? `${reason}. ${steps}` : reason,
    targetEnemyId: scene.enemy.id,
    attack,
  });
  publishPersisted(pending.campaignId, "roll_pending", { pendingRoll: publicPendingRoll(damagePending) });
}

// Called from the pending-rolls submit route when a parked to-hit roll lands.
// Returns the combat note the resumed turn surfaces to the model; a hit (or a
// spell's graze) parks the damage roll, so the turn waits for those dice too.
export function resolvePendingPcAttack(pending: PendingRoll, roll: StoredRoll): string | null {
  const stored = pending.attack as AttackRecord | null;
  if (!stored) {
    return null;
  }
  // A to-hit roll still parked when the turn moved on (the lead skipped it,
  // the order was edited) must not land on a later turn as though nothing
  // had happened: the player declared it on a turn that is over.
  if (attackTurnOver(pending.campaignId, stored, pending.characterId)) {
    return `${stored.attacker}'s ${stored.weapon} attack was still ${stored.serverDice ? "waiting on its player's choice" : "unrolled"} when their turn ended, so it does not land. No damage roll happens; narrate the moment passing.`;
  }
  const found = sceneOf(pending);
  if (!found) {
    return `${stored.attacker}'s ${stored.weapon} attack rolled ${roll.total}, but the target is already gone; narrate around it.`;
  }
  const { scene, record } = found;
  const notes: string[] = [];
  const judged = judgeSwing(scene, record, roll.breakdown, notes);
  const rolled = `${record.attacker}'s ${record.weapon} attack rolled ${roll.total} vs AC ${judged.targetAc}`;
  // What the engine said of the attack before the roll, as the server's dice
  // answer says it (conditionEffects).
  notes.unshift(...(record.notes ?? []));
  if (!judged.hit) {
    const { graze } = missSwing(scene, record, judged, roll.breakdown, roll.visibility, notes);
    const said = notes.length ? ` ${notes.join("; ")}.` : "";
    if (graze && (record.serverDice || graze.noDice || noDiceIn(graze.expression))) {
      const out = serverBlow(scene, record, graze, roll.breakdown, roll.visibility, rollAgainst(`${record.weapon} (half on a miss)`, scene.enemy.displayName), []);
      return `${rolled}: MISS.${said} The spell still deals half its damage. ${blowSentences(scene, graze, out, []).join(" ")}`;
    }
    if (graze) {
      parkDamage(pending, scene, record, graze, roll);
      return `${rolled}: MISS.${said} The spell still deals half its damage: ${record.attacker} now rolls damage (${graze.expression}), and the server will apply half of it to ${scene.enemy.displayName} automatically.`;
    }
    return `${rolled}: MISS${judged.natural1 ? " (natural 1)" : ""}.${said} No damage roll happens; narrate the miss.`;
  }
  if (scene.enemy.status !== "alive") {
    return `${rolled}: HIT, but the target is already gone; narrate around it.`;
  }
  const prepared = hitSwing(scene, record, judged, roll.breakdown, roll.visibility, notes);
  const said = notes.length ? ` ${notes.join("; ")}.` : "";
  if ("done" in prepared) {
    return `${rolled}: HIT.${said} ${String(prepared.done.note ?? "")}`.trim();
  }
  const { ask } = prepared;
  const critical = ask.crit ? (ask.stunShot ? " (CRITICAL: the target is stunned instead of the dice doubling)" : " (CRITICAL: damage dice are doubled)") : "";
  if (record.serverDice || ask.noDice || noDiceIn(ask.expression)) {
    // The server threw the d20, so it throws the damage too, as its own
    // answer would have: the player decided only what to do with the d20.
    const blowNotes: string[] = [];
    const out = serverBlow(scene, record, ask, roll.breakdown, roll.visibility, pending.detail, blowNotes);
    return `${rolled}: HIT${critical}.${said} ${blowSentences(scene, ask, out, blowNotes).join(" ")}`.trim();
  }
  parkDamage(pending, scene, record, ask, roll);
  return `${rolled}: HIT${critical}.${said} ${record.attacker} now rolls damage (${ask.expression})${damageDiceNote(ask)}; the server will apply it to ${scene.enemy.displayName} automatically.`;
}

// Called from the pending-rolls submit route when the player's damage roll
// for a parked attack lands: the blow lands as the server's dice land it.
export function resolvePendingPcDamage(pending: PendingRoll, roll: StoredRoll): string | null {
  const stored = pending.attack as AttackRecord | null;
  const ask = stored?.damage;
  // A damage roll parked by an older build resolves the way it was parked.
  if (!stored || !ask) {
    return applyPendingDamageRoll(pending, roll);
  }
  const found = sceneOf(pending);
  if (!found) {
    return `${stored.attacker}'s target is no longer in the fight; the damage was NOT applied. Narrate around it.`;
  }
  const { scene, record } = found;
  const toHit = record.toHitRollId ? (getRoll(record.toHitRollId)?.breakdown ?? null) : null;
  const notes: string[] = [];
  const out = landSwingBlow(scene, record, ask, roll, toHit, pending.visibility, notes);
  if ("error" in out && typeof out.warning !== "string") {
    return null;
  }
  return blowSentences(scene, ask, out, notes, roll.total).join(" ");
}

// What a landed blow did, in the words the resumed turn gives the model.
// `total`: the player's damage roll, said beside the half of it that landed.
function blowSentences(scene: SwingScene, ask: DamageAsk, out: Record<string, unknown>, notes: string[], total?: number): string[] {
  if (typeof out.warning === "string") {
    return [out.warning];
  }
  const byType = Array.isArray(out.damageByType) ? ` (${(out.damageByType as string[]).join(", ")})` : "";
  const dealt = Number(out.damage ?? 0);
  // A blow declared nonlethal leaves the creature at 0 and stable, as the
  // server's dice say of it (knockout.ts): "now dead" told the GM otherwise
  // (finding L820-knockout-note-says-dead).
  const after = getFoe(scene.enemy.id);
  const now = after && isKnockedOut(after) ? "knocked out: unconscious and stable" : out.dead ? "SLAIN" : String(out.health ?? "unharmed");
  const parts = [
    ask.half
      ? `The server already applied half ${total === undefined ? "the" : `of this ${total}`} damage, ${dealt}${byType}, to ${scene.enemy.displayName} (now ${now}).`
      : `The server already applied this ${dealt} damage${byType} to ${scene.enemy.displayName} (now ${now}).`,
  ];
  if (out.encounterOver) {
    parts.push(`The encounter ended: ${String(out.outcome)}. XP was awarded automatically.`);
  }
  parts.push(...notes.map((note) => `${note}.`), ...outcomeLines(out));
  parts.push(`Do NOT call apply_damage for this ${ask.half ? "miss" : "hit"}; narrate from this state.`);
  return parts;
}

// What the blow left, said in the order the server's dice answer says it.
function outcomeLines(out: Record<string, unknown>): string[] {
  const keys = ["maneuver", "stunningStrike", "tempHp", "poison", "onHit", "openHand", "hurlThroughHell", "darkOnesBlessing", "subclassFeatures", "spellEffect", "mote"];
  return keys.flatMap((key) => {
    const value = out[key];
    const lines = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    return lines.filter((line): line is string => typeof line === "string" && line.length > 0).map((line) => (/[.!?]$/.test(line) ? line : `${line}.`));
  });
}
