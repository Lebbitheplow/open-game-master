// Finding a book's creature, item or spell in SRD 5.1 by its name. Books
// name things their own way: other editions and systems ("Grey Ooze",
// "Spectre", "Goblin Warrior"), plurals ("four kobolds"), a creature with a
// description in front ("Starved Grey Ooze", "Blind Dwarf Mummy"), a count
// behind ("Kobold (12)"). The rule here is the one WorldForge's forge keeps:
// resolve generously, store strictly. A name only ever lands on an entry
// that is in the list it was given. Pure.

export type SrdCandidate = { name: string; slug: string; cr?: number; type?: string; size?: string; kind?: string; desc?: string };
// "family": the SRD entry covers it only as one of a family ("Weapon, +1,
// +2, or +3", Spell Scroll): the book's own item stays, so its specifics
// (which weapon, which spell) are not lost.
export type SrdHit<T extends SrdCandidate = SrdCandidate> = { entry: T; via: "exact" | "alias" | "within" | "family" };

// Spellings and names other books use for SRD 5.1 entries.
const SPELLINGS: Array<[RegExp, string]> = [
  [/\bgrey\b/g, "gray"],
  [/\bspectre\b/g, "specter"],
  [/\bkobolds?\b/g, "kobold"],
  [/\bwerewolves\b/g, "werewolf"],
  [/\bmen\b/g, "man"],
  [/\bwomen\b/g, "woman"],
  [/\bdwarves\b/g, "dwarf"],
  [/\belves\b/g, "elf"],
  [/\bwolves\b/g, "wolf"],
  [/\bliches\b/g, "lich"],
  [/\bdefence\b/g, "defense"],
  [/\barmour\b/g, "armor"],
  [/\bcolour\b/g, "color"],
];

// Named versions of one SRD item: "Potion of Fire Giant Strength" is the
// SRD's Potion of Giant Strength, "Scroll of Fireball" its Spell Scroll.
const ITEM_FAMILIES: Array<[RegExp, string]> = [
  [/^potion of (hill|stone|frost|fire|cloud|storm) giant strength$/, "potion of giant strength"],
  [/^belt of (hill|stone|frost|fire|cloud|storm) giant strength$/, "belt of giant strength"],
];

export function itemFamily(name: string): string | null {
  const key = srdKey(name);
  for (const [pattern, family] of ITEM_FAMILIES) if (pattern.test(key)) return family;
  return null;
}

// "Ring of Protection +1" is the SRD's Ring of Protection; "Wand of the War
// Mage +2" its "Wand of the War Mage, +1, +2, or +3".
export function withoutBonus(name: string): string | null {
  const trimmed = name.trim();
  const match = /^\+[123]\s+(.+)$/.exec(trimmed) ?? /^(.+?),?\s+\+[123]$/.exec(trimmed);
  return match ? match[1] : null;
}

// Names a newer printing or another system gives an SRD 5.1 creature,
// item or spell, mapped to the SRD's own (normalized) name.
const ALIASES: Record<string, string> = {
  "goblin warrior": "goblin",
  "goblin minion": "goblin",
  "kobold warrior": "kobold",
  "hobgoblin warrior": "hobgoblin",
  "bugbear warrior": "bugbear",
  "gnoll warrior": "gnoll",
  "orc warrior": "orc",
  "sahuagin warrior": "sahuagin",
  "lizardfolk warrior": "lizardfolk",
  "warrior infantry": "guard",
  "guard captain": "knight",
  "tough": "thug",
  "pirate": "bandit",
  "pirate captain": "bandit captain",
  "priest acolyte": "acolyte",
  "cultist fanatic": "cult fanatic",
  "fire beetle": "giant fire beetle",
  "killer bee": "giant wasp",
  "living statue": "animated armor",
  "carcass crawler": "carrion crawler",
  "bat swarm": "swarm of bats",
  "rat swarm": "swarm of rats",
  "insect swarm": "swarm of insects",
  "giant rats": "giant rat",
  "skeletal warrior": "skeleton",
  "zombie warrior": "zombie",
  "potion of cure light wounds": "potion of healing",
  "potion of healing greater": "potion of greater healing",
  "cure light wounds": "cure wounds",
  "cure serious wounds": "cure wounds",
  "magic weapon": "weapon 1 2 or 3",
};

export function srdKey(text: string): string {
  let out = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9+ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [pattern, replacement] of SPELLINGS) out = out.replace(pattern, replacement);
  // "the", a count in front ("4 kobolds"), and "x2" behind.
  out = out.replace(/^(the|a|an)\s+/, "").replace(/^\d+\s+/, "").replace(/\s+x\s*\d+$/, "").trim();
  return out;
}

// One plural off the end, the regular ways.
const IRREGULAR: Record<string, string> = { wolves: "wolf", elves: "elf", dwarves: "dwarf", thieves: "thief", knives: "knife", halflings: "halfling", mice: "mouse", geese: "goose", lice: "louse", oxen: "ox", children: "child", people: "person", fungi: "fungus", larvae: "larva", liches: "lich" };

export function singular(word: string): string {
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (word.length <= 3) return word;
  if (/ies$/.test(word)) return word.slice(0, -3) + "y";
  if (/(ches|shes|xes|sses)$/.test(word)) return word.slice(0, -2);
  if (/[^s]s$/.test(word) && !/(us|is|ss)$/.test(word)) return word.slice(0, -1);
  return word;
}

// A count or dice in front of a name ("12 Kobolds", "1d6 Oil Beetles", "d4
// hunters") and in brackets behind ("Kobold (12)"): how many, not who.
export function withoutCount(name: string): string {
  return name
    .replace(/^\s*(\d+\s*d\s*\d+|d\d+|\d+)\s*[x×]?\s+/i, "")
    .replace(/\s*\((\d+|\d*d\d+)\)\s*$/i, "")
    .trim();
}

// "Kobolds" as "Kobold": a name that was a count of creatures, one of them.
export function oneOf(name: string): string {
  const words = name.trim().split(/\s+/);
  if (!words.length) return name;
  const last = words[words.length - 1];
  const one = singular(last.toLowerCase());
  if (one === last.toLowerCase()) return name;
  words[words.length - 1] = /^[A-Z]/.test(last) ? one.charAt(0).toUpperCase() + one.slice(1) : one;
  return words.join(" ");
}

function keysOf(name: string): string[] {
  const key = srdKey(withoutCount(name));
  const words = key.split(" ");
  const last = words.length ? singular(words[words.length - 1]) : "";
  const one = [...words.slice(0, -1), last].join(" ");
  return [...new Set([key, one])].filter(Boolean);
}

// The names an SRD row goes by: its own; each of "Succubus/Incubus"; the
// one in brackets when the rest is not another row's name ("Svirfneblin"
// for "Deep Gnome (Svirfneblin)", never "Diseased" for "Giant Rat
// (Diseased)", which is a Giant Rat); and the family of "Wand of the War
// Mage, +1, +2, or +3".
function namesOf(name: string, rows: Map<string, number>): string[] {
  const out = [name];
  if (name.includes("/")) out.push(...name.split("/"));
  const bracket = /^(.+?)\s*\(([^)]+)\)$/.exec(name);
  // (srdKey drops brackets, so this row is one of the count.)
  if (bracket && (rows.get(srdKey(bracket[1])) ?? 0) <= 1) out.push(bracket[1], bracket[2]);
  const family = /^(.+?),\s*\+1, \+2, or \+3$/.exec(name);
  if (family) out.push(family[1]);
  return out.map((entry) => entry.trim()).filter(Boolean);
}

export function buildIndex<T extends SrdCandidate>(entries: T[]): Map<string, T> {
  const index = new Map<string, T>();
  const rows = new Map<string, number>();
  for (const entry of entries) rows.set(srdKey(entry.name), (rows.get(srdKey(entry.name)) ?? 0) + 1);
  for (const entry of entries) for (const key of keysOf(entry.name)) if (!index.has(key)) index.set(key, entry);
  // Other names after every row's own, so a row's own name always wins.
  for (const entry of entries) {
    for (const other of namesOf(entry.name, rows).slice(1)) for (const key of keysOf(other)) if (!index.has(key)) index.set(key, entry);
  }
  return index;
}

// The SRD entry a book's name stands for: the same name; a name another
// printing uses for it; or, failing those, the longest SRD name that sits
// whole inside the book's ("Starved Gray Ooze" holds "Gray Ooze"). A name
// inside counts only at the end of the book's, where English puts the
// noun ("Mummy" in "Blind Dwarf Mummy", never "Wolf" in "Wolf Rider's Lance").
export function matchSrdName<T extends SrdCandidate>(name: string, index: Map<string, T>): SrdHit<T> | null {
  const keys = keysOf(name);
  for (const key of keys) {
    const hit = index.get(key);
    if (hit) return { entry: hit, via: "exact" };
  }
  for (const key of keys) {
    const alias = ALIASES[key];
    if (alias) {
      const hit = index.get(alias);
      if (hit) return { entry: hit, via: "alias" };
    }
  }
  // "The Spectre of Lady Jayne", "Rhiannon Dreamdust, the Banshee": the
  // creature before "of", or after a comma.
  const shaped = srdKey(withoutCount(name));
  const parts = [shaped.split(" of ")[0], /,\s*(?:the\s+)?(.+)$/.exec(name.toLowerCase())?.[1] ?? ""].map((part) => srdKey(part)).filter((part) => part && part !== shaped);
  for (const part of parts) {
    for (const key of [part, [...part.split(" ").slice(0, -1), singular(part.split(" ").at(-1) ?? "")].join(" ")]) {
      const hit = index.get(key) ?? (ALIASES[key] ? index.get(ALIASES[key]) : undefined);
      if (hit) return { entry: hit, via: "within" };
    }
  }
  for (const key of keys) {
    const words = key.split(" ");
    for (let start = 1; start < words.length; start += 1) {
      const tail = words.slice(start).join(" ");
      if (tail.length < 3) continue;
      const hit = index.get(tail) ?? (ALIASES[tail] ? index.get(ALIASES[tail]) : undefined);
      if (hit) return { entry: hit, via: "within" };
    }
  }
  return null;
}

// "+1 Longsword", "Longsword +2", "+3 Plate": a weapon or armor with a
// bonus is the SRD's "Weapon, +1, +2, or +3" / "Armor, +1, +2, or +3".
// Only for a base that is an SRD weapon, armor or shield (`kindOf`, from
// the SRD's own rows): "Ring of Protection +1" is no weapon.
export function bonusItem(name: string, kindOf: (base: string) => "weapon" | "armor" | "shield" | null): { bonus: number; base: string; family: "weapon" | "armor" | "shield" } | null {
  const match = /^\+([123])\s+(.+)$/.exec(name.trim()) ?? /^(.+?),?\s+\+([123])$/.exec(name.trim());
  if (!match) return null;
  const [bonus, base] = /^\d$/.test(match[1]) ? [Number(match[1]), match[2]] : [Number(match[2]), match[1]];
  const family = kindOf(base);
  return family ? { bonus, base, family } : null;
}
