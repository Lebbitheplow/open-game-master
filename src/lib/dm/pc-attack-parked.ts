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
import { listSheets } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { attackRecord, recordTargetAc, type AttackRecord, type DamageAsk } from "@/lib/dm/attack-record";
import { damageDiceNote, damageDiceSteps, landSwingBlow } from "@/lib/dm/attack-blow";
import { hitSwing, judgeSwing, missSwing, type SwingScene } from "@/lib/dm/attack-swing";
import type { HeldMote } from "@/lib/dm/authored-mote";
import { applyPendingDamageRoll } from "@/lib/dm/enemy-blow";
import type { AttackPlan } from "@/lib/dm/pc-attack-plan";
import type { Strike } from "@/lib/dm/pc-attack-resolve";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { rollAgainst } from "@/lib/roll-labels";

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
  const fight = getActiveEncounter(pending.campaignId);
  if (fight?.orderReady) {
    const current = fight.order[fight.turnIndex];
    if (!current || current.kind !== "pc" || current.characterId !== pending.characterId) {
      return `${stored.attacker}'s ${stored.weapon} attack was still unrolled when their turn ended, so it does not land. No damage roll happens; narrate the moment passing.`;
    }
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
  parkDamage(pending, scene, record, ask, roll);
  return `${rolled}: HIT${ask.crit ? (ask.stunShot ? " (CRITICAL: the target is stunned instead of the dice doubling)" : " (CRITICAL: damage dice are doubled)") : ""}.${said} ${record.attacker} now rolls damage (${ask.expression})${damageDiceNote(ask)}; the server will apply it to ${scene.enemy.displayName} automatically.`;
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
  if (typeof out.warning === "string") {
    return out.warning;
  }
  if ("error" in out) {
    return null;
  }
  const byType = Array.isArray(out.damageByType) ? ` (${(out.damageByType as string[]).join(", ")})` : "";
  const dealt = Number(out.damage ?? 0);
  const parts = [
    ask.half
      ? `The server already applied half of this ${roll.total} damage, ${dealt}${byType}, to ${scene.enemy.displayName} (now ${out.dead ? "SLAIN" : String(out.health ?? "unharmed")}).`
      : `The server already applied this ${dealt} damage${byType} to ${scene.enemy.displayName} (now ${out.dead ? "SLAIN" : String(out.health)}).`,
  ];
  if (out.encounterOver) {
    parts.push(`The encounter ended: ${String(out.outcome)}. XP was awarded automatically.`);
  }
  parts.push(...notes.map((note) => `${note}.`), ...outcomeLines(out));
  parts.push(`Do NOT call apply_damage for this ${ask.half ? "miss" : "hit"}; narrate from this state.`);
  return parts.join(" ");
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
