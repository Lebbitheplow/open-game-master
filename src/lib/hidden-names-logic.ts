// A creature the GM keeps off the board is "someone unseen" in what a
// player's seat is sent (src/lib/dm/turn-lines-logic.ts tableName: "one the
// GM keeps off the board is 'someone unseen' there, as on the tracker and in
// the turn note"). Each line that names a creature used to call tableName
// where it was written, and the ones that did not (a roll's detail and its
// attacker, a sheet change's reason, an opportunity attack's line, the order
// entry of a creature that leaves) sent its name to every player (gap sweep
// 2026-11-09). src/lib/table-delivery.ts runs every event that can name a
// creature through this, once, so a new line is covered the day it lands.
//
// Pure, for the test suite.

import { textKey } from "@/lib/language/text-logic";

export const UNSEEN_NAME = "someone unseen";

const NO_IDS: ReadonlySet<string> = new Set();

// The sentences of a roll or a waiting card whose parts make its words, as
// they read once its targets are replaced (src/lib/roll-words.ts
// seatSentences): `sent` is the record after the replacement, `kept` as it
// was. Null for a record whose words are a sentence its site wrote, which
// keeps the text replacement.
export type Reword = (sent: Record<string, unknown>, kept: Record<string, unknown>) => { detail: string; reason?: string } | null;

// A record that says its words in parts takes its sentences from them: the
// text replacement cannot tell a hidden "Bandit" from the word inside a
// seen "Bandit Captain", and the parts can. True when a sentence changed.
function reworded(out: Record<string, unknown>, record: Record<string, unknown>, reword: Reword | undefined): boolean {
  if (!reword || typeof record.detail !== "string" || !record.parts || typeof record.parts !== "object") {
    return false;
  }
  const said = reword(out, record);
  if (!said) {
    return false;
  }
  Object.assign(out, said);
  return out.detail !== record.detail || out.reason !== record.reason;
}

// A row written before the fight under way began (hideNames `since`).
function writtenBefore(record: Record<string, unknown>, since: string | undefined): boolean {
  return Boolean(since) && typeof record.createdAt === "string" && record.createdAt < (since as string);
}

// Only whom a roll is against, by id: for a payload no hidden name is in.
function hideTargets<T>(payload: T, ids: ReadonlySet<string>, reword?: Reword, since?: string): T {
  let changed = false;
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (value && typeof value === "object") {
      if (writtenBefore(value as Record<string, unknown>, since)) {
        return value;
      }
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        out[key] = key === "targets" && Array.isArray(inner)
          ? inner.map((target) => {
              const id = target && typeof target === "object" ? (target as Record<string, unknown>).id : undefined;
              if (typeof id === "string" && ids.has(id)) {
                changed = true;
                return { kind: "unseen" };
              }
              return target;
            })
          : walk(inner);
      }
      reworded(out, value as Record<string, unknown>, reword);
      return out;
    }
    return value;
  };
  const next = walk(payload);
  return changed ? (next as T) : payload;
}

// The names to keep from the table: the hidden ones, less any a creature the
// table does see (or a hero) also answers to, which the table must keep.
export function namesToHide(hidden: readonly string[], shown: readonly string[]): string[] {
  const kept = new Set(shown.map((name) => name.trim().toLowerCase()));
  return [...new Set(hidden.map((name) => name.trim()).filter((name) => name.length > 1 && !kept.has(name.toLowerCase())))]
    // The longest first, so "Bandit Captain" goes before "Bandit".
    .sort((a, b) => b.length - a.length);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Every text in the payload with each name in `names` as a whole word
// replaced by "someone unseen" ("Someone unseen" where it opens a sentence),
// and an order entry for a creature so named marked hidden. The same object
// when nothing in it names one.
// `ids` are the hidden creatures themselves: what a roll's target is matched
// by, where it says who it is. `reword` makes the sentences of a roll whose
// parts make its words (above).
//
// `since` is for what a seat reads outside the stream, which comes as rows
// that each say when they were written (a message, a roll, a sheet change).
// The stream replaces a name only in what it sends while the creature is
// hidden in the fight under way, so a row written before that fight began is
// left as it reads: with a bandit hidden, "the bandit camp" in an older page
// of the story stays what the table read.
export type HideOptions = { ids?: ReadonlySet<string>; reword?: Reword; since?: string };

export function hideNames<T>(payload: T, names: readonly string[], options: HideOptions = {}): T {
  const { ids = NO_IDS, reword, since } = options;
  if ((!names.length && !ids.size) || payload === null || typeof payload !== "object") {
    return payload;
  }
  if (!names.length) {
    // A hidden creature the table also knows by a seen one's name: no text
    // is its alone, and its id still is.
    return hideTargets(payload, ids, reword, since);
  }
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  let changed = false;
  // Whom a roll is against (src/lib/roll-parts.ts RollTarget). A creature
  // kept from the table is no name and no id there: the roll's words say
  // "someone unseen" for it, in the reader's language. Its name replaced in
  // the field would open that string, and read with a capital in the middle
  // of the card's words; and its id is what the table is not owed.
  // A creature is matched by what it is, never by its name inside another's:
  // with "Bandit" hidden, a "Bandit Captain" the table sees is still the
  // Captain. One that says its id is hidden or not by that id alone, and
  // keeps its name as it is. One sent by name only (a waiting card's) is
  // hidden when the name is, whole, a hidden creature's.
  const whole = new Set(names.map(textKey));
  const target = (value: unknown): unknown => {
    const named = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
    if (!named || named.kind === "object" || typeof named.name !== "string") {
      return walk(value);
    }
    const unseen = typeof named.id === "string" ? ids.has(named.id) : whole.has(textKey(named.name));
    if (unseen) {
      changed = true;
      return { kind: "unseen" };
    }
    return value;
  };
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") {
      const next = value.replace(pattern, (_match, offset: number, whole: string) => {
        changed = true;
        const before = whole.slice(0, offset).trimEnd();
        return !before || /[.!?:]$/.test(before) ? "Someone unseen" : UNSEEN_NAME;
      });
      return next;
    }
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (writtenBefore(record, since)) {
        return value;
      }
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(record)) {
        out[key] = key === "targets" && Array.isArray(inner) ? inner.map(target) : walk(inner);
      }
      // A tracker entry ({ name, hidden }) of a creature kept from the table.
      if (typeof record.name === "string" && "hidden" in record && out.name !== record.name) {
        out.hidden = true;
      }
      if (reworded(out, record, reword)) {
        changed = true;
      }
      return out;
    }
    return value;
  };
  const next = walk(payload);
  return changed ? (next as T) : payload;
}
