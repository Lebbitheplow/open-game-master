// The character builder as a player's browser runs it, for the builder sweep
// (scripts/test-enforce-sweep-builder-*.mjs).
//
// scripts/lib/enforce-builder.mjs drives useBuilderDerived and submit.ts; the
// quick-build suite on top of it fills only the bundled SRD options. A real
// builder is offered more than those: useBuilderOptions asks
// /api/content/{races,classes,backgrounds} and /api/content/archetypes and
// builds its rows with packRaceOptions, packClassOptions and
// mergedBackgroundOptions, so with the content pack installed a player picks
// from the pack's species, backgrounds and subclasses, and "Fill what's left"
// (useQuickFill) runs over those rows. This helper loads the options the same
// way, registers what the hook registers, and runs the fill the hook runs
// (FILL_ROUNDS + 1 rounds, the table's subclass list, the spell step's pool).
//
// Import scripts/lib/enforce-world.mjs first.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openBuilder } from "./enforce-builder.mjs";
import { PORTRAIT } from "./enforce-creation.mjs";

const src = (file) => import(new URL(`../../src/${file}`, import.meta.url).href);

// The registries the browser fills (a pack or workshop species' rules, a
// pack or workshop subclass's table) do nothing on the server: each checks
// for a window first (src/lib/srd/race-id.ts registerBrowserSpecies,
// src/lib/srd/subclass-tables.ts registerBrowserSubclassExtras). Without
// them a builder driven from Node would read a pack subclass as featureless
// where the browser reads its training, so the registering call is given a
// window for as long as it runs, and nothing else is.
export function asBrowser(fn) {
  const had = "window" in globalThis;
  if (!had) globalThis.window = {};
  try {
    return fn();
  } finally {
    if (!had) delete globalThis.window;
  }
}

export const EMPTY_SCORES = { str: null, dex: null, con: null, int: null, wis: null, cha: null };

// A fixed sequence, so a failing build names the same character every run.
export function seeded(seed = 7) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

// Lower-case, trimmed: how two proficiency names are compared for a repeat.
export const key = (text) => String(text ?? "").trim().toLowerCase();

// The names in a list that appear more than once, case and space aside.
export function repeats(list) {
  const seen = new Map();
  for (const entry of list ?? []) {
    seen.set(key(entry), (seen.get(key(entry)) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count > 1).map(([name]) => name);
}

// `world` is an openWorld() or openCreation().world; `user` whoever builds.
// `campaignId` scopes the options to a table (its workshop content), as the
// builder opened from a campaign does.
export async function openSweepBuilder({ world, user, campaignId = null }) {
  const builder = await openBuilder();
  const quick = await src("app/characters/builder/quickBuild.ts");
  const optionRows = await src("lib/characters/options.ts");
  const { packRaceOptions, speciesRulesOf } = await src("lib/content/race-options.ts");
  const { registerBrowserSpecies } = await src("lib/srd/race-id.ts");
  const { registerWorkshopClasses } = await src("lib/classes/workshop-registry.ts");
  const { isWorkshopClassId } = await src("lib/homebrew/class-data.ts");
  const features = await src("lib/srd/features.ts");
  const { extraSubclassOf } = await src("lib/srd/subclass-tables.ts");
  const { withSpeciesVariant } = await src("lib/content/species-variants.ts");
  const { checklistSpellsOn } = await src("lib/srd/spell-lists.ts");
  const contentRoute = await world.route("content/[kind]");
  const scope = campaignId ? `&campaign=${campaignId}` : "";

  async function content(kind, query) {
    world.signIn(user);
    const response = await contentRoute.GET(new Request(`http://test/api/content/${kind}?${query}${scope}`), {
      params: Promise.resolve({ kind }),
    });
    const json = await response.json();
    assert.ok(response.status < 400, `/api/content/${kind}?${query}: ${response.status} ${JSON.stringify(json).slice(0, 200)}`);
    return json;
  }

  // useBuilderOptions' load(), line for line.
  const racesData = await content("races", "limit=200");
  const classesData = await content("classes", "limit=100");
  const backgroundsData = await content("backgrounds", "limit=200");
  const installed = [racesData, classesData, backgroundsData].find((data) => data)?.packInstalled !== false;
  let races = optionRows.srdRaceOptions();
  if ((racesData.results ?? []).length) {
    const packed = packRaceOptions(racesData.results, []);
    races = installed ? packed : [...optionRows.srdRaceOptions().filter((option) => !packed.some((entry) => entry.id === option.id)), ...packed];
    asBrowser(() => registerBrowserSpecies(Object.fromEntries(races.map((option) => [option.id, speciesRulesOf(option)]))));
  }
  let classes = optionRows.srdClassOptions();
  const classRows = classesData.results ?? [];
  registerWorkshopClasses(optionRows.workshopClassesOf(classRows));
  if (classRows.length && installed) {
    classes = optionRows.packClassOptions(classRows);
  } else if (classRows.length) {
    classes = [...optionRows.srdClassOptions(), ...optionRows.packClassOptions(classRows).filter((option) => isWorkshopClassId(option.id))];
  }
  let backgrounds = optionRows.srdBackgroundOptions();
  if ((backgroundsData.results ?? []).length) {
    backgrounds = optionRows.mergedBackgroundOptions(backgroundsData.results);
  }
  const offered = { classes, races, backgrounds };

  // useArchetypeOptions: the subclasses the picker shows a class, with their
  // tables registered for the grants the builder previews.
  const archetypeCache = new Map();
  async function subclassesOf(classId) {
    if (!archetypeCache.has(classId)) {
      const data = await content("archetypes", `class=${encodeURIComponent(classId)}&limit=100`);
      const rows = data.results ?? [];
      const tables = rows
        .map((row) => extraSubclassOf({ name: row.name, source: String(row.source ?? "open5e"), data: row.data ?? {} }, features.subclassLevelFor(classId) ?? 3))
        .filter((table) => table !== null);
      asBrowser(() => features.registerBrowserSubclassExtras(classId, tables));
      // The picker's list (usePickerGroups.ts): the bundled subclasses, then
      // the rows the server offers that are not among them.
      const bundled = features.subclassNamesFor(classId).map((name) => ({ name, source: "bundled", slug: null }));
      const listed = new Set(bundled.map((row) => key(row.name)));
      archetypeCache.set(classId, [
        ...bundled,
        ...rows.filter((row) => !listed.has(key(row.name))).map((row) => ({ name: row.name, source: String(row.source ?? "open5e"), slug: row.slug })),
      ]);
    }
    return archetypeCache.get(classId);
  }

  // The spell step's pool (src/components/sheet/useSpellPool.ts): the
  // search's pages, and on a server without the content pack the bundled
  // manifest's spells for the list as well, each name once.
  const manifest = JSON.parse(fs.readFileSync(new URL("../../src/lib/srd/manifest/spells.json", import.meta.url), "utf8")).spells;
  const pools = new Map();
  async function spellPool(classSlug, maxLevel) {
    const id = `${classSlug}:${maxLevel}`;
    if (!classSlug) return [];
    if (!pools.has(id)) {
      const rows = [];
      let fallback = false;
      for (let offset = 0; offset < 2000; offset += 100) {
        const body = await content("spells", new URLSearchParams({ class: classSlug, level: String(maxLevel), limit: "100", offset: String(offset) }).toString());
        if (body.packInstalled === false) fallback = true;
        const page = body.results ?? [];
        rows.push(...page.map((row) => ({ name: row.name, level: Number(row.level ?? 0), school: String(row.school ?? row.data?.school ?? "") })));
        if (page.length < 100) break;
      }
      const wanted = classSlug.toLowerCase();
      if (fallback && wanted.startsWith("homebrew-")) {
        // A workshop class's list, answered by the checklist as the server
        // answers it (useSpellPool.ts checklistPool).
        rows.push(
          ...checklistSpellsOn(wanted)
            .filter((spell) => spell.level <= maxLevel)
            .map((spell) => ({ name: spell.name, level: spell.level, school: "" }))
            .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
        );
      } else if (fallback) {
        rows.push(
          ...manifest
            .filter((spell) => spell.l <= maxLevel && String(spell.c ?? "").split(",").some((entry) => entry.trim().toLowerCase() === wanted))
            .map((spell) => ({ name: spell.n, level: spell.l, school: String(spell.s ?? "") }))
            .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
        );
      }
      const seen = new Set();
      pools.set(id, rows.filter((row) => (seen.has(key(row.name)) ? false : seen.add(key(row.name)))));
    }
    return pools.get(id);
  }

  const find = (list, id) => list.find((entry) => entry.id === id);

  function fresh(fields = {}) {
    return builder.stateOf({ name: "", raceId: "", classId: "", backgroundId: "", scores: EMPTY_SCORES, rollSlots: EMPTY_SCORES, toolPicks: [], ...fields });
  }

  // The race as useBuilderState shapes it: with the variant picked folded in.
  function derive(fields) {
    const raceRow = find(races, fields.raceId);
    return builder.build({
      race: raceRow ? withSpeciesVariant(raceRow, fields.racialVariant) : undefined,
      class: find(classes, fields.classId),
      background: find(backgrounds, fields.backgroundId),
      ...fields,
    });
  }

  // "Fill what's left", as useQuickFill runs it.
  async function fill(start, { answers, only, rng = seeded() } = {}) {
    let fields = start;
    const filled = [];
    for (let round = 0; round < quick.FILL_ROUNDS + 1; round += 1) {
      const { derived } = derive(fields);
      const pool = derived.casts ? await spellPool(derived.spellSearchClass, derived.maxSpellLevel) : [];
      const subclasses = fields.classId ? (await subclassesOf(fields.classId)).map((row) => row.name) : [];
      const step = quick.fillRound({
        fields,
        derived,
        race: find(races, fields.raceId),
        klass: find(classes, fields.classId),
        background: find(backgrounds, fields.backgroundId),
        offered,
        subclasses,
        answers,
        only,
        rng,
        spellPool: pool,
      });
      if (!step.filled.length) break;
      fields = { ...fields, ...step.patch };
      filled.push(...step.filled);
    }
    return { fields, filled };
  }

  return { builder, quick, installed, races, classes, backgrounds, offered, subclassesOf, spellPool, fresh, derive, fill, content };
}

// The two doors a built character goes through. Each answers
// { ok, status, error, sheet }: the sheet as the server stored it.
export function doors({ creation }) {
  const { call, libraryRoute, world, player } = creation;
  return {
    async library(built, user = player) {
      world.signIn(user);
      const made = await call(libraryRoute, "POST", { level: built.level, sheet: { ...built.sheet, portrait: PORTRAIT } });
      return {
        ok: made.status < 400,
        status: made.status,
        error: made.json.error ?? null,
        sheet: made.json.character?.sheet ?? null,
        id: made.json.character?.id ?? null,
      };
    },
    async table(built, user = player) {
      const posted = await creation.atTable({ ...built.sheet, portrait: PORTRAIT }, user);
      return { ok: posted.status < 400, status: posted.status, error: posted.error, sheet: posted.sheet };
    },
  };
}
