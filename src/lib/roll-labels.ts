// How a roll is worded wherever it is stored or shown: the detail the engine
// writes, the chronicle card, cinematic mode's toast and chronicle line. An
// attack or damage roll records its attacker, who goes in front, and its
// detail says what was used and against whom, so each creature is named
// once. A roll nobody at the table made (a trap's, a fall's, the GM's own
// dice) records its source as its attacker, so the source goes in front and
// the character it lands on is named in the detail, as a target is. Every
// other roll, and one stored before the attacker was recorded, keeps the
// sheet it concerns (characterId) in front, as it always has.
// Pure (type imports only), so client components and test scripts import it.
// The kind words are the dictionaries' (rollmap.kind.*); the surface that
// shows them passes its translator.

import type { HazardKind, StoredRoll } from "@/lib/db/rolls";
import { contentName } from "@/lib/content/names";
import { textKey } from "@/lib/language/text-logic";
import type { RollParts } from "@/lib/roll-parts";
import { cardLine, makesWords, rollWords, type CardLine, type RollTranslator as T } from "@/lib/roll-words";

type Worded = Pick<StoredRoll, "kind" | "detail" | "attacker" | "parts">;

function localizeRollWhat(what: string, locale: "en" | "fr" | "es"): string {
  if (locale !== "fr" || !what) return what;
  const key = textKey(what);
  const w = contentName("weapons", key, "fr");
  if (w !== key) return w;
  const s = contentName("spells", key, "fr");
  if (s !== key) return s;
  return what;
}

function localizeDetail(detail: string, locale: "en" | "fr" | "es"): string {
  if (locale !== "fr" || !detail) return detail;
  const vsAt = detail.indexOf(" vs ");
  if (vsAt > 0) {
    return `${localizeRollWhat(detail.slice(0, vsAt), locale)} c/ ${detail.slice(vsAt + 4)}`;
  }
  const onAt = detail.indexOf(" on ");
  if (onAt > 0) {
    return `${localizeRollWhat(detail.slice(0, onAt), locale)} sur ${detail.slice(onAt + 4)}`;
  }
  return localizeRollWhat(detail, locale);
}

// A stored roll's words as a seat reads them (issue #1064). Parts that make
// the words are read alone, in the reader's language
// (src/lib/roll-words.ts): a site whose family has moved wrote no sentence.
// Any other roll, and one stored before its parts, is shown by the sentence
// its site wrote, with the little of it the reader above can put into
// French.
function rollDetailWords(t: T, said: Pick<StoredRoll, "detail"> & { parts?: RollParts | null }, tidy: (words: string) => string = (words) => words.trim()): string {
  return makesWords(said.parts) ? tidy(rollWords(t, said.parts)) : localizeDetail(tidy(said.detail ?? ""), t.locale ?? "en");
}

// A roll card waiting on its player's dice, as its two faces read it.
type Waiting = { kind: string; detail: string; reason: string; parts?: RollParts | null; carry?: { line?: CardLine } | null };

// The card's words: from its parts where they make them, as its roll will
// read once it lands. A card whose site still writes its sentence shows it
// exactly as written, as it always has: the reader above is for stored
// rolls, and a waiting card of a family that has not moved is not its to
// change.
export function pendingWords(t: T, pending: Waiting): string {
  return makesWords(pending.parts) ? rollWords(t, pending.parts) : pending.detail;
}

// What the card says besides: its reason. Where the parts make the words,
// a card whose site says a line of its own in fields reads that line in the
// reader's language (`reason` keeps its English). A card that was given
// none of its own carries its words again as its reason
// (src/lib/roll-words.ts cardReason): that copy is the English sentence, so
// it is not shown under a title that already says the words (`titled`), and
// on a card with no such title it is the words, in the reader's language.
export function pendingReason(t: T, pending: Waiting, titled: boolean): string {
  if (makesWords(pending.parts)) {
    if (pending.carry?.line) {
      return cardLine(t, pending.kind, pending.parts, pending.carry.line);
    }
    if (pending.reason === pending.detail) {
      return titled ? "" : rollWords(t, pending.parts);
    }
  }
  return pending.reason;
}

// A skill's id in a card's words reads as words ("sleight_of_hand").
const spaced = (words: string) => words.replaceAll("_", " ");

// What a source's roll threw (src/lib/roll-sources.ts): its dice, the type
// of harm, and a few words in front where they are needed ("30 ft").
export type Thrown = { dice?: string; type?: string; note?: string };

// The words of a roll its source made, whose name goes in front of the card:
// what was thrown and on whom, and never the source again.
// "30 ft, 3d6 bludgeoning on Aria".
export function thrownOn(thrown: Thrown, targets: string[]): string {
  const dice = [thrown.dice, thrown.type].filter(Boolean).join(" ");
  // The note is held short, so a target after it survives the 120
  // characters a roll card keeps of its words (roll-card.ts rollCard).
  return rollOn([thrown.note?.slice(0, NOTE_MAX), dice].filter(Boolean).join(", ") || "damage", targets);
}
const NOTE_MAX = 60;

// A source's attack roll against one target's armour: "Attack vs Aria, AC 16".
export function attackOn(target: string, ac: number): string {
  return `${rollAgainst("Attack", target)}, AC ${ac}`;
}

// One target: "Club vs Aria".
export function rollAgainst(what: string, target: string): string {
  return `${what} vs ${target}`;
}

// An area's creatures, or what a fall lands on: "Fireball on Goblin 1, Goblin 2".
// An area that caught only creatures the table cannot see names none.
export function rollOn(what: string, targets: string[]): string {
  return targets.length ? `${what} on ${targets.join(", ")}` : what;
}

// The two sources that are never given a name, in front of a roll. They are
// chosen by what the source is and never by its name, which is what a
// sentence calls it (src/lib/roll-sources.ts).
const SERVER_NAMED: Partial<Record<HazardKind, string>> = { fall: "The fall", gm: "The GM" };

// Who made the roll: its attacker, else the sheet it concerns. A trap's or a
// hazard's own name is as it was given.
export function rollerName(roll: Pick<StoredRoll, "attacker">, sheetName: string | undefined): string | undefined {
  const by = roll.attacker;
  if (!by) {
    return sheetName;
  }
  return by.kind === "hazard" ? (SERVER_NAMED[by.hazard] ?? by.name) : by.name;
}

// The same, as a seat reads it: the server's two are the dictionaries' words.
function shownRoller(t: T, roll: Pick<StoredRoll, "attacker">, sheetName: string | undefined): string | undefined {
  const by = roll.attacker;
  if (by?.kind === "hazard" && by.hazard === "fall") {
    return t("The fall");
  }
  if (by?.kind === "hazard" && by.hazard === "gm") {
    return t("The GM");
  }
  return rollerName(roll, sheetName);
}

// A roll kind as the table reads it, on every card and in cinematic mode.
export const ROLL_KIND_KEYS: Record<string, string> = {
  skill_check: "Skill check",
  saving_throw: "Saving throw",
  ability_check: "Ability check",
  attack: "Attack roll",
  damage: "Damage",
  initiative: "Initiative",
  custom: "Roll",
};

export function rollKindLabel(t: T, kind: string): string {
  return t(ROLL_KIND_KEYS[kind] ?? "Roll");
}

// The chronicle card's line: "Goblin · Attack roll (Club vs Aria)".
export function rollCardLabel(t: T, roll: Worded, sheetName: string | undefined): string {
  const who = shownRoller(t, roll, sheetName);
  const detail = rollDetailWords(t, roll, spaced);
  return `${who ? `${who} · ` : ""}${rollKindLabel(t, roll.kind)}${detail ? ` (${detail})` : ""}`;
}

// Cinematic mode's roll pill, up to the dice: "Goblin · Club vs Aria".
export function rollToastLead(t: T, roll: Worded & Pick<StoredRoll, "requestedBy">, sheetName: string | undefined): string {
  const who = shownRoller(t, roll, sheetName);
  const what = rollDetailWords(t, roll) || rollKindLabel(t, roll.kind);
  return `${who ? `${who} · ` : roll.requestedBy === "dm" ? t("The GM · ") : ""}${what}`;
}

// Cinematic mode's chronicle line, up to the dice. A roll without an
// attacker keeps the reading it always had: its detail alone, which for a
// roll stored before the attacker was recorded still opens with the roller's
// name.
export function rollChronicleLead(t: T, roll: Worded, sheetName: string | undefined): string {
  const label = rollKindLabel(t, roll.kind);
  const detail = rollDetailWords(t, roll);
  if (roll.attacker) {
    return `${shownRoller(t, roll, sheetName)} · ${detail || label}`;
  }
  return detail || (sheetName ? `${sheetName} · ${label}` : label);
}
