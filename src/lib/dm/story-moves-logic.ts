// What the story shows one person doing toward another that the GM may not
// have recorded (issue 641): a flirt, a confession, an ask for the next
// step, a proposal, the answer to one, and the help or defence that wins
// regard. The claims reader reads these as one more claim kind, "bond", in
// the reads it already makes (src/lib/dm/claims-logic.ts), from the players'
// words this exchange and the narration. This module checks a bond claim
// against the refs it may name and decides what the engine does about a pair
// the GM recorded nothing for. The engine keeps its own rules: a step is only
// ever taken by romance_advance and its consent roll, so an ask nobody
// answered becomes a note the GM answers through the tool, and only a flirt
// or a kindness the character's own player declared is recorded by the
// engine itself, through relationship_beat and every limit it keeps. Pure,
// so scripts/test-story-moves.mjs loads it directly.

import { textKey } from "../language/text-logic.ts";
import { speakerMatchers } from "./speech-prose.ts";
import type { Speaker } from "./speech.ts";
import { ROMANCE_LABEL, nextRomanceStage, type RomanceStage } from "./relationship-logic.ts";

export const BOND_MOVES = ["flirt", "confess", "court", "propose", "accept", "refuse", "help", "defend"] as const;
export type BondMove = (typeof BOND_MOVES)[number];

const ROMANTIC: ReadonlySet<BondMove> = new Set(["flirt", "confess", "court", "propose", "accept", "refuse"]);
// The moves that ask for the next rung of the romance ladder.
const ASKS: ReadonlySet<BondMove> = new Set(["confess", "court", "propose"]);

export function isRomanticMove(move: BondMove): boolean {
  return ROMANTIC.has(move);
}

// One side of a bond claim as the refs resolve it: a party character played
// by a player ("pc"), a lasting companion, or a tracked NPC.
export type BondSide = { ref: string; name: string; side: "pc" | "companion" | "npc" };

// said: the party character whose player's own words hold the quote, or null
// when it is the narration's.
export type BondClaim = { kind: "bond"; move: BondMove; by: BondSide; to: BondSide; quote: string; said: string | null };

// The reader's line for the claim, listed only on a read that asks it, so
// every other read sends what it did before. At a table with romance off (or
// a line drawn at it) only the kindnesses are asked.
export function bondKindLine(romance: boolean): string {
  const moves = romance
    ? "flirt (a charming line, a compliment on their looks, a wink: flirting with them), confess (says they love or desire them), court (asks to court them or to be together as partners), propose (asks to marry them), accept (answers yes to a confess, court or propose, in words or a gesture), refuse (answers no or not yet to one), "
    : "";
  return `{"kind":"bond","move":MOVE,"by":REF,"to":REF,"quote":Q}: one person does this toward another now, by deed or in words (a quoted line counts here). MOVE is one of: ${moves}help (does them a real service at some cost or effort), defend (protects them: steps between them and a threat, shields them, or stands up for them). by and to are party or people refs; an answer is a claim of its own beside the move it answers. Never for thanks, greetings, a question about anything else, friendship or family love, a plan, or a move told as past.`;
}

// The tracked people a passage names anywhere, quoted lines included: a
// confession names its beloved inside the quote. A word of a longer name
// counts only written as a name, as namedSpeakers (claims-logic.ts) reads it.
export function namedPeople<T extends Speaker>(text: string, people: ReadonlyMap<string, T>): Map<string, T> {
  return new Map(
    [...people].filter(([, person]) => {
      const [matcher] = speakerMatchers([person]);
      return matcher ? [...text.matchAll(matcher.pattern)].some((found) => !matcher.short.has(textKey(found[0])) || /^\p{Lu}/u.test(found[0])) : false;
    }),
  );
}

// A bond claim shaped as the reply gave it, checked against the refs: by and
// to must be two different people the request listed, and the quote must be
// the narration's or a party character's player's (said). Anything else is
// dropped, so an invented claim never acts.
export function bondClaim(
  raw: { move: BondMove; by: string; to: string; quote: string },
  refs: { party: ReadonlyMap<string, string>; companions: ReadonlySet<string>; people: ReadonlyMap<string, string> },
  where: { narration: boolean; said: string | null },
): BondClaim | null {
  const side = (ref: string): BondSide | null => {
    const member = refs.party.get(ref);
    if (member !== undefined) {
      return { ref, name: member, side: refs.companions.has(ref) ? "companion" : "pc" };
    }
    const person = refs.people.get(ref);
    return person === undefined ? null : { ref, name: person, side: "npc" };
  };
  const by = side(raw.by);
  const to = side(raw.to);
  if (!by || !to || by.ref === to.ref || (!where.narration && !where.said)) {
    return null;
  }
  // What happened is the narrator's to say: a kindness quoted only from a
  // player's words is a plan until the story tells it.
  if (!where.narration && !isRomanticMove(raw.move)) {
    return null;
  }
  return { kind: "bond", move: raw.move, by, to, quote: raw.quote, said: where.said };
}

// The pair a claim is about: a player's character on one side, a companion
// or NPC on the other. Two player characters are not metered (their players
// own that), and two NPCs are not the party's.
export type Pair = { characterId: string; character: string; subject: string };

export function pairOf(claim: BondClaim): (Pair & { byCharacter: boolean }) | null {
  if (claim.by.side === "pc" && claim.to.side !== "pc") {
    return { characterId: claim.by.ref, character: claim.by.name, subject: claim.to.name, byCharacter: true };
  }
  if (claim.to.side === "pc" && claim.by.side !== "pc") {
    return { characterId: claim.to.ref, character: claim.to.name, subject: claim.by.name, byCharacter: false };
  }
  return null;
}

export function pairKey(characterId: string, subject: string): string {
  return `${characterId}|${textKey(subject)}`;
}

// What the exchange recorded for one pair.
export type PairRecord = {
  // A relationship call named them this exchange: a beat (as its subject, a
  // witness or a victim), a romance step either way, an NPC's move, an
  // ending, an act.
  recorded: boolean;
  // The step romance_advance ruled on for the character's own ask: said yes,
  // or did not (a refused consent roll, or the rules' refusal and why).
  step: { accepted: true; to: RomanceStage } | { accepted: false; why: string } | null;
  // An NPC's move made this exchange, or one still waiting on the player.
  npcMove: boolean;
};

export type PairState = {
  romance: RomanceStage;
  status: "active" | "parted" | "ended";
  // The character's player opened them to an NPC's advances.
  openToAdvances: boolean;
};

export type MoveOptions = {
  // A fight runs: relationship_beat takes only deeds and romance_advance is
  // not offered until it is over.
  fight: boolean;
  // Romance is on and the table's safety leaves room for it.
  romance: boolean;
  // The engine may record a declared flirt or kindness itself: an AI GM's
  // exchange, where the engine owns the turn.
  record: boolean;
};

// One claim on a pair: who made the move, and whether the character's own
// player declared it (their words hold it, or name the other person).
export type PairClaim = { move: BondMove; byCharacter: boolean; quote: string; declared: boolean };

export type Settlement =
  | { kind: "record"; beat: "flirt" | "helped" | "defended"; quote: string }
  // An ask made mid-fight, handed to the engine's hold for after the fight
  // (src/lib/dm/story-moves.ts holdFightStep); note is what the GM is told
  // when nothing holds it.
  | { kind: "hold"; to: RomanceStage; quote: string; note: string }
  | { kind: "note"; text: string; afterFight: boolean };

const BEAT_OF = { help: "helped", defend: "defended" } as const;
const DID = { help: "helped", defend: "stood up for" } as const;
// Weightier first: one beat a pair an exchange is the engine's to record.
const RECORD_ORDER: readonly BondMove[] = ["defend", "help", "flirt"];

function first(claims: readonly PairClaim[], moves: readonly BondMove[], byCharacter: boolean): PairClaim | undefined {
  return claims.find((claim) => claim.byCharacter === byCharacter && moves.includes(claim.move));
}

// What the engine does about one pair this exchange: nothing where the GM
// recorded it the same way, a beat the engine records where the character's
// own player declared a flirt or a kindness, and otherwise a note the GM
// reads next turn. Never a step: that is romance_advance's, with its roll.
export function settlePair(pair: Pair, claims: readonly PairClaim[], record: PairRecord, state: PairState, options: MoveOptions): Settlement[] {
  if (state.status !== "active") {
    return [];
  }
  const { character: c, subject: s } = pair;
  const kept = options.romance ? claims : claims.filter((claim) => !isRomanticMove(claim.move));
  const next = nextRomanceStage(state.romance);
  const ask = first(kept, [...ASKS], true);
  const kindness = first(kept, ["defend", "help"], true);
  if (options.fight) {
    const out: Settlement[] = [];
    if (ask && next && !record.step) {
      out.push({ kind: "hold", to: next, quote: ask.quote, note: `${c} asked ${s} for the next step (to: ${next}) mid-fight, and romance waits until the fight is over. Once it is, answer it with romance_advance for ${c} and ${s}.` });
    }
    if (kindness && !record.recorded) {
      const move = kindness.move as "help" | "defend";
      out.push({ kind: "note", afterFight: true, text: `${c} ${DID[move]} ${s} mid-fight, and relationship_beat takes only deeds until the fight is over. Once it is, record it with relationship_beat (beat ${BEAT_OF[move]}).` });
    }
    return out;
  }
  const out: Settlement[] = [];
  const answer = first(kept, ["accept", "refuse"], false);
  if (answer && record.step) {
    // The server answered and the story told it the other way.
    if (record.step.accepted && answer.move === "refuse") {
      out.push(note(`The server had ${s} say yes to ${c} (${ROMANCE_LABEL[record.step.to]} now), but the narration had ${s} turn ${c} down. They are ${ROMANCE_LABEL[record.step.to]}: play it that way from here.`));
    } else if (!record.step.accepted && answer.move === "accept") {
      out.push(note(`romance_advance did not take ${c} and ${s} further (${record.step.why}), but the narration had ${s} say yes. Nothing changed between them: play it that way from here.`));
    }
  } else if (answer && next) {
    out.push(
      note(
        answer.move === "accept"
          ? `The narration had ${s} say yes to ${c}, but no romance_advance ran, so nothing changed between them: that answer is the server's. Call romance_advance for ${c} and ${s} (to: ${next}) and narrate what it reports.`
          : `The narration had ${s} turn ${c} down, but no romance_advance ran, so nothing was recorded. If ${c} asked for the next step, call romance_advance for ${c} and ${s} (to: ${next}) and let the server answer.`,
      ),
    );
  } else if (ask && next && !record.step) {
    const told = ask.move === "propose" ? `proposed to ${s}` : ask.move === "confess" ? `told ${s} of their feelings` : `asked ${s} for more between them`;
    const skipped = ask.move === "propose" && next !== "betrothed" ? ` From ${ROMANCE_LABEL[state.romance]} that is not yet a betrothal.` : "";
    out.push(note(`${c} ${told}, and no romance_advance answered it. The next step is ${next}.${skipped} If that is what ${c} asked, it waits on ${s}'s answer: call romance_advance for ${c} and ${s} (to: ${next}) before narrating it, and narrate what the server decides.`));
  }
  const move = first(kept, [...ASKS], false);
  if (move && !record.npcMove && !record.step) {
    out.push(
      note(
        state.openToAdvances
          ? `The narration had ${s} make a romantic move toward ${c}, and nothing recorded it. An NPC's move is romance_advance with initiator npc, made once a note says ${s} is ready; ${c}'s player answers it on their screen.`
          : `The narration had ${s} make a romantic move toward ${c}, but ${c}'s player has not opened ${c} to advances, so no NPC makes that move. Nothing changed between them; let ${c}'s player lead.`,
      ),
    );
  }
  if (!record.recorded) {
    const beat = RECORD_ORDER.map((wanted) => first(kept, [wanted], true)).find(Boolean);
    if (beat) {
      const name = beat.move === "flirt" ? "flirt" : BEAT_OF[beat.move as "help" | "defend"];
      if (beat.declared && options.record) {
        out.push({ kind: "record", beat: name, quote: beat.quote });
      } else {
        out.push(
          note(
            beat.move === "flirt"
              ? `The story showed ${c} flirt with ${s}, and no relationship_beat recorded it. If ${c} did, record it with relationship_beat (beat flirt).`
              : `The story showed ${c} ${beat.move === "help" ? "help" : "stand up for"} ${s}, and no relationship_beat recorded it. If it mattered to ${s}, record it with relationship_beat (beat ${name}).`,
          ),
        );
      }
    }
  }
  return out;
}

function note(text: string): Settlement {
  return { kind: "note", text, afterFight: false };
}

// The line a beat the engine recorded leaves for the GM's next turn, from the
// result relationship_beat gave: its own note without the instruction for
// the narration it was not part of.
export function recordedNote(result: { note?: unknown; skill?: unknown; roll?: unknown; dc?: unknown; outcome?: unknown }): string {
  const said = String(result.note ?? "").replace(/\s*Narrate exactly this much and no further step\.\s*$/, "").trim();
  const rolled = typeof result.roll === "number" && typeof result.dc === "number" ? ` (${String(result.skill)} ${result.roll} against DC ${result.dc}: ${String(result.outcome)})` : "";
  return `No tool recorded it, so the server did, from the story${rolled}: ${said} Carry it into how they treat each other from here.`;
}

// The notes this module leaves, as DM-only facts (the channel the deed note
// uses, src/lib/dm/deed-claims.ts): one a pair, by subject. A note lasts one
// exchange, or until the fight is over for one that waits on it.
export const MOVE_NOTE = "Story move";
export const FIGHT_MOVE_NOTE = "Story move after the fight";

export function moveNoteSubject(pair: Pick<Pair, "character" | "subject">, afterFight: boolean): string {
  return `${afterFight ? FIGHT_MOVE_NOTE : MOVE_NOTE}: ${pair.character} and ${pair.subject}`;
}

// How many pairs one exchange may leave notes for: the facts block holds six
// lines a category, and the party's own facts share it.
export const MOVE_NOTES_PER_EXCHANGE = 2;
