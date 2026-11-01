import { compareNames, searchKey } from "@/lib/language/text-logic";

export { searchKey };

// The composer's @ menu (issue 650): typing @ offers the names of the
// table, so a long campaign's people and places are written the way the
// table spells them, without hunting for an accent or an apostrophe on a
// phone. Pure, so its rules are tested directly (scripts/test-name-menu.mjs);
// NameMenu.tsx is the hook and the list.
//
// It offers only what this seat already holds and the table already knows:
// the party, the people the story has introduced (the cast a player is sent
// is only those, src/lib/dm/cast.ts), and the places on the map, which every
// seat sees. In the story's own voice (Narrate, Direct) a seat that holds
// the whole cast is offered everyone, and the people not yet introduced are
// marked, so naming one is a choice and never a slip. In Do, Say and OOC the
// menu speaks for the character, who knows only who the story has named.

export type NameGroup = "party" | "people" | "places";

export type NameChoice = {
  name: string;
  group: NameGroup;
  // Other names they answer to, matched as the name is; never inserted.
  aliases?: string[];
  // In the story's voice: someone the table has not met or heard of yet.
  unmet?: boolean;
};

export const NAME_GROUP_LABEL: Record<NameGroup, string> = { party: "Party", people: "People", places: "Places" };

const GROUP_ORDER: readonly NameGroup[] = ["party", "people", "places"];

// Longer than any name a table writes: past it, the @ was not a name.
const MAX_QUERY = 40;

// As many rows as a phone shows above its keyboard; typing narrows it.
export const NAME_MENU_LIMIT = 8;

// What may stand right before an @ that starts a name: nothing, a space, or
// an opening bracket or quote. Inside a word ("bob@mail.com") it is text.
const OPENER = /[\s([{"“‘'«]/u;

// The @ the caret is writing a name after, and what follows it so far, or
// null. A space straight after the @, a line break, a second @ or a query
// longer than any name all mean the @ was something else.
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("@");
  if (start < 0) {
    return null;
  }
  if (start > 0 && !OPENER.test(before[start - 1])) {
    return null;
  }
  const query = before.slice(start + 1);
  if (query.length > MAX_QUERY || /[\n@]/.test(query) || /^\s/u.test(query)) {
    return null;
  }
  return { start, query };
}

type SheetLike = { name: string; summon?: unknown };
type CastLike = { name: string; aliases?: string[]; known?: boolean };
type PlaceLike = { name: string };

// Everything the menu may offer this seat, in group order, each name once
// (the party's spelling first: a companion is a party member, not cast).
export function nameChoices(input: {
  sheets: readonly SheetLike[];
  cast: readonly CastLike[];
  places: readonly PlaceLike[];
  // Narrate or Direct: the story's voice rather than a character's.
  storyVoice: boolean;
}): NameChoice[] {
  const seen = new Set<string>();
  const out: NameChoice[] = [];
  const add = (choice: NameChoice) => {
    const key = searchKey(choice.name);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(choice);
    }
  };
  // A summoned creature fights for the party but is nobody's name to write.
  for (const sheet of input.sheets) {
    if (!sheet.summon) {
      add({ name: sheet.name, group: "party" });
    }
  }
  for (const member of input.cast) {
    // An older host sends the whole cast unmarked: in a character's voice
    // only a member marked known is safe to offer.
    if (member.known === true || input.storyVoice) {
      add({
        name: member.name,
        group: "people",
        ...(member.aliases?.length ? { aliases: member.aliases } : {}),
        ...(member.known === false ? { unmet: true } : {}),
      });
    }
  }
  for (const place of input.places) {
    add({ name: place.name, group: "places" });
  }
  return out;
}

// How well a spelling answers the query: 3 it starts with it, 2 a word in
// it does, 1 it holds it anywhere, 0 not at all.
function score(spelling: string, query: string): number {
  const key = searchKey(spelling);
  if (key.startsWith(query)) {
    return 3;
  }
  if (` ${key}`.includes(` ${query}`)) {
    return 2;
  }
  return key.includes(query) ? 1 : 0;
}

// The choices that answer the query, best first within each group, the
// groups in their fixed order so a heading is never repeated.
export function matchNames(choices: readonly NameChoice[], query: string, limit = NAME_MENU_LIMIT): NameChoice[] {
  const wanted = searchKey(query);
  return choices
    .map((choice) => ({
      choice,
      score: wanted ? Math.max(...[choice.name, ...(choice.aliases ?? [])].map((spelling) => score(spelling, wanted))) : 3,
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        GROUP_ORDER.indexOf(a.choice.group) - GROUP_ORDER.indexOf(b.choice.group) ||
        b.score - a.score ||
        compareNames(a.choice.name, b.choice.name),
    )
    .slice(0, limit)
    .map((entry) => entry.choice);
}

// The menu for the text and caret as they stand, or null for none. A space
// typed after words that name nobody is the sentence going on, not a name
// still being written, so the menu steps aside rather than follow it.
export function nameMenuAt(
  text: string,
  caret: number,
  choices: readonly NameChoice[],
): { start: number; query: string; matches: NameChoice[] } | null {
  const at = mentionAt(text, caret);
  if (!at) {
    return null;
  }
  const matches = matchNames(choices, at.query);
  if (!matches.length && /\s/u.test(at.query)) {
    return null;
  }
  return { ...at, matches };
}

const WORD_TAIL = /^[\p{L}\p{M}\p{N}]+/u;
// After these the name needs no space of its own: "Marla's", "Marla,".
const CLOSER = /^[\s,.;:!?'’")\]}»]/u;

// The text with the @ and what was typed after it (and the rest of a word
// the caret stood inside) replaced by the name as the table spells it, a
// space after it unless one or a closing mark is already there, and where
// the caret goes: past that space.
export function insertName(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const rest = text.slice(caret);
  const after = rest.slice(WORD_TAIL.exec(rest)?.[0].length ?? 0);
  const gap = after && CLOSER.test(after) ? "" : " ";
  const next = `${text.slice(0, start)}${name}${gap}${after}`;
  const end = start + name.length + (gap || /^\s/u.test(after) ? 1 : 0);
  return { text: next, caret: end };
}
