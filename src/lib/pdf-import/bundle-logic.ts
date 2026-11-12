import { matchKey } from "./ai-logic.ts";
import type { Draft, DraftRecord } from "./draft-logic.ts";
import { gridFit, type GridGuess } from "./picture-logic.ts";

// A reviewed draft as a workshop bundle (src/lib/workshop/bundle-schema.ts),
// so an import goes through the very checks a bundle file does and lands
// as a new workshop; or, from WorldForge, as a WorldForge file laid into
// the world already open. Indexes stand for links (a place's map, a card's
// person), as bundles have them. Pictures come in through `picture`, which
// the server answers from the import's own folder. Pure.

export type PictureLookup = (pictureId: string) => string;

type Bundleish = Record<string, unknown> & {
  maps: Record<string, unknown>[];
  locations: Record<string, unknown>[];
  npcs: Record<string, unknown>[];
  factions: Record<string, unknown>[];
  encounters: Record<string, unknown>[];
  tables: Record<string, unknown>[];
  lore: Record<string, unknown>[];
  monsters: Record<string, unknown>[];
  homebrew: Record<string, unknown>[];
  storyboard: Record<string, unknown>[];
};

const str = (value: unknown) => (typeof value === "string" ? value : "");
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`);
const MAX_BEATS = 120;
const MAX_MAP_LABELS = 40;

export const BEAT_KIND_OF: Record<string, string> = {
  hook: "hook",
  event: "event",
  encounter: "encounter",
  setting: "setting",
  secret: "secret",
  npc_moment: "npc_moment",
  backstory: "backstory",
};

// Where each record's book name points after the import: a monster that is
// the built-in creature by another printing keeps the built-in's name; one
// that differs from a built-in of the same name is kept under the book's
// title so a fight never deploys the wrong one.
export function monsterNames(records: DraftRecord[], bookTitle: string): Map<string, string> {
  const out = new Map<string, string>();
  const short = cut(bookTitle.replace(/[()]/g, "").trim() || "Imported", 30);
  for (const record of records) {
    if (record.kind !== "monster") continue;
    const srd = str(record.data.srd);
    const differs = record.data.srdDiffers === true;
    // A copy with the SRD's numbers under the book's name keeps that name;
    // a 5e book's own version of an SRD creature is kept under the title.
    out.set(matchKey(record.name), record.data.asSrd ? record.name : srd && !differs ? srd : differs ? cut(`${record.name} (${short})`, 120) : record.name);
  }
  return out;
}

// The records that come in: the ticked ones, and any creature a ticked
// fight or person fights with, so leaving a creature out never leaves a
// fight with nothing to play.
export function takenRecords(draft: Draft): DraftRecord[] {
  const ticked = draft.records.filter((record) => record.include);
  const used = new Set<string>();
  for (const record of ticked) {
    if (record.kind === "encounter") for (const creature of (record.data.creatures as Array<{ name: string }> | undefined) ?? []) used.add(matchKey(creature.name));
    if (record.kind === "npc" && str(record.data.statBlock)) used.add(matchKey(str(record.data.statBlock)));
  }
  return draft.records.filter((record) => record.include || (record.kind === "monster" && (used.has(matchKey(record.name)) || used.has(matchKey(record.key)))));
}

export function draftToBundle(draft: Draft, fileName: string, picture: PictureLookup): Bundleish {
  const included = takenRecords(draft);
  const of = (kind: DraftRecord["kind"]) => included.filter((record) => record.kind === kind);
  const renamed = monsterNames(included, draft.title);
  const creature = (name: string) => renamed.get(matchKey(name)) ?? name;

  // Maps first: places and fights point at them.
  const maps = of("map").map((record) => {
    const width = Number(record.data.width) || 0;
    const height = Number(record.data.height) || 0;
    const fit = gridFit(width, height, (record.data.grid as GridGuess | null) ?? null);
    const keys = (record.data.keys as Array<{ key: string; fx: number; fy: number }> | undefined) ?? [];
    const seen = new Set<string>();
    const labels = [];
    for (const key of keys) {
      const x = Math.max(0, Math.min(fit.width - 1, Math.floor(key.fx * fit.width)));
      const y = Math.max(0, Math.min(fit.height - 1, Math.floor(key.fy * fit.height)));
      if (seen.has(`${x},${y}`)) continue;
      seen.add(`${x},${y}`);
      labels.push({ x, y, text: key.key, dmOnly: true });
      if (labels.length >= MAX_MAP_LABELS) break;
    }
    return {
      name: cut(record.name, 120),
      notes: cut(`From page ${record.pages.join(", ")} of ${fileName}.`, 4_000),
      tags: ["imported"],
      width: fit.width,
      height: fit.height,
      terrain: ".".repeat(fit.width * fit.height),
      // The light the table sees it in; a printed map is drawn lit.
      ambient: "bright",
      backdrop: picture(str(record.data.picture)),
      backdropTransform: { offsetX: fit.offsetX, offsetY: fit.offsetY, scale: fit.scale, opacity: 1 },
      labels,
      ref: "",
    };
  });
  const mapRecords = of("map");
  const mapIndexForSite = (siteKey: string) => {
    const at = mapRecords.findIndex((record) => siteKey && str(record.data.site) === siteKey);
    return at >= 0 ? at : null;
  };

  const locationRecords = of("location");
  const locations = locationRecords.map((record) => ({
    name: cut(record.name, 120),
    layoutDescription: cut(str(record.data.layoutDescription), 8_000),
    connections: strings(record.data.connections).map((name) => cut(name, 120)).slice(0, 40),
    map: mapIndexForSite(str(record.data.site) || record.key),
    partOf: str(record.data.partOf) ? cut(str(record.data.partOf), 120) : null,
    ref: "",
  }));
  const locationIndex = new Map(locationRecords.map((record, index) => [matchKey(record.name), index]));

  // Portraits: a picture printed on a person's page, named in its caption
  // or the only person on that page.
  const art = of("art");
  const usedArt = new Set<string>();
  const npcRecords = of("npc");
  const portraitFor = (record: DraftRecord) => {
    const onPage = art.filter((picture) => !usedArt.has(picture.key) && picture.pages.some((page) => record.pages.includes(page)));
    const named = onPage.find((picture) => matchKey(picture.name).includes(matchKey(record.name)));
    const peopleThere = npcRecords.filter((other) => other.pages.some((page) => onPage[0]?.pages.includes(page))).length;
    const chosen = named ?? (onPage.length && peopleThere === 1 ? onPage[0] : undefined);
    if (!chosen) return "";
    usedArt.add(chosen.key);
    return picture(str(chosen.data.picture));
  };

  // A person's ties to other people in the book, as the Cast keeps them
  // (src/lib/dm/npc-logic.ts parseRelations): by name, with the book's word
  // for the tie as the note.
  const npcNames = new Set(npcRecords.map((record) => matchKey(record.name)));
  const relationsOf = (name: string) =>
    (draft.links ?? [])
      .filter((link) => matchKey(link.from) === matchKey(name) && npcNames.has(matchKey(link.to)))
      .slice(0, 20)
      .map((link) => ({ npcName: cut(link.to, 80), score: 0, note: cut(link.label, 120) }));
  const npcs = npcRecords.map((record) => {
    const relations = relationsOf(record.name);
    const goals = str(record.data.goals);
    // The Cast keeps a person's looks and manner as one line (`trait`); its
    // personality and goals columns are the engine's own (axes, a scene and
    // an ambition), so the book's words go to the line and the ambition.
    const trait = [str(record.data.description) || str(record.data.trait), str(record.data.personality)].filter(Boolean).join(" ");
    return {
      name: cut(record.name, 120),
      attitude: ["hostile", "indifferent", "friendly"].includes(str(record.data.attitude)) ? str(record.data.attitude) : "indifferent",
      trait: cut(trait, 500),
      location: cut(str(record.data.location), 120),
      role: cut(str(record.data.role), 40),
      // The Cast's own words for it (src/lib/gender.ts).
      gender: ({ male: "Male", female: "Female", nonbinary: "Nonbinary" } as Record<string, string>)[str(record.data.gender)] ?? "",
      race: cut(str(record.data.race).toLowerCase(), 40),
      personality: "",
      goals: goals ? JSON.stringify({ ambition: cut(goals, 200) }) : "",
      relations: relations.length ? JSON.stringify(relations) : "",
      portrait: portraitFor(record),
      // Matched to an SRD creature in the review: the SRD's, never the
      // book's own creature of the same name.
      statBlock: !str(record.data.statBlock) ? "" : swappedToSrd(record) ? cut(str(record.data.statBlock), 80) : cut(creature(npcStatBlock(record, included)), 80),
      ref: "",
    };
  });
  const npcIndex = new Map(npcRecords.map((record, index) => [matchKey(record.name), index]));

  const factions = of("faction")
    .slice(0, 60)
    .map((record) => ({
      name: cut(record.name, 80),
      blurb: cut(str(record.data.description), 400),
      goal: cut(str(record.data.goal), 400),
      attitude: ["hostile", "wary", "neutral", "friendly", "allied"].includes(str(record.data.attitude)) ? str(record.data.attitude) : "neutral",
      members: strings(record.data.members).map((name) => cut(name, 120)).slice(0, 40),
    }));

  const encounterRecords = of("encounter");
  const encounters = encounterRecords.map((record) => {
    const place = str(record.data.place);
    const at = place ? locationIndex.get(matchKey(place)) : undefined;
    const creatures = (record.data.creatures as Array<{ name: string; count: number; asked?: string }> | undefined) ?? [];
    return {
      name: cut(record.name, 120),
      enemies: creatures.slice(0, 8).map((entry) => ({ monster: entry.asked ? entry.name : creature(entry.name), count: entry.count })),
      battlefield: cut(place, 2_000),
      notes: cut([str(record.data.notes), `From page ${record.pages.join(", ")}.`].filter(Boolean).join("\n\n"), 8_000),
      map: { map: at !== undefined ? (locations[at].map as number | null) : null, scene: null, seed: null, theme: null, ambient: null, width: null, height: null },
      ref: "",
    };
  });
  const encounterIndex = new Map(encounterRecords.map((record, index) => [matchKey(record.name), index]));

  const tables = of("table").map((record) => ({
    name: cut(record.name, 120),
    entries: ((record.data.entries as Array<{ min: number; max: number; text: string }>) ?? []).slice(0, 100),
  }));

  // The book's words as the GM's lore; each section's first unclaimed
  // picture goes with it, and pictures nobody claimed become handouts.
  const loreRecords = of("lore");
  const lore = loreRecords.map((record) => {
    const section = Number(record.data.section);
    const image = art.find((picture) => !usedArt.has(picture.key) && Number(picture.data.section) === section);
    if (image) usedArt.add(image.key);
    return {
      category: str(record.data.category) || "other",
      title: cut(record.name, 200),
      body: str(record.data.body),
      tags: strings(record.data.tags).slice(0, 20),
      visibility: record.data.visibility === "party" ? "party" : "dm",
      pinned: false,
      style: "plain",
      image: image ? picture(str(image.data.picture)) : "",
    };
  });
  for (const picture_ of art) {
    if (usedArt.has(picture_.key) || lore.length >= 500) continue;
    lore.push({
      category: "other",
      title: cut(picture_.name.startsWith("Illustration") ? picture_.name : `Illustration: ${picture_.name}`, 200),
      body: `From page ${picture_.pages.join(", ")} of ${fileName}.`,
      tags: ["illustration"],
      visibility: "dm",
      pinned: false,
      style: "plain",
      image: picture(str(picture_.data.picture)),
    });
  }

  // A stat block that could not be read into numbers a fight plays is kept
  // as the GM's lore, as printed, so its words are not lost.
  for (const record of of("monster")) {
    if (record.data.stats || (str(record.data.srd) && record.data.srdDiffers !== true) || lore.length >= 500) continue;
    lore.push({
      category: "other",
      title: cut(`Stat block: ${record.name}`, 200),
      body: cut(str(record.data.text) || `Printed on page ${record.pages.join(", ")} of ${fileName}.`, 20_000),
      tags: ["stat block"],
      visibility: "dm",
      pinned: false,
      style: "plain",
      image: "",
    });
  }

  const monsters = of("monster")
    .filter((record) => !str(record.data.srd) || record.data.srdDiffers === true)
    .filter((record) => record.data.stats)
    .map((record) => ({
      name: creature(record.name),
      desc: cut(str(record.data.text), 8_000),
      stats: record.data.stats,
      extraDamagePerRound: 0,
    }));

  // An SRD item or spell is the SRD's: nothing new is made for it.
  const spells = of("spell")
    .filter((record) => !str(record.data.srd))
    .map((record) => ({
      kind: "spell",
      name: cut(record.name, 80),
      data: { desc: cut(str(record.data.description), 20_000), level: Number(record.data.level) || 0, school: str(record.data.school) },
    }));
  const homebrew = of("item").filter((record) => !str(record.data.srd)).map((record) => ({
    kind: "item",
    name: cut(record.name, 80),
    data: {
      itemKind: record.data.kind === "gear" ? "gear" : "magic_item",
      rarity: cut(str(record.data.rarity), 40),
      requiresAttunement: record.data.attunement === true,
      desc: cut(str(record.data.description), 20_000),
    },
  }));

  // The story, in book order, each card leading to the next.
  const beatRecords = of("beat")
    .sort((a, b) => Number(a.data.order ?? 0) - Number(b.data.order ?? 0))
    .slice(0, MAX_BEATS);
  const storyboard = beatRecords.map((record, index) => {
    const place = str(record.data.place);
    const person = str(record.data.npc);
    const location = place ? locationIndex.get(matchKey(place)) : undefined;
    const npc = person ? npcIndex.get(matchKey(person)) : undefined;
    const encounter = record.data.beatKind === "encounter" ? encounterIndex.get(matchKey(record.name)) : undefined;
    const links: Record<string, number> = {};
    if (location !== undefined) links.location = location;
    if (npc !== undefined) links.npc = npc;
    if (encounter !== undefined) links.encounter = encounter;
    return {
      kind: BEAT_KIND_OF[str(record.data.beatKind)] ?? "event",
      title: cut(record.name, 120),
      body: cut(str(record.data.body), 4_000),
      edges: index + 1 < beatRecords.length ? [index + 1] : [],
      routes: [],
      links,
      x: 40 + (index % 12) * 280,
      y: 40 + Math.floor(index / 12) * 220,
      ref: "",
    };
  });

  const world = worldDoc(draft, { npcs: npcRecords, locations: locationRecords, factions: of("faction").slice(0, 60), lore: loreRecords });

  return {
    kind: "odm.workshop",
    version: 1,
    manifest: {
      name: cut(draft.title || fileName.replace(/\.pdf$/i, ""), 70),
      blurb: cut(draft.premise || `An adventure imported from ${fileName}.`, 200),
      version: "1.0.0",
      author: "",
      homepage: "",
      inspiredBy: cut(`${draft.title || fileName}, imported from ${fileName} for private use`, 200),
      rightsHolder: "The publisher of the imported book",
      shelf: "all",
    },
    genre: "high_fantasy",
    theme: "",
    premise: cut(draft.premise, 500),
    targetParty: draft.party ?? { size: 4, level: 1 },
    houseRulesText: "",
    variantRules: {},
    lore,
    locations,
    npcs,
    factions,
    encounters,
    tables,
    maps,
    storyboard,
    monsters,
    homebrew: [...homebrew, ...spells],
    pregens: [],
    shops: [],
    plugin: null,
    world,
    overworld: null,
    dependsOn: null,
  };
}

// A person whose stat block the review matched to an SRD 5.1 creature.
function swappedToSrd(record: DraftRecord): boolean {
  const book = str(record.data.bookStatBlock);
  return Boolean(book) && matchKey(book) !== matchKey(str(record.data.statBlock));
}

// The stat block a person fights with: the one printed for them, or the
// creature the model named.
function npcStatBlock(record: DraftRecord, records: DraftRecord[]): string {
  const named = str(record.data.statBlock);
  const monster = records.find((other) => other.kind === "monster" && (other.key === named || matchKey(other.name) === matchKey(named)));
  return monster ? monster.name : named;
}

// The ties and secrets as the bundle's WorldForge document, refs as row
// positions ("npc:#3"), per src/lib/db/world-forge-bundle.ts.
function worldDoc(draft: Draft, shelves: { npcs: DraftRecord[]; locations: DraftRecord[]; factions: DraftRecord[]; lore: DraftRecord[] }) {
  const refs = new Map<string, string>();
  const add = (shelf: string, records: DraftRecord[]) => records.forEach((record, index) => refs.set(matchKey(record.name), refs.get(matchKey(record.name)) ?? `${shelf}:#${index}`));
  add("npc", shelves.npcs);
  add("location", shelves.locations);
  add("faction", shelves.factions);
  add("lore", shelves.lore);
  const refOf = (name: string) => refs.get(matchKey(name)) ?? "";
  const entries: Record<string, { hiddenTruth: string }> = {};
  shelves.npcs.forEach((record, index) => {
    const secret = str(record.data.secret);
    if (secret) entries[`npc:#${index}`] = { hiddenTruth: cut(secret, 4_000) };
  });
  const links = (draft.links ?? [])
    .map((link, index) => ({ id: `pdf-l${index}`, from: refOf(link.from), to: refOf(link.to), label: cut(link.label, 40), veracity: "known", oneway: false }))
    .filter((link) => link.from && link.to && link.from !== link.to)
    .slice(0, 2_000);
  const secrets = (draft.secrets ?? [])
    .map((secret, index) => ({
      id: `pdf-s${index}`,
      title: cut(str(secret.title), 120),
      subject: refOf(str(secret.about)),
      notes: cut(str(secret.notes), 4_000),
      knownBy: strings(secret.knownBy).map(refOf).filter(Boolean).slice(0, 40),
      partyKnows: false,
    }))
    .filter((secret) => secret.title)
    .slice(0, 500);
  if (!links.length && !secrets.length && !Object.keys(entries).length) return null;
  return { doc: { entries, links, secrets }, images: {}, entryImages: {} };
}

// The world-shaped half of a draft as a WorldForge file (src/lib/
// worldforge/format.ts), for an import started inside WorldForge: people,
// places, factions and lore as entries, their ties, the secrets, and the
// story as scenes. What a WorldForge file cannot carry (battle maps,
// prepared fights, roll tables) stays with the new-workshop import.
export function draftToWorldForge(draft: Draft, fileName: string, picture: PictureLookup): Record<string, unknown> {
  const included = draft.records.filter((record) => record.include);
  const entities: Array<Record<string, unknown>> = [];
  const entityImages: Record<string, string> = {};
  const idOf = new Map<string, string>();
  const push = (record: DraftRecord, type: string, summary: string, extra: Record<string, unknown> = {}) => {
    const id = `e${entities.length + 1}`;
    idOf.set(matchKey(record.name), idOf.get(matchKey(record.name)) ?? id);
    entities.push({ id, name: cut(record.name, 120), type, summary: cut(summary, 20_000), ...extra });
  };
  for (const record of included) {
    if (record.kind === "npc") {
      const words = [str(record.data.description), str(record.data.personality) && `Personality: ${str(record.data.personality)}`, str(record.data.goals) && `Goals: ${str(record.data.goals)}`];
      push(record, "Character", words.filter(Boolean).join("\n\n") || str(record.data.trait), str(record.data.secret) ? { hiddenTruth: str(record.data.secret) } : {});
    } else if (record.kind === "location") push(record, "Location", str(record.data.layoutDescription));
    else if (record.kind === "faction") push(record, "Faction", [str(record.data.description), str(record.data.goal) && `Goal: ${str(record.data.goal)}`].filter(Boolean).join("\n\n"));
    else if (record.kind === "lore") push(record, loreType(str(record.data.category)), str(record.data.body), { odmVisibility: "dm" });
    else if (record.kind === "art") {
      push(record, "Illustration", `From page ${record.pages.join(", ")} of ${fileName}.`, { odmVisibility: "dm" });
      const image = picture(str(record.data.picture));
      if (image) entityImages[String(entities[entities.length - 1].id)] = image;
    }
  }
  for (const link of draft.links ?? []) {
    const from = entities.find((entity) => entity.id === idOf.get(matchKey(link.from)));
    const to = idOf.get(matchKey(link.to));
    if (!from || !to || from.id === to) continue;
    const list = (from.links as Array<Record<string, unknown>> | undefined) ?? [];
    list.push({ targetId: to, label: cut(link.label, 40), veracity: "known", oneway: false });
    from.links = list;
  }
  const story = { id: "story1", name: cut(draft.title || fileName, 120), summary: cut(draft.premise, 2_000) };
  const beats = included.filter((record) => record.kind === "beat").sort((a, b) => Number(a.data.order ?? 0) - Number(b.data.order ?? 0));
  const scenes = beats.map((record, index) => ({
    id: `sc${index + 1}`,
    storyId: story.id,
    order: index + 1,
    title: cut(record.name, 120),
    gist: cut(str(record.data.body), 400),
    povEntityId: idOf.get(matchKey(str(record.data.npc))) ?? "",
    locationEntityId: idOf.get(matchKey(str(record.data.place))) ?? "",
  }));
  const sceneBodies = Object.fromEntries(beats.map((record, index) => [`sc${index + 1}`, cut(str(record.data.body), 4_000)]));
  const secrets = (draft.secrets ?? [])
    .map((secret, index) => ({
      id: `s${index + 1}`,
      title: cut(str(secret.title), 120),
      entityId: idOf.get(matchKey(str(secret.about))) ?? "",
      notes: cut(str(secret.notes), 4_000),
      knownBy: { [story.id]: Object.fromEntries(strings(secret.knownBy).map((name) => [idOf.get(matchKey(name)) ?? "", true]).filter(([id]) => id)) },
    }))
    .filter((secret) => secret.title);
  return { worldName: cut(draft.title || fileName, 120), version: 4, entities, secrets, stories: [story], scenes, sceneBodies, media: { entityImages } };
}

function loreType(category: string): string {
  return ({ history: "History", religion: "Religion", magic: "Magic", factions: "Lore", geography: "Geography", culture: "Culture" } as Record<string, string>)[category] ?? "Lore";
}
