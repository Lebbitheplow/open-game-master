// The one door a roll goes on record through (issue #915).
//
// Once a roll is thrown, four things have to happen: it is stored, it is sent
// to the table, it joins the cards of the turn it was made in, and it says
// who rolled it and how. No function did all four, so each site did them by
// hand and some skipped one. The usual miss was the turn: a site read it with
// getDmTurn, which hands back a copy, pushed the roll onto the copy and saved
// nothing, or was handed no turn at all. The roll was stored and thrown on
// the dice stage, and the chronicle, which draws its cards from the turn,
// never showed it (#665, Rally in #914, Turn the Tide, Balm of Peace).
//
// A roll has exactly one home:
//
// - the turn it was made in. Inside a GM call that is the call's own live
//   turn (src/lib/dm/held-call.ts heldCallTurn), whatever copy of it the site
//   holds or does not: the turn rides the call, so a site deep in the engine
//   cannot lose it, and a call that parks takes the roll back with the rest.
//   Outside a call nothing holds the turn in hand, so the roll is written to
//   the turn's stored row with the roll itself, and a copy saved later keeps
//   it (src/lib/db/dm-turns.ts saveDmTurn);
// - or the line the site posts for it (`home: "line"`), which carries the
//   card on that message's rollIds. Such a roll joins no turn, so the card is
//   drawn once.
//
// One kind of roll has neither and stands apart (`home: "apart"`): a
// storyteller's secret, read from the roll list by the two seats that may.
//
// A roll made where no turn is open (the dice tray, the GM's roll table, a
// player's hit dice from their sheet) is handed none and is on none, as
// before the door: it is stored, sent and in the roll log. Whether such a
// roll should have a home is an open question on issue #915.
//
// A new site that stores a roll calls recordRoll rather than insertRoll, a
// publish of "roll_result" and a push onto rollIds:
// scripts/test-roll-record-sites.mjs walks the source for those three and
// fails on any outside this module, the two stores it writes through and the
// one migration that files old turns (src/lib/db/answered-cards-backfill.ts).
// No other file sends "roll_result": a roll sent a second time (a secret
// that comes out, revealRolls below) leaves here too.
//
// The door also keeps one mark (issue #1073): the rolls an AI GM asked for
// with request_roll (`asked`). It goes on the turn's own list in the step
// that joins the roll to the turn, and the gate that holds the model's
// numbers takes a total from that list and from nowhere else
// (src/lib/dm/ai-gate.ts). A roll no site marked pays for nothing, so a new
// site that throws dice on an AI's turn needs to do nothing to stay out of
// the gate's way. Before, every site's dice had to be stamped spent after
// the fact, and a site that was missed paid for a number the model made up.
//
// It imports the roll store, the turn store and the event stream, and reaches
// the held call through globalThis as the roll store does: the clock's paths
// card their dice through roll-card.ts, which must stay free of the engine's
// import cycles.

import { allocateSeq } from "@/lib/db/campaigns";
import { getDatabase } from "@/lib/db/core";
import { joinStoredTurn, type DmTurn } from "@/lib/db/dm-turns";
import { insertRoll, revealRollRow, type RollInsert, type RollKind, type StoredRoll } from "@/lib/db/rolls";
import { publishWithSeq } from "@/lib/events";
import { makesWords, PHYSICAL, rollSentence } from "@/lib/roll-words";

// How the dice came in: thrown by the server, or rolled by the player on
// their own dice and entered (src/lib/dm/pending-roll-land.ts RollLanding).
export type RollLanded = { physical: boolean; source: "digital" | "physical" };

declare global {
  // src/lib/dm/held-call.ts, registered there: the live turn of the GM call
  // now running, and how the decided roll a record is about to store came in.
  var __odmHeldCallTurn: (() => DmTurn | null) | undefined;
  var __odmTakenLanding: ((characterId: string | null, kind: RollKind) => RollLanded | null) | undefined;
}

export type RollRecord = RollInsert & {
  // The turn the site holds, or its id where the site was handed only that.
  // Inside a GM call neither is needed, and a copy of the call's turn is not
  // used.
  turn?: DmTurn | null;
  turnId?: string | null;
  // "line": the site posts a line of its own that carries the card.
  // "apart": on no turn and no line. A storyteller's secret (roll-card.ts
  // secretRoll): a turn's cards are named in the message every seat is sent,
  // and that such a roll was made at all would give it away
  // (src/lib/dm/viewer.ts rollAccessFor).
  home?: "turn" | "line" | "apart";
  // Null for dice the site threw where it stands. Left out, it is read off
  // the held call: dice the player entered for this character and kind.
  landing?: RollLanded | null;
  // False for a roll no seat is sent as it is made (roll-card.ts dmRoll).
  send?: boolean;
  // The roll card these dice answer (pending-roll-land.ts): each screen takes
  // the card down as it is told of the roll.
  answers?: string | null;
  // An AI GM asked for this roll with request_roll. Said by two sites and no
  // other (scripts/test-roll-record-sites.mjs): src/lib/dm/invoke-roll.ts,
  // where the call is thrown on the server's dice, and
  // src/lib/dm/pending-roll-land.ts, where the card it dealt lands. A roll
  // with no turn to join carries no mark.
  asked?: boolean;
};

export function recordRoll(record: RollRecord): StoredRoll {
  const { turn, turnId, home, landing: said, send, answers, asked, ...insert } = record;
  const landing = said === undefined ? (globalThis.__odmTakenLanding?.(insert.characterId ?? null, insert.kind) ?? null) : said;
  // Dice rolled at the table are on record as the player's own, as a roll
  // card's are (pending-roll-land.ts): a field says so (roll-parts.ts
  // rollPhysical), and the words say it to whoever reads the card.
  const parts = landing?.physical && insert.parts ? { ...insert.parts, physical: true as const } : landing?.physical && insert.parts === undefined ? { physical: true as const } : insert.parts;
  // A roll whose parts make its words (issue #1064, src/lib/roll-words.ts)
  // is handed no sentence: the one stored is built here from the parts, in
  // English, so the two cannot disagree. Any other roll keeps the sentence
  // its site wrote, with the mark for the player's own dice after it.
  // A roll handed neither is refused (roll-words.ts rollSentence).
  const words = rollSentence({ detail: insert.detail, parts });
  const detail = landing?.physical && !makesWords(parts) ? `${words || insert.kind} ${PHYSICAL}` : words;
  const stored = { ...insert, detail, ...(parts === undefined ? {} : { parts }) } as RollInsert;
  // An id handed with a turn that is not that turn's own wins: the roll joins
  // one turn, never the two.
  const id = turnId ?? turn?.id ?? null;
  const target = home === "line" || home === "apart" ? null : turnFor(turn && turn.id === id ? turn : null, id);
  let roll: StoredRoll;
  if (target?.storedId) {
    // The roll, its place on the turn and its mark stand or fall together.
    const storedId = target.storedId;
    roll = getDatabase().transaction(() => {
      const made = insertRoll(stored);
      joinStoredTurn(storedId, made.id, asked === true);
      return made;
    })();
  } else {
    roll = insertRoll(stored);
  }
  if (target?.live && !target.live.rollIds.includes(roll.id)) {
    target.live.rollIds.push(roll.id);
  }
  if (asked === true && target?.live && !target.live.askedRollIds.includes(roll.id)) {
    target.live.askedRollIds.push(roll.id);
  }
  if (send !== false) {
    // Sent as it was made: told "digital", the stage threw a die on screen
    // that the player had already rolled.
    announce(roll, { source: landing?.source ?? "digital", ...(answers ? { pendingRollId: answers } : {}) });
  }
  return roll;
}

// The one place a roll is sent from. It is handed over whole: the event
// stream takes the number out for the seats not owed it, in the log and on
// the way to each seat (src/lib/table-delivery.ts), so no site redacts.
function announce(roll: StoredRoll, how: { source: "digital" | "physical"; pendingRollId?: string; revealed?: true }) {
  publishWithSeq(roll.campaignId, allocateSeq(roll.campaignId), "roll_result", { roll, ...how });
}

// A hidden roll comes out (a pact's plan goes, a secret action is caught):
// each roll behind the secret turns public and every seat is sent it whole,
// number and all. Sent again, not recorded again: it keeps the home it had.
export function revealRolls(rollIds: readonly string[]) {
  for (const id of rollIds) {
    const roll = id ? revealRollRow(id) : null;
    if (roll) {
      announce(roll, { source: "digital", revealed: true });
    }
  }
}

// Where a roll made on a turn joins it: the object in hand that will be
// saved (`live`), and the stored row (`storedId`) where no call holds one.
function turnFor(handed: DmTurn | null, handedId: string | null): { live: DmTurn | null; storedId: string | null } | null {
  const held = globalThis.__odmHeldCallTurn?.() ?? null;
  if (held && (!handedId || handedId === held.id)) {
    return { live: held, storedId: null };
  }
  // Another turn than the call's own (a stand-in turn opened for the engine's
  // own rolls, dm-turns.ts openStandInTurn), or no call at all.
  return handedId ? { live: handed, storedId: handedId } : null;
}
