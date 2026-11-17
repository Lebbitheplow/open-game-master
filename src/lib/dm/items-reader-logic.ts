// The items reader's pure half (docs/specs/ogm-domain-owners.md, slice 3):
// the one model that reads words about things. At the end of a turn it reads
// what the heroes said, what the stage decided and what the narration told,
// and names every thing that changed hands, fell or was lost. It decides
// nothing about rules and writes nothing: the items owner
// (src/lib/owners/items.ts) checks each move and makes it, or refuses it.
//
// It never makes a thing: a thing new to the world (a fish caught, loot, a
// reward) is the master's grant_item, a rules decision. What it reads is
// movement between those who hold things, the ground, and loss.

export type ItemMove = { thing: string; from: string; to: string };

export type ItemPerson = { name: string; hero: boolean; carries: string[] };

// The ground of the place the party stands, as a holder.
export const GROUND = "ground";

export const ITEMS_READER_SYSTEM = [
  "You keep the record of who holds which thing in a tabletop role-playing game. You read one turn: what the players' heroes said and did, what the characters on stage did, and how the narrator told it. You name every thing whose holder changed in this turn, as the story tells it ended.",
  "A move is {thing, from, to}. from is the person who held it, or \"ground\" for a thing picked up from where it lay. to is the person who now holds it, \"ground\" for a thing put down, dropped or left lying here, or \"\" for a thing gone for good (eaten, drunk up, thrown into the sea, burnt, broken beyond use).",
  "Use the people's names exactly as listed and the thing's words as listed with its holder. One move per thing; a thing split or shared among several people is one move for each piece that changed hands.",
  "Only what happened: a thing offered and refused, held out and kept, promised, asked for or merely shown did not move. A theft or a grab that failed did not move. A thing handed over and given back in the same turn is two moves.",
  "Drinking from a skin, bottle or barrel, or taking some out of a sack or a box, moves nothing: the container stays with its holder. Only the whole thing gone (the last of it eaten or drunk, the thing itself thrown away, burnt or broken) is a loss; when unsure whether all of it is gone, it is not.",
  "Never a thing that was not held by someone listed or lying on the ground listed: a thing caught, found or made for the first time is not yours to record.",
  "Already recorded this turn means already done: do not repeat it.",
  'Answer with ONE JSON object and nothing else: {"moves": [{"thing": "...", "from": "...", "to": "..."}]}. No move: {"moves": []}.',
].join("\n");

// The line a loss removes: one whose words the move names whole. A move
// naming fewer words than the line (the biscuits, of a sack of biscuits) or
// several lines at once removes nothing.
export function wholeThingNamed(things: readonly string[], words: string, keyOf: (text: string) => string): string | null {
  const key = keyOf(words);
  if (!key) {
    return null;
  }
  const fits = things.filter((thing) => {
    const held = keyOf(thing);
    return Boolean(held) && (held === key || key.includes(held));
  });
  return fits.length === 1 ? fits[0] : (fits.find((thing) => keyOf(thing) === key) ?? null);
}

export function renderItemsReaderPrompt(input: {
  people: readonly ItemPerson[];
  ground: readonly string[];
  heroLines: readonly { name: string; text: string }[];
  narration: string;
  stage: string;
  recorded: readonly string[];
}): string {
  return [
    "Who is here and what they hold:",
    ...input.people.map((person) => `- ${person.name}${person.hero ? " (hero)" : ""}: ${person.carries.join("; ") || "nothing"}`),
    `On the ground here: ${input.ground.join("; ") || "nothing"}`,
    input.heroLines.length ? `What the heroes said and did this turn, in their own words:\n${input.heroLines.map((line) => `- ${line.name}: ${line.text}`).join("\n")}` : "",
    input.stage ? `What the characters on stage did (decided by the referee):\n${input.stage}` : "",
    `How the narrator told the turn:\n${input.narration}`,
    input.recorded.length ? `Already recorded this turn:\n${input.recorded.map((line) => `- ${line}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseItemMoves(text: string): { ok: true; moves: ItemMove[] } | { ok: false; error: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { ok: false, error: "no JSON object" };
  }
  let record: unknown;
  try {
    record = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false, error: "not JSON" };
  }
  const list = record && typeof record === "object" ? (record as Record<string, unknown>).moves : null;
  if (!Array.isArray(list)) {
    return { ok: false, error: "no moves list" };
  }
  const word = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, 120) : "");
  const moves = list
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({ thing: word(entry.thing), from: word(entry.from), to: word(entry.to) }))
    .filter((move) => move.thing)
    .slice(0, 12);
  return { ok: true, moves };
}

export type ItemPlan =
  | { kind: "hand"; thing: string; from: string; to: string }
  | { kind: "drop"; thing: string; from: string }
  | { kind: "pickup"; thing: string; to: string }
  | { kind: "lose"; thing: string; from: string }
  | { kind: "refused"; why: string };

const isGround = (holder: string, keyOf: (word: string) => string) => ["ground", "terra", "a terra", "per terra", "suolo"].includes(keyOf(holder));

// What the owner is asked to do with one move, or why nothing is asked:
// only people present take part, and nothing is made.
export function planItemMove(move: ItemMove, people: readonly ItemPerson[], keyOf: (word: string) => string): ItemPlan {
  const person = (holder: string) => people.find((entry) => keyOf(entry.name) === keyOf(holder))?.name ?? null;
  const fromGround = isGround(move.from, keyOf);
  const toGround = isGround(move.to, keyOf);
  if (!move.from) {
    return { kind: "refused", why: "nothing is made by the record: a new thing is the master's grant_item" };
  }
  if (fromGround) {
    const to = person(move.to);
    return to ? { kind: "pickup", thing: move.thing, to } : { kind: "refused", why: `${move.to || "nobody"} is not here to pick it up` };
  }
  const from = person(move.from);
  if (!from) {
    return { kind: "refused", why: `${move.from} is not here` };
  }
  if (toGround) {
    return { kind: "drop", thing: move.thing, from };
  }
  if (!move.to) {
    return { kind: "lose", thing: move.thing, from };
  }
  const to = person(move.to);
  if (!to) {
    return { kind: "refused", why: `${move.to} is not here` };
  }
  if (to === from) {
    return { kind: "refused", why: "it stays with the one who holds it" };
  }
  return { kind: "hand", thing: move.thing, from, to };
}
