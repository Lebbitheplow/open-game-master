// Builds src/lib/language/srd-names-it.json: the official Italian names of
// the SRD 5.1's spells, creatures, magic items, gear and rules terms, keyed by
// the English name the engine looks things up by.
//
// The Italian names come from Wizards of the Coast's own Italian SRD 5.1
// (SRD_CC_v5.1_IT.pdf, CC BY 4.0), never from a fan translation. An Italian
// entry is paired with an English one by what the two books say about it,
// not by position: the two alphabetical orders differ. A spell pairs by its
// school, level, ritual tag, casting time, range, components and duration; a
// creature by its size, armor class, hit points, challenge and six scores; a
// magic item by its rarity and kind. A pairing the evidence cannot settle is
// left out and listed, or settled by hand in scripts/lib/it-srd-name-pairs.mjs.
//
// The output is committed and loaded at runtime. Run by hand when the SRD
// data changes (needs pdftotext, from poppler):
//
//   node scripts/generate-it-srd-names.mjs           # write the file
//   node scripts/generate-it-srd-names.mjs --check   # fail if stale
//   node scripts/generate-it-srd-names.mjs --explain # print what stayed unpaired
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HAND_PAIRS, RULE_TERMS } from "./lib/it-srd-name-pairs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "src/lib/language/srd-names-it.json");
const PDF_URL = "https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1_IT.pdf";
const PDF_SHA256 = "2ef143b8abeae9558d30b405ea48e2ee9b5d700dd11cd955e6117e61cbddd3f7";
const ATTRIBUTION =
  'Questo lavoro include materiale tratto dal System Reference Document 5.1 ("SRD 5.1") di Wizards of the Coast LLC, disponibile su https://dnd.wizards.com/resources/systems-reference-document. L\'SRD 5.1 è concesso in licenza ai sensi della licenza Creative Commons Attribution 4.0 International, disponibile su https://creativecommons.org/licenses/by/4.0/legalcode.';

const args = new Set(process.argv.slice(2));

// --- the Italian text ------------------------------------------------------

async function italianLines() {
  const dir = join(tmpdir(), "odm-srd-it");
  mkdirSync(dir, { recursive: true });
  const pdf = join(dir, "SRD_CC_v5.1_IT.pdf");
  if (!existsSync(pdf) || sha256(readFileSync(pdf)) !== PDF_SHA256) {
    const response = await fetch(PDF_URL);
    if (!response.ok) {
      throw new Error(`Italian SRD: ${PDF_URL} answered ${response.status}`);
    }
    writeFileSync(pdf, Buffer.from(await response.arrayBuffer()));
  }
  const got = sha256(readFileSync(pdf));
  if (got !== PDF_SHA256) {
    throw new Error(`Italian SRD: expected sha256 ${PDF_SHA256}, got ${got}. Wizards changed the file: check it, then update PDF_SHA256.`);
  }
  // Laid out, for stat blocks read column by column; plain, for names a
  // column split cut short.
  const text = (mode) => {
    const txt = join(dir, `srd-it${mode.join("")}.txt`);
    execFileSync("pdftotext", [...mode, "-enc", "UTF-8", pdf, txt]);
    return readFileSync(txt, "utf8");
  };
  const layout = text(["-layout"]);
  return {
    laidOut: layout.split("\f").flatMap(readingOrder),
    wide: layout.split("\n").map((line) => line.trim()),
    plain: text([]).split("\n").map((line) => line.trim()),
  };
}

// A laid-out page in reading order: its left column, then its right one. The
// gutter is where the right column most often starts; without one the page is
// read as it stands. Without this, a stat block's name can land a column away
// from its numbers.
function readingOrder(page) {
  const lines = page.split("\n");
  const starts = new Map();
  for (const line of lines) {
    for (const gap of line.matchAll(/\S {3,}(?=\S)/g)) {
      const at = gap.index + gap[0].length;
      starts.set(at, (starts.get(at) ?? 0) + 1);
    }
  }
  const cut = [...starts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 5)
    .map(([at]) => at)
    .find((at) => at >= 60 && at <= 110);
  if (cut === undefined) {
    return lines.map((line) => line.trim());
  }
  const left = [];
  const right = [];
  for (const line of lines) {
    const gap = [...line.matchAll(/ {2,}/g)].find((match) => match.index <= cut && cut <= match.index + match[0].length + 1);
    if (gap) {
      left.push(line.slice(0, gap.index).trim());
      right.push(line.slice(gap.index + gap[0].length).trim());
    } else if (line.length > cut && !line.slice(0, cut).trim()) {
      right.push(line.trim());
    } else if (line.trimEnd().length < cut) {
      left.push(line.trim());
    } else {
      left.push(line.slice(0, cut).trim());
      right.push(line.slice(cut).trim());
    }
  }
  return [...left, ...right];
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// --- the English data ------------------------------------------------------

const rulebook = JSON.parse(readFileSync(join(root, "src/lib/rulebook/srd-5.1.json"), "utf8"));
const englishPages = (kind) => rulebook.pages.filter((page) => page.kind === kind);

// --- spells ----------------------------------------------------------------

const SCHOOLS = {
  abiurazione: "abjuration",
  ammaliamento: "enchantment",
  divinazione: "divination",
  evocazione: "conjuration",
  illusione: "illusion",
  invocazione: "evocation",
  necromanzia: "necromancy",
  trasmutazione: "transmutation",
};

const ITALIAN_SPELL_HEAD = /^(?:Trucchetto di (\p{L}+)|(\p{L}+) di (\d)° livello)( \(rituale\))?$/u;
const ENGLISH_SPELL_HEAD = /^\*(?:(\w+) cantrip|(\d)(?:st|nd|rd|th)-level (\w+))( \(ritual\))?\*$/;

// A length in feet: the Italian book gives 1.5 m for every 5 ft and 1.5 km
// for a mile.
function feetOfItalian(text) {
  const km = /([\d.,]+) (?:chilometr|km\b)/.exec(text);
  if (km) {
    return Math.round((Number(km[1].replace(/\./g, "").replace(",", ".")) / 1.5) * 5280);
  }
  const m = /([\d.,]+) metr/.exec(text);
  return m ? Math.round((Number(m[1].replace(/\./g, "").replace(",", ".")) / 1.5) * 5) : null;
}

function feetOfEnglish(text) {
  const mile = /([\d,]+) miles?/.exec(text);
  if (mile) {
    return Number(mile[1].replace(/,/g, "")) * 5280;
  }
  const ft = /([\d,]+)[- ](?:feet|foot)/.exec(text);
  return ft ? Number(ft[1].replace(/,/g, "")) : null;
}

function rangeKey(feet, word) {
  return feet !== null ? `${feet}ft` : word;
}

const ITALIAN_RANGE_WORDS = [
  [/^Incantatore/, "self"],
  [/^Contatto/, "touch"],
  [/^Vista/, "sight"],
  [/^Illimitat/, "unlimited"],
  [/^Speciale/, "special"],
];
const ENGLISH_RANGE_WORDS = [
  [/^Self/, "self"],
  [/^Touch/, "touch"],
  [/^Sight/, "sight"],
  [/^Unlimited/, "unlimited"],
  [/^Special/, "special"],
];

function wordKey(text, words) {
  for (const [pattern, key] of words) {
    if (pattern.test(text)) {
      return key;
    }
  }
  return `?${text}`;
}

// Self ranges carry their area ("Self (15-foot cone)"); only the leading word
// is compared, since the two books phrase the area differently.
function italianRange(text) {
  const word = wordKey(text, ITALIAN_RANGE_WORDS);
  return word === "self" || word === "touch" ? word : rangeKey(feetOfItalian(text), word);
}

function englishRange(text) {
  const word = wordKey(text, ENGLISH_RANGE_WORDS);
  return word === "self" || word === "touch" ? word : rangeKey(feetOfEnglish(text), word);
}

// The first unit named after the number: "1 reazione, che l'incantatore
// effettua…" is a reaction, not an hour inside "incantatore".
const TIME_UNITS = [
  [/^azione bonus|^bonus action/, "bonus"],
  [/^reazione|^reaction/, "reaction"],
  [/^azion|^action/, "action"],
  [/^round/, "round"],
  [/^minut/, "minute"],
  [/^or[ae]\b|^hour/, "hour"],
  [/^giorn|^day/, "day"],
];

function timeKey(text) {
  const lower = text.toLowerCase();
  if (/istantane|instantaneous/.test(lower)) {
    return "instant";
  }
  if (/dissolt|dispelled/.test(lower)) {
    return lower.includes("innesc") || lower.includes("trigger") ? "dispelled-or-triggered" : "dispelled";
  }
  if (/^speciale|^special/.test(lower)) {
    return "special";
  }
  const concentration = /concentrazione|concentration/.test(lower) ? "c:" : "";
  const counted = /(\d+|un[oa]?|one)\s+(.*)$/.exec(lower);
  const number = counted && /\d/.test(counted[1]) ? counted[1] : "1";
  const rest = counted?.[2] ?? lower;
  const unit = TIME_UNITS.find(([pattern]) => pattern.test(rest))?.[1] ?? `?${text}`;
  return `${concentration}${number} ${unit}`;
}

function componentsKey(text) {
  const head = text.replace(/\(.*$/, "");
  return ["V", "S", "M"].filter((letter) => new RegExp(`\\b${letter}\\b`).test(head)).join("");
}

function englishSpells() {
  const out = [];
  for (const page of englishPages("spell")) {
    const lines = page.md.split("\n").map((line) => line.trim()).filter(Boolean);
    const head = ENGLISH_SPELL_HEAD.exec(lines[0]);
    if (!head) {
      throw new Error(`English spell ${page.title}: unread head "${lines[0]}"`);
    }
    const field = (name) => lines.find((line) => line.startsWith(`**${name}:**`))?.replace(`**${name}:**`, "").trim() ?? "";
    const school = (head[1] ?? head[3]).toLowerCase();
    const level = head[2] ? Number(head[2]) : 0;
    out.push({
      name: page.title,
      key: [school, level, head[4] ? "ritual" : "", timeKey(field("Casting Time")), englishRange(field("Range")), componentsKey(field("Components")), timeKey(field("Duration"))].join("|"),
    });
  }
  return out;
}

// The Italian name is the line above the school line, unless a page break
// set the name's column elsewhere: then the name is not a name (it ends with
// a full stop, or starts in lower case) and the entry is left to the hand
// pairs.
function italianSpells(lines) {
  const out = [];
  lines.forEach((line, index) => {
    const head = ITALIAN_SPELL_HEAD.exec(line);
    if (!head) {
      return;
    }
    let up = index - 1;
    while (up >= 0 && !lines[up]) {
      up -= 1;
    }
    const name = lines[up];
    const block = [];
    for (let down = index + 1; down < lines.length && block.length < 24; down += 1) {
      if (lines[down]) {
        block.push(lines[down]);
      }
    }
    // A field may wrap onto the next line; only its first line is needed.
    const field = (prefix) => block.find((entry) => entry.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
    const schoolWord = (head[1] ?? head[2]).toLowerCase();
    const school = SCHOOLS[schoolWord];
    if (!school) {
      throw new Error(`Italian spell ${name}: unknown school "${schoolWord}"`);
    }
    out.push({
      name,
      line: index + 1,
      plausible: /^\p{Lu}/u.test(name) && !/[.:,;]$/.test(name) && !/^(?:Durata|Gittata|Componenti|Tempo di lancio):/.test(name) && !ITALIAN_SPELL_HEAD.test(name),
      key: [school, head[3] ? Number(head[3]) : 0, head[4] ? "ritual" : "", timeKey(field("Tempo di lancio:")), italianRange(field("Gittata:")), componentsKey(field("Componenti:")), timeKey(field("Durata:"))].join("|"),
    });
  });
  return out;
}

// --- creatures -------------------------------------------------------------

// A creature pairs by its armor class and hit points with their dice: the
// stat block's first two numbers, printed the same in both books.
function englishCreatures() {
  const out = [];
  for (const page of englishPages("monster")) {
    const ac = /\*\*Armor Class\*\* (\d+)/.exec(page.md)?.[1];
    const hp = /\*\*Hit Points\*\* (\d+) \(([^)]+)\)/.exec(page.md);
    if (!ac || !hp) {
      continue;
    }
    const challenge = /\*\*Challenge\*\* ([\d/]+)/.exec(page.md)?.[1] ?? "?";
    const speeds = speedKey(/\*\*Speed\*\* ([^\n]+)/.exec(page.md)?.[1] ?? "", /(?:(\w+) )?(\d+) ft/g, ENGLISH_MOVES, (n) => Number(n));
    out.push({ name: page.title, key: `${ac}|${hp[1]}|${hp[2].replace(/\s+/g, "")}`, fine: `${speeds}|${challenge}` });
  }
  return out;
}

// Speeds by kind of movement ("walk 30, fly 80"), so that two dragons with
// the same numbers but different kinds of movement stay apart.
const ENGLISH_MOVES = { burrow: "burrow", climb: "climb", fly: "fly", swim: "swim" };
const ITALIAN_MOVES = { scavare: "burrow", scalare: "climb", volare: "fly", nuotare: "swim" };

function speedKey(text, pattern, moves, toFeet) {
  return [...text.matchAll(pattern)]
    .map((match) => `${moves[match[1]?.toLowerCase()] ?? "walk"}${toFeet(match[2])}`)
    .sort()
    .join(",");
}

const ITALIAN_SIZES = /^(?:[\p{L}']+ ){0,3}(?:minuscol|piccol|medi|grand|enorm|mastodontic)\p{L}*\b/iu;

// The name is the line above the size-and-type line, which sits above the
// armor class; a block whose lines the page layout scattered is left out.
function italianCreatures(lines) {
  const out = [];
  lines.forEach((line, index) => {
    const hp = /^Punti Ferita (\d+) \(([^)]+)\)/.exec(line);
    if (!hp) {
      return;
    }
    const above = [];
    for (let up = index - 1; up >= 0 && above.length < 5; up -= 1) {
      if (lines[up]) {
        above.push(lines[up]);
      }
    }
    // The size-and-type line may wrap ("Immondo Minuscolo (diavolo,
    // mutaforma)," then "legale malvagio"): the name sits above its start.
    const ac = /^Classe Armatura (\d+)/.exec(above[0] ?? "");
    const kindAt = [1, 2].find((at) => ITALIAN_SIZES.test(above[at] ?? ""));
    if (!ac || kindAt === undefined) {
      return;
    }
    const name = above[kindAt + 1] ?? "";
    const below = lines.slice(index + 1, index + 120);
    const speedLine = below.find((entry) => entry.startsWith("Velocità ")) ?? "";
    const speeds = speedKey(speedLine.replace(/^Velocità /, ""), /(?:(\p{L}+) )?([\d,]+) m\b/gu, ITALIAN_MOVES, (n) => Math.round((Number(n.replace(",", ".")) / 1.5) * 5));
    const challenge = /^Sfida ([\d/]+)/.exec(below.find((entry) => /^Sfida [\d/]+/.test(entry)) ?? "")?.[1] ?? "?";
    out.push({
      name,
      line: index + 1,
      fine: `${speeds}|${challenge}`,
      plausible: /^\p{Lu}/u.test(name) && !/[.:,;]$/.test(name) && !/\d/.test(name),
      key: `${ac[1]}|${hp[1]}|${hp[2].replace(/\s+/g, "")}`,
    });
  });
  return out;
}

// --- magic items -----------------------------------------------------------

// A magic item pairs by its kind, its (first) rarity and whether it needs
// attunement; within that, by the dice and save DCs its text names.
const ITEM_KINDS = [
  [/^Wondrous item|^Oggetto meraviglioso/, "wondrous"],
  [/^Armor|^Armatura/, "armor"],
  [/^Weapon|^Arma\b/, "weapon"],
  [/^Potion|^Pozione/, "potion"],
  [/^Ring|^Anello/, "ring"],
  [/^Wand|^Bacchetta/, "wand"],
  [/^Staff|^Bastone/, "staff"],
  [/^Rod|^Verga/, "rod"],
  [/^Scroll|^Pergamena/, "scroll"],
];
const RARITIES = [
  [/very rare|molto rar/, "very rare"],
  [/uncommon|non comune/, "uncommon"],
  [/common|comune/, "common"],
  [/rare|rar[oa]\b/, "rare"],
  [/legendary|leggendari/, "legendary"],
  [/artifact|artefatto/, "artifact"],
  [/rarity varies|rarità variabile/, "varies"],
];
const ITALIAN_ITEM_HEAD = /^(?:Oggetto meraviglioso|Armatura|Arma|Pozione|Anello|Bacchetta|Bastone|Verga|Pergamena)(?: \([^)]*\))?, (?:comune|non comune|rar[oa]|molto rar[oa]|leggendari[oa]|artefatto|rarità variabile)/;

function itemKey(head) {
  const kind = ITEM_KINDS.find(([pattern]) => pattern.test(head))?.[1] ?? `?${head}`;
  const rest = head.replace(/^[^,]*,\s*/, "").toLowerCase();
  const rarity = RARITIES.map(([pattern, name]) => [pattern.exec(rest)?.index ?? Infinity, name]).sort((a, b) => a[0] - b[0])[0];
  const attuned = /requires attunement|richiede sintonia/.test(head) ? "attuned" : "";
  return `${kind}|${rarity[0] === Infinity ? "?" : rarity[1]}|${attuned}`;
}

// The dice and save DCs an item's text names, as a set.
function itemFine(text) {
  const dice = [...text.matchAll(/\b(\d+d\d+)\b/g)].map((match) => match[1]);
  const dcs = [...text.matchAll(/\b(?:DC|CD) (\d+)/g)].map((match) => `DC${match[1]}`);
  return [...new Set([...dice, ...dcs])].sort().join(",");
}

function englishItems() {
  return englishPages("item").map((page) => {
    const [head, ...body] = page.md.split("\n");
    return { name: page.title, key: itemKey(head.replace(/^\*|\*$/g, "")), fine: itemFine(body.join("\n")) };
  });
}

function italianItems(lines) {
  const heads = [];
  lines.forEach((line, index) => {
    if (ITALIAN_ITEM_HEAD.test(line)) {
      heads.push(index);
    }
  });
  return heads.map((index, at) => {
    let up = index - 1;
    while (up >= 0 && !lines[up]) {
      up -= 1;
    }
    // A line the column split missed keeps the right column after a wide gap.
    const name = (lines[up] ?? "").split(/ {3,}/)[0];
    const head = `${lines[index]} ${lines[index + 1] ?? ""}`;
    const body = lines.slice(index + 1, (heads[at + 1] ?? index + 200) - 1).join("\n");
    return {
      name,
      line: index + 1,
      plausible: /^\p{Lu}/u.test(name) && !/[.:,;]$/.test(name),
      key: itemKey(head),
      fine: itemFine(body),
    };
  });
}

// --- equipment -------------------------------------------------------------

// A table row pairs by its price and weight, and a weapon also by its damage,
// an armor by its armor class: the same numbers in both books, once the
// Italian prices (mr, ma, me, mo, mp) and kilograms are read back.
const COINS = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000, mr: 1, ma: 10, me: 50, mo: 100, mp: 1000 };
const DAMAGE_TYPES = { perforanti: "piercing", contundenti: "bludgeoning", taglienti: "slashing" };

function copper(amount, coin) {
  return Number(amount.replace(/[.,]/g, "")) * COINS[coin];
}

function englishPounds(text) {
  const match = /^([\d/]+|\d+ \d\/\d) lb/.exec(text.trim());
  if (!match) {
    return "-";
  }
  const [whole, fraction] = match[1].includes(" ") ? match[1].split(" ") : match[1].includes("/") ? ["0", match[1]] : [match[1], "0/1"];
  const [top, bottom] = fraction.split("/").map(Number);
  return String(Number(whole) + top / bottom);
}

function italianPounds(text) {
  const match = /([\d.,]+) kg/.exec(text);
  return match ? String(Number(match[1].replace(/\./g, "").replace(",", ".")) * 2) : "-";
}

function englishRows(title) {
  const page = englishPages("rules").find((entry) => entry.title === title);
  return page.md
    .split("\n")
    .filter((line) => line.startsWith("|") && !line.startsWith("|-"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    // A row name ending in a bare number ("Potion of healing 5") is a
    // table the English source flattened, not an item.
    .filter((cells) => cells[0] && !/^\*/.test(cells[0]) && !/ \d+$/.test(cells[0]) && /^\d[\d,]* (?:cp|sp|ep|gp|pp)$/.test(cells[1] ?? ""))
    .map(([name, cost, ...rest]) => {
      const [amount, coin] = cost.split(" ");
      return { name: name.replace(/^~\s*/, ""), copper: copper(amount, coin), rest };
    });
}

// A name holds no wide gap: one that does is prose from the other column.
const ITALIAN_ROW = /^(\S(?:(?! {3}).)*?)\s{2,}(\d[\d.]*) (mr|ma|me|mo|mp)(?:\s{2,}(.*))?$/;

function italianRows(texts) {
  const rows = new Map();
  for (const line of texts) {
    const match = ITALIAN_ROW.exec(line);
    if (match) {
      const row = { name: match[1].trim(), copper: copper(match[2], match[3]), rest: (match[4] ?? "").split(/\s{2,}/) };
      rows.set(`${row.name}|${row.copper}|${row.rest.join("|")}`, row);
    }
  }
  return [...rows.values()];
}

function damageKey(text) {
  const match = /(\d+d\d+|\d+) (\w+)/.exec(text);
  return match ? `${match[1]} ${DAMAGE_TYPES[match[2]] ?? match[2]}` : "-";
}

function englishWeapons() {
  return englishRows("Weapons").map((row) => ({ name: row.name, key: `${row.copper}|${damageKey(row.rest[0])}|${englishPounds(row.rest[1])}` }));
}

function italianWeapons(rows) {
  return rows.filter((row) => /^(?:\d+d\d+|1) (?:perforant|contundent|taglient)/.test(row.rest[0] ?? "")).map((row) => ({ name: row.name, key: `${row.copper}|${damageKey(row.rest[0])}|${italianPounds(row.rest[1] ?? "")}` }));
}

function englishArmor() {
  return englishRows("Armor").map((row) => ({ name: row.name, key: `${row.copper}|${/^\+?\d+/.exec(row.rest[0])?.[0]}|${englishPounds(row.rest.at(-1))}` }));
}

function italianArmor(rows) {
  return rows.filter((row) => /^\+?\d+(?: \+ modificatore|$)/.test(row.rest[0] ?? "")).map((row) => ({ name: row.name, key: `${row.copper}|${/^\+?\d+/.exec(row.rest[0])[0]}|${italianPounds(row.rest.at(-1))}` }));
}

function englishGear() {
  return [...englishRows("Adventuring Gear"), ...englishRows("Tools")].map((row) => ({ name: row.name, key: `${row.copper}|${englishPounds(row.rest[0] ?? "")}` }));
}

function italianGear(rows) {
  return rows.filter((row) => row.rest.length === 1).map((row) => ({ name: row.name, key: `${row.copper}|${italianPounds(row.rest[0])}` }));
}

// --- pairing ---------------------------------------------------------------

// Pairs two lists by an evidence key: a key held by exactly one entry on each
// side pairs them; anything else is reported.
function pairByKey(category, english, italian, hand) {
  const pairs = {};
  const handEnglish = new Set(Object.keys(hand));
  const handItalian = new Set(Object.values(hand));
  const byKey = (list) => {
    const map = new Map();
    for (const entry of list) {
      map.set(entry.key, [...(map.get(entry.key) ?? []), entry]);
    }
    return map;
  };
  const englishByKey = byKey(english.filter((entry) => !handEnglish.has(entry.name)));
  const italianByKey = byKey(italian.filter((entry) => entry.plausible !== false && !handItalian.has(entry.name)));
  const misplaced = italian.filter((entry) => entry.plausible === false).map((entry) => ({ key: entry.key, english: [], italian: [`(name misplaced near line ${entry.line}: "${entry.name}")`] }));
  const unpaired = [];
  for (const [key, englishEntries] of englishByKey) {
    const italianEntries = italianByKey.get(key) ?? [];
    if (englishEntries.length === 1 && italianEntries.length === 1) {
      pairs[englishEntries[0].name] = italianEntries[0].name;
    } else if (englishEntries.some((entry) => entry.fine) && italianEntries.length) {
      // Within a shared key, a second piece of evidence (a creature's speeds
      // and challenge) pairs an entry only when it alone holds it on each side.
      const left = [];
      for (const entry of englishEntries) {
        const sameEnglish = englishEntries.filter((other) => other.fine === entry.fine);
        const sameItalian = italianEntries.filter((other) => other.fine === entry.fine);
        if (sameEnglish.length === 1 && sameItalian.length === 1) {
          pairs[entry.name] = sameItalian[0].name;
        } else {
          left.push(entry);
        }
      }
      const taken = new Set(Object.values(pairs));
      if (left.length || italianEntries.some((entry) => !taken.has(entry.name))) {
        unpaired.push({ key, english: left.map((entry) => `${entry.name} [${entry.fine}]`), italian: italianEntries.filter((entry) => !taken.has(entry.name)).map((entry) => `${entry.name} [${entry.fine}]`) });
      }
    } else {
      unpaired.push({ key, english: englishEntries.map((entry) => entry.name), italian: italianEntries.map((entry) => entry.name) });
    }
  }
  for (const [key, italianEntries] of italianByKey) {
    if (!englishByKey.has(key)) {
      unpaired.push({ key, english: [], italian: italianEntries.map((entry) => entry.name) });
    }
  }
  for (const [englishName, italianName] of Object.entries(hand)) {
    if (!english.some((entry) => entry.name === englishName)) {
      throw new Error(`${category}: hand pair "${englishName}" is no English entry`);
    }
    pairs[englishName] = italianName;
  }
  const pairedItalian = new Set(Object.values(pairs));
  return {
    pairs,
    unpaired: [...unpaired, ...misplaced].filter((group) => group.english.some((name) => !pairs[name]) || group.italian.some((name) => !name.startsWith("(") && !pairedItalian.has(name))),
    missing: english.map((entry) => entry.name).filter((name) => !pairs[name]),
  };
}

// Every Italian name stands as a whole line of the Italian book (a heading or
// a list entry), and names one English entry only within its category.
function checkItalian(category, pairs, lines) {
  // A name may share its line with the other column, or wrap onto the next.
  const heads = lines.map((line) => line.split(/ {3,}/)[0]);
  const printed = new Set([...heads, ...heads.map((head, index) => `${head} ${heads[index + 1] ?? ""}`)]);
  const seen = new Map();
  for (const [englishName, italianName] of Object.entries(pairs)) {
    if (!printed.has(italianName)) {
      throw new Error(`${category}: "${italianName}" (${englishName}) is not a line of the Italian SRD`);
    }
    if (seen.has(italianName)) {
      throw new Error(`${category}: "${italianName}" names both ${seen.get(italianName)} and ${englishName}`);
    }
    seen.set(italianName, englishName);
  }
}

// --- main ------------------------------------------------------------------

const { laidOut: lines, plain, wide } = await italianLines();
const tableRows = italianRows([...wide, ...lines]);
const sections = {
  spells: pairByKey("spells", englishSpells(), italianSpells(lines), HAND_PAIRS.spells),
  creatures: pairByKey("creatures", englishCreatures(), italianCreatures(lines), HAND_PAIRS.creatures),
  magicItems: pairByKey("magicItems", englishItems(), italianItems(lines), HAND_PAIRS.magicItems),
  weapons: pairByKey("weapons", englishWeapons(), italianWeapons(tableRows), HAND_PAIRS.weapons),
  armor: pairByKey("armor", englishArmor(), italianArmor(tableRows), HAND_PAIRS.armor),
  gear: pairByKey("gear", englishGear(), italianGear(tableRows), HAND_PAIRS.gear),
};

for (const [name, section] of Object.entries(sections)) {
  checkItalian(name, section.pairs, [...lines, ...plain]);
}
// A rules term must stand as a word of the Italian book.
const book = plain.join(" ").toLowerCase();
for (const [group, terms] of Object.entries(RULE_TERMS)) {
  for (const [englishName, italianName] of Object.entries(terms)) {
    const word = new RegExp(`(?<![\\p{L}])${italianName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "u");
    if (!word.test(book)) {
      throw new Error(`rules ${group}: "${italianName}" (${englishName}) is not a word of the Italian SRD`);
    }
  }
}
const report = Object.entries(sections).map(([name, section]) => `${name}: ${Object.keys(section.pairs).length} paired; English left unpaired: ${section.missing.join(", ") || "none"}`);
if (args.has("--explain")) {
  for (const [name, section] of Object.entries(sections)) {
    for (const group of section.unpaired) {
      console.log(`${name} ${group.key}\n  en: ${group.english.join(" / ") || "-"}\n  it: ${group.italian.join(" / ") || "-"}`);
    }
  }
}
console.log(report.join("\n"));

const output = {
  _note: "GENERATED by scripts/generate-it-srd-names.mjs from Wizards of the Coast's Italian SRD 5.1. Do not edit by hand; re-run the script instead.",
  _attribution: ATTRIBUTION,
  ...Object.fromEntries(Object.entries(sections).map(([name, section]) => [name, sortedObject(section.pairs)])),
  rules: Object.fromEntries(Object.entries(RULE_TERMS).map(([group, terms]) => [group, sortedObject(terms)])),
};
const text = `${JSON.stringify(output, null, 2)}\n`;

function sortedObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
}

if (args.has("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== text) {
    console.error(`${OUT} is stale: run node scripts/generate-it-srd-names.mjs`);
    process.exit(1);
  }
} else if (!args.has("--explain")) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
}
