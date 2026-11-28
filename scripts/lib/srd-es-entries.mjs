// Pairing the Spanish print's entries (spells, magic items, stat blocks) with
// the English book's pages, for scripts/import-srd-rulebook-es.mjs.
//
// The two prints sort their entries by their own alphabets, so a Spanish
// entry is not in its English twin's place. What the two share is numbers: a
// stat block's Armor Class, hit points, six scores and challenge; a spell's
// level, school and components; an item's kind, rarity and attunement; and
// the dice and counts in the text, and the many words Spanish and English
// spell alike (invulnerability, invulnerabilidad). `signature` reads those from either
// language, `suggest` pairs entries by them, and `mismatch` says what a pair
// disagrees on, which the importer asks of every pair on every run.

const num = (text) => text.replace(/\u2212|\u2013/g, "-");

const SCHOOLS = {
  abjuration: "abj", conjuration: "con", divination: "div", enchantment: "enc", evocation: "evo", illusion: "ill", necromancy: "nec", transmutation: "tra",
  abjuración: "abj", conjuración: "con", adivinación: "div", encantamiento: "enc", evocación: "evo", ilusionismo: "ill", ilusión: "ill", nigromancia: "nec", transmutación: "tra",
};

const RARITIES = [
  ["very rare", "muy rar[oa]", "V"],
  ["uncommon", "infrecuente", "U"],
  ["legendary", "legendari[oa]", "L"],
  ["rare", "rar[oa]", "R"],
  ["common", "común", "C"],
  ["rarity varies|varies", "rareza variable|variable|varía", "?"],
];

const KINDS = [
  ["wondrous item", "objeto maravilloso", "wondrous"],
  ["armor", "armadura", "armor"],
  ["weapon", "arma", "weapon"],
  ["potion", "poción", "potion"],
  ["ring", "anillo", "ring"],
  ["rod", "cetro|vara", "rod"],
  ["scroll", "pergamino", "scroll"],
  ["staff", "bastón", "staff"],
  ["wand", "varita", "wand"],
];

// The dice a text rolls ("2d6", "1d10"), sorted: the same in both prints.
function dice(text) {
  return [...num(text).matchAll(/\b\d*d\d+\b/g)].map((match) => match[0]).sort();
}

// Every number a text prints, with the English measures turned into the
// print's metric ones (5 feet is 1,5 m, a mile 1,5 km, a pound half a kilo).
function numbers(text, english) {
  let plain = num(text);
  if (english) {
    plain = plain
      .replace(/(\d),(\d{3})\b/g, "$1$2")
      .replace(/(\d+(?:\.\d+)?)[- ](?:foot|feet|ft\.?)/g, (_, feet) => `${+(feet * 0.3).toFixed(2)} m`)
      .replace(/(\d+(?:\.\d+)?)[- ](?:miles?)/g, (_, miles) => `${+(miles * 1.5).toFixed(2)} km`)
      .replace(/(\d+(?:\.\d+)?)[- ](?:pounds?|lb\.?)/g, (_, pounds) => `${+(pounds * 0.5).toFixed(2)} kg`);
  } else {
    plain = plain.replace(/(\d)[.\u00a0 ](\d{3})\b/g, "$1$2").replace(/(\d),(\d)/g, "$1.$2");
  }
  return [...plain.matchAll(/\d+(?:\.\d+)?/g)].map((match) => String(Number(match[0]))).sort();
}

// The words two languages are likely to share: the first five letters of
// every long word, accents dropped ("invul", "eleme", "resis").
function cognates(text) {
  const plain = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return new Set([...plain.matchAll(/[a-z]{6,}/g)].map((match) => match[0].slice(0, 5)));
}

// How alike two sorted lists are: shared entries over all entries.
function overlap(one, other) {
  const left = new Map();
  for (const each of one) left.set(each, (left.get(each) ?? 0) + 1);
  let shared = 0;
  for (const each of other) {
    const have = left.get(each) ?? 0;
    if (have > 0) {
      shared += 1;
      left.set(each, have - 1);
    }
  }
  const all = one.length + other.length - shared;
  return all === 0 ? 1 : shared / all;
}

function monster(text, english) {
  const plain = num(text).replace(/\*/g, "");
  const ac = (english ? /Armor Class:? (\d+)/ : /Clase de Armadura: (\d+)/).exec(plain)?.[1];
  const hp = (english ? /Hit Points:? (\d+)(?: \(([^)]+)\))?/ : /Puntos de golpe: (\d+)(?: \(([^)]+)\))?/).exec(plain);
  const scores = [...plain.matchAll(/(\d+) \([+-]\d+\)/g)].slice(0, 6).map((match) => match[1]);
  const challenge = (english ? /Challenge:? ([\d/]+)/ : /Desafío: ([\d/]+)/).exec(plain)?.[1];
  if (!ac) return null;
  return [ac, hp?.[1], (hp?.[2] ?? "").replace(/\s/g, ""), scores.join(","), challenge].join("|");
}

function spell(text, english) {
  const plain = num(text).replace(/\*/g, "");
  const head = plain.split("\n").find((line) => line.trim())?.toLowerCase() ?? "";
  const school = Object.entries(SCHOOLS).find(([word]) => head.includes(word))?.[1];
  const level = /cantrip|truco/.test(head) ? "0" : /(\d)/.exec(head)?.[1];
  const components = (english ? /Components: ([VSM, ]+)/ : /Componentes: ([VSM, ]+)/).exec(plain)?.[1].replace(/[, ]/g, "");
  const duration = (english ? /Duration: ([^\n]*)/ : /Duración: ([^\n]*)/).exec(plain)?.[1] ?? "";
  return [level, school, components, /concentra/i.test(duration) ? "c" : "", /ritual/.test(head) ? "r" : ""].join("|");
}

function item(text, english) {
  const head = (text.split("\n").find((line) => line.trim()) ?? "").replace(/\*/g, "").toLowerCase();
  const side = english ? 0 : 1;
  const kind = KINDS.find((row) => new RegExp(`^(?:${row[side]})\\b`).test(head))?.[2];
  let rest = head;
  const rarities = [];
  for (const row of RARITIES) {
    const pattern = new RegExp(`(?:${row[side]})`, "g");
    if (pattern.test(rest)) {
      rarities.push(row[2]);
      rest = rest.replace(pattern, " ");
    }
  }
  return [kind, rarities.sort().join(""), /attunement|sintonizaci/.test(head) ? "a" : ""].join("|");
}

const READERS = { monster, spell, item };

// What an entry's text says of itself: `hard` must be the same in both
// prints, `dice` and `numbers` are how alike two texts are beyond that.
export function signature(kind, text, english) {
  return { hard: READERS[kind](text, english), dice: dice(text), numbers: numbers(text, english), words: cognates(text), size: text.length };
}

// `weight` is how telling a shared word is: one few entries use says more.
function likeness(en, es, weight) {
  let shared = 0;
  let left = 0;
  let right = 0;
  for (const word of en.words) {
    left += weight(word);
    if (es.words.has(word)) shared += weight(word);
  }
  for (const word of es.words) right += weight(word);
  const words = left && right ? shared / Math.sqrt(left * right) : 0;
  return words * 0.5 + overlap(en.dice, es.dice) * 0.2 + overlap(en.numbers, es.numbers) * 0.2 + (Math.min(en.size, es.size) / Math.max(en.size, es.size)) * 0.1;
}

// Pairs each English entry with a Spanish one: only entries whose hard facts
// agree are candidates, and among them the most alike are paired first.
// Returns the pairs with how far ahead of the next candidate each one was,
// so the close calls can be read by a person.
export function suggest(english, spanish) {
  const uses = new Map();
  for (const entry of [...english, ...spanish]) {
    for (const word of entry.sig.words) uses.set(word, (uses.get(word) ?? 0) + 1);
  }
  const weight = (word) => Math.log((english.length + spanish.length) / (uses.get(word) ?? 1));
  const pairs = [];
  for (const en of english) {
    for (const es of spanish) {
      if (en.sig.hard === es.sig.hard) pairs.push({ en, es, score: likeness(en.sig, es.sig, weight) });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const takenEn = new Map();
  const takenEs = new Set();
  for (const pair of pairs) {
    if (takenEn.has(pair.en.id) || takenEs.has(pair.es.title)) continue;
    takenEn.set(pair.en.id, pair);
    takenEs.add(pair.es.title);
  }
  const result = [];
  for (const en of english) {
    const pair = takenEn.get(en.id);
    if (!pair) {
      result.push({ id: en.id, title: en.title, es: null, margin: 0 });
      continue;
    }
    // `pairs` is sorted, so the first other pair either side is in is the
    // best one the choice was made against.
    const rival = pairs.find((other) => other !== pair && (other.en.id === en.id || other.es.title === pair.es.title));
    result.push({ id: en.id, title: en.title, es: pair.es.title, score: pair.score, margin: rival ? pair.score - rival.score : 1 });
  }
  return { pairs: result, unpaired: spanish.filter((es) => !takenEs.has(es.title)).map((es) => es.title) };
}
