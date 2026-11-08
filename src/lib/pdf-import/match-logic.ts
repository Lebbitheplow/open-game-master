import { compareNames } from "../language/text-logic.ts";
import { singular, srdKey } from "./srd-names-logic.ts";

// The creatures a book's name could not settle, set beside their closest
// SRD 5.1 guesses for the GM to confirm (the review's "Match to SRD 5.1").
// Without a model the guess is scored from what the book printed: shared
// words in the name, the type, the size, the challenge, and the SRD
// creatures the book's own words mention. With a model its pick is the
// suggestion. Either way the GM confirms every one, and a guess is never
// played without that.

export type MatchOption = { name: string; detail: string };

// What a choice changes: a creature record of the book's, a name in a
// prepared fight, or the stat block a person fights with.
export type MatchTarget = { record: string; creature?: string; statBlock?: boolean };

export type MatchAsk = {
  key: string;
  // As the book has it.
  name: string;
  // What the book says it is, in a few words.
  about: string;
  pages: number[];
  // The book printed numbers of its own (a conversion or its own block)
  // that can be kept instead.
  own: boolean;
  // Closest first.
  options: MatchOption[];
  // What the import suggests, and why: a name the SRD shares, the model's
  // pick, the closest guess, or nothing close.
  suggested: string | null;
  how: "name" | "model" | "guess" | "none";
  // The GM's choice, which starts at the suggestion. Null keeps the book's
  // own numbers (or, with none, leaves the fight to be given one).
  current: string | null;
  confirmed: boolean;
  targets: MatchTarget[];
};

export type GuessSubject = { name: string; type: string; size: string; cr: number | null; text: string };
export type GuessCandidate = { name: string; type?: string; size?: string; cr?: number | null };

// Words that say how big or old a thing is, not what it is: "Giant" shares
// little between a Giant Rat and a Giant Rhagodessa.
const GENERIC = new Set(["giant", "young", "adult", "ancient", "elder", "greater", "lesser", "swarm", "dire", "great", "huge", "small", "little", "big", "wild", "living"]);
const STOP = new Set(["the", "of", "a", "an", "and", "in", "on", "with", "from", "to"]);

const words = (text: string) =>
  srdKey(text)
    .split(" ")
    .filter((word) => word.length > 1 && !STOP.has(word))
    .map((word) => singular(word));

// A book's word for a kind of creature, in the SRD's word for it: a bee is
// one of the SRD's insects, a poacher its scout, a banshee its ghost. The
// book's names are English by source (the book is read only in English).
const KIND_WORDS: Record<string, string> = {
  bee: "insect", wasp: "insect", hornet: "insect", ant: "insect", locust: "insect", mosquito: "insect", fly: "insect",
  tarantula: "spider", arachnid: "spider",
  serpent: "snake", viper: "snake", adder: "snake", cobra: "snake", asp: "snake",
  kodiak: "bear", grizzly: "bear",
  leopard: "panther", jaguar: "panther", cougar: "panther", puma: "panther", cat: "panther",
  hound: "mastiff", dog: "mastiff",
  banshee: "ghost", phantom: "ghost", spirit: "ghost", spectre: "specter", wisp: "will-o'-wisp",
  revenant: "wight", corpse: "zombie", undead: "zombie",
  poacher: "scout", hunter: "scout", archer: "scout", ranger: "scout", tracker: "scout",
  raider: "bandit", brigand: "bandit", outlaw: "bandit", highwayman: "bandit", robber: "bandit", pirate: "bandit",
  soldier: "guard", guardsman: "guard", watchman: "guard", sentry: "guard", warrior: "veteran",
  wizard: "mage", sorcerer: "mage", warlock: "mage", witch: "mage", sorceress: "mage",
  ruffian: "thug", bruiser: "thug", enforcer: "thug", cutthroat: "thug",
  cultist: "cultist", zealot: "cult fanatic", acolyte: "acolyte", monk: "acolyte", priestess: "priest",
};

function kindWords(text: string): string[] {
  const out: string[] = [];
  for (const word of words(text)) {
    const kind = KIND_WORDS[word];
    if (kind) out.push(...words(kind));
  }
  return out;
}

const crText = (cr: number) => (cr === 0.125 ? "1/8" : cr === 0.25 ? "1/4" : cr === 0.5 ? "1/2" : String(cr));

export function optionDetail(candidate: GuessCandidate): string {
  const body = [candidate.size, candidate.type].filter(Boolean).join(" ");
  const cr = candidate.cr === null || candidate.cr === undefined ? "" : `CR ${crText(candidate.cr)}`;
  return [body, cr].filter(Boolean).join(", ");
}

export function scoreCandidate(subject: GuessSubject, candidate: GuessCandidate, said: Set<string>): number {
  const mine = new Set(words(subject.name));
  const kinds = new Set(kindWords(subject.name));
  const theirs = words(candidate.name);
  let score = 0;
  for (const word of theirs) {
    if (mine.has(word)) score += GENERIC.has(word) ? 1.5 : 5;
    else if (kinds.has(word)) score += 4;
  }
  // A swarm only for a swarm: one beetle is not a Swarm of Beetles.
  if (theirs.includes("swarm") && !mine.has("swarm") && !said.has("swarm")) score -= 3;
  // The book's own words name it ("a spider the size of a horse").
  const noun = theirs.at(-1);
  if (noun && !GENERIC.has(noun) && said.has(noun) && !mine.has(noun)) score += 2;
  const type = subject.type.toLowerCase();
  const theirType = (candidate.type ?? "").toLowerCase();
  if (type && theirType) {
    if (type.includes(theirType) || theirType.includes(type)) score += 4;
    // People are never beasts, and beasts never people.
    else if (type.includes("humanoid") || theirType === "humanoid") score -= 4;
  }
  if (subject.size && candidate.size && subject.size.toLowerCase() === candidate.size.toLowerCase()) score += 1;
  const cr = candidate.cr ?? 0;
  // Challenge by ratio: CR 1 against 2 is as far as 8 against 16.
  if (subject.cr !== null) score -= Math.abs(Math.log2((subject.cr + 1) / (cr + 1))) * 5;
  else if (cr > 5) score -= (cr - 5) * 0.3;
  return score;
}

// A guess is worth suggesting when something ties it to the book's
// creature: a shared word, the same type, a mention. Below this it is a
// coin toss, and the review says nothing came close.
export const GUESS_FLOOR = 2;

export function guessCreatures(subject: GuessSubject, catalog: GuessCandidate[], limit = 8): Array<{ candidate: GuessCandidate; score: number }> {
  const said = new Set(words(subject.text));
  return catalog
    .map((candidate) => ({ candidate, score: scoreCandidate(subject, candidate, said) }))
    .sort((a, b) => b.score - a.score || compareNames(a.candidate.name, b.candidate.name))
    .slice(0, limit);
}

// The options a row offers: the suggestion first, then the closest guesses.
export function matchOptions(suggested: string | null, guesses: Array<{ candidate: GuessCandidate }>, catalog: GuessCandidate[], limit = 8): MatchOption[] {
  const out: MatchOption[] = [];
  const add = (candidate: GuessCandidate | undefined) => {
    if (candidate && !out.some((option) => option.name === candidate.name)) out.push({ name: candidate.name, detail: optionDetail(candidate) });
  };
  if (suggested) add(catalog.find((candidate) => candidate.name === suggested));
  for (const guess of guesses) add(guess.candidate);
  return out.slice(0, limit);
}

// The GM's choices from the review, laid over the asks. A choice of a name
// outside the SRD is refused by the route before it gets here.
export function chooseMatches(asks: MatchAsk[], choices: Record<string, { srd: string | null; confirmed: boolean }>): MatchAsk[] {
  return asks.map((ask) => {
    const choice = choices[ask.key];
    if (!choice) return ask;
    return { ...ask, current: choice.srd, confirmed: choice.confirmed };
  });
}

// The asks still waiting for the GM among those that matter: an ask whose
// creature, fight and person are all left out of the import changes
// nothing, and waits for nobody.
export const unconfirmed = (asks: MatchAsk[] | undefined, taken?: (recordKey: string) => boolean) =>
  (asks ?? []).filter((ask) => !ask.confirmed && (!taken || ask.targets.some((target) => taken(target.record)))).length;
