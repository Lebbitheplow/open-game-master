// A roll's words, made from its parts (issue #1064, step 2).
//
// A roll's `detail` was a sentence each site wrote by hand, in English, and
// a French table read it half translated: the reader could put only a weapon
// or a spell in front of " vs " or " on " into French
// (src/lib/roll-labels.ts localizeDetail). A site whose family has moved
// writes no sentence. It says what the roll is in fields
// (src/lib/roll-parts.ts), and this module makes the words from them, in
// the reader's language, through the dictionaries.
//
// One rule decides what is put into another language: the engine's own
// words are, and nothing a person or the model typed ever is.
//
//   what was used   by its key, where it has one and is carried under its
//                   row's own name: the key says which content row it is,
//                   so the row's name in the reader's language is shown. A
//                   name with no key (an improvised "Log", a homebrew
//                   spell, a wild shape's bite) and one carried under
//                   another name than its row's (a "Longsword +1", a
//                   renamed blade) are shown as written. A name is never
//                   looked up as a word: "Log" is no "Journal";
//   a note          one of the engine's own (ROLL_NOTES), by its id, so the
//                   dictionary can find it; a typed note is shown as
//                   written;
//   a target        as it was named when the roll was made. The engine's
//                   own words for a target are a kind with no name: an
//                   object nobody named, a creature the table has not
//                   seen. They are never text in a name field.
//
// A word nobody has translated yet reads in English, as everywhere else.
//
// The same function writes the English sentence the door stores as `detail`
// (src/lib/dm/roll-record.ts), so GAME STATE, Ask and a client not yet
// updated read what they always have, and a row's sentence and its parts
// cannot disagree: one is built from the other.
//
// Only parts marked `worded` make a roll's words, and the mark is a number:
// the version of the words these parts make (WORDS_VERSION). A site whose
// family has not moved still writes its sentence, and its parts say only
// what a rule reads back; that roll is shown by its sentence, as before. So
// is a roll whose version this build does not know (a newer server's row
// read by an older client): its English sentence is always stored.
//
// Pure: no database. Client components import it through roll-labels.ts.

import { contentName, type FrNamesTable } from "@/lib/content/names";
import { UNSEEN_NAME } from "@/lib/hidden-names-logic";
import { interpolate } from "@/lib/i18n/translate";
import { textKey } from "@/lib/language/text-logic";
import type { RollNote, RollParts, RollTarget, RollUsed, WordedParts } from "@/lib/roll-parts";

// The shape of a translator, as the pure sentence builders take it.
export type RollTranslator = ((key: string, vars?: Record<string, string | number>) => string) & { locale?: "en" | "fr" };

// The version of the words `worded` parts make. Raised when a field these
// words are made from changes its meaning: rows are never rewritten, so a
// reader tells the old from the new by this number.
export const WORDS_VERSION = 1;

// The fields a roll's words are made from, and no others: rollWords cannot
// read a field that is not listed here, and a waiting card is sent exactly
// these (wordParts), so a card and its landed roll are worded from the same.
const WORD_FIELDS = ["used", "targets", "aim", "notes", "physical", "worded"] as const;
type RollWordParts = Pick<RollParts, (typeof WORD_FIELDS)[number]>;

// The engine's own notes, each by its id. The words are English and are the
// dictionaries' key, as the app's other words are. A site names a note by
// its id and never writes its words, so the list is closed: the dice-site
// sweep holds every stored note to it.
export const ROLL_NOTES = {
  opportunity: "opportunity attack",
  half_on_miss: "half on a miss",
} as const;
export type RollNoteId = keyof typeof ROLL_NOTES;

// What the door writes after the words of dice rolled at the table, in every
// row, old and new (src/lib/roll-parts.ts rollPhysical reads it in an old
// one).
const PHYSICAL_WORD = "physical";
const DICE_CONTEXT = "roll.dice";
export const PHYSICAL = `(${PHYSICAL_WORD})`;

// How the words join what was used to whom it is against: "Club vs Aria",
// "Fireball on Goblin 1, Goblin 2". Both are common words with other
// meanings elsewhere in the app, so the dictionaries keep these under a
// context of their own.
const AIM_CONTEXT = "roll.aim";

// The names table of each kind of thing that has a content key.
const KEY_TABLES: Partial<Record<RollUsed["kind"], FrNamesTable>> = { weapon: "weapons", spell: "spells" };

const ENGLISH: RollTranslator = Object.assign((key: string, vars?: Record<string, string | number>) => interpolate(key, vars), { locale: "en" as const });

// Whether these parts make a roll's words, in a version this build knows.
export function makesWords(parts: RollParts | null | undefined): parts is WordedParts {
  return parts?.worded === WORDS_VERSION;
}

// What was used, in the reader's language: its row's name where its key says
// which row it is and it is carried under that name, else as written.
function usedWords(t: RollTranslator, used: RollUsed): string {
  const table = KEY_TABLES[used.kind];
  const locale = t.locale ?? "en";
  if (locale === "en" || !table || !used.key || textKey(used.name) !== used.key) {
    return used.name;
  }
  return contentName(table, used.name, locale);
}

function noteWords(t: RollTranslator, note: RollNote): string {
  // An id this build does not know (a row a newer server stored) reads as
  // its id, which says more than nothing.
  return "typed" in note ? note.typed : t(ROLL_NOTES[note.engine] ?? note.engine);
}

function targetWords(t: RollTranslator, target: RollTarget): string {
  if (target.kind === "unseen") {
    return t(UNSEEN_NAME);
  }
  return target.kind === "object" ? (target.name ?? t("an object")) : target.name;
}

// The words of a roll, from its parts: "Longsword (opportunity attack) vs
// Goblin (physical)". Who made the roll is not among them: the roller goes
// in front of the card (src/lib/roll-labels.ts).
export function rollWords(t: RollTranslator, parts: RollWordParts): string {
  const what = [parts.used ? usedWords(t, parts.used) : "", ...(parts.notes ?? []).map((note) => `(${noteWords(t, note)})`)].filter(Boolean).join(" ");
  const names = (parts.targets ?? []).map((target) => targetWords(t, target));
  const against = names.length ? `${t(parts.aim ?? "vs", { context: AIM_CONTEXT })} ${names.join(", ")}` : "";
  return [what, against, parts.physical ? `(${t(PHYSICAL_WORD, { context: DICE_CONTEXT })})` : ""].filter(Boolean).join(" ");
}

// The sentence a roll is stored and quoted with: its parts' own, in English,
// where they make its words, else the one its site wrote. A roll handed
// neither is refused: stored with no words, its card would say nothing, and
// nothing would say why.
export function rollSentence(said: { detail?: string; parts?: RollParts | null }): string {
  if (makesWords(said.parts)) {
    return rollWords(ENGLISH, said.parts);
  }
  if (typeof said.detail !== "string") {
    throw new Error("A roll is handed the sentence its site wrote (`detail`) or parts that make its words (src/lib/roll-parts.ts): this one has neither.");
  }
  return said.detail;
}

// What a player does with their dice before they enter them, each step by
// its id and its number (src/lib/dm/attack-damage-dice.ts diceSteps). The
// words are English and are the dictionaries' key; the feature a step comes
// from is named in them.
export type DiceStep =
  | { step: "reroll_low"; below: number }
  | { step: "brutal" }
  | { step: "savage" }
  | { step: "piercer" }
  | { step: "empower"; dice: number };

const DICE_STEPS: Record<DiceStep["step"], string> = {
  reroll_low: "reroll any die of {below} or less once (Great Weapon Fighting)",
  brutal: "roll the damage a second time and keep the better total (Brutal Attack)",
  savage: "roll the weapon's dice a second time and keep the better total (Savage Attacker)",
  piercer: "reroll the lowest damage die once and keep the new roll (Piercer)",
  empower: "reroll up to {dice} of the damage dice and keep the new rolls (Empowered Spell)",
};
const STEPS_CONTEXT = "roll.steps";

// "Before you enter your dice: reroll any die of 2 or less once (Great
// Weapon Fighting), then ...". Empty when there is no step.
function stepsWords(t: RollTranslator, steps: DiceStep[]): string {
  const said = steps.map(({ step, ...numbers }) => t(DICE_STEPS[step] ?? step, numbers));
  return said.length ? t("Before you enter your dice: {steps}.", { steps: said.join(`, ${t("then", { context: STEPS_CONTEXT })} `) }) : "";
}

// A waiting card's own line under its title, where its site says one: the
// roll again as a sentence ("Longsword damage against Goblin"), then the
// steps for a player with dice in hand. A card with no line of its own
// carries its words as its reason (cardReason).
export type CardLine = { steps: DiceStep[] };

// The sentence of that line, by the roll's kind.
const CARD_SENTENCES = {
  attack: "{used} attack against {target}",
  damage: "{used} damage against {target}",
  half: "{used} half damage against {target}",
} as const;

const isNote = (note: RollNote, id: RollNoteId) => "engine" in note && note.engine === id;

// The line, from the card's parts: "Greatsword damage against Goblin
// (opportunity attack). Before you enter your dice: ...". A graze's damage
// says "half damage" where the roll's words say "(half on a miss)".
export function cardLine(t: RollTranslator, kind: string, parts: RollWordParts, line: CardLine): string {
  const used = parts.used ? usedWords(t, parts.used) : "";
  const names = (parts.targets ?? []).map((target) => targetWords(t, target));
  const half = kind === "damage" && (parts.notes ?? []).some((note) => isNote(note, "half_on_miss"));
  const template = half ? CARD_SENTENCES.half : kind === "attack" || kind === "damage" ? CARD_SENTENCES[kind] : null;
  const notes = (parts.notes ?? []).filter((note) => !(half && isNote(note, "half_on_miss"))).map((note) => ` (${noteWords(t, note)})`);
  const sentence = template && used && names.length ? `${t(template, { used, target: names.join(", ") })}${notes.join("")}` : rollWords(t, parts);
  const steps = stepsWords(t, line.steps);
  return steps ? `${sentence}. ${steps}` : sentence;
}

// The reason a waiting card is kept with, in English, as GAME STATE, a
// connected agent and a client not yet updated read it: its own line where
// its site says one in fields, else the reason its site wrote, else the
// card's words again.
export function cardReason(card: { kind: string; detail?: string; reason?: string; parts?: RollParts | null; line?: CardLine | null }): string {
  if (card.line && makesWords(card.parts)) {
    return cardLine(ENGLISH, card.kind, card.parts, card.line);
  }
  return card.reason ?? rollSentence(card);
}

// The sentences of a roll or a waiting card as a seat is sent it once a
// creature kept from the table was replaced among its targets
// (src/lib/hidden-names-logic.ts Reword): made again from the parts, as the
// door made them. Null where the parts do not make the words.
export function seatSentences(sent: Record<string, unknown>, kept: Record<string, unknown>): { detail: string; reason?: string } | null {
  const parts = sent.parts as RollParts | null | undefined;
  if (!makesWords(parts)) {
    return null;
  }
  const detail = rollWords(ENGLISH, parts);
  if (typeof kept.reason !== "string") {
    return { detail };
  }
  const line = (kept.carry as { line?: CardLine } | null | undefined)?.line;
  if (line) {
    return { detail, reason: cardLine(ENGLISH, String(kept.kind), parts, line) };
  }
  return kept.reason === kept.detail ? { detail, reason: detail } : { detail };
}

const nameOnly = (target: RollTarget): RollTarget => (target.kind === "object" || target.kind === "unseen" ? target : { kind: target.kind, name: target.name });

// What a roll card waiting on its player's dice is sent of its parts: the
// fields that make its words, so the card reads in the player's language.
// What a rule reads back (a save's purpose, what it resists) stays on the
// server until the roll lands, and so does a target's id: the words need
// only its name, which the card's sentence already says. Undefined for a
// card whose site still writes its sentence.
export function wordParts(parts: RollParts | null | undefined): RollWordParts | undefined {
  if (!makesWords(parts)) {
    return undefined;
  }
  const sent: Record<string, unknown> = {};
  for (const field of WORD_FIELDS) {
    if (parts[field] !== undefined) {
      sent[field] = field === "targets" ? (parts.targets ?? []).map(nameOnly) : parts[field];
    }
  }
  return sent as RollWordParts;
}
