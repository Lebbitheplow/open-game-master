// A parked roll's dice are final: the roll is recorded, what it does happens,
// and when the turn has no rolls left the GM resumes. Shared by the route a
// player answers a parked roll on and the after-the-roll choice
// (src/lib/dm/after-roll.ts).

import {
  getDmTurn,
  getLatestDmTurnId,
  listOpenPendingRolls,
  listPendingForTurn,
  resolvePendingRoll,
  getPendingRoll,
  setPendingAttack,
  setPendingCombatNote,
  withdrawPendingRoll,
  publicPendingRoll,
  type PendingRoll,
} from "@/lib/db/dm-turns";
import { insertRoll, type StoredRoll } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { settleAttackDie } from "@/lib/dm/forced-save";
import { rollsCanWait } from "@/lib/dm/after-roll";
import { afterToHitLanded, runQueuedParts } from "@/lib/dm/pc-attack-parts";
import { moteAfterRoll } from "@/lib/dm/authored-mote";
import type { RollResult } from "@/lib/dice";
import { endTurnOnLanding, recordInitiativeRoll, settleTurn, turnHolder } from "@/lib/dm/encounter-tools";
import { applyInitiativeRefills } from "@/lib/dm/feature-hooks";
import { applyPendingDamageRoll } from "@/lib/dm/enemy-damage";
import { resolvePendingPcAttack } from "@/lib/dm/pc-attack";
import { lostSwingNote, parkedTargetAc, resolvePendingPcDamage } from "@/lib/dm/pc-attack-parked";
import { attackTurnOver, type AttackRecord } from "@/lib/dm/attack-record";
import { closeStaleDmTurn, resumeDmTurn } from "@/lib/dm/turn";
import { parkedTurnIsStale, toHitRollWithPlayer } from "@/lib/dm/open-roll-logic";
import { resumeHumanTurn } from "@/lib/dm/invoke";
import { enqueueDmJob } from "@/lib/dm/queue";
import { runInTurnScope } from "@/lib/dm/job-control";
import { postPersonsRecord, startPersonsRecord } from "@/lib/dm/persons-record";
import { claimHeldPending, runHeldAgain } from "@/lib/dm/held-call";
import { backstopTurn } from "@/lib/dm/backstop-calls";
import { resumeBackstop } from "@/lib/dm/backstop-resume";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";

// What a landed roll leaves: its record, or, for dice whose call waits again
// on another roll, the word that they are kept (held-call.ts runHeldAgain).
export type Landed = StoredRoll | { waiting: string };

const KEPT = "The dice are in. The call they belong to waits on another roll, and records them when it finishes.";

// What a route answers the one who landed a roll.
export function landedBody(landed: Landed): { roll: StoredRoll } | { waiting: string } {
  return "waiting" in landed ? landed : { roll: landed };
}

export type RollLanding = {
  status: "submitted" | "fallback";
  // "(physical)" marks a roll made entirely with real dice.
  physical: boolean;
  source: "digital" | "physical";
};

// A roll that held its whole call (src/lib/dm/held-call.ts): the call runs
// again with the roll in hand, under the turn it was made on, and records the
// roll itself as its first run would have.
function landHeld(campaign: Campaign, pending: PendingRoll, outcome: RollResult, landing: RollLanding): Landed | null {
  if (!claimHeldPending(pending.id, landing.status)) {
    return null;
  }
  const parkedOn = getDmTurn(pending.turnId);
  const record = parkedOn?.actor === "human_dm" ? startPersonsRecord(campaign, parkedOn) : null;
  const { roll, waits } = runInTurnScope(pending.turnId, () => {
    const holder = turnHolder(campaign.id);
    const ran = runHeldAgain(campaign, pending, outcome, landing);
    settleTurn(campaign, holder);
    return ran;
  });
  const after = record ? getDmTurn(pending.turnId) : null;
  if (record && after) {
    postPersonsRecord(campaign, after, record, { rollIds: roll ? [roll.id] : [] });
  }
  return waits ? { waiting: KEPT } : roll;
}

// An attack sent with endTurn ("and end the turn", the console's check box)
// on dice entered at the table: the ask rides each of its rolls, and the turn
// ends once the last of them has landed, as the server's dice end it. A roll
// the landing left open (the damage of a hit, a queued part) takes the ask
// over; a turn already over (the pointer moved on) is not ended again.
function carryEndTurn(campaign: Campaign, pending: PendingRoll) {
  const record = pending.attack;
  if (!record?.endTurn || !pending.characterId) {
    return;
  }
  const open = listPendingForTurn(pending.turnId).filter((entry) => entry.id !== pending.id && entry.status === "pending" && entry.attack && entry.characterId === pending.characterId);
  if (open.length) {
    for (const entry of open) {
      if (!entry.attack?.endTurn) setPendingAttack(entry.id, { ...entry.attack!, endTurn: true });
    }
    return;
  }
  if (!attackTurnOver(campaign.id, record as AttackRecord, pending.characterId)) {
    const ended = endTurnOnLanding(campaign, pending.turnId, pending.characterId);
    if (!ended.error) {
      const note = getPendingRoll(pending.id)?.combatNote;
      setPendingCombatNote(pending.id, [note, "the turn ends, as the attack asked"].filter(Boolean).join("; "));
    }
  }
}

function landOne(campaign: Campaign, pending: PendingRoll, thrown: RollResult, landing: RollLanding): Landed | null {
  if (pending.carry?.call) {
    return landHeld(campaign, pending, thrown, landing);
  }
  const campaignId = campaign.id;
  // A parked to-hit roll takes a held Bardic Inspiration die the way the
  // digital one does: only on a miss it turns into a hit (forced-save.ts).
  // A player whose rolls can wait spends it themselves, after the roll
  // (after-roll.ts): the die is theirs, and stays held if they keep the roll.
  const attacker = pending.kind === "attack" && pending.attack && pending.characterId ? getSheetById(pending.characterId) : null;
  const decides = Boolean(pending.thrown) || rollsCanWait(attacker);
  const outcome = attacker && pending.attack && !decides ? settleAttackDie(campaignId, attacker, thrown, parkedTargetAc(campaignId, pending.attack), pending.attack.critRange ?? 20) : thrown;
  if (outcome !== thrown) {
    // The server threw that die: the roll is no longer the player's alone.
    landing = { ...landing, physical: false };
  }
  const roll = insertRoll({
    campaignId,
    characterId: pending.characterId,
    requestedBy: "player",
    kind: pending.kind,
    // Once any face was drawn by the server the "(physical)" label would
    // overclaim, so a mixed or fully digital submission keeps the plain detail.
    detail: landing.physical ? `${pending.detail || pending.kind} (physical)`.trim() : pending.detail,
    advantage: pending.advantage,
    dc: pending.dc,
    result: outcome,
    // A parked pc_attack roll (to-hit or damage) is the PC's own; any other
    // parked roll is a roll tool's free text about its sheet.
    attacker:
      pending.attack && pending.characterId
        ? { kind: "sheet", id: pending.characterId, name: pending.attack.attacker }
        : null,
    // A roll the DM asked for behind the screen lands behind it.
    visibility: pending.visibility,
  });

  const resolved = resolvePendingRoll(pending.id, landing.status, roll.id);
  if (!resolved) {
    return null;
  }

  publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", {
    roll,
    pendingRollId: pending.id,
    // Real dice already rolled on a real table; the overlay animates only
    // rolls where every face was drawn digitally (a mixed submission still
    // happened at the table).
    source: landing.source,
  });

  // A person's turn has no narration to carry the dice entered for it: they
  // and what they did go to the chronicle now (issue 713).
  const parkedOn = getDmTurn(pending.turnId);
  const record = parkedOn?.actor === "human_dm" ? startPersonsRecord(campaign, parkedOn) : null;
  // What the roll does lands in the player's request, but it is the parked
  // turn's work: the order the last initiative locks (and the death saves
  // the pointer then rolls), the damage it lands. Filed under that turn, its
  // revert takes them with the rest (issue #622).
  runInTurnScope(pending.turnId, () => {
    const holder = turnHolder(campaignId);
    // Combat initiative submitted from a physical table: record it; the last
    // one locks the order. The note rides pending_rolls.combat_note so the
    // resumed DM turn narrates what actually happened.
    if (pending.kind === "initiative") {
      const note = recordInitiativeRoll(campaignId, pending.characterId, roll.total);
      if (note) {
        setPendingCombatNote(pending.id, note);
      }
      // Superior Inspiration, Perfect Self: a use back on rolling initiative,
      // for dice entered at the table as for dice the server threw.
      if (pending.characterId) {
        applyInitiativeRefills(campaign, pending.characterId);
      }
    } else if (pending.kind === "attack" && pending.attack) {
      // A parked pc_attack to-hit roll: the server adjudicates it against the
      // stored enemy AC and, on a hit, parks the damage roll so the turn stays
      // paused until the player rolls their damage dice.
      // Asked before the roll lands: a turn that is over lands nothing, and
      // makes none of the attacks queued behind the roll.
      const over = attackTurnOver(campaignId, pending.attack as AttackRecord, pending.characterId);
      const note = resolvePendingPcAttack(pending, roll);
      if (note) {
        // Who helped the roll (the after-roll route) stays beside what it did.
        const helped = getPendingRoll(pending.id)?.combatNote;
        setPendingCombatNote(pending.id, helped ? `${helped}; ${note}` : note);
      }
      // The attacks declared after this one wait behind it: made now, in
      // order, as the server's dice would have made them, or behind the
      // damage roll a hit parked (pc-attack-parts.ts afterToHitLanded).
      if (!over) {
        afterToHitLanded(campaign, pending, roll);
      }
    } else if (pending.kind === "damage" && pending.targetEnemyId) {
      // Targeted damage applies server-side the moment the dice land; the
      // enemy card updates now, not when the model gets around to it. A
      // pc_attack's damage lands through the attack's own stage, as the
      // server's dice land it (attack-blow.ts).
      const over = pending.attack ? attackTurnOver(campaignId, pending.attack as AttackRecord, pending.characterId) : true;
      const note = pending.attack ? resolvePendingPcDamage(pending, roll) : applyPendingDamageRoll(pending, roll);
      if (note) {
        setPendingCombatNote(pending.id, note);
      }
      // The attacks of the call that waited behind this blow: made now that
      // it has landed, unless the turn they belong to is over.
      if (!over && (pending.attack as AttackRecord | null)?.queue) {
        runQueuedParts(campaign, pending);
      }
    } else if (pending.carry?.mote) {
      // A mote the spent inspiration die carried goes off as it does on the
      // server's throw (authored-mote.ts): a save's temporary hit points.
      const sheet = pending.characterId ? getSheetById(pending.characterId) : null;
      const line = sheet ? moteAfterRoll(campaign, sheet, pending.carry.mote, pending.kind, roll.breakdown) : null;
      if (line) {
        setPendingCombatNote(pending.id, line);
      }
    }

    // A combatant who left the fight during the call takes no turn with them.
    settleTurn(campaign, holder);
    carryEndTurn(campaign, pending);
  });
  const after = record ? getDmTurn(pending.turnId) : null;
  if (record && after) {
    postPersonsRecord(campaign, after, record, { rollIds: [roll.id] });
  }
  return roll;
}

export function landPendingRoll(campaign: Campaign, pending: PendingRoll, outcome: RollResult, landing: RollLanding): Landed | null {
  // Asked before the roll lands, as landOne asks it.
  const toHit = pending.kind === "attack" && Boolean(pending.attack);
  const turnOver = toHit && attackTurnOver(campaign.id, pending.attack as AttackRecord, pending.characterId);
  const roll = landOne(campaign, pending, outcome, landing);
  if (!roll) {
    return null;
  }
  const pendings = listPendingForTurn(pending.turnId);
  const remaining = pendings.filter((entry) => entry.status === "pending");
  // A roll of the backstop's (backstop-calls.ts): the creature's turn ran as
  // it landed (landHeld), and the pass goes on with no model call.
  if (!remaining.length && backstopTurn(pendings)) {
    enqueueDmJob(campaign.id, () => resumeBackstop(campaign.id, pending.turnId), { kind: "turn" });
    return roll;
  }
  if (!remaining.length && parkedTurnIsStale({ toHit, turnOver, turnId: pending.turnId }, getLatestDmTurnId(campaign.id))) {
    // The swing landed on nothing and newer turns have told the story since:
    // the turn it was parked on closes without a word (open-roll-logic.ts).
    if (!resumeHumanTurn(pending.turnId)) {
      enqueueDmJob(campaign.id, () => closeStaleDmTurn(campaign.id, pending.turnId), { kind: "turn" });
    }
    return roll;
  }
  if (!remaining.length) {
    // A turn a person opened has no model waiting on the answer: the roll
    // already published itself and applied what it applies, so closing the
    // turn is the whole of "resuming" it.
    if (!resumeHumanTurn(pending.turnId)) {
      enqueueDmJob(campaign.id, () => resumeDmTurn(campaign.id, pending.turnId), { kind: "turn" });
    }
  }
  return roll;
}

// The lead skipped a turn with its attack's d20 still with the player, so no
// card outlives the turn it was dealt on. Thrown dice with the choice still
// open are kept as they lie, as the clock keeps them (after-roll-timer.ts):
// the turn is over, so the swing lands on nothing and nothing is spent. Dice
// the player never entered are taken off the table with nothing rolled: left
// up, the card could only land nothing, or, entered once the hero's turn came
// round again, hit for last round. The screen drops it on the roll_pending
// event a watch stop closes with (useCampaignStream.ts).
// `skippedId`: the character whose turn the skip ended. Their rolls are
// marked as made on a skipped turn: a lone hero's skip can leave the pointer
// and round where they were (the foe owed its turn first), and the turn read
// as still running, so the card stayed up and, kept later, hit.
export function keepRollsLeftBehind(campaign: Campaign, skippedId: string | null): number {
  const fight = getActiveEncounter(campaign.id) ?? undefined;
  const left = listOpenPendingRolls(campaign.id).flatMap((entry) => {
    if (!entry.characterId || !toHitRollWithPlayer([entry], entry.characterId)) {
      return [];
    }
    if (entry.characterId === skippedId && toHitRollWithPlayer([entry], skippedId, fight)) {
      const marked: AttackRecord = { ...(entry.attack as AttackRecord), skipped: true };
      return [setPendingAttack(entry.id, marked) ?? entry];
    }
    return attackTurnOver(campaign.id, entry.attack as AttackRecord, entry.characterId) ? [entry] : [];
  });
  for (const pending of left) {
    if (pending.thrown) {
      landPendingRoll(campaign, pending, pending.thrown.outcome, pending.thrown.landing);
    } else {
      withdrawUnrolled(campaign, pending);
    }
  }
  return left.length;
}

function withdrawUnrolled(campaign: Campaign, pending: PendingRoll) {
  const withdrawn = withdrawPendingRoll(pending.id);
  if (!withdrawn) {
    return;
  }
  setPendingCombatNote(pending.id, lostSwingNote(pending.attack as AttackRecord));
  publishPersisted(campaign.id, "roll_pending", { pendingRoll: publicPendingRoll(withdrawn) });
  // The turn it was parked on has nothing left to wait for, and nothing
  // landed to tell: it closes untold, as a lost swing answered late does.
  if (!listPendingForTurn(pending.turnId).some((entry) => entry.status === "pending") && !resumeHumanTurn(pending.turnId)) {
    enqueueDmJob(campaign.id, () => closeStaleDmTurn(campaign.id, pending.turnId), { kind: "turn" });
  }
}
