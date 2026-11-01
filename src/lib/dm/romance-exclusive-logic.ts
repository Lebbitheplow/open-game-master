// Romance is exclusive by default (issue 642), the pure half: who is spoken
// for, whether a new romance may start beside one, and who minds a flirt
// with someone else. No DB access and no "@/" imports, so
// scripts/test-romance-exclusive.mjs loads it directly; the rim is
// src/lib/dm/romance-exclusive.ts.
//
// Before this nothing in the engine had a view on it: an NPC asked a married
// character to court them, a second romance started beside a marriage, and
// flirting with a guard in front of a partner moved nothing. Most tables
// expect monogamy, so that is the default; a character marked open to more
// than one partner (the "Drawn to" trait, src/lib/attraction.ts) is the
// exception, and only when everyone in it is.

import { romanceIndex, type RelationshipStatus, type RomanceStage } from "./relationship-logic.ts";
import type { DeedSeverity } from "./companion-values-logic.ts";

// From this rung two people are partners, and spoken for: the ladder's
// "partners", then betrothed and married. A courtship is still a question
// being asked, so someone courting may be courted by another (issue 501's
// suitor rules read it the same way); once they are together, nobody new.
export const SPOKEN_FOR: RomanceStage = "together";

export function spokenFor(bond: { romance: RomanceStage; status: RelationshipStatus }): boolean {
  return bond.status !== "ended" && romanceIndex(bond.romance) >= romanceIndex(SPOKEN_FOR);
}

// One person in it: their name and whether they are open to more than one
// partner.
export type Lover = { name: string; open: boolean };

// A romantic move between two people, and who each is already spoken for
// with (never each other).
export type RomanceParties = {
  a: Lover;
  b: Lover;
  aPartners: readonly Lover[];
  bPartners: readonly Lover[];
};

// Why a romance between a and b may not start or go further, or null. It
// may when nobody in it is spoken for elsewhere, or when every person
// involved is open: both of them and each partner either already has. The
// reason names the first partnership in the way, in the words a GM or a
// player reads: "Tamsin is with Sir Hollis; neither is open to another
// partner."
export function exclusiveProblem(parties: RomanceParties): string | null {
  const ties = [
    ...parties.aPartners.map((partner) => ({ taken: parties.a, partner, other: parties.b })),
    ...parties.bPartners.map((partner) => ({ taken: parties.b, partner, other: parties.a })),
  ];
  for (const { taken, partner, other } of ties) {
    if (!taken.open && !partner.open) {
      return `${taken.name} is with ${partner.name}; neither is open to another partner.`;
    }
    if (!taken.open) {
      return `${taken.name} is with ${partner.name} and is not open to another partner.`;
    }
    if (!partner.open) {
      return `${taken.name} is with ${partner.name}, who is not open to another partner.`;
    }
    if (!other.open) {
      return `${taken.name} is with ${partner.name}, and ${other.name} is not open to a romance beside theirs.`;
    }
  }
  return null;
}

// The whole refusal a GM reads: why, and what to play instead.
export function exclusiveRefusal(problem: string): string {
  return `${problem} Romance here is exclusive unless everyone in it is open to more than one partner, so no new romance starts beside theirs. Play the moment without a romantic step.`;
}

// The seam the claims reader stands on (issue 641): would a romantic move by
// `mover` toward someone who is not their partner be unfaithful, and which
// partners would mind. A partner minds unless both of them are open.
export function partnersWhoMind<P extends Lover>(mover: Lover, partners: readonly P[]): P[] {
  return partners.filter((partner) => !(mover.open && partner.open));
}

// How much it weighs with the partner who saw it: serious between partners
// and beyond, and minor for anything younger, should the rung that binds
// ever move below them.
export function unfaithfulSeverity(stage: RomanceStage): DeedSeverity {
  return romanceIndex(stage) >= romanceIndex("together") ? "serious" : "minor";
}

// One brief GAME STATE line while anyone at the table is spoken for, so the
// GM neither plays an NPC courting them nor offers a second romance.
// `pairs` are the exclusive ones; `openPairs` those where both are open.
export function exclusiveLine(pairs: ReadonlyArray<{ character: string; partner: string }>, openPairs: ReadonlyArray<{ character: string; partner: string }> = []): string {
  const lines: string[] = [];
  if (pairs.length) {
    const who = pairs.map((pair) => `${pair.character} (with ${pair.partner})`).join(", ");
    lines.push(
      `Spoken for, and exclusive: ${who}. Nobody new courts them or is courted by them, and a flirt with anyone else in front of their partner is a deed that partner judges when relationship_beat records the flirt.`,
    );
  }
  if (openPairs.length) {
    lines.push(`Open to more than one partner, both of them: ${openPairs.map((pair) => `${pair.character} and ${pair.partner}`).join("; ")}.`);
  }
  return lines.join(" ");
}
