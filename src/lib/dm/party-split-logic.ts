import { LIST_REF, SINGLE_REF } from "@/lib/dm/arg-coerce";
import { textKey } from "@/lib/language/text-logic";

// The party split up, kept as a state (issue 951). A table split up and the
// GM folded both groups into one passage: nothing said who stood where once
// the move_party that split them had answered, so the next turn read every
// player's line as one scene. Here is what is kept and what follows from it:
//
//   - the scene is at one place and follows one group. Everyone else is in a
//     group "away", at the place the scene left them;
//   - a turn answers the lines of those in the scene. A line from someone away
//     waits (`heard`), and the scene cuts to them once those it is with have
//     had their reply: one passage a group, the way a GM cuts between rooms;
//   - going where others wait joins them, and the split is over when nobody
//     is away.
//
// Pure: the moves, the lines a turn reads, what is said about it and what a
// call may reach, so scripts/test-party-split.mjs reads every rule with no
// database. src/lib/dm/party-split.ts does the reads and writes.

export type PartyGroup = {
  // Where they are, by the name the place is on record under.
  place: string;
  // Character ids. A creature a spell made is not listed: it is where its
  // maker is (fight-away-logic.ts withFollowers).
  ids: string[];
  // The newest line of the transcript the scene had answered when it left
  // them. A move of theirs after it waits for the scene to come back.
  heard: number;
  // The clock's instant, in minutes, when the scene left them.
  left: number;
};

// The last time the scene took in someone from elsewhere.
export type PartyCut = {
  // The seq of the table's note that said so.
  at: number;
  // Who came in, each with their group's `heard`: their moves between it and
  // the note are what the next reply answers.
  from: Record<string, number>;
  // How long the scene had been away from them, in minutes, and the clock's
  // instant at the cut: a rest they took in that time passes no more of it.
  behind: number;
  clock: number;
};

// Where the scene's own walked from, the last time they walked, and the
// newest line of the transcript then: for a move_party that only afterwards
// says who made that walk (moveGroups `back`).
export type PartyCame = { from: string; at: number };

export const MAX_PARTY_GROUPS = 8;
const PLACE_MAX = 80;

const whole = (value: unknown): number => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export function normalizeAway(raw: unknown): PartyGroup[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const groups: PartyGroup[] = [];
  for (const entry of raw as Array<Record<string, unknown>>) {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.ids)) {
      continue;
    }
    // Nobody is in two places.
    const ids = [...new Set((entry.ids as unknown[]).map((id) => String(id)))].filter((id) => id && !seen.has(id)).slice(0, 12);
    ids.forEach((id) => seen.add(id));
    if (ids.length) {
      groups.push({ place: String(entry.place ?? "").trim().slice(0, PLACE_MAX), ids, heard: whole(entry.heard), left: whole(entry.left) });
    }
  }
  return groups.slice(0, MAX_PARTY_GROUPS);
}

export function normalizeCut(raw: unknown): PartyCut | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const from: Record<string, number> = {};
  if (record.from && typeof record.from === "object") {
    for (const [id, heard] of Object.entries(record.from as Record<string, unknown>).slice(0, 12)) {
      from[id] = whole(heard);
    }
  }
  const at = whole(record.at);
  return at ? { at, from, behind: whole(record.behind), clock: whole(record.clock) } : null;
}

export function normalizeCame(raw: unknown): PartyCame | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const from = String(record.from ?? "").trim().slice(0, PLACE_MAX);
  return from ? { from, at: whole(record.at) } : null;
}

type Follower = { id: string; summon?: { casterId: string } | null };

// Everyone away: those listed, and what their spells made.
export function awayIdsOf(away: readonly PartyGroup[], sheets: readonly Follower[] = []): Set<string> {
  const ids = new Set(away.flatMap((group) => group.ids));
  for (const sheet of sheets) {
    if (sheet.summon && ids.has(sheet.summon.casterId)) {
      ids.add(sheet.id);
    }
  }
  return ids;
}

// The sheets in the scene. Unchanged, and the same array, while nobody is away.
export function inScene<T extends Follower>(away: readonly PartyGroup[], sheets: T[]): T[] {
  if (!away.length) {
    return sheets;
  }
  const gone = awayIdsOf(away, sheets);
  return sheets.filter((sheet) => !gone.has(sheet.id));
}

// Where someone away is, or null for someone in the scene.
export function placeAway(away: readonly PartyGroup[], id: string, sheets: readonly Follower[] = []): string | null {
  const maker = sheets.find((sheet) => sheet.id === id)?.summon?.casterId;
  const group = away.find((entry) => entry.ids.includes(id) || (maker !== undefined && entry.ids.includes(maker)));
  return group ? group.place : null;
}

// The groups with only the party as it stands in them: someone dead, benched
// or gone from the table holds no place.
export function settleAway(away: readonly PartyGroup[], members: readonly string[]): PartyGroup[] {
  const party = new Set(members);
  return away.map((group) => ({ ...group, ids: group.ids.filter((id) => party.has(id)) })).filter((group) => group.ids.length);
}

const samePlace = (one: string, other: string) => Boolean(one) && textKey(one) === textKey(other);

export type MoveInput = {
  away: readonly PartyGroup[];
  // The party in play, by id, with no summoned creature in it.
  members: readonly string[];
  // Where the scene is, "" before the party ever set out.
  from: string;
  to: string;
  // Who the call named, as ids; null or empty for everyone in the scene.
  named: readonly string[] | null;
  // The newest line the scene has answered, and the clock, for those left.
  // `heard` is the GM's last reply: whoever is left behind by those who walk
  // on is still owed an answer to what they have said since. `heardHere` is
  // every line the reply being written has read, for a cut: the group the
  // scene leaves was the one that reply answers.
  heard: number;
  heardHere?: number;
  now: number;
  // Where the scene's own walked here from, when they have only just come:
  // a move that names some of them with the place they already stand at
  // says that only those came, and the rest are still back there. A small
  // model moves the party first and says who went when asked.
  back?: string;
};

export type MoveOutcome = {
  away: PartyGroup[];
  // Who made the move.
  went: string[];
  // Who it left behind, and where: the place the scene was at, or the one
  // it had just come from when the move only says who came.
  stayed: string[];
  stayedAt: string;
  // Who came into the scene from elsewhere: named from a group away, or
  // waiting where the scene went. Each with their group's `heard`.
  arrived: Record<string, number>;
  // Whether anyone the scene was with is still in it. False on a cut: the
  // scene left one group for another and nobody walked from here to there.
  followed: boolean;
  // The places nobody of the party is left at, for who travels with it.
  emptied: string[];
  // Where those who came from elsewhere set out from, when it is one place.
  origin: string | null;
  // How long the scene had been away from those it is with now; 0 while
  // anyone it was with is still in it.
  behind: number;
  // Whether the party was split before the move, and is after it.
  wasSplit: boolean;
  split: boolean;
};

// One move_party, read against who is where. No names means those in the
// scene go, so a room-to-room move while split moves only them; naming
// someone away brings them into the scene (a cut, when nobody here goes with
// them); and whoever waits at the place the scene goes to is in it again.
export function moveGroups(input: MoveInput): MoveOutcome {
  const before = settleAway(input.away, input.members);
  const gone = new Set(before.flatMap((group) => group.ids));
  const present = input.members.filter((id) => !gone.has(id));
  const named = (input.named ?? []).filter((id) => input.members.includes(id));
  const going = named.length ? [...new Set(named)] : present;
  const goes = new Set(going);
  const stays = samePlace(input.to, input.from);
  // Naming some of those here, with the place they stand at, right after
  // they came: only those came.
  const back = input.back ?? "";
  const onlyThese = stays && Boolean(back) && !samePlace(back, input.to) && named.length > 0 && named.length < present.length && named.every((id) => present.includes(id));
  // Otherwise, going where the scene already is moves nobody who is in it.
  const stayed = stays && !onlyThese ? [] : present.filter((id) => !goes.has(id));
  const kept = stays && !onlyThese ? present : present.filter((id) => goes.has(id));
  const stayedAt = onlyThese ? back : input.from;

  const arrived: Record<string, number> = {};
  const lefts: number[] = [];
  const origins = new Set<string>();
  const emptied: string[] = [];
  const after: PartyGroup[] = [];
  for (const group of before) {
    const waiting = samePlace(group.place, input.to);
    const out = waiting ? group.ids : group.ids.filter((id) => goes.has(id));
    if (out.length) {
      out.forEach((id) => (arrived[id] = group.heard));
      lefts.push(group.left);
      if (!waiting) {
        origins.add(group.place);
      }
    }
    const rest = group.ids.filter((id) => !out.includes(id));
    if (rest.length) {
      after.push({ ...group, ids: rest });
    } else if (!waiting) {
      emptied.push(group.place);
    }
  }
  if (stayed.length) {
    const there = after.find((group) => samePlace(group.place, stayedAt));
    if (there) {
      there.ids = [...there.ids, ...stayed];
    } else {
      after.push({ place: stayedAt, ids: stayed, heard: kept.length ? input.heard : (input.heardHere ?? input.heard), left: input.now });
    }
  } else if (!stays && kept.length) {
    emptied.push(input.from);
  }
  const came = Object.keys(arrived).length > 0;
  return {
    away: after.slice(0, MAX_PARTY_GROUPS),
    went: going,
    stayed,
    stayedAt,
    arrived,
    followed: kept.length > 0,
    emptied: emptied.filter(Boolean),
    origin: !kept.length && origins.size === 1 ? [...origins][0] : null,
    behind: came && !kept.length ? Math.max(0, input.now - Math.max(...lefts)) : 0,
    wasSplit: before.length > 0,
    split: after.length > 0,
  };
}

// ---- the lines a turn reads ----

export type SceneLine = { seq: number; authorType: string; characterId?: string | null; content: string };

// A move, as against table talk: a question put out of character is answered
// wherever the scene is.
const isMove = (line: SceneLine) => line.authorType === "player" && !line.content.startsWith("(ooc)");

// Whether the cut's own moves still wait: no reply has come since its note.
export function cutLive(history: readonly SceneLine[], cut: PartyCut | null): cut is PartyCut {
  return Boolean(cut) && !history.some((line) => line.authorType === "dm" && line.seq > (cut as PartyCut).at);
}

// The transcript as the turn at this scene reads it. A move by someone away,
// made since the scene left them, is `held`: it is nobody's to answer here.
// The moves of those the scene has just cut to, made while it was elsewhere,
// are read after the note that told the cut, so they are the newest lines and
// every reader of "what is new since the GM spoke" finds them there.
export function sceneLines<T extends SceneLine>(history: readonly T[], away: readonly PartyGroup[], cut: PartyCut | null): { lines: T[]; held: T[] } {
  const heard = new Map(away.flatMap((group) => group.ids.map((id) => [id, group.heard] as const)));
  const held: T[] = [];
  const rest: T[] = [];
  for (const line of history) {
    const since = line.characterId ? heard.get(line.characterId) : undefined;
    (since !== undefined && isMove(line) && line.seq > since ? held : rest).push(line);
  }
  if (!cutLive(rest, cut)) {
    return { lines: rest, held };
  }
  const owed = (line: T) => {
    const since = line.characterId ? cut.from[line.characterId] : undefined;
    return since !== undefined && isMove(line) && line.seq > since && line.seq < cut.at;
  };
  const moved = rest.filter(owed);
  if (!moved.length) {
    return { lines: rest, held };
  }
  const others = rest.filter((line) => !owed(line));
  const at = others.findIndex((line) => line.seq > cut.at);
  const split = at < 0 ? others.length : at;
  return { lines: [...others.slice(0, split), ...moved, ...others.slice(split)], held };
}

// The moves the scene's own have made that no reply has answered.
export function unanswered<T extends SceneLine>(lines: readonly T[]): T[] {
  let from = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].authorType === "dm") {
      from = index + 1;
      break;
    }
  }
  return lines.slice(from).filter(isMove);
}

// The group the scene cuts to before the next reply, or null to stay. A fight
// keeps the scene where it is: it has the floor until it ends. Otherwise the
// group whose move has waited longest is next, once those the scene is with
// have nothing waiting, or at once when that move has already sat through a
// reply of theirs: a table that keeps one room talking does not starve the
// other. A scene nobody of the party is left in (they fell, or left the
// table) goes to whoever is.
export function cutDue<T extends SceneLine>(
  history: readonly T[],
  away: readonly PartyGroup[],
  cut: PartyCut | null,
  table: { fight: boolean; present: number },
): PartyGroup | null {
  if (!away.length || table.fight) {
    return null;
  }
  if (table.present === 0) {
    return away[0];
  }
  const { lines, held } = sceneLines(history, away, cut);
  if (!held.length) {
    return null;
  }
  const first = held.reduce((oldest, line) => (line.seq < oldest.seq ? line : oldest));
  const replied = [...lines].reverse().find((line) => line.authorType === "dm")?.seq ?? 0;
  if (unanswered(lines).length && first.seq > replied) {
    return null;
  }
  return away.find((group) => group.ids.includes(first.characterId ?? "")) ?? null;
}

// ---- what is said ----

type Named = { id: string; name: string };

export function nameList(names: readonly string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
}

const namesOf = (ids: readonly string[], roster: readonly Named[]) => ids.flatMap((id) => roster.find((sheet) => sheet.id === id)?.name ?? []);

// The line the table reads, or "" when the move changed nothing about who is
// where. Said by the server, so every table sees the cut the same way and the
// transcript the model reads later has the seam in it.
export function tableLine(outcome: MoveOutcome, to: string, from: string, here: readonly string[], roster: readonly Named[]): string {
  const stayed = namesOf(outcome.stayed, roster);
  const arrived = namesOf(Object.keys(outcome.arrived), roster);
  const present = namesOf(here, roster);
  if (!outcome.split) {
    return outcome.wasSplit ? `The party is together again at ${to}.` : "";
  }
  if (arrived.length && !outcome.followed) {
    return `Meanwhile, at ${to}: ${nameList(present)}.`;
  }
  if (arrived.length) {
    return `${nameList(arrived)} ${arrived.length === 1 ? "joins" : "join"} the others at ${to}.`;
  }
  if (stayed.length) {
    const went = namesOf(outcome.went, roster);
    return `The party splits up: ${nameList(went)} ${went.length === 1 ? "goes" : "go"} to ${to}, and ${nameList(stayed)} ${stayed.length === 1 ? "stays" : "stay"}${from ? ` at ${from}` : " behind"}.`;
  }
  return "";
}

const elsewhere = (away: readonly PartyGroup[], roster: readonly Named[]) =>
  away.map((group) => `${nameList(namesOf(group.ids, roster))}${group.place ? ` at ${group.place}` : ""}`).join("; ");

// What the storyteller is told in move_party's result. "" when the whole
// party moved together and still is.
export function moveNote(outcome: MoveOutcome, to: string, here: readonly string[], roster: readonly Named[], waiting: readonly string[] = []): string {
  const stayed = namesOf(outcome.stayed, roster);
  const arrived = namesOf(Object.keys(outcome.arrived), roster);
  if (!outcome.split) {
    return outcome.wasSplit ? `The party is back together at ${to}: everyone is in this scene again.` : "";
  }
  const head = arrived.length
    ? outcome.followed
      ? `${nameList(arrived)} ${arrived.length === 1 ? "is" : "are"} in this scene now, at ${to}.`
      : `The scene has cut to ${to}, with ${nameList(namesOf(here, roster))}.`
    : stayed.length
      ? `The party has split up: ${nameList(namesOf(outcome.went, roster))} went to ${to}, and ${nameList(stayed)} stayed behind. The scene follows those who went.`
      : "";
  return [
    head,
    `Elsewhere now: ${elsewhere(outcome.away, roster)}. Narrate only this scene; the scene cuts to the others by itself when they act, and going where they are joins them.`,
    waiting.length ? `Waiting on an answer here: ${waiting.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function span(minutes: number): string {
  if (minutes >= 2 * 1440) {
    return `${Math.round(minutes / 1440)} days`;
  }
  return minutes >= 120 ? `${Math.round(minutes / 60)} hours` : "an hour";
}

// GAME STATE's own lines while the party is split: who the scene is with and
// who is not in it. In the part of the state that is read each turn, since it
// changes with every cut. `behind` is how long the scene was away from those
// it has just come to, when that is an hour or more.
export function splitStateBlock(input: { here: readonly string[]; place: string; away: readonly PartyGroup[]; roster: readonly Named[]; behind?: number }): string {
  if (!input.away.length) {
    return "";
  }
  const present = nameList(namesOf(input.here, input.roster));
  return [
    `The party is split up. In this scene${input.place ? `, at ${input.place}` : ""}: ${present}. Elsewhere: ${elsewhere(input.away, input.roster)}.`,
    "Only those in this scene see, hear, speak or act in it, and a call reaches only them. Never narrate what the others do: the scene cuts to them by itself when they act.",
    "move_party moves those in this scene (characterIds when only some of them go); going where the others are joins them.",
    input.behind && input.behind >= 60
      ? `The scene was away from ${present} for ${span(input.behind)}: say briefly how they spent it. A rest they took in that time passes no more of it.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

// ---- what a call may reach ----

// The calls that are bookkeeping, or the split's own doing, and so name
// someone who is not in the scene without reaching into another place: the
// move itself, a fight's own list of who is not at it, shares of a reward,
// the sheet, a private word, a question to a player, the record.
export const SCENE_FREE_TOOLS: ReadonlySet<string> = new Set([
  "move_party",
  "start_encounter",
  "party_award",
  "award_xp",
  "modify_gold",
  "update_sheet",
  "learn_spell",
  "send_whisper",
  "request_player_input",
  "record_event",
  "generate_image",
  "set_lifestyle",
  "dismiss_companion",
  "relationship_end",
  "relationship_scheme",
]);

// Every character a call names: its own fields, and those of the entries it
// lists (a heal's targets, a rest's spends).
function characterRefs(args: Record<string, unknown>): string[] {
  const refs: string[] = [];
  const read = (record: Record<string, unknown>, nested: boolean) => {
    for (const [key, value] of Object.entries(record)) {
      if (SINGLE_REF.test(key) && typeof value === "string") {
        refs.push(value);
      } else if (LIST_REF.test(key) && Array.isArray(value)) {
        refs.push(...value.filter((entry): entry is string => typeof entry === "string"));
      } else if (!nested && Array.isArray(value)) {
        for (const entry of value) {
          if (entry && typeof entry === "object" && !Array.isArray(entry)) {
            read(entry as Record<string, unknown>, true);
          }
        }
      }
    }
  };
  read(args, false);
  return refs;
}

// A call that names someone who is not in the scene, refused with the way
// through. While the party is split a call for Bram at the docks, sent from a
// scene at the mill, rolled his check, spent his slot or healed him there: the
// engine keeps one place and would have no reason to say no. `away` is who is
// elsewhere and where; a fight's own absentees are left to the fight's rule
// (fight-away-logic.ts), which the caller leaves out of the list.
export function sceneRefusal(name: string, args: Record<string, unknown>, away: ReadonlyArray<Named & { place: string }>, here: string): string | null {
  if (!away.length || SCENE_FREE_TOOLS.has(name)) {
    return null;
  }
  const named = [...new Set(characterRefs(args))].flatMap((ref) => away.find((sheet) => sheet.id === ref || textKey(sheet.name) === textKey(ref)) ?? []);
  const gone = [...new Map(named.map((sheet) => [sheet.id, sheet])).values()];
  if (!gone.length) {
    return null;
  }
  const where = [...new Set(gone.map((sheet) => sheet.place).filter(Boolean))];
  const ids = gone.map((sheet) => sheet.id).join(", ");
  const place = where.length === 1 ? where[0] : "";
  return [
    `${nameList(gone.map((sheet) => sheet.name))} ${gone.length === 1 ? "is" : "are"} not in this scene${place ? `: the party is split up, and they are at ${place}` : ": the party is split up"}.`,
    "A call reaches only who is in the scene.",
    place
      ? `If the story has turned to them, cut the scene first with move_party (name "${place}", characterIds ${ids})${here ? `; if they have come here, move_party with name "${here}" and the same characterIds` : ""}.`
      : `If the story has turned to them or they have come here, call move_party first with the place and characterIds ${ids}.`,
    "Nothing was rolled or spent.",
  ].join(" ");
}

// ---- the party parting, read from the players' own words ----

// A small narrator does not say who goes. Of twelve plays on a 20B model in
// which one character slipped off alone, it named who went once, and in four
// it called no move_party at all: the rule was in the tool's description and
// then in the tool's result, and it moved "the party" all the same. So the
// players' own words are read once as the turn opens, by the utility model:
// who does not go, and where the others are going. The storyteller is told
// before it writes, its move_party of "everyone" is read as a move of those
// who go, and a turn that still records nothing is put right by the server.
// Nobody is left behind on a guess: each name comes with the words that say
// so, and those words must be in what the players wrote.
export const PARTING_PROMPT_START = "You read what the players at a tabletop RPG table just said, and tell whether the party parts ways";

// What a read found, kept on the party record for the turn it was read for:
// who stays, where the others go ("" when the words name no place), and the
// newest line it read.
export type PartyParting = { ids: string[]; to: string; at: number };

export function normalizeParting(raw: unknown): PartyParting | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const ids = Array.isArray(record.ids) ? [...new Set((record.ids as unknown[]).map((id) => String(id)))].filter(Boolean).slice(0, 12) : [];
  return ids.length ? { ids, to: String(record.to ?? "").trim().slice(0, PLACE_MAX), at: whole(record.at) } : null;
}

export function partingReading(input: { party: readonly string[]; place: string; words: readonly string[] }): { role: "system" | "user"; content: string }[] {
  const system = [
    `${PARTING_PROMPT_START}. You never judge the story or the rules.`,
    "The party parts when some of the listed characters go to another place and others do not go with them: they stay behind, wait, keep watch where they are, are left or sent elsewhere, or go a different way.",
    "Nobody parts when everyone goes together, when nobody leaves the place, or when someone only does something else in the same place. A character nobody says anything about goes with the others. When in doubt, nobody parts.",
    'Reply with JSON only: {"stays":[{"name":"who does not go","quote":"the exact words from the players that say so"}],"to":"the place the others go to, in a few words, or empty"}. Nobody parts: {"stays":[],"to":""}.',
  ].join("\n");
  const user = [`The party: ${input.party.join(", ")}`, input.place ? `They are at: ${input.place}` : "", `The players' words:\n${input.words.join("\n")}`].filter(Boolean).join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// Who stays and where the others go, each stayer held to a listed character
// and to words the players really wrote. Null when the reply cannot be read,
// names nobody, or leaves nobody to go.
export function parseParting(reply: string, party: readonly Named[], words: string, place: string): { ids: string[]; to: string } | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  const record = parsed && typeof parsed === "object" ? (parsed as { stays?: unknown; to?: unknown }) : null;
  if (!record || !Array.isArray(record.stays)) {
    return null;
  }
  const said = textKey(words);
  const ids = new Set<string>();
  for (const entry of record.stays) {
    const { name, quote } = (entry ?? {}) as { name?: unknown; quote?: unknown };
    const sheet = typeof name === "string" ? party.find((member) => textKey(member.name) === textKey(name)) : undefined;
    if (sheet && typeof quote === "string" && textKey(quote).length >= 3 && said.includes(textKey(quote))) {
      ids.add(sheet.id);
    }
  }
  if (!ids.size || ids.size >= party.length) {
    return null;
  }
  // The place as the players named it, said as a place is: no sentence, and
  // never the place they are leaving.
  const named = typeof record.to === "string" ? record.to.replace(/[.!?\s]+$/, "").trim().slice(0, 60) : "";
  const to = named && !samePlace(named, place) ? `${named.charAt(0).toUpperCase()}${named.slice(1)}` : "";
  return { ids: [...ids], to };
}

// What the storyteller is told as the turn opens, when the players' words
// part the party: who is not going, and the call that says so.
export function partingBlock(parting: PartyParting, present: readonly Named[]): string {
  const stays = present.filter((sheet) => parting.ids.includes(sheet.id));
  const goes = present.filter((sheet) => !parting.ids.includes(sheet.id));
  if (!stays.length || !goes.length) {
    return "";
  }
  return [
    `By the players' own words the party parts ways this turn: ${nameList(stays.map((sheet) => sheet.name))} ${stays.length === 1 ? "does" : "do"} not go with ${nameList(goes.map((sheet) => sheet.name))}.`,
    `When ${goes.length === 1 ? "that one goes" : "they go"} anywhere, your first call is move_party with the place and characterIds ${JSON.stringify(goes.map((sheet) => sheet.id))}: the server keeps ${nameList(stays.map((sheet) => sheet.name))} where they are.`,
    "Narrate only those who go; the scene comes back to the others when they act.",
  ].join(" ");
}

// How much of the time the scene was away is left for a rest to have been
// taken in: what the cut counted, less whatever the clock has moved since.
export function restCredit(cut: PartyCut | null, now: number): number {
  return cut ? Math.max(0, cut.behind - Math.max(0, now - cut.clock)) : 0;
}
