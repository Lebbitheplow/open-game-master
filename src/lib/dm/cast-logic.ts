import { textKey } from "@/lib/language/text-logic";

// Who of the cast the table knows by name (issue 650), as pure rules the
// database rim (src/lib/dm/cast.ts, src/lib/db/npcs.ts) and the tests share.
//
// A person is known once the party has met them through a rule (Npc.metAt)
// or once the story has said their name to the table (Npc.heardAt): in the
// GM's narration, in a system line, or as the speaker a quoted line is
// shown under. Everyone else in the cast is the story's secret: the cast a
// workshop module brought in, the people a GM forged or a settlement was
// populated with, a name the AI registered without saying it. Those are
// sent only to the seats that already read the whole cast through the GM's
// people panel, and a player's device never holds them.
//
// A player's own words never make a name heard: a guess typed at the table
// is not the story confirming that someone exists. An alias heard is not the
// name either: "the Black Spider" said aloud does not tell the table who
// that is.

// A passage as the table read it, keyed once so every candidate is a
// substring test: its words, then the names its quoted lines were shown
// under. Padded with spaces, the only gap a key has, so a match is always
// whole words ("Al" is not heard in "always").
export function heardKey(content: string, speakers: readonly string[] = []): string {
  return ` ${textKey([content, ...speakers].join("\n"))} `;
}

// The candidates whose name stands in any of these keyed passages.
export function namesHeard<T extends { name: string }>(candidates: readonly T[], keys: readonly string[]): T[] {
  return candidates.filter((candidate) => {
    const wanted = textKey(candidate.name);
    return wanted !== "" && keys.some((key) => key.includes(` ${wanted} `));
  });
}

// What every seat may hold of the cast: the people the table knows.
export function knownCast<T extends { known?: boolean }>(cast: readonly T[]): T[] {
  return cast.filter((member) => member.known === true);
}
