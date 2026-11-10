// Argument normalizers for model-supplied tool calls: an ability written as
// its rules name ("Wisdom", "DEX save") reaches its id, and a boolean sent as
// a string is the boolean it names. A fixed choice's other values are not
// guessed from words: its z.enum refuses them, and the refusal lists the
// values (src/lib/dm/tool-errors.ts invalidArguments), which reads the same at
// every table language. Pure, for the test suite.

import { textKey } from "../language/text-logic.ts";

const ABILITY_NAMES: Record<string, string> = {
  str: "strength",
  dex: "dexterity",
  con: "constitution",
  int: "intelligence",
  wis: "wisdom",
  cha: "charisma",
};

// "Wisdom" / "wis." / "DEX save" -> the three-letter id. Only genuine
// prefixes of the full ability name map ("charm" stays "charm").
export function normalizeAbility(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const cleaned = value.trim().toLowerCase().replace(/[^a-z]/g, " ").trim();
  const first = cleaned.split(/\s+/)[0] ?? "";
  for (const [id, full] of Object.entries(ABILITY_NAMES)) {
    if (first === id || (first.length >= 3 && full.startsWith(first))) {
      return id;
    }
  }
  return value;
}

// The strings "true" and "false" a model sometimes sends for a boolean
// argument, turned into the booleans they mean before any schema reads them.
// A tool's z.coerce.boolean() reads every non-empty string as true, so
// useInspiration: "false" spent the Inspiration it was told to keep. A value
// that is exactly one of the two words is touched, at the top level and in
// the entries of a list (pc_attack's attacks: stunningStrike: "false" spent
// the ki): no text argument of any tool is ever the bare word, and anything
// that is not a JSON object is handed back as it came for the handler to
// refuse.
export function strictBooleanArgs(rawArguments: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments || "{}");
  } catch {
    return rawArguments;
  }
  if (!isRecord(parsed)) {
    return rawArguments;
  }
  const out = Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, Array.isArray(value) ? value.map((entry) => (isRecord(entry) ? strictEntries(entry) : entry)) : strict(value)]),
  );
  const coerced = JSON.stringify(out);
  return coerced === JSON.stringify(parsed) ? rawArguments : coerced;
}

// ---- the door -----------------------------------------------------------
//
// What every GM tool call's arguments pass, once, before any gate or handler
// reads them: the model's turn loop (src/lib/dm/turn.ts resolveModelCall)
// and the console's and agent programs' dispatch (src/lib/dm/invoke-
// dispatch.ts) call it through turn.ts modelCallArguments, and a new caller
// of a handler goes through it too. Each slip was read one way at one door
// and another way at the next (gap sweep 2026-11-09):
//
//   null for an optional field is the field left out. z.coerce.number read
//     it as 0: travel {hours: null} was a journey of 0 hours.
//   "" for a number, a yes/no or a fixed choice is the field left out (an
//     empty text stays a value: the console's "left empty to clear").
//   one value where the schema asks a list is a list of one, and a text in
//     lines is its lines (listOf says which); a list of one text where it
//     asks one text is that text.
//   a character named by name where an id is asked reaches the id, so the
//     AI's gate (ai-gate.ts) reads the same sheet the handler resolves:
//     set_condition with characterId "Mira" laid prone with no save, where
//     her id was refused and asked for one.
//   a list of character ids is refused at the first one that names nobody,
//     with who there is (tool-errors.ts unknownRef): eleven tools dropped it
//     in silence and went on with the rest (party_award paid one of two,
//     roll_treasure paid the whole hoard to one, cast_buff cast on the
//     caster).
//   an id in such a list that is no character's but that the tool's own
//     handler takes (cast_buff's Bless on an ogre the party dominates) is
//     asked of `alsoNames`, which the caller builds from the lookup that
//     handler reads, so the door and the handler cannot disagree on it.
export type DoorField = { type?: unknown; enum?: unknown; items?: { type?: unknown } };
export type DoorRecord = { id: string; name: string };
export type DoorAlsoNames = (key: string, ref: string, args: Readonly<Record<string, unknown>>) => boolean;

const SINGLE_REF = /^(?:characterId|casterId|healerId|casterCharacterId|targetCharacterId|sourceCharacterId|toCharacterId|storeInCharacterId)$/;
const LIST_REF = /^(?:characterIds|[a-z]+CharacterIds)$/;

export function doorArgs(
  rawArguments: string,
  { properties = {}, sheets = [], alsoNames }: { properties?: Record<string, DoorField>; sheets?: readonly DoorRecord[]; alsoNames?: DoorAlsoNames },
): { rawArguments: string } | { refusal: { error: string; retry: true } } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments || "{}");
  } catch {
    return { rawArguments };
  }
  if (!isRecord(parsed)) {
    return { rawArguments };
  }
  const out: Record<string, unknown> = {};
  for (const [key, sent] of Object.entries(parsed)) {
    const field = properties[key] ?? {};
    let value: unknown = sent;
    if (value === null) {
      continue;
    }
    if (value === "" && (field.type === "number" || field.type === "integer" || field.type === "boolean" || Array.isArray(field.enum))) {
      continue;
    }
    if (field.type === "array" && !Array.isArray(value)) {
      value = listOf(key, value, field);
    } else if (field.type === "string" && Array.isArray(value) && value.length === 1 && typeof value[0] === "string") {
      value = value[0];
    }
    if (Array.isArray(value)) {
      // A list's entries (pc_attack's attacks, grant_item's items) are read
      // field by field as the top level is: null is the field left out.
      value = value.map((entry) => (isRecord(entry) ? strictEntries(Object.fromEntries(Object.entries(entry).filter(([, inner]) => inner !== null))) : entry));
    } else {
      value = strict(value);
    }
    if (sheets.length && SINGLE_REF.test(key) && typeof value === "string") {
      value = sheetIdFor(value, sheets) ?? value;
    }
    out[key] = value;
  }
  // The lists after every single ref is read, so `alsoNames` sees the actor's
  // id however the call named them.
  for (const [key, value] of Object.entries(out)) {
    if (!sheets.length || !LIST_REF.test(key) || !Array.isArray(value)) {
      continue;
    }
    const ids: unknown[] = [];
    for (const ref of value) {
      if (typeof ref !== "string") {
        ids.push(ref);
        continue;
      }
      const id = sheetIdFor(ref, sheets) ?? (alsoNames?.(key, ref.trim(), out) ? ref.trim() : null);
      if (id === null) {
        const listed = [...new Set(sheets.map((sheet) => `${sheet.name} (${sheet.id})`))];
        // Said as the handlers it stands in front of said it (travel's "names
        // nobody at this table ... Nothing moved"), for every list.
        return { refusal: { error: `Unknown ${key} "${ref}": it names nobody at this table. Use one of: ${listed.join(", ")}. Nothing moved and nothing was spent: nothing was done for anyone in the list.`, retry: true } };
      }
      ids.push(id);
    }
    out[key] = ids;
  }
  const coerced = JSON.stringify(out);
  return { rawArguments: coerced === JSON.stringify(parsed) ? rawArguments : coerced };
}

// One value sent where a list is asked. A text is the list its handler read
// it as before the door: lines where the list is of texts (the console's
// "Objectives, one per line" for set_quest, whose handler split them; a list
// of the one text left a quest with a single objective of two lines, and
// tick_objective found neither), and lines or commas where it is of
// characters (send_whisper's comma-joined ids). Anything else is a list of
// one.
function listOf(key: string, value: unknown, field: DoorField): unknown[] {
  if (typeof value !== "string") {
    return [value];
  }
  const ids = LIST_REF.test(key);
  if (!ids && field.items?.type !== "string") {
    return [value];
  }
  const parts = value.split(ids ? /\r?\n|,/ : /\r?\n/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [value];
}

// A sheet's id from its id or its whole name (case and spacing aside, as
// rolls.ts resolveSheetRef reads one), or null. A name two sheets share
// names neither.
function sheetIdFor(ref: string, sheets: readonly DoorRecord[]): string | null {
  const trimmed = ref.trim();
  if (!trimmed) {
    return null;
  }
  if (sheets.some((sheet) => sheet.id === trimmed)) {
    return trimmed;
  }
  const key = textKey(trimmed);
  const named = sheets.filter((sheet) => textKey(sheet.name) === key);
  return named.length === 1 ? named[0].id : null;
}

function strict(value: unknown): unknown {
  const word = typeof value === "string" ? value.trim().toLowerCase() : null;
  return word === "true" || word === "false" ? word === "true" : value;
}

const strictEntries = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, strict(value)]));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
