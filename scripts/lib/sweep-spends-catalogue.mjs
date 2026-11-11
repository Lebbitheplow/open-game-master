// The catalogue the "spends" sweep walks (scripts/lib/sweep-spends.mjs): every
// class and subclass the tables hold, where each counter, authored spend and
// authored reaction first arrives, the text each feature ships, and where the
// engine names a counter outside the table that declares it.
import fs from "node:fs";
import { ABILITIES, optionPicks, readJson, SRC } from "./sweep-spends.mjs";

const withPicks = (build, level) => {
  const picks = optionPicks(build, level);
  return picks.length ? { ...build, level, features: [...(build.features ?? []), ...picks] } : { ...build, level };
};

// Every class and subclass the tables hold, each as { classId, subclass }.
export function allBuilds(rig) {
  const srd = readJson("lib/srd/class-features.json").classes;
  const authoredSubclasses = readJson("lib/srd/subclasses.json").classes;
  const out = [];
  for (const classId of Object.keys(srd)) {
    for (const subclass of [...(srd[classId].subclasses ?? []), ...(authoredSubclasses[classId] ?? [])]) {
      out.push({ classId, subclass: subclass.name, kind: "srd" });
    }
  }
  for (const [classId, table] of Object.entries(rig.classes.CUSTOM_CLASS_FEATURES)) {
    for (const subclass of table.subclasses) {
      out.push({ classId, subclass: subclass.name, kind: "genre" });
    }
  }
  return out;
}

const MODS = Object.fromEntries(Object.entries(ABILITIES).map(([key, score]) => [key, Math.floor((score - 10) / 2)]));

// The features and counters a build holds at a level, by the functions
// createSheet itself calls (src/lib/db/sheets.ts).
export function heldAt(rig, build, level) {
  const held = [...rig.features.populateFeaturesForClasses([], [{ id: build.classId, subclass: build.subclass ?? "", level }], build.race ?? "human", build.feats ?? []), ...optionPicks(build, level)];
  const counters = rig.resources.populateResources(held, level, MODS, undefined, undefined, build.feats ?? [], undefined, { race: build.race ?? "human" });
  return { features: held, counters };
}

// Where each counter, authored spend and authored reaction first arrives:
// the build and the level. A row several subclasses share keeps the first.
export function arrivals(rig) {
  const counters = new Map();
  const spends = new Map();
  const reactions = new Map();
  const holders = new Map();
  const note = (build, level, ids) => {
    for (const id of ids) {
      holders.set(id, (holders.get(id) ?? new Set()).add(`${build.classId}/${build.subclass ?? ""}`));
      if (!counters.has(id)) counters.set(id, withPicks(build, level));
    }
  };
  for (const build of allBuilds(rig)) {
    const seen = new Set();
    for (let level = 1; level <= 20; level += 1) {
      const held = [...rig.features.populateFeaturesForClasses([], [{ id: build.classId, subclass: build.subclass ?? "", level }], "human", []), ...optionPicks(build, level)];
      // What this level adds. A counter is held when one feature of its
      // name is, so the new features alone say which counters arrive here
      // (populateResources over a whole sheet, 3,000 times, took 20 seconds).
      const fresh = held.filter((feature) => !seen.has(feature.name));
      if (!fresh.length) continue;
      for (const feature of fresh) seen.add(feature.name);
      const sheet = { class: build.classId, level, features: held, conditions: [], equipment: [] };
      note(build, level, Object.keys(rig.resources.populateResources(fresh, level, MODS, undefined, undefined, [], undefined, undefined)));
      note(build, level, rig.resources.heldAtWill({ ...sheet, features: fresh }).map(([id]) => id));
      for (const row of rig.authored.heldAuthored(sheet)) {
        for (const spend of row.entry.spends ?? []) {
          const key = `${row.key}::${spend.name}`;
          const open = !spend.gate?.level || row.level >= spend.gate.level;
          if (open && !spends.has(key)) spends.set(key, { ...withPicks(build, level), row, spend });
        }
        for (const reaction of row.entry.reactions ?? []) {
          const key = `${row.key}::${reaction.name}`;
          const open = !reaction.gate?.level || row.level >= reaction.gate.level;
          if (open && !reactions.has(key)) reactions.set(key, { ...withPicks(build, level), row, reaction });
        }
      }
    }
  }
  // The counters a species or a feat brings, on a plain fighter: every race
  // row, at the levels a racial use can arrive, and every feat alone.
  const plain = (extra) => ({ classId: "fighter", subclass: "Champion", kind: "srd", ...extra });
  for (const race of readJson("lib/srd/races.json").races) {
    for (const level of [1, 3, 5]) {
      const build = plain({ race: race.id });
      const { features: held, counters: map } = heldAt(rig, build, level);
      const sheet = { class: "fighter", level, features: held, conditions: [], equipment: [] };
      note(build, level, [...Object.keys(map), ...rig.resources.heldAtWill(sheet).map(([id]) => id)]);
    }
  }
  for (const feat of readJson("lib/srd/authored-feats.json").feats) {
    const build = plain({ feats: [feat.name] });
    note(build, 4, Object.keys(heldAt(rig, build, 4).counters));
  }
  return { counters, spends, reactions, holders };
}



// The text a table ships for a feature, by its name: the authored subclass
// rows and the genre catalogues ({ n, d } rows wherever they sit).
export function featureTexts(rig) {
  const index = new Map();
  const walk = (node, source) => {
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry, source);
    } else if (node && typeof node === "object") {
      if (typeof node.n === "string" && typeof node.d === "string") {
        const key = rig.textKey(node.n);
        index.set(key, [...(index.get(key) ?? []), { text: node.d, source }]);
      }
      for (const value of Object.values(node)) walk(value, source);
    }
  };
  walk(readJson("lib/srd/subclasses.json"), "src/lib/srd/subclasses.json");
  for (const genre of ["cyberpunk", "dark-fantasy", "horror", "mystery", "post-apocalyptic", "steampunk"]) {
    walk(readJson(`lib/classes/${genre}-features.json`), `src/lib/classes/${genre}-features.json`);
  }
  // A name two catalogues share is read from the one the row belongs to:
  // `prefer` is a word of its file's name ("horror", "subclasses").
  return {
    get: (name, prefer) => {
      const found = index.get(rig.textKey(name ?? "")) ?? [];
      return found.find((entry) => prefer && entry.source.includes(prefer)) ?? (prefer ? null : found[0]) ?? null;
    },
    any: (name) => (index.get(rig.textKey(name ?? "")) ?? [])[0] ?? null,
  };
}


// Where the engine itself names a counter outside the tables that declare
// it: another path (the attack, the cast, a reaction, a watcher) carries its
// effect, and a plain use_resource on it is a second door, not the feature.
export function engineMentions() {
  const read = (folder) => {
    const dir = new URL(`lib/${folder}/`, SRC);
    return fs.readdirSync(dir, { recursive: true }).filter((file) => String(file).endsWith(".ts")).map((file) => [`src/lib/${folder}/${file}`, fs.readFileSync(new URL(String(file), dir), "utf8")]);
  };
  const engine = read("dm");
  // A counter's id held in a constant (LUCK_POINTS) is named by the constant.
  const constants = new Map();
  for (const [, text] of read("srd")) {
    for (const match of text.matchAll(/export const ([A-Z][A-Z_0-9]+) = "([a-z][a-z_0-9]+)"/g)) constants.set(match[2], match[1]);
  }
  const lowered = engine.map(([file, text]) => [file, text.toLowerCase()]);
  return (id, names = []) => {
    // By the feature's own name too, where the engine reads it as words.
    const named = names.map((name) => name.toLowerCase()).filter((name) => name.length >= 6);
    const byName = named.length ? lowered.filter(([, text]) => named.some((name) => text.includes(name))).map(([file]) => file) : [];
    const forms = [`["'\`.]${id}\\b`];
    if (constants.has(id)) forms.push(`\\b${constants.get(id)}\\b`);
    // An id built from its level ("mystic_arcanum_6" from `mystic_arcanum_${level}`).
    const numbered = /^(.*_)\d+$/.exec(id);
    if (numbered) forms.push(`[\`"']${numbered[1]}\\$\\{`);
    const word = new RegExp(forms.join("|"));
    return [...new Set([...engine.filter(([, text]) => word.test(text)).map(([file]) => file), ...byName])];
  };
}
