import { raceMechanics, type RaceMechanics } from "@/lib/content/mechanics";
import { readSpeciesVariants, variantRecordName } from "@/lib/content/species-variants";
import { readSpeciesSpells } from "@/lib/content/species-spells";
import { speciesProseGrants } from "@/lib/content/species-prose-logic";
import { SRD_RACES, type SrdRace } from "@/lib/srd";
import { isDwarf, srdRaceId, type SpeciesRules } from "@/lib/srd/race-id";
import { isEdition2024 } from "@/lib/content/edition";
import { textKey } from "@/lib/language/text-logic";

// The content pack's race rows, turned into the shape the character builder
// works from. Three things happen here that raceMechanics alone cannot do:
//
// - A subrace row (Hill Dwarf under Dwarf) carries only what it adds, so its
//   parent's speed, languages and ability bumps are folded in. Without this a
//   pack Hill Dwarf had +1 Wisdom, no +2 Constitution, and spoke only Common.
// - A row the bundled SRD also describes (the wotc-srd rows, the expanded
//   pack's copies) takes its mechanics from
//   src/lib/srd/races.json, which is what actually grants skills, tools,
//   cantrips and free languages; the pack keeps its prose. A third-party row
//   that only shares a slug (Tome of Heroes' drow) is its own race.
// - Anything else is parsed from the pack's prose.
// - A parent whose rules require a subrace (the SRD's Dwarf, a gearforged
//   without its chassis) is not an option itself; its subraces are, unless a
//   stored character already sits on the parent (`keepIds`).
// - A 2024 species (src/lib/content/edition.ts) is not offered to the 2014
//   builder, again unless a stored character already names it.
// - A race the bundled documents print twice (the SRD's High Elf and the
//   expanded pack's Elf (High), rule for rule the same) is offered once, the
//   SRD's copy, unless a stored character sits on the other (issue #116).
// - A third-party row under a bundled race's slug (Tome of Heroes' Drow
//   beside the SRD drow) gets an id that carries its document, "toh-drow".
//   Every reader keys a race by srdRaceId(id): the dialog's trait list, the
//   innate spells, the hit point bonus, the server's trait grant. Under the
//   bare slug they all answered for the SRD drow (issue #115); under the
//   prefixed id none of them match, and the row's own rules stand.

// Content-pack slugs are kebab-case and the pack's own copies of SRD rows
// carry an "odm-" prefix; the bundled ids are snake_case.
export function canonicalRaceId(raceId: string): string {
  return srdRaceId(raceId);
}

// A subrace card names its parent, the way the bundled rows already read:
// "Halfling (Stoor)", "Darakhul (Drow Heritage)", "Gearforged (Dwarf
// Chassis)". The parent's own word is dropped from the subrace's name
// ("Stoor Halfling" -> "Stoor", "High Elf" -> "High") unless nothing would
// be left.
// A name that already carries its parent, or already has a parenthesis, is
// left alone. Darakhul's Ravenfolk is a heritage named without the word.
export function subraceLabel(name: string, parentName?: string | null): string {
  const sub = String(name ?? "").trim();
  const parent = String(parentName ?? "").trim();
  if (!parent || !sub || textKey(sub) === textKey(parent) || sub.includes("(")) {
    return sub;
  }
  const pieces = sub.split(/\s+/);
  const length = parent.split(/\s+/).length;
  const at = pieces.findIndex((_, index) => textKey(pieces.slice(index, index + length).join(" ")) === textKey(parent));
  let rest = sub;
  if (at >= 0) {
    rest = [...pieces.slice(0, at), ...pieces.slice(at + length)].join(" ");
    if (!rest) {
      return sub;
    }
  }
  if (/^darakhul$/i.test(parent) && !/heritage/i.test(rest)) {
    rest = `${rest} Heritage`;
  }
  return `${parent} (${rest})`;
}

export function srdRaceFor(raceId: string): SrdRace | null {
  const id = canonicalRaceId(raceId);
  return SRD_RACES.find((entry) => entry.id === id) ?? null;
}

export type RaceRow = {
  slug: string;
  name: string;
  documentSlug: string;
  // The document's title, when the caller has it ("Tome of Heroes").
  document?: string;
  data: Record<string, unknown>;
};

// The documents whose rows the bundled SRD tables describe, the SRD's first.
const BUNDLED_DOCUMENTS = ["wotc-srd", "odm-expanded"];
const isBundledDocument = (documentSlug: string) => BUNDLED_DOCUMENTS.includes(documentSlug);
const documentRank = (documentSlug: string) => {
  const rank = BUNDLED_DOCUMENTS.indexOf(documentSlug);
  return rank === -1 ? BUNDLED_DOCUMENTS.length : rank;
};

export type PackRaceOption = {
  id: string;
  name: string;
  note: string;
  // The pack row behind the option, for its write-up; differs from the id
  // only for a third-party row under a bundled slug (see optionIdFor).
  slug: string;
  documentSlug: string;
  // The book it comes from, by title.
  source: string;
} & RaceMechanics;

// The id the builder and the sheet use for a pack row. A stored character
// that already names the bare slug keeps it (`keepIds`), so an edit lands
// on the row it was built from; new characters get the prefixed id.
export function optionIdFor(
  row: Pick<RaceRow, "slug" | "documentSlug">,
  keepIds: ReadonlySet<string> = new Set(),
): string {
  const collides =
    !isBundledDocument(row.documentSlug) && srdRaceFor(row.slug) !== null && !keepIds.has(row.slug);
  return collides ? `${row.documentSlug}-${row.slug}` : row.slug;
}

const GRANT_KEYS = [
  "skills",
  "skillChoice",
  "asiChoice",
  "cantripChoice",
  "tools",
  "toolChoice",
  "armor",
  "weapons",
  "weaponChoice",
  "trainingChoice",
  "expertiseChoice",
] as const;

function withParent(
  sub: RaceMechanics,
  subData: Record<string, unknown>,
  parent: RaceMechanics,
): RaceMechanics {
  const asi: RaceMechanics["asi"] = { ...parent.asi };
  for (const [ability, bonus] of Object.entries(sub.asi)) {
    const key = ability as keyof RaceMechanics["asi"];
    asi[key] = (asi[key] ?? 0) + (bonus ?? 0);
  }
  const ownSpeed = subData.speed !== undefined || Array.isArray(subData.traits);
  const ownLanguages = subData.languages !== undefined;
  const merged: RaceMechanics = {
    ...sub,
    asi,
    speed: ownSpeed ? sub.speed : parent.speed,
    languages: ownLanguages ? sub.languages : parent.languages,
    bonusLanguages: ownLanguages ? sub.bonusLanguages : parent.bonusLanguages,
    traitsSummary: [parent.traitsSummary, sub.traitsSummary].filter(Boolean).join(" · "),
    ...((sub.size ?? parent.size) ? { size: sub.size ?? parent.size } : {}),
    ...(sub.heavyArmorSpeed || parent.heavyArmorSpeed ? { heavyArmorSpeed: true } : {}),
    // The subrace is the parent's "choose one of these" already answered.
    traitNames: [
      ...parent.traitNames.filter((name) => !parent.choiceTraitNames.includes(name)),
      ...sub.traitNames,
    ],
  };
  const choice = ownLanguages ? sub.languageChoice : parent.languageChoice;
  if (choice) {
    merged.languageChoice = choice;
  } else {
    delete merged.languageChoice;
  }
  for (const key of GRANT_KEYS) {
    const value = sub[key] ?? parent[key];
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  // A subrace's training adds to its parent's: a mushroomfolk acid cap is
  // proficient in Survival (Hardy Survivor) and Athletics (Clan Athlete).
  for (const key of ["skills", "tools", "armor", "weapons"] as const) {
    const both = [...new Set([...(parent[key] ?? []), ...(sub[key] ?? [])])];
    if (both.length) {
      merged[key] = both;
    }
  }
  if (!merged.spells && parent.spells) {
    merged.spells = parent.spells;
  }
  // A gearforged's two picks and its human chassis's one are three picks.
  if (
    sub.asiChoice &&
    parent.asiChoice &&
    sub.asiChoice.amount === parent.asiChoice.amount &&
    !sub.asiChoice.from &&
    !parent.asiChoice.from
  ) {
    merged.asiChoice = { count: sub.asiChoice.count + parent.asiChoice.count, amount: sub.asiChoice.amount };
  }
  return merged;
}

// A third-party pack row's rules are in its prose (Tome of Heroes, Open5e's
// own); a bundled row's are in races.json, and a workshop species is typed
// into its fields.
const readsProse = (row: RaceRow) => !isBundledDocument(row.documentSlug) && row.documentSlug !== "homebrew";

// The row with what its prose states (src/lib/content/species-prose-logic.ts):
// the engine-read lines join its trait names, the training joins its fields.
function withProse(mechanics: RaceMechanics, data: Record<string, unknown>): RaceMechanics {
  const prose = speciesProseGrants(data);
  const join = (held: string[] | undefined, more: string[]) => {
    const all = [...(held ?? [])];
    for (const entry of more) {
      if (!all.some((item) => textKey(item) === textKey(entry))) all.push(entry);
    }
    return all;
  };
  // A trait whose name already carries its resistance ("Acid Cap
  // Resistance") is read by the damage engine as it stands.
  const named = mechanics.traitNames.map((name) => name.toLowerCase()).filter((name) => name.includes("resistance"));
  const lines = prose.lines.filter((line) => {
    const type = /^(\w+) resistance$/i.exec(line)?.[1]?.toLowerCase();
    return !type || !named.some((name) => name.includes(type));
  });
  const merged: RaceMechanics = { ...mechanics, traitNames: join(mechanics.traitNames, lines) };
  for (const key of ["skills", "weapons", "armor", "tools"] as const) {
    const list = join(mechanics[key], prose[key]);
    if (list.length) merged[key] = list;
  }
  if (!merged.skillChoice && prose.skillChoice) merged.skillChoice = prose.skillChoice;
  if (!merged.toolChoice && prose.toolChoice) merged.toolChoice = prose.toolChoice;
  if (!merged.weaponChoice && prose.weaponChoice) merged.weaponChoice = prose.weaponChoice;
  if (!merged.trainingChoice && prose.trainingChoice) merged.trainingChoice = prose.trainingChoice;
  if (!merged.expertiseChoice && prose.expertiseChoice) merged.expertiseChoice = prose.expertiseChoice;
  if (!merged.spells && prose.spells) merged.spells = prose.spells;
  if (!merged.variants && prose.variants) merged.variants = prose.variants;
  if (prose.livingOrigin) merged.livingOrigin = true;
  return merged;
}

function withSrd(parsed: RaceMechanics, srd: SrdRace): RaceMechanics {
  const merged: RaceMechanics = {
    speed: srd.speed,
    asi: srd.asi,
    languages: srd.languages.filter((language) => !/of your choice/i.test(language)),
    bonusLanguages: srd.bonusLanguages ?? 0,
    traitsSummary: parsed.traitsSummary || srd.traits.join(" · "),
    traitNames: parsed.traitNames,
    choiceTraitNames: parsed.choiceTraitNames,
    ...((srd.size ?? parsed.size) ? { size: (srd.size as RaceMechanics["size"]) ?? parsed.size } : {}),
    // Every bundled dwarf carries the Dwarf's own Speed trait.
    ...(parsed.heavyArmorSpeed || isDwarf(srd.id) ? { heavyArmorSpeed: true } : {}),
  };
  for (const key of GRANT_KEYS) {
    if (srd[key] !== undefined) {
      (merged as Record<string, unknown>)[key] = srd[key];
    }
  }
  return merged;
}

// `keepIds` are rows offered even though their rules ask for a subrace: a
// character saved on a bare Dwarf before its subraces stood alone keeps its
// race in an edit instead of falling to the list's first row.
export function packRaceOptions(rows: RaceRow[], keepIds: Iterable<string> = []): PackRaceOption[] {
  const keptIds = new Set(keepIds);
  const idFor = (row: RaceRow) => optionIdFor(row, keptIds);
  const kept = (row: RaceRow) => keptIds.has(row.slug) || keptIds.has(idFor(row));
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  // The one copy offered of each race the bundled documents print twice.
  const copyOffered = new Map<string, RaceRow>();
  for (const row of rows) {
    if (!isBundledDocument(row.documentSlug) || !srdRaceFor(row.slug)) {
      continue;
    }
    const id = canonicalRaceId(row.slug);
    const held = copyOffered.get(id);
    if (!held || documentRank(row.documentSlug) < documentRank(held.documentSlug)) {
      copyOffered.set(id, row);
    }
  }
  const secondCopy = (row: RaceRow) => {
    const offeredCopy = copyOffered.get(canonicalRaceId(row.slug));
    return Boolean(offeredCopy) && offeredCopy !== row && isBundledDocument(row.documentSlug) && !kept(row);
  };
  const parsed = new Map<string, RaceMechanics>();
  const mechanicsFor = (row: RaceRow): RaceMechanics => {
    let mechanics = parsed.get(row.slug);
    if (!mechanics) {
      // A workshop species' choice rides along, so the builder offers it
      // and the creation check holds a character to it.
      const variants = readSpeciesVariants(row.data.variants);
      // And its own spells (issue #833).
      const spells = readSpeciesSpells(row.data.spells);
      mechanics = { ...raceMechanics(row.data), ...(variants ? { variants } : {}), ...(spells ? { spells } : {}) };
      if (readsProse(row)) {
        mechanics = withProse(mechanics, row.data);
      }
      parsed.set(row.slug, mechanics);
    }
    return mechanics;
  };
  const parentSlugs = new Set(rows.map((row) => String(row.data.parent_slug ?? "")));
  const needsSubrace = (row: RaceRow) =>
    !kept(row) &&
    parentSlugs.has(row.slug) && (row.documentSlug === "wotc-srd" || mechanicsFor(row).choiceTraitNames.length > 0);
  const offered = (row: RaceRow) =>
    !needsSubrace(row) && !secondCopy(row) && (!isEdition2024(row.documentSlug) || kept(row));
  return rows.filter(offered).flatMap((row) => {
    let mechanics = mechanicsFor(row);
    const parentSlug = String(row.data.parent_slug ?? "");
    const parent = parentSlug && parentSlug !== row.slug ? bySlug.get(parentSlug) : undefined;
    if (parent) {
      mechanics = withParent(mechanics, row.data, mechanicsFor(parent));
    }
    const srd = isBundledDocument(row.documentSlug) ? srdRaceFor(row.slug) : null;
    if (srd) {
      mechanics = withSrd(mechanics, srd);
    }
    if (!mechanics.languages.length) {
      mechanics = { ...mechanics, languages: ["Common"] };
    }
    const option: PackRaceOption = {
      id: idFor(row),
      name: subraceLabel(row.name, parent?.name),
      ...mechanics,
      note: mechanics.traitsSummary,
      slug: row.slug,
      documentSlug: row.documentSlug,
      source: row.document ?? row.documentSlug,
    };
    // A shade's Living Origin is its size, speed and a language: each origin
    // is offered as the subrace it is, so the size every engine reads by the
    // race's id is the origin's. A character stored on the bare row keeps it.
    return mechanics.livingOrigin && !kept(row) ? LIVING_ORIGINS.map((origin) => livingOriginOption(option, origin)) : [option];
  });
}

// The peoples a shade may have been in life, by their SRD 5.1 size, speed
// and tongue (a human's tongue is any one of the player's choice).
const LIVING_ORIGINS: Array<{ id: string; name: string; size: RaceMechanics["size"]; speed: number; language: string | null }> = [
  { id: "human", name: "Human", size: "Medium", speed: 30, language: null },
  { id: "dwarf", name: "Dwarf", size: "Medium", speed: 25, language: "Dwarvish" },
  { id: "elf", name: "Elf", size: "Medium", speed: 30, language: "Elvish" },
  { id: "halfling", name: "Halfling", size: "Small", speed: 25, language: "Halfling" },
  { id: "gnome", name: "Gnome", size: "Small", speed: 25, language: "Gnomish" },
  { id: "half-elf", name: "Half-Elf", size: "Medium", speed: 30, language: "Elvish" },
  { id: "half-orc", name: "Half-Orc", size: "Medium", speed: 30, language: "Orc" },
  { id: "dragonborn", name: "Dragonborn", size: "Medium", speed: 30, language: "Draconic" },
  { id: "tiefling", name: "Tiefling", size: "Medium", speed: 30, language: "Infernal" },
];

function livingOriginOption(base: PackRaceOption, origin: (typeof LIVING_ORIGINS)[number]): PackRaceOption {
  const record = `Living Origin (${origin.name})`;
  const rest: PackRaceOption = { ...base };
  delete rest.livingOrigin;
  return {
    ...rest,
    id: `${base.id}-${origin.id}-origin`,
    name: `${base.name} (${origin.name} Origin)`,
    size: origin.size,
    speed: origin.speed,
    languages: origin.language ? [...new Set([...base.languages, origin.language])] : base.languages,
    bonusLanguages: origin.language ? 0 : Math.max(1, base.bonusLanguages),
    traitNames: base.traitNames.map((name) => (textKey(name) === textKey("Living Origin") ? record : name)),
    choiceTraitNames: base.choiceTraitNames.filter((name) => textKey(name) !== textKey("Living Origin")),
    note: base.note,
  };
}

// What the engines read off an option the bundled list does not carry
// (src/lib/srd/race-id.ts SpeciesRules): the server's reader
// (src/lib/characters/species-rules.ts) and the builder's
// (useBuilderOptions.ts) both build it here, so the browser and the server
// read a workshop species' spells, and each option's, alike (issue #833).
export function speciesRulesOf(option: Pick<RaceMechanics, "size" | "heavyArmorSpeed" | "traitNames" | "spells" | "variants">): SpeciesRules {
  const variantSpells = Object.fromEntries(
    (option.variants?.options ?? []).flatMap((entry) =>
      entry.spells ? [[entry.id, { ...entry.spells, from: variantRecordName(option.variants!.label, entry) }]] : [],
    ),
  );
  return {
    size: option.size,
    heavyArmorSpeed: option.heavyArmorSpeed,
    traitNames: option.traitNames,
    ...(option.spells ? { spells: option.spells } : {}),
    ...(Object.keys(variantSpells).length ? { variantSpells } : {}),
  };
}
