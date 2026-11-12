import type { Block } from "./layout-logic.ts";

// Printed stat blocks, read back into the open5e-shaped record the
// bestiary's own reader takes (src/lib/bestiary/statblock.ts parseMonster),
// so a monster from a book plays by the same code as one from the content
// pack. The printed form is the SRD's: name, a size-type-alignment line,
// Armor Class, Hit Points, Speed, the six scores, the labelled lines, then
// traits and the Actions, Reactions and Legendary Actions lists. Pure.

export type PrintedEntry = { name: string; desc: string };

export type PrintedMonster = {
  name: string;
  size: string;
  type: string;
  subtype: string;
  alignment: string;
  armor_class: number;
  armor_desc: string;
  hit_points: number;
  hit_dice: string;
  speed: Record<string, number | string>;
  strength?: number;
  dexterity?: number;
  constitution?: number;
  intelligence?: number;
  wisdom?: number;
  charisma?: number;
  [save: `${string}_save`]: number | undefined;
  skills: Record<string, number>;
  damage_vulnerabilities: string;
  damage_resistances: string;
  damage_immunities: string;
  condition_immunities: string;
  senses: string;
  languages: string;
  cr: number;
  challenge_rating: string;
  special_abilities: PrintedEntry[];
  actions: PrintedEntry[];
  bonus_actions: PrintedEntry[];
  reactions: PrintedEntry[];
  legendary_actions: PrintedEntry[];
  legendary_desc: string;
  desc: string;
};

export type FoundStatBlock = {
  monster: PrintedMonster;
  // The blocks it was read from, so the section's prose can leave them out.
  blocks: Block[];
  page: number;
  // The printed text, for the GM to check against.
  printed: string;
  // Read from a row of a creature table rather than a whole block.
  table?: boolean;
};

const SIZES = "tiny|small|medium|large|huge|gargantuan";
const TYPE_LINE = new RegExp(`^(${SIZES})(?:\\s+or\\s+(?:${SIZES}))?\\s+([a-z][a-z ]*?)\\s*(?:\\(([^)]*)\\))?\\s*,\\s*(.+)$`, "i");
const SAVE_KEYS: Record<string, string> = { str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" };
const LABELS = [
  "armor class",
  "hit points",
  "speed",
  "saving throws",
  "skills",
  "damage vulnerabilities",
  "damage resistances",
  "damage immunities",
  "condition immunities",
  "senses",
  "languages",
  "challenge",
  "proficiency bonus",
] as const;
const LISTS: Record<string, "actions" | "bonus_actions" | "reactions" | "legendary_actions" | "lair"> = {
  actions: "actions",
  "bonus actions": "bonus_actions",
  reactions: "reactions",
  "legendary actions": "legendary_actions",
  "lair actions": "lair",
  "regional effects": "lair",
  "mythic actions": "legendary_actions",
};

const plain = (text: string) => text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
// Book minus signs and dashes are "−" and "–"; the numbers want "-".
const minus = (text: string) => text.replace(/[−–—]/g, "-");

// The 2024 printing's short labels for the same lines ("AC 15", "HP 22",
// "CR 1/4"), read as the 2014 ones: an import lands in SRD 5.1 terms.
const SHORT_LABELS: Array<[RegExp, (typeof LABELS)[number]]> = [
  [/^ac\b/, "armor class"],
  [/^hp\b/, "hit points"],
  [/^cr\b/, "challenge"],
  [/^immunities\b/, "damage immunities"],
  [/^resistances\b/, "damage resistances"],
  [/^vulnerabilities\b/, "damage vulnerabilities"],
];

function labelOf(text: string): { label: (typeof LABELS)[number]; rest: string } | null {
  const bold = /^\*\*([^*]+?)\*\*\s*([\s\S]*)$/.exec(text);
  const head = bold ? bold[1].trim() : "";
  const rest = bold ? bold[2] : text;
  const probe = (head || text).toLowerCase();
  for (const [pattern, label] of SHORT_LABELS) {
    const match = pattern.exec(probe);
    if (match) {
      const after = head ? `${head.slice(match[0].length)} ${rest}` : text.slice(match[0].length);
      return { label, rest: after.replace(/^[\s:.]+/, "").trim() };
    }
  }
  for (const label of LABELS) {
    if (probe.startsWith(label)) {
      const after = head ? `${head.slice(label.length)} ${rest}` : text.slice(label.length);
      return { label, rest: after.replace(/^[\s:.]+/, "").trim() };
    }
  }
  return null;
}

function entryOf(text: string): PrintedEntry | null {
  const bold = /^\*\*([^*]+?)\*\*\s*([\s\S]*)$/.exec(text);
  if (!bold) return null;
  const name = bold[1].replace(/[.:]\s*$/, "").trim();
  if (!name) return null;
  return { name, desc: plain(bold[2]) };
}

function crValue(text: string): number {
  const match = /(\d+)\s*\/\s*(\d+)|(\d+(?:\.\d+)?)/.exec(text);
  if (!match) return 0;
  if (match[1]) return Number(match[1]) / Math.max(1, Number(match[2]));
  return Number(match[3]);
}

export function speedOf(text: string): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const part of minus(text).split(/[,;]/)) {
    const match = /^\s*(walk|fly|swim|climb|burrow)?\s*(\d+)\s*ft\.?\s*(\(hover\))?/i.exec(part);
    if (!match) continue;
    out[(match[1] ?? "walk").toLowerCase()] = Number(match[2]);
    if (match[3]) out.hover = "true";
  }
  return out;
}

function scoresOf(text: string): number[] {
  const out: number[] = [];
  for (const match of minus(text).matchAll(/(\d{1,2})\s*\(\s*[+-]?\s*\d+\s*\)/g)) out.push(Number(match[1]));
  if (out.length >= 6) return out;
  // The 2024 table: "Str 12 +1 +1 Dex 15 +2 +2 ...".
  const table: number[] = [];
  for (const match of minus(text).matchAll(/\b(?:Str|Dex|Con|Int|Wis|Cha)\s+(\d{1,2})\s+[+-]\d+/gi)) table.push(Number(match[1]));
  return table.length >= out.length ? table : out;
}

// Where a stat block starts: a short name line, then the size and type.
export function startsStatBlock(blocks: Block[], index: number): boolean {
  const name = blocks[index];
  const next = blocks[index + 1];
  if (!name || !next) return false;
  const title = plain(name.text);
  if (!title || title.length > 60 || /[.,;]$/.test(title)) return false;
  if (name.kind !== "heading" && !name.bold) return false;
  if (!TYPE_LINE.test(plain(next.text))) return false;
  // Armor Class within the next few lines, or it is prose that happens to
  // begin "Medium humanoid,".
  return blocks.slice(index + 2, index + 6).some((block) => /^\*?\*?(armor class|ac\b)/i.test(block.text));
}

// Reads one stat block from `blocks[start]` onward. It ends at the next
// heading that is not one of its own list titles, at the next stat block, or
// where a tinted box it sat in gives way to plain text.
export function readStatBlock(blocks: Block[], start: number): FoundStatBlock {
  const nameBlock = blocks[start];
  const typeBlock = blocks[start + 1];
  const typeMatch = TYPE_LINE.exec(plain(typeBlock.text));
  const monster: PrintedMonster = {
    name: plain(nameBlock.text).slice(0, 120),
    size: typeMatch ? typeMatch[1][0].toUpperCase() + typeMatch[1].slice(1).toLowerCase() : "Medium",
    type: typeMatch ? typeMatch[2].trim().toLowerCase() : "",
    subtype: typeMatch?.[3]?.trim() ?? "",
    alignment: typeMatch ? typeMatch[4].trim() : "",
    armor_class: 10,
    armor_desc: "",
    hit_points: 1,
    hit_dice: "",
    speed: {},
    skills: {},
    damage_vulnerabilities: "",
    damage_resistances: "",
    damage_immunities: "",
    condition_immunities: "",
    senses: "",
    languages: "",
    cr: 0,
    challenge_rating: "0",
    special_abilities: [],
    actions: [],
    bonus_actions: [],
    reactions: [],
    legendary_actions: [],
    legendary_desc: "",
    desc: "",
  };
  const used: Block[] = [nameBlock, typeBlock];
  const boxed = typeBlock.kind === "boxed";
  let list: "special_abilities" | "actions" | "bonus_actions" | "reactions" | "legendary_actions" | "lair" = "special_abilities";
  let lair: string[] = [];
  let seenChallenge = false;
  let unlabeledRun = 0;
  let index = start + 2;
  for (; index < blocks.length; index += 1) {
    const block = blocks[index];
    const text = block.text.trim();
    if (startsStatBlock(blocks, index)) break;
    if (block.kind === "heading" && block.level <= 3) break;
    if (boxed && block.kind !== "boxed" && seenChallenge && !/^\*\*/.test(text)) break;
    const listTitle = LISTS[plain(text).toLowerCase()];
    if (listTitle) {
      list = listTitle;
      used.push(block);
      unlabeledRun = 0;
      continue;
    }
    const labelled = !seenChallenge ? labelOf(text) : null;
    if (labelled) {
      readLabel(monster, labelled.label, labelled.rest);
      if (labelled.label === "challenge") seenChallenge = true;
      used.push(block);
      continue;
    }
    // The six scores, however the table broke across lines ("STR DEX CON
    // INT" on one, "WIS CHA 16 (+3) ..." on the next).
    if (!seenChallenge && (/^(STR|DEX|CON|INT|WIS|CHA)\b/i.test(plain(text)) || scoresOf(text).length >= 6)) {
      const scores = scoresOf(text);
      if (scores.length >= 6 && monster.strength === undefined) {
        [monster.strength, monster.dexterity, monster.constitution, monster.intelligence, monster.wisdom, monster.charisma] = scores;
      }
      used.push(block);
      continue;
    }
    if (block.kind === "heading" && block.level === 4) {
      // A run-in title inside the block is an entry's name on its own line.
      if (!seenChallenge) break;
    }
    const entry = entryOf(text);
    if (entry) {
      unlabeledRun = 0;
      if (list === "lair") lair.push(`${entry.name}. ${entry.desc}`);
      else monster[list].push(entry);
      used.push(block);
      continue;
    }
    // Prose with no label: the legendary preamble, or the rest of the
    // entry above it. Past two such paragraphs it is the book talking again.
    if (!seenChallenge) {
      used.push(block);
      continue;
    }
    if (list === "legendary_actions" && !monster.legendary_actions.length && !monster.legendary_desc) {
      monster.legendary_desc = plain(text);
      used.push(block);
      continue;
    }
    if (list === "lair") {
      lair.push(plain(text));
      used.push(block);
      continue;
    }
    unlabeledRun += 1;
    const last = monster[list][monster[list].length - 1];
    if (!last || unlabeledRun > 2) break;
    last.desc = `${last.desc}\n${plain(text)}`;
    used.push(block);
  }
  if (lair.length) monster.desc = lair.join("\n");
  lair = [];
  return {
    monster,
    blocks: used,
    page: nameBlock.page,
    printed: used.map((block) => plain(block.text)).join("\n").slice(0, 8_000),
  };
}

function readLabel(monster: PrintedMonster, label: (typeof LABELS)[number], rest: string): void {
  const text = minus(rest);
  switch (label) {
    case "armor class": {
      const match = /(\d+)\s*(\(([^)]*)\))?/.exec(text);
      if (match) {
        monster.armor_class = Number(match[1]);
        monster.armor_desc = match[3]?.trim() ?? "";
      }
      return;
    }
    case "hit points": {
      const match = /(\d+)\s*(?:\(([^)]*)\))?/.exec(text);
      if (match) {
        monster.hit_points = Number(match[1]);
        monster.hit_dice = (match[2] ?? "").replace(/\s+/g, "");
      }
      return;
    }
    case "speed":
      monster.speed = speedOf(text);
      return;
    case "saving throws":
      for (const match of text.matchAll(/\b(str|dex|con|int|wis|cha)\w*\s*([+-]\s*\d+)/gi)) {
        monster[`${SAVE_KEYS[match[1].toLowerCase()]}_save`] = Number(match[2].replace(/\s+/g, ""));
      }
      return;
    case "skills":
      for (const match of text.matchAll(/([A-Za-z][A-Za-z ]+?)\s*([+-]\s*\d+)/g)) {
        monster.skills[match[1].trim().toLowerCase().replace(/\s+/g, "_")] = Number(match[2].replace(/\s+/g, ""));
      }
      return;
    case "damage vulnerabilities":
      monster.damage_vulnerabilities = rest;
      return;
    case "damage resistances":
      monster.damage_resistances = rest;
      return;
    case "damage immunities":
      monster.damage_immunities = rest;
      return;
    case "condition immunities":
      monster.condition_immunities = rest;
      return;
    case "senses":
      monster.senses = rest;
      return;
    case "languages":
      monster.languages = rest;
      return;
    case "challenge": {
      monster.cr = crValue(text);
      monster.challenge_rating = (/(\d+\s*\/\s*\d+|\d+)/.exec(text)?.[1] ?? "0").replace(/\s+/g, "");
      return;
    }
    case "proficiency bonus":
      return;
  }
}

// Every stat block in a run of blocks, in order.
export function findStatBlocks(blocks: Block[]): FoundStatBlock[] {
  const out: FoundStatBlock[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    if (!startsStatBlock(blocks, index)) continue;
    const found = readStatBlock(blocks, index);
    out.push(found);
    index += Math.max(1, found.blocks.length) - 1;
  }
  return out;
}
