import { replyJson } from "../worldforge/forge.ts";
import { textKey } from "../language/text-logic.ts";
import { slug, type Draft, type DraftRecord, type RecordKind } from "./draft-logic.ts";

// The model's half of an import: the book cut into pieces that fit the
// model's window, what each piece is asked, and the answer read back as
// records. The rule WorldForge's forge settled on holds here too: resolve
// generously, store strictly. A field the model invents is dropped, a kind
// it misnames is not guessed at, and a name already found in the book's
// layout is merged into, never duplicated. Pure.

export type Chunk = { index: number; title: string; path: string[]; pages: [number, number]; text: string };

// Characters per piece for a model's context window: a quarter of the
// window for the book's words (about four characters a token), leaving the
// instructions and the answer the rest. Between 4,000 characters (a 16K
// local model) and 48,000 (a large hosted one), where an answer of a
// few thousand tokens still covers a piece in full.
export function chunkChars(contextTokens: number): number {
  return Math.max(4_000, Math.min(48_000, Math.floor(contextTokens * 4 * 0.25)));
}

// The sections in book order, packed into pieces of up to `size`
// characters. A section larger than a piece is split between paragraphs;
// small neighbours share a piece and keep their titles.
export function chunksOf(sections: Draft["sections"], size: number): Chunk[] {
  const out: Chunk[] = [];
  let current: Chunk | null = null;
  const flush = () => {
    if (current && current.text.trim()) out.push(current);
    current = null;
  };
  for (const section of sections) {
    const titled = section.title && section.id !== 0 ? `## ${section.path.join(" > ")}\n\n${section.text}` : section.text;
    if (!titled.trim() || titled.replace(/\s+/g, "").length < 40) continue;
    const pieces = splitText(titled, size);
    for (const piece of pieces) {
      const room: Chunk | null = current;
      if (room && room.text.length + piece.length + 2 <= size) {
        room.text = `${room.text}\n\n${piece}`;
        room.pages = [room.pages[0], Math.max(room.pages[1], section.pageEnd)];
        continue;
      }
      flush();
      current = { index: out.length, title: section.title, path: section.path, pages: [section.pageStart, section.pageEnd], text: piece };
    }
  }
  flush();
  return out.map((chunk, index) => ({ ...chunk, index }));
}

function splitText(text: string, size: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n\n", size);
    if (cut < size * 0.5) cut = rest.lastIndexOf(". ", size) + 1;
    if (cut <= 0) cut = size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

const SYSTEM = [
  "You read pages of a tabletop roleplaying adventure and list what a game master needs to run it, as JSON.",
  "Use only what the pages say. Never invent a name, a number or an event. Leave a field out when the pages do not say it.",
  "Answer with one JSON object and nothing else, with these keys (each a list, each list at most 12 items):",
  '"npcs": [{"name", "role" (their job or place in the story, a few words), "race", "gender" ("male", "female" or "nonbinary"), "attitude" ("hostile", "indifferent" or "friendly" toward the heroes), "description" (looks and manner), "personality", "goals", "secret" (what the GM knows that the heroes do not), "location" (the place they are found), "faction", "statBlock" (the creature stat block they fight with, by its printed name)}]',
  '"places": [{"name", "description", "partOf" (the bigger place it is in), "connections" (names of places it leads to)}]',
  '"factions": [{"name", "goal", "description", "attitude" ("hostile", "wary", "neutral", "friendly" or "allied" toward the heroes), "members" (names of people in it)}] only organized groups with a shared aim (a cult, a guild, a gang, a noble house, a tribe with a leader). Not a kind of creature ("kobolds") or a set of objects',
  '"items": [{"name", "kind" ("magic_item" or "gear"), "rarity", "attunement" (true or false), "description" (what it does, in the book\'s words)}] only things with an effect in play: magic items, potions, scrolls, and gear the story turns on (a key, a map, a relic). Not coins, gems, art objects or ordinary weapons and armor',
  '"spells": [{"name", "level" (0 for a cantrip to 9), "school", "description" (what it does)}] only spells the pages describe in full, not ones they only name',
  '"encounters": [{"name", "place", "creatures": [{"name", "count"}], "notes" (tactics, what sets it off, the treasure)}]',
  '"scenes": [{"title", "kind" ("hook", "event", "encounter", "setting", "secret", "npc_moment" or "backstory"), "summary" (what happens and what the heroes can do), "place", "npc"}]',
  '"secrets": [{"title", "about" (the person, place or faction it is about), "notes", "knownBy" (names of people who know it)}]',
  '"links": [{"from", "to", "label" (a few words: "serves", "rival of", "member of", "lives in", "guards")}]',
  "Only named people go in npcs (not \"a guard\"). Only places with a name go in places. Creatures in encounters are named as their stat block is titled, one kind of creature per entry (\"Kobold\" with count 6, not \"6 kobolds\").",
  "The book may be written for any game (5th edition, an older edition, Old-School Essentials, Pathfinder): report what it says; the import turns it into SRD 5.1 terms.",
].join("\n");

export function chunkMessages(bookTitle: string, outline: string[], chunk: Chunk): Array<{ role: "system" | "user"; content: string }> {
  const contents = outline.slice(0, 60).join("; ");
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: [
        `The adventure: ${bookTitle}.`,
        contents ? `Its chapters: ${contents}.` : "",
        `These are pages ${chunk.pages[0]}${chunk.pages[1] !== chunk.pages[0] ? `-${chunk.pages[1]}` : ""}, from ${chunk.path.join(" > ") || "the start"}. Lines starting ">" are read-aloud text.`,
        "",
        chunk.text,
      ]
        .filter((line) => line !== "")
        .join("\n"),
    },
  ];
}

// ---- reading the answer ----

const str = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
// A model asked for names sometimes fills a slot with a placeholder
// ("None", "N/A"); that is no one, and makes no record.
const PLACEHOLDER = /^(none|n\/?a|unknown|unnamed|nobody|nothing|tbd|-+|\?+)$/i;
const nameOf = (value: unknown, max: number) => {
  const name = str(value, max);
  return PLACEHOLDER.test(name) ? "" : name;
};
const list = (value: unknown, max = 12): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").slice(0, max) : [];
const names = (value: unknown, max = 20) =>
  Array.isArray(value) ? value.map((item) => str(item, 120)).filter(Boolean).slice(0, max) : typeof value === "string" ? [str(value, 120)].filter(Boolean) : [];
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
  const text = str(value, 40).toLowerCase();
  return (allowed as readonly string[]).includes(text) ? (text as T) : fallback;
};

export type ChunkFindings = {
  spells?: Array<Record<string, unknown>>;
  npcs: Array<Record<string, unknown>>;
  places: Array<Record<string, unknown>>;
  factions: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
  encounters: Array<Record<string, unknown>>;
  scenes: Array<Record<string, unknown>>;
  secrets: Array<Record<string, unknown>>;
  links: Array<{ from: string; to: string; label: string }>;
};

export const NO_FINDINGS: ChunkFindings = { npcs: [], places: [], factions: [], items: [], encounters: [], scenes: [], secrets: [], links: [] };

const NAME_WORDS = /^(a|an|the|some|several|two|three|four|five|many)\s/i;

// One answer, coerced to what a workshop could hold. Null when the answer
// is not JSON at all (asked again, once, by the job).
export function readChunkReply(raw: string): ChunkFindings | null {
  const parsed = replyJson(raw) as Record<string, unknown> | null;
  if (!parsed) return null;
  const named = (item: Record<string, unknown>) => {
    const name = nameOf(item.name ?? item.title, 120);
    return name && !NAME_WORDS.test(name) ? name : "";
  };
  return {
    npcs: list(parsed.npcs)
      .map((item) => ({
        name: named(item),
        role: str(item.role, 40),
        race: str(item.race, 40),
        gender: oneOf(item.gender, ["male", "female", "nonbinary"] as const, "" as never),
        attitude: oneOf(item.attitude, ["hostile", "indifferent", "friendly"] as const, "indifferent"),
        description: str(item.description, 500),
        personality: str(item.personality, 2_000),
        goals: str(item.goals, 2_000),
        secret: str(item.secret, 2_000),
        location: str(item.location, 120),
        faction: str(item.faction, 80),
        statBlock: str(item.statBlock, 80),
      }))
      .filter((item) => item.name),
    places: list(parsed.places)
      .map((item) => ({ name: named(item), description: str(item.description, 4_000), partOf: str(item.partOf, 120), connections: names(item.connections, 20) }))
      .filter((item) => item.name),
    factions: list(parsed.factions)
      .map((item) => ({
        name: nameOf(item.name, 80),
        goal: str(item.goal, 400),
        description: str(item.description, 400),
        attitude: oneOf(item.attitude, ["hostile", "wary", "neutral", "friendly", "allied"] as const, "neutral"),
        members: names(item.members, 40),
      }))
      .filter((item) => item.name),
    items: list(parsed.items)
      .map((item) => ({
        name: nameOf(item.name, 80),
        kind: oneOf(item.kind, ["magic_item", "gear"] as const, "magic_item"),
        rarity: str(item.rarity, 40),
        attunement: item.attunement === true,
        description: str(item.description, 6_000),
      }))
      .filter((item) => item.name && item.description),
    spells: list(parsed.spells)
      .map((item) => ({ name: nameOf(item.name, 80), level: Math.max(0, Math.min(9, Math.round(Number(item.level) || 0))), school: str(item.school, 20).toLowerCase(), description: str(item.description, 6_000) }))
      .filter((item) => item.name && item.description),
    encounters: list(parsed.encounters)
      .map((item) => ({
        name: nameOf(item.name, 120),
        place: str(item.place, 120),
        creatures: list(item.creatures, 8)
          .map((creature) => ({ name: nameOf(creature.name, 80), count: Math.max(1, Math.min(20, Math.round(Number(creature.count) || 1))) }))
          .filter((creature) => creature.name),
        notes: str(item.notes, 4_000),
      }))
      .filter((item) => item.name && item.creatures.length),
    scenes: list(parsed.scenes)
      .map((item) => ({
        title: str(item.title, 120),
        kind: oneOf(item.kind, ["hook", "event", "encounter", "setting", "secret", "npc_moment", "backstory"] as const, "event"),
        summary: str(item.summary, 3_000),
        place: str(item.place, 120),
        npc: str(item.npc, 120),
      }))
      .filter((item) => item.title && item.summary),
    secrets: list(parsed.secrets)
      .map((item) => ({ title: str(item.title, 120), about: str(item.about, 120), notes: str(item.notes, 2_000), knownBy: names(item.knownBy, 20) }))
      .filter((item) => item.title),
    links: list(parsed.links, 30)
      .map((item) => ({ from: str(item.from, 120), to: str(item.to, 120), label: str(item.label, 40) || "linked to" }))
      .filter((item) => item.from && item.to && textKey(item.from) !== textKey(item.to)),
  };
}

// ---- merging into the draft ----

// The name a record is matched by: "12. Throne Room" and "Throne Room" are
// one place; "The Red Wizard" and "Red Wizard" one person.
export function matchKey(name: string): string {
  return textKey(name.replace(/^[A-Z]{0,2}\d{1,3}[a-z]?\.\s+/, "").replace(/^the\s+/i, ""));
}

const join = (a: unknown, b: unknown, max: number) => {
  const first = typeof a === "string" ? a.trim() : "";
  const second = typeof b === "string" ? b.trim() : "";
  if (!second || first.includes(second)) return first.slice(0, max);
  if (!first || second.includes(first)) return second.slice(0, max);
  return `${first}\n\n${second}`.slice(0, max);
};

// Every chunk's findings folded into the draft: a new name becomes a
// record (from "model"), a known one gains what it lacked, and each keeps
// the pages its piece covered as where it came from.
export function mergeFindings(draft: Draft, findings: Array<{ chunk: Chunk; found: ChunkFindings }>): Draft {
  const records = draft.records.map((record) => ({ ...record, data: { ...record.data }, pages: [...record.pages], check: [...record.check] }));
  const index = new Map<string, DraftRecord>();
  const keyOf = (kind: RecordKind, name: string) => `${kind}:${matchKey(name)}`;
  const used = new Set(records.map((record) => record.key));
  for (const record of records) index.set(keyOf(record.kind, record.name), record);
  const upsert = (kind: RecordKind, name: string, pages: number[], source: string, data: Record<string, unknown>, merge: (record: DraftRecord) => void) => {
    const existing = index.get(keyOf(kind, name));
    if (existing) {
      merge(existing);
      existing.pages = [...new Set([...existing.pages, ...pages])].sort((a, b) => a - b);
      return existing;
    }
    let key = `${kind}:${slug(name)}`;
    for (let n = 2; used.has(key); n += 1) key = `${kind}:${slug(name)}-${n}`;
    used.add(key);
    const record: DraftRecord = { key, kind, name, pages, source: source.slice(0, 1_200), check: [], include: true, from: "model", data };
    records.push(record);
    index.set(keyOf(kind, name), record);
    return record;
  };

  const links: Array<{ from: string; to: string; label: string }> = [];
  const secrets: Array<Record<string, unknown>> = [];
  for (const { chunk, found } of findings) {
    let sceneOrder = 0;
    const pages = [chunk.pages[0], chunk.pages[1]].filter((page, at, all) => all.indexOf(page) === at);
    const source = chunk.text.slice(0, 1_200);
    for (const npc of found.npcs) {
      upsert("npc", String(npc.name), pages, source, { ...npc }, (record) => {
        for (const field of ["role", "race", "gender", "location", "faction", "statBlock"] as const) if (!record.data[field] && npc[field]) record.data[field] = npc[field];
        record.data.description = join(record.data.description, npc.description, 500);
        record.data.personality = join(record.data.personality, npc.personality, 4_000);
        record.data.goals = join(record.data.goals, npc.goals, 4_000);
        record.data.secret = join(record.data.secret, npc.secret, 4_000);
        if (npc.attitude !== "indifferent") record.data.attitude = npc.attitude;
      });
    }
    for (const place of found.places) {
      upsert("location", String(place.name), pages, source, { layoutDescription: place.description, partOf: place.partOf, connections: place.connections }, (record) => {
        record.data.layoutDescription = join(record.data.layoutDescription, place.description, 8_000);
        if (!record.data.partOf && place.partOf) record.data.partOf = place.partOf;
        record.data.connections = [...new Set([...((record.data.connections as string[]) ?? []), ...(place.connections as string[])])].slice(0, 40);
      });
    }
    for (const faction of found.factions) {
      upsert("faction", String(faction.name), pages, source, { ...faction }, (record) => {
        record.data.goal = join(record.data.goal, faction.goal, 400);
        record.data.description = join(record.data.description, faction.description, 400);
        record.data.members = [...new Set([...((record.data.members as string[]) ?? []), ...(faction.members as string[])])].slice(0, 40);
      });
    }
    for (const item of found.items) {
      upsert("item", String(item.name), pages, source, { ...item }, (record) => {
        record.data.description = join(record.data.description, item.description, 6_000);
        if (!record.data.rarity && item.rarity) record.data.rarity = item.rarity;
        if (item.attunement) record.data.attunement = true;
      });
    }
    for (const spell of found.spells ?? []) {
      upsert("spell", String(spell.name), pages, source, { ...spell }, (record) => {
        record.data.description = join(record.data.description, spell.description, 6_000);
      });
    }
    for (const encounter of found.encounters) {
      upsert("encounter", String(encounter.name), pages, source, { ...encounter }, (record) => {
        record.data.notes = join(record.data.notes, encounter.notes, 8_000);
      });
    }
    for (const scene of found.scenes) {
      sceneOrder += 1;
      // In book order, after the chapter card of the pages they came from.
      upsert("beat", String(scene.title), pages, source, { beatKind: scene.kind, body: scene.summary, place: scene.place, npc: scene.npc, order: chunk.pages[0] * 1_000 + sceneOrder }, (record) => {
        record.data.body = join(record.data.body, scene.summary, 4_000);
        if (!record.data.place && scene.place) record.data.place = scene.place;
        if (!record.data.npc && scene.npc) record.data.npc = scene.npc;
      });
    }
    links.push(...found.links);
    secrets.push(...found.secrets);
  }
  // The chapter cards stay as the story's headings, the model's scenes
  // between them in book order.
  return { ...draft, records, links: dedupeLinks([...(draft.links ?? []), ...links]), secrets: [...(draft.secrets ?? []), ...secrets] };
}

function dedupeLinks(links: Array<{ from: string; to: string; label: string }>) {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${matchKey(link.from)}|${matchKey(link.to)}|${link.label.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---- SRD 5.1 equivalents the model picks ----

// The creatures no stat block or SRD name settled, each with the SRD 5.1
// creatures near its type and challenge, for the model to choose the one it
// is. It may only answer with a name from that creature's own list, or
// "none": a list held to the creature's power keeps a band of poachers from
// becoming a bat.
// `details` runs beside `candidates`: each one's size, type and challenge,
// so the model weighs what a candidate is and not only its name.
export type EquivalentAsk = { name: string; hint: string; candidates: string[]; details?: string[] };

export function equivalentMessages(asks: EquivalentAsk[]): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: [
        "You match creatures from a tabletop adventure to their equivalent in the System Reference Document 5.1.",
        "For each creature, choose from ITS OWN list the SRD 5.1 creature it is, or the one most like it in kind (a band of human raiders is a Bandit, a swarm of bees is a Swarm of Insects, an animated statue is an Animated Armor). Match what it is first (its type, its size, how it fights in what the book prints), then its challenge. People are never beasts or monsters; a beast is never a person. Answer \"none\" when nothing on its list is that kind of creature.",
        'Answer with one JSON object: {"matches": [{"name": the creature as given, "srd": a name from its list or "none"}]}.',
      ].join("\n"),
    },
    {
      role: "user",
      content: asks
        .map((ask) => `- ${ask.name} (${ask.hint}). Choose from: ${ask.candidates.map((name, index) => (ask.details?.[index] ? `${name} [${ask.details[index]}]` : name)).join("; ")}.`)
        .join("\n"),
    },
  ];
}

export function readEquivalents(raw: string, asks: EquivalentAsk[]): Map<string, string> {
  const parsed = replyJson(raw) as { matches?: unknown } | null;
  const out = new Map<string, string>();
  if (!parsed || !Array.isArray(parsed.matches)) return out;
  const byName = new Map(asks.map((ask) => [matchKey(ask.name), ask]));
  for (const item of parsed.matches) {
    if (!item || typeof item !== "object") continue;
    const ask = byName.get(matchKey(str((item as Record<string, unknown>).name, 120)));
    if (!ask) continue;
    const wanted = textKey(str((item as Record<string, unknown>).srd, 120));
    const srd = ask.candidates.find((candidate) => textKey(candidate) === wanted);
    if (srd) out.set(ask.name, srd);
  }
  return out;
}
