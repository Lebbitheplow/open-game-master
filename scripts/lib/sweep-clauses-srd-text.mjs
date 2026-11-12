// The clause ledger's texts for the slice `srd`: the words the app ships for
// every SRD 5.1 class and subclass feature named in class-features.json, every
// feat of authored-feats.json and every lineage of races.json, each with the
// file it came from and the hash the ledger pins.
//
// Where a class feature's words live:
//   - the twelve SRD classes: the feature's own section of the class's page in
//     the rulebook the app ships (src/lib/rulebook/srd-5.1.json, the SRD 5.1
//     text a player reads at /rulebook). The sheet's own one-line gloss
//     (src/lib/help/index.ts describeFeature) is noted beside it as `help`.
//   - the artificer, which SRD 5.1 does not print: the sheet's gloss, the
//     only words the app has (src/lib/help/srd-features.json).
//   - a feat: its `desc` in src/lib/srd/authored-feats.json.
//   - a lineage: its row of src/lib/srd/races.json, as stored. The trait
//     lines ARE the description (src/lib/help/index.ts describeRace), and the
//     row's speed, size, scores, languages and grants are what the builder
//     reads, so the whole row is the text and a clause is a piece of it.
//
// Reads files only, so the ledger check needs no database.
import crypto from "node:crypto";
import fs from "node:fs";

const SRC = new URL("../../src/", import.meta.url);
const readJson = (file) => JSON.parse(fs.readFileSync(new URL(file, SRC), "utf8"));

export const RULEBOOK = "src/lib/rulebook/srd-5.1.json";
export const HELP = "src/lib/help/srd-features.json";
export const FEATS = "src/lib/srd/authored-feats.json";
export const RACES = "src/lib/srd/races.json";
export const CLASS_FEATURES = "src/lib/srd/class-features.json";

export const sha12 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);

const norm = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const bare = (name) => name.replace(/\s*\([^)]*\)\s*$/, "");

// A feature whose words are not under a heading of its own name: the
// heading that holds them. `tier` marks a later step of a feature already
// in the ledger (its entry lists only the sentence the step adds).
const HEADING = {
  "cleric::Divine Intervention Improvement": "Divine Intervention",
  "druid::Wild Shape Improvement": "Wild Shape",
  "monk::Unarmored Movement Improvement": "Unarmored Movement",
  "paladin::Aura Improvements": "Aura of Protection",
  "ranger::Favored Enemy Improvement": "Favored Enemy",
  "ranger::Natural Explorer Improvement": "Natural Explorer",
  "sorcerer::Metamagic Option": "Metamagic",
  "bard::Bonus Proficiencies (Lore)": "Bonus Proficiencies",
  "cleric::Bonus Proficiency (heavy armor)": "Bonus Proficiency",
  "paladin::Channel Divinity: Sacred Weapon": "Channel Divinity",
  "paladin::Channel Divinity: Turn the Unholy": "Channel Divinity",
};

// The Oath of Devotion prints its two Channel Divinity options as paragraphs
// of one section: each entry is its own paragraphs.
const SLICE = {
  "paladin::Channel Divinity: Sacred Weapon": ["***Sacred Weapon***", "***Turn the Unholy***"],
  "paladin::Channel Divinity: Turn the Unholy": ["***Turn the Unholy***", null],
};

// A section the page ends too early: the druid's Spellcasting is followed by
// two of its own subsections printed at the feature's heading depth.
const UNTIL = { "druid::Spellcasting": "Wild Shape" };

// The warlock page prints the name twice: the feature, then the list of
// invocations (the options of src/lib/srd/options.json, not this slice).
const FIRST_ONLY = new Set(["warlock::Eldritch Invocations"]);

function headingsOf(md) {
  const out = [];
  const re = /^(#{2,6}) (.+)$/gm;
  let match;
  while ((match = re.exec(md))) {
    out.push({ depth: match[1].length, title: match[2].trim(), at: match.index, bodyAt: match.index + match[0].length });
  }
  return out;
}

// Every named feature of class-features.json, in table order: base levels,
// then the SRD subclass. A name a class grants twice (Expertise at 3 and 10)
// is two rows; the second carries its level in the key.
export function classFeatureRows() {
  const table = readJson("lib/srd/class-features.json").classes;
  const rows = [];
  for (const [classId, entry] of Object.entries(table)) {
    const seen = new Map();
    const push = (name, level, group, sub) => {
      const base = `${classId}::${name}`;
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      rows.push({ key: count ? `${base}@${level}` : base, base, classId, name, level: Number(level), group, subclass: sub });
    };
    for (const [level, names] of Object.entries(entry.levels)) {
      for (const name of names) push(name, level, classId, null);
    }
    for (const subclass of entry.subclasses) {
      for (const [level, names] of Object.entries(subclass.levels)) {
        for (const name of names) push(name, level, subclass.name, subclass.name);
      }
    }
  }
  return rows;
}

let classTexts = null;

// key -> { key, classId, group, level, name, source, text, help?, tierOf? }
export function classFeatureTexts() {
  if (classTexts) return classTexts;
  const book = readJson("lib/rulebook/srd-5.1.json");
  const help = readJson("lib/help/srd-features.json");
  const rows = classFeatureRows();
  const out = new Map();
  const byClass = new Map();
  for (const row of rows) byClass.set(row.classId, [...(byClass.get(row.classId) ?? []), row]);

  for (const [classId, list] of byClass) {
    const page = book.pages.find((entry) => entry.id === classId && entry.kind === "class");
    const helpOf = (name) => help.byClass?.[classId]?.[name] ?? help.features[name] ?? help.byClass?.[classId]?.[bare(name)] ?? help.features[bare(name)] ?? null;
    if (!page) {
      // No SRD page (the artificer): the sheet's gloss is the text.
      for (const row of list) {
        const text = helpOf(row.name);
        out.set(row.key, { ...row, source: HELP, text: text ?? "" });
      }
      continue;
    }
    const md = page.md;
    const heads = headingsOf(md);
    const split = heads.find((head) => head.depth === 2)?.at ?? md.length;
    // Which heading each row's words sit under.
    const found = new Map();
    for (const row of list) {
      const wanted = norm(HEADING[row.base] ?? bare(row.name));
      const exact = norm(HEADING[row.base] ?? row.name);
      const pool = heads.filter((head) => (row.subclass ? head.at > split : head.at < split));
      let hits = pool.filter((head) => norm(head.title) === exact);
      if (!hits.length) hits = pool.filter((head) => norm(head.title) === wanted);
      const head = FIRST_ONLY.has(row.base) || !row.subclass ? hits[0] : hits[0];
      found.set(row.key, head ?? null);
    }
    // A nested heading another row owns is that row's text, not its parent's.
    const owned = new Set([...found.values()].filter(Boolean).map((head) => head.at));
    const firstOwner = new Map();
    for (const row of list) {
      const head = found.get(row.key);
      if (head && !firstOwner.has(head.at)) firstOwner.set(head.at, row.key);
    }
    for (const row of list) {
      const head = found.get(row.key);
      if (!head) {
        out.set(row.key, { ...row, source: RULEBOOK, text: "" });
        continue;
      }
      const index = heads.indexOf(head);
      let end = md.length;
      const until = UNTIL[row.base];
      for (let at = index + 1; at < heads.length; at += 1) {
        if (until ? norm(heads[at].title) === norm(until) : heads[at].depth <= head.depth) {
          end = heads[at].at;
          break;
        }
      }
      // Cut the nested sections other rows own out of this one.
      let text = "";
      let cursor = head.bodyAt;
      for (let at = index + 1; at < heads.length && heads[at].at < end; at += 1) {
        if (!owned.has(heads[at].at)) continue;
        text += md.slice(cursor, heads[at].at);
        let stop = end;
        for (let next = at + 1; next < heads.length && heads[next].at < end; next += 1) {
          if (heads[next].depth <= heads[at].depth) {
            stop = heads[next].at;
            break;
          }
        }
        cursor = stop;
      }
      text += md.slice(Math.min(cursor, end), end);
      const slice = SLICE[row.base];
      if (slice) {
        const from = text.indexOf(slice[0]);
        const to = slice[1] ? text.indexOf(slice[1]) : text.length;
        text = text.slice(from, to);
      }
      text = text.trim();
      const owner = firstOwner.get(head.at);
      const gloss = helpOf(row.name);
      out.set(row.key, {
        ...row,
        source: RULEBOOK,
        page: classId,
        heading: head.title,
        text,
        ...(gloss ? { help: { source: HELP, sha: sha12(gloss), text: gloss } } : {}),
        // A later step of a feature (Brutal Critical (2 dice), Expertise at
        // 10): the same section, already split under the first row.
        ...(owner !== row.key && !slice ? { tierOf: owner } : {}),
      });
    }
  }
  classTexts = out;
  return out;
}

export function featTexts() {
  const out = new Map();
  for (const feat of readJson("lib/srd/authored-feats.json").feats) {
    out.set(`feat::${feat.name}`, {
      key: `feat::${feat.name}`,
      name: feat.name,
      group: "feat",
      level: null,
      source: FEATS,
      prerequisite: feat.prerequisite,
      // The prerequisite is a promise as well (the builder refuses without
      // it), so it is part of the hashed text, on its own first line.
      text: feat.prerequisite ? `Prerequisite: ${feat.prerequisite}\n${feat.desc}` : feat.desc,
    });
  }
  return out;
}

export function speciesTexts() {
  const out = new Map();
  for (const race of readJson("lib/srd/races.json").races) {
    out.set(`species::${race.id}`, {
      key: `species::${race.id}`,
      id: race.id,
      name: race.name,
      group: "species",
      level: null,
      source: RACES,
      row: race,
      text: JSON.stringify(race),
    });
  }
  return out;
}

// ---- sentences ----

// The pieces of a text a clause must cover: sentences of prose, list items,
// and table rows. Headings and table rules are layout, not promises.
export function sentencesOf(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || /^#{1,6} /.test(line) || /^\|[-| ]+\|$/.test(line) || /^\|[\s|]*\|$/.test(line)) continue;
    if (line.startsWith("|")) {
      out.push(line);
      continue;
    }
    const body = line.replace(/^[-*+]\s+/, "");
    let from = 0;
    const re = /[.!?:](?:\*+)?["')\]]?(?=\s+[A-Z*(_\d"'])/g;
    let match;
    while ((match = re.exec(body))) {
      // "1st level", "e.g. x", an initial: not an end.
      const piece = body.slice(from, match.index + match[0].length).trim();
      if (piece.length < 12) continue;
      out.push(piece);
      from = match.index + match[0].length;
    }
    const tail = body.slice(from).trim();
    if (tail) out.push(tail);
  }
  return out;
}

// Wording that states a mechanic: a sentence with none of it and no clause
// of its own is flavor. Wide on purpose, so nothing mechanical slips by as
// flavor unread; what it catches wrongly is given a clause by hand.
const MECHANIC = new RegExp(
  [
    "\\d", "\\bd(?:4|6|8|10|12|20)\\b", "\\bDC\\b", "saving throw", "\\bsaves?\\b", "ability check", "attack roll", "damage", "hit points?", "\\bregain", "\\bheal",
    "advantage", "resistan", "immun", "proficien", "\\bbonus\\b", "\\breaction\\b", "\\baction\\b", "\\bspeed\\b", "\\bfeet\\b", "\\bfoot\\b", "\\brange\\b",
    "frightened", "charmed", "stunned", "\\bprone\\b", "restrained", "blinded", "deafened", "invisible", "paralyzed", "poisoned", "incapacitated", "grappled", "unconscious", "exhaustion",
    "can't", "cannot", "\\bmust\\b", "\\bonce\\b", "\\btwice\\b", "\\buses?\\b", "\\brest\\b", "spell slot", "\\bspells?\\b", "cantrip", "\\blevel\\b", "\\bturn\\b", "\\bround\\b", "\\bminute", "\\bhour",
    "\\bArmor Class\\b", "\\bAC\\b", "critical", "\\bmodifier\\b", "\\bscore\\b", "\\bchoose\\b", "\\bchoice\\b", "\\blearn", "\\bgain", "\\bextra\\b", "\\badditional\\b", "\\bdouble", "\\bhalf\\b", "\\bhalve",
    "\\bmove", "\\bclimb", "\\bjump", "\\bswim", "\\bfly", "\\bteleport", "\\bhide\\b", "\\bhidden\\b", "\\battack", "\\bweapon", "\\barmor\\b", "\\bshield", "concentrat", "\\britual", "\\bprepare", "\\blanguage",
    "\\bki\\b", "sorcery point", "\\brage\\b", "\\braging\\b", "\\binspiration\\b", "\\bimmune\\b", "\\bdisease", "\\bpoison", "\\btarget", "\\bcreature", "\\bdie\\b", "\\bdice\\b", "\\broll",
  ].join("|"),
  "i",
);
export const statesMechanic = (sentence) => MECHANIC.test(sentence);

// Whether a clause covers a sentence: one holds the other, or they overlap
// where the clause was cut mid-sentence.
export function covers(clause, sentence) {
  return sentence.includes(clause) || clause.includes(sentence);
}
