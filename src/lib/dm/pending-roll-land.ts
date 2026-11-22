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
import { getDatabase } from "@/lib/db/core";
import { kindAndRoller, type StoredRoll } from "@/lib/db/rolls";
import { cardRoller } from "@/lib/dm/roll-card";
import { recordRoll } from "@/lib/dm/roll-record";
import { getSheetById } from "@/lib/db/sheets";
import { settleAttackDie } from "@/lib/dm/forced-save";
import { rollsCanWait } from "@/lib/dm/after-roll";
import { afterToHitLanded, runQueuedParts } from "@/lib/dm/pc-attack-parts";
import { moteAfterRoll } from "@/lib/dm/authored-mote";
import { rollExpression, type RollResult } from "@/lib/dice";
import { heroRollTag } from "@/lib/dice-script-logic";
import { throwDamage } from "@/lib/dm/attack-damage-dice";
import { endTurnOnLanding, recordInitiativeRoll, settleTurn, turnHolder } from "@/lib/dm/encounter-tools";
import { applyInitiativeRefills } from "@/lib/dm/feature-hooks";
import { applyPendingDamageRoll, serverLandsDamageRoll } from "@/lib/dm/enemy-damage";
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
import { holdDeliveries, publishPersisted } from "@/lib/events";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";

// What a landed roll leaves: its record, or, for dice whose call waits again
// on another roll, the word that they are kept (held-call.ts runHeldAgain).
// An answer to the ask before an opportunity attack (opportunity-ask.ts)
// lands no roll of its own: it says so.
export type Landed = StoredRoll | { waiting: string } | { answered: string };

const KEPT = "The dice are in. The call they belong to waits on another roll, and records them when it finishes.";
const ANSWERED = "Your answer is in, and the walk goes on.";

// What a route answers the one who landed a roll.
export function landedBody(landed: Landed): { roll: StoredRoll } | { waiting: string } | { answered: string } {
  return "waiting" in landed || "answered" in landed ? landed : { roll: landed };
}

export type RollLanding = {
  status: "submitted" | "fallback";
  // "(physical)" marks a roll made entirely with real dice.
  physical: boolean;
  source: "digital" | "physical";
};

// A roll that held its whole call (src/lib/dm/held-call.ts): the call runs
// again with the roll in hand, under the turn it was made on, and records the
// roll itself as its first run would have. At a table a person runs, the line
// the landing posts lists what the run left on the turn, and the player's
// own roll with it when the run put that on a short turn of its own (a
// zone's save), which nothing else draws. A roll a line of its own carries
// (a death save, an opportunity swing: roll-record.ts `home: "line"`) stays
// on that line alone (persons-record.ts).
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
  return waits ? { waiting: KEPT } : (roll ?? (pending.carry?.ask ? { answered: ANSWERED } : null));
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
  // A card already landed stores nothing and spends nothing: asked before a
  // held die is settled on its d20 below, and before the roll goes on
  // record, since the door stores it, sends it and adds it to the turn at
  // once.
  if (getPendingRoll(pending.id)?.status !== "pending") {
    return null;
  }
  const campaignId = campaign.id;
  // A parked to-hit roll takes a held Bardic Inspiration die the way the
  // digital one does: only on a miss it turns into a hit (forced-save.ts).
  // A player whose rolls can wait spends it themselves, after the roll
  // (after-roll.ts): the die is theirs, and stays held if they keep the roll.
  const attacker = pending.kind === "attack" && pending.attack && pending.characterId ? getSheetById(pending.characterId) : null;
  const decides = Boolean(pending.thrown) || rollsCanWait(attacker);
  const outcome = attacker && pending.attack && !decides ? settleAttackDie(campaignId, attacker, thrown, parkedTargetAc(campaignId, pending.attack)) : thrown;
  if (outcome !== thrown) {
    // The server threw that die: the roll is no longer the player's alone.
    landing = { ...landing, physical: false };
  }
  // The turn as the card left it, read before the roll joins it.
  const parkedOn = getDmTurn(pending.turnId);
  // A person's turn has no narration to carry the dice entered for it: they
  // and what they did go to the chronicle now (issue 713), on a line that
  // lists what the turn gains from here, the roll first.
  const record = parkedOn?.actor === "human_dm" ? startPersonsRecord(campaign, parkedOn) : null;
  // On record through the one door (roll-record.ts): the roll joins the turn
  // the card was dealt on as it lands, ahead of the dice its landing throws.
  // It used to wait for the turn to resume, and a turn that never resumed
  // with a model (a person's call at the console, a turn closed untold) left
  // it on no turn. On a turn is not yet in the chronicle: a console call at
  // a table the AI runs posts no line and a turn closed untold writes no
  // message, for this roll as for every other of theirs.
  // The roll goes on record and its card is answered together or not at
  // all: a roll on record with its card still open could be landed again.
  // The roll's event waits until both stand, so no screen is told of a
  // roll, and takes its card down, for a landing that was taken back.
  const deliveries = holdDeliveries();
  let roll: StoredRoll;
  try {
    roll = getDatabase().transaction(() => {
      const made = recordRoll({
        campaignId,
        characterId: pending.characterId,
        requestedBy: "player",
        // A parked pc_attack roll (to-hit or damage) is the PC's own; any
        // other parked roll is a roll tool's free text about its sheet,
        // whose attack or damage roll is that character's too.
        ...kindAndRoller(
          pending.kind,
          pending.attack && pending.characterId ? { kind: "sheet", id: pending.characterId, name: pending.attack.attacker } : null,
          cardRoller(pending.characterId ? getSheetById(pending.characterId) : null),
        ),
        detail: pending.detail,
        advantage: pending.advantage,
        dc: pending.dc,
        result: outcome,
        // A roll the DM asked for behind the screen lands behind it.
        visibility: pending.visibility,
        turnId: pending.turnId,
        // How the dice came in. The door writes "(physical)" for a roll
        // made entirely with real dice: once any face was drawn by the
        // server the label would overclaim, so a mixed or fully digital
        // submission keeps the plain detail. Real dice already rolled on a
        // real table are sent as such, and the overlay animates only rolls
        // where every face was drawn digitally (a mixed submission still
        // happened at the table).
        landing,
        answers: pending.id,
        // The card says whether an AI GM's request_roll dealt it
        // (invoke-roll.ts): nothing here works that out from the card's
        // shape or its turn. A total the server lands itself, below, leaves
        // nothing for the GM to send.
        asked: pending.carry?.asked === true && !(pending.kind === "damage" && pending.targetEnemyId && serverLandsDamageRoll(campaignId, pending.targetEnemyId)),
      });
      resolvePendingRoll(pending.id, landing.status, made.id);
      return made;
    })();
  } catch (error) {
    deliveries.release(false);
    throw error;
  }
  deliveries.release(true);

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
    postPersonsRecord(campaign, after, record);
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
  return left.length + (skippedId ? settleSkippedStages(campaign, skippedId, fight) : 0);
}

// The rest of the skipped turn's cards (issue 931's kin). A hit's damage card:
// the hit landed, so its damage is owed; left on the card it landed turns
// later and was told as a new blow. It is thrown now as the "Roll digitally"
// fallback throws it (pending-rolls route: the hit's own damage feats ride
// it). A contest or check its action held on the player's d20 (held-call.ts
// ownTurn): never made, so the card goes and nothing it was for happens.
function settleSkippedStages(campaign: Campaign, skippedId: string, fight: { createdAt: string } | undefined): number {
  const mine = listOpenPendingRolls(campaign.id).filter((entry) => entry.characterId === skippedId && (!fight || entry.createdAt >= fight.createdAt));
  let settled = 0;
  for (const pending of mine) {
    if (pending.kind === "damage" && pending.attack && !pending.thrown) {
      const ask = (pending.attack as AttackRecord).damage ?? null;
      const outcome = ask ? throwDamage(ask, pending.attack.attacker ?? "", []) : rollExpression(pending.expression, undefined, { purpose: heroRollTag("damage") });
      if (landPendingRoll(campaign, pending, outcome, { status: "fallback", physical: false, source: "digital" })) {
        settled += 1;
      }
    } else if (pending.carry?.call?.ownTurn) {
      const withdrawn = withdrawPendingRoll(pending.id);
      if (!withdrawn) {
        continue;
      }
      settled += 1;
      setPendingCombatNote(pending.id, `${pending.detail} was still with its player when their turn ended, so what it was for never happened: nothing was rolled, spent or done. Narrate the moment passing.`);
      publishPersisted(campaign.id, "roll_pending", { pendingRoll: publicPendingRoll(withdrawn) });
      if (!listPendingForTurn(pending.turnId).some((entry) => entry.status === "pending") && !resumeHumanTurn(pending.turnId)) {
        enqueueDmJob(campaign.id, () => closeStaleDmTurn(campaign.id, pending.turnId), { kind: "turn" });
      }
    }
  }
  return settled;
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
