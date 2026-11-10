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

export const UNSEEN_NAME = "someone unseen";

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
export function hideNames<T>(payload: T, names: readonly string[]): T {
  if (!names.length || payload === null || typeof payload !== "object") {
    return payload;
  }
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  let changed = false;
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
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(record)) {
        out[key] = walk(inner);
      }
      // A tracker entry ({ name, hidden }) of a creature kept from the table.
      if (typeof record.name === "string" && "hidden" in record && out.name !== record.name) {
        out.hidden = true;
      }
      return out;
    }
    return value;
  };
  const next = walk(payload);
  return changed ? (next as T) : payload;
}
