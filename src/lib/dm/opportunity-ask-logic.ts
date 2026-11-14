// The ask before a character's opportunity attack (src/lib/dm/opportunity-ask.ts),
// in its pure half: what the card carries and the words it and the table read.
// No "@/" imports, so the card on the table's page draws from this too.
//
// SRD 5.1, Opportunity Attacks: "You CAN make an opportunity attack when a
// hostile creature that you can see moves out of your reach ... you use your
// reaction". The reaction is the one Shield, Hellish Rebuke or Uncanny Dodge
// would spend, so it is the player's to keep.

// What draws the swing: leaving the reach (the rule itself), entering a
// polearm's (Polearm Master), moving within it (Hold the Line), or moving away
// from a Manifest Echo's side.
export type OpportunityTrigger = "leaves" | "enters" | "within" | "echo";

// The card's question, carried on the parked roll (dm-turns.ts PendingCarry).
// `walker` is the walker's name as the table sees it, `weapon` the one the
// swing would use. `deadline` only while another player is at the table
// (after-roll-timer.ts afterRollDeadline). `strike` and `timedOut` are the
// answer, written as the card lands.
export type OpportunityAsk = {
  walkerId: string;
  walker: string;
  weapon: string;
  trigger: OpportunityTrigger;
  deadline?: string;
  strike?: boolean;
  timedOut?: boolean;
};

// The answer, as the walk's call reads it when it runs again (held-call.ts).
export type OpportunityChoice = { walkerId: string; strike: boolean; timedOut?: boolean };

const MOVES: Record<OpportunityTrigger, (whose: string) => string> = {
  leaves: (whose) => `is moving out of ${whose} reach`,
  enters: (whose) => `is moving into ${whose} reach`,
  within: (whose) => `is moving within ${whose} reach`,
  echo: (whose) => `is moving away from ${whose} echo`,
};

// The player's own card: "The Goblin is moving out of your reach. Take your
// opportunity attack with your Longsword? It uses your reaction."
export function askLine(ask: Pick<OpportunityAsk, "walker" | "weapon" | "trigger">): string {
  return `${ask.walker} ${MOVES[ask.trigger]("your")}. Take your opportunity attack with your ${ask.weapon}? It uses your reaction.`;
}

// What everyone else at the table reads while the player decides.
export function waitLine(ask: Pick<OpportunityAsk, "walker" | "trigger">, name: string): string {
  return `${ask.walker} ${MOVES[ask.trigger](`${name}'s`)}. ${name} is deciding whether to take an opportunity attack.`;
}

// The roll card's own detail, for a screen that draws it as any roll.
export function askDetail(ask: Pick<OpportunityAsk, "walker" | "trigger">, name: string): string {
  return `Opportunity attack on ${ask.walker}? (${name})`;
}

// The table note for a swing let go: the GM narrates it, and nobody asks
// later why the reaction is still there.
export function letGoNote(name: string, walker: string): string {
  return `${name} lets ${walker} go: no opportunity attack, and the reaction is kept.`;
}

// The swing the clock took, said as such.
export function timedOutNote(name: string, note: string): string {
  return `${name}'s player did not answer in time, so the opportunity attack was taken. ${note}`;
}
