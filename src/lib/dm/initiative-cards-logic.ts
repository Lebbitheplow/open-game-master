// The initiative roll cards an AI's fight sends its real-dice seats when it
// opens (src/lib/dm/initiative-ask.ts, play-test 2026-11-07 B3), as the
// answer to the call that opened the fight carries them.
//
// The answer is written when the fight opens, and the turn then waits on the
// cards as it waits on a request_roll's. A card's total cannot be a second
// answer to the same call (a backend refuses two answers to one call id), so
// it is written into that first answer when the turn resumes (turn.ts
// resumeDmTurn), with the note the last one brings once the order locks.
//
// Pure and alias-import-free so scripts/test-real-dice-initiative.mjs can
// load it.

export type OpeningAsk = {
  // "Name total" for each roll the server threw.
  rolled: string[];
  // Names, and ids in the same order, of the characters holding a card.
  waiting: string[];
  waitingIds: string[];
  // The engine's note when the last roll locked the order.
  combat: string | null;
};

type Card = { characterId: string; name: string; waiting?: boolean; [key: string]: unknown };

function cardsOf(parsed: Record<string, unknown>): Card[] | null {
  const cards = parsed.initiativeCards;
  return Array.isArray(cards) ? (cards as Card[]) : null;
}

// The opening call's answer with what the ask did: the totals it threw, the
// cards it sent and what the model does about them. The answer still told
// the model to request_roll for the seats that now hold a card, which would
// only put a second card in front of them.
export function withInitiativeCards(result: Record<string, unknown>, ask: OpeningAsk): Record<string, unknown> {
  if (!ask.rolled.length && !ask.waiting.length) {
    return result;
  }
  const initiative = [typeof result.initiative === "string" ? result.initiative : "", ...ask.rolled].filter(Boolean).join(", ");
  const out: Record<string, unknown> = { ...result, ...(initiative ? { initiative } : {}) };
  if (!ask.waiting.length) {
    return ask.combat ? { ...out, next: ask.combat } : out;
  }
  const one = ask.waiting.length === 1;
  const names = ask.waiting.length > 1 ? `${ask.waiting.slice(0, -1).join(", ")} and ${ask.waiting.at(-1)}` : ask.waiting[0];
  return {
    ...out,
    initiativeCards: ask.waiting.map((name, index) => ({ characterId: ask.waitingIds[index], name, waiting: true })),
    next: `${names} ${one ? "rolls" : "roll"} their own dice: the server sent ${one ? "an initiative roll card" : "each an initiative roll card"}, and this turn waits for ${one ? "it" : "them"}. Do not call request_roll for ${one ? "them" : "any of them"}. Each total arrives here under initiativeCards, and combat begins once every initiative is in.`,
  };
}

// Whether an answer holds this character's card still waiting on its roll.
export function holdsInitiativeCard(content: unknown, characterId: string): boolean {
  if (typeof content !== "string") {
    return false;
  }
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return Boolean(cardsOf(parsed)?.some((card) => card.characterId === characterId && card.waiting === true));
  } catch {
    return false;
  }
}

// The answer with this character's card filled in by its roll. Once the last
// card is in, the answer no longer says the turn waits: it carries the note
// the order's locking brought, or says every initiative is in.
export function fillInitiativeCard(content: string, characterId: string, answer: Record<string, unknown>): string {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const cards = (cardsOf(parsed) ?? []).map((card) =>
    card.characterId === characterId && card.waiting === true ? { characterId: card.characterId, name: card.name, ...answer } : card,
  );
  const stillWaiting = cards.some((card) => card.waiting === true);
  const combat = typeof answer.combat === "string" ? answer.combat : null;
  return JSON.stringify({
    ...parsed,
    initiativeCards: cards,
    ...(combat ? { next: combat } : !stillWaiting ? { next: "Every initiative card is in." } : {}),
  });
}
