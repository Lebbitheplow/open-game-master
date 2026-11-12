import type { Block } from "./layout-logic.ts";
import type { FoundStatBlock, PrintedEntry, PrintedMonster } from "./statblock-text-logic.ts";
import { singular } from "./srd-names-logic.ts";

// Stat blocks from other systems, read into the same open5e-shaped record a
// 5e block becomes (statblock-text-logic.ts), so every creature a book
// prints lands as SRD 5.1 numbers. The import then looks for the SRD 5.1
// creature each one is (srd-match.ts) and uses that where there is one;
// these conversions are for the creatures the SRD does not have, and the
// review marks them to check. Pure.

export type BookSystem = "5e" | "5e-2024" | "bx" | "pathfinder" | "unknown";

export const SYSTEM_LABELS: Record<BookSystem, string> = {
  "5e": "5th edition",
  "5e-2024": "the 2024 printing of 5th edition",
  bx: "Old-School Essentials / B/X",
  pathfinder: "Pathfinder or another d20 game",
  unknown: "a system the layout does not say",
};

const plain = (text: string) => text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
const minus = (text: string) => text.replace(/[−–—]/g, "-").replace(/[’′]/g, "'");

// Which system a book is written for, from what its stat blocks print.
export function detectSystem(blocks: Block[], fileName = ""): BookSystem {
  let fifth = 0;
  let newer = 0;
  let bx = 0;
  let pathfinder = 0;
  for (const block of blocks) {
    const text = minus(plain(block.text));
    if (/\bArmor Class\b/.test(text) || /\bChallenge\s+\d/.test(text)) fifth += 1;
    if (/\bInitiative\s*[+-]\d+\s*\(\d+\)/.test(text) || /\bCR\s+[\d/]+\s*\(XP\s*[\d,]+;\s*PB/.test(text)) newer += 2;
    if (/\bTHAC0\b/.test(text) || /\bHD\s*\d+[*+]?.*\bMV\s*\d+'/.test(text) || /\bSV\s*D\d+\s*W\d+/.test(text)) bx += 2;
    if (/\bCreature\s+-?\d+\b/.test(text) || /\bFort\s*[+-]\d+,\s*Ref\s*[+-]\d+,\s*Will\s*[+-]\d+/.test(text) || /\bflat-footed\s+\d+/.test(text)) pathfinder += 2;
  }
  const best = Math.max(fifth, newer, bx, pathfinder);
  // A book that prints no full stat block may still say what it is for.
  if (best < 2) return /(^|[^a-z0-9])5e([^a-z0-9]|$)|5th edition|dnd ?5|d&d/i.test(fileName) || blocks.slice(0, 80).some((block) => /\b(5e|fifth edition|5th edition)\b/i.test(block.text)) ? "5e" : "unknown";
  if (best === newer) return "5e-2024";
  if (best === bx) return "bx";
  if (best === pathfinder) return "pathfinder";
  return "5e";
}

function blank(name: string): PrintedMonster {
  return {
    name: name.slice(0, 120),
    size: "Medium",
    type: "",
    subtype: "",
    alignment: "",
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
}

// A creature's type from the words of its name, for systems that print
// none: the bestiary needs one, and the GM can change it.
const TYPE_WORDS: Array<[RegExp, string]> = [
  [/\b(golem|statue|construct|automaton|animated)\b/i, "construct"],
  [/\b(ooze|jelly|pudding|slime)\b/i, "ooze"],
  [/\b(skeleton|zombie|ghoul|ghast|ghost|mummy|wight|wraith|spectre|specter|vampire|lich|undead|banshee|shadow)\b/i, "undead"],
  [/\b(dragon|drake|wyvern)\b/i, "dragon"],
  [/\b(demon|devil|fiend|imp)\b/i, "fiend"],
  [/\b(elemental)\b/i, "elemental"],
  [/\b(giant|ogre|troll|ettin|cyclops)\b/i, "giant"],
  [/\b(fairy|faerie|pixie|sprite|dryad|satyr|hag)\b/i, "fey"],
  [/\b(fungus|fungi|mold|myconid|treant|shrub|vine|plant)\b/i, "plant"],
  [/\b(angel|deva)\b/i, "celestial"],
  [/\b(wolf|bat|rat|bear|leopard|lion|boar|snake|spider|beetle|eel|shark|horse|mule|deer|bee|wasp|ant|centipede|crab|hawk|eagle|owl|ape|cat|dog|hound|scorpion|lizard|toad|frog|arachnid|rhagodessa)\b/i, "beast"],
  [/\b(kobold|goblin|hobgoblin|bugbear|orc|gnoll|bandit|poacher|human|elf|dwarf|halfling|gnome|cultist|guard|soldier|knight|priest|mage|thief|peddler|merchant|noble|villager|hunter|lizardfolk|sahuagin|merfolk|troglodyte)\b/i, "humanoid"],
];

export function typeFromName(name: string): string {
  // "Marsh Wolves" is wolves: each word is also tried as one of them.
  const one = name.toLowerCase().split(/\s+/).map(singular).join(" ");
  for (const [pattern, type] of TYPE_WORDS) if (pattern.test(name) || pattern.test(one)) return type;
  return "monstrosity";
}

const DAMAGE_WORDS: Array<[RegExp, string]> = [
  [/\b(claw|talon|sword|axe|blade|scimitar|dagger|slash|scythe|sickle)\b/i, "slashing"],
  [/\b(bite|spear|arrow|bow|sting|horn|gore|pierce|tusk|javelin|bolt|crossbow|dart|blowgun|pick|lance|trident)\b/i, "piercing"],
  [/\b(fire|flame|burn|molotov)\b/i, "fire"],
  [/\b(cold|frost|ice)\b/i, "cold"],
  [/\b(acid)\b/i, "acid"],
  [/\b(poison|venom)\b/i, "poison"],
  [/\b(touch|drain|aging|necrotic)\b/i, "necrotic"],
  [/\b(lightning|shock)\b/i, "lightning"],
];

function damageType(attack: string): string {
  for (const [pattern, type] of DAMAGE_WORDS) if (pattern.test(attack)) return type;
  return "bludgeoning";
}

// A dice expression the engine rolls, from "2d6", "1d6 + aging", "d4".
function diceOf(text: string): string | null {
  const match = /(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?/i.exec(minus(text));
  if (!match) return null;
  const count = match[1] ? Number(match[1]) : 1;
  return `${count}d${match[2]}${match[3] ? `${match[3]}${match[4]}` : ""}`;
}

function averageOf(dice: string): number {
  const match = /(\d+)d(\d+)(?:([+-])(\d+))?/.exec(dice);
  if (!match) return 1;
  const base = Math.floor((Number(match[1]) * (Number(match[2]) + 1)) / 2);
  const bonus = match[3] ? (match[3] === "-" ? -1 : 1) * Number(match[4]) : 0;
  return Math.max(1, base + bonus);
}

// An attack in the words the bestiary's own reader takes
// (src/lib/bestiary/attack-parse.ts): "+4 to hit, reach 5 ft." and
// "Hit: 7 (2d6) slashing damage.", with the rider kept as written.
function attackEntry(name: string, toHit: number, dice: string, type: string, rider: string, ranged = false): PrintedEntry {
  const reach = ranged ? "range 80/320 ft." : "reach 5 ft.";
  const kind = ranged ? "Ranged Weapon Attack" : "Melee Weapon Attack";
  const extra = rider.trim() ? ` ${rider.trim().replace(/^[+,\s]+/, "").replace(/^./, (c) => c.toUpperCase())}.` : "";
  return { name: name.replace(/^./, (c) => c.toUpperCase()).slice(0, 60), desc: `${kind}: ${toHit >= 0 ? "+" : ""}${toHit} to hit, ${reach}, one target. Hit: ${averageOf(dice)} (${dice}) ${type} damage.${extra}` };
}

function setCr(monster: PrintedMonster, cr: number): void {
  const value = Math.max(0.125, Math.min(30, cr));
  const snapped = value < 0.25 ? 0.125 : value < 0.5 ? 0.25 : value < 1 ? 0.5 : Math.round(value);
  monster.cr = snapped;
  monster.challenge_rating = snapped === 0.125 ? "1/8" : snapped === 0.25 ? "1/4" : snapped === 0.5 ? "1/2" : String(snapped);
}

function multiattack(monster: PrintedMonster, count: number): void {
  if (count > 1) monster.actions.unshift({ name: "Multiattack", desc: `The ${monster.name.toLowerCase()} makes ${count} attacks.` });
}

// ---- Old-School Essentials / B/X: "AC 6 [13], HD 2+2 (11hp), Att 1 ×
// bite (1d6), THAC0 17 [+2], MV 180' (60'), SV D12 ..., ML 6, AL Neutral,
// XP 25". The bracketed numbers are the ascending ones; MV's parenthesis is
// the encounter speed, which is 5e's.

const BX_LINE = /\bAC\b\**\s*-?\d+\s*\[(\d+)\]/;

export function readBxLine(name: string, line: string, after: Block[] = []): PrintedMonster | null {
  const text = minus(plain(line));
  const ac = BX_LINE.exec(text);
  const hd = /\bHD\s*(\d+|½|1\/2)\s*(?:\+\s*(\d+)|-\s*(\d+))?\s*(\**)/.exec(text);
  if (!ac || !hd) return null;
  const monster = blank(name.replace(/\s*\((\d+)\)$/, ""));
  // "Constantine Kodiak (Blue amber golem)": the person's kind is the
  // parenthesis.
  const kind = /\(([^)]*[a-z][^)]*)\)/i.exec(name)?.[1] ?? name;
  monster.type = typeFromName(kind);
  monster.armor_class = Number(ac[1]);
  const dice = hd[1] === "½" || hd[1] === "1/2" ? 0.5 : Number(hd[1]);
  const stars = (hd[4] ?? "").length;
  const hp = /\(\s*(?:hp\s*)?(\d+)\s*(?:hp)?[^)]*\)/i.exec(text.slice(hd.index));
  monster.hit_points = hp ? Number(hp[1]) : Math.max(1, Math.round(dice * 4.5 + Number(hd[2] ?? 0) - Number(hd[3] ?? 0)));
  monster.hit_dice = `${Math.max(1, Math.round(dice))}d8${hd[2] ? `+${hd[2]}` : ""}`;
  const bonus = /\bTHAC0\b\**\s*\d+\s*\[([+-]?\d+)\]/.exec(text);
  const toHit = bonus ? Number(bonus[1]) : Math.max(0, Math.round(dice));
  const att = /\bAtt\b\**\s*(.+?)(?:,\s*\**THAC0|$)/.exec(text);
  let count = 0;
  if (att) {
    for (const part of att[1].matchAll(/(\d+)\s*[×x]\s*([^,(]+?)\s*\(([^)]*)\)/g)) {
      const times = Number(part[1]);
      const label = part[2].trim();
      const rolled = diceOf(part[3]);
      if (!rolled) {
        monster.special_abilities.push({ name: label, desc: `${label} (${part[3].trim()}).` });
        continue;
      }
      const ranged = /\b(bow|crossbow|sling|blowgun|dart|javelin|throw)\b/i.test(label);
      const rider = part[3].replace(/^[^+]*?\d*d\d+(\s*[+-]\s*\d+)?/i, "");
      monster.actions.push(attackEntry(label, toHit, rolled, damageType(label), rider, ranged));
      count += times;
    }
  }
  multiattack(monster, count);
  const mv = /\bMV\b\**\s*(\d+)'\s*\((\d+)'\)(?:\s*\/\s*(\d+)'\s*\((\d+)'\)\s*(flying|\S?ying|swimming|climbing))?/i.exec(text);
  if (mv) {
    monster.speed.walk = Number(mv[2]);
    if (mv[4]) monster.speed[/swim/i.test(mv[5] ?? "") ? "swim" : /climb/i.test(mv[5] ?? "") ? "climb" : "fly"] = Number(mv[4]);
  }
  const al = /\bAL\b\**\s*(Lawful|Neutral|Chaotic)/i.exec(text);
  if (al) monster.alignment = al[1].toLowerCase() === "lawful" ? "lawful neutral" : al[1].toLowerCase() === "chaotic" ? "chaotic neutral" : "neutral";
  // B/X Hit Dice against 5e challenge: about three HD to each CR in the low
  // range, a special ability (the stars) a step up for every two.
  setCr(monster, dice < 1 ? 0.125 : dice < 2 ? 0.25 : dice < 3 ? 0.5 : dice * 0.75 - 1 + stars * 0.5);
  for (const block of after) {
    const ability = /^\**►?\s*\**([^:*]{2,60}):\**\s*([\s\S]+)$/.exec(plain(block.text).replace(/^►\s*/, ""));
    if (!ability) break;
    monster.special_abilities.push({ name: ability[1].replace(/^►\s*/, "").trim(), desc: ability[2].trim() });
  }
  return monster;
}

// ---- Pathfinder and other d20 games: "AC 16; Fort +5, Ref +7, Will +3",
// "HP 6", "Speed 25 feet", "Melee [one-action] dogslicer +7 (agile),
// Damage 1d6 slashing", ability modifiers "Str +0, Dex +3".

export function readPathfinder(name: string, lines: string[]): PrintedMonster | null {
  const text = minus(lines.map(plain).join(" "));
  const ac = /\bAC\s*(\d+)[;,]/.exec(text);
  const hp = /\b(?:HP|hp)\s*(\d+)/.exec(text);
  if (!ac || !hp) return null;
  const monster = blank(name);
  monster.type = typeFromName(name);
  monster.armor_class = Number(ac[1]);
  monster.hit_points = Number(hp[1]);
  const level = /\bCreature\s*(-?\d+)/i.exec(text) ?? /\bCR\s*(\d+(?:\/\d+)?)/.exec(text);
  if (level) {
    const value = level[1].includes("/") ? Number(level[1].split("/")[0]) / Number(level[1].split("/")[1]) : Number(level[1]);
    setCr(monster, /Creature/i.test(level[0]) ? (value <= 0 ? 0.125 * (value + 2) : value < 3 ? value / 2 : value - 1) : value);
  }
  const speed = /\bSpeed\s*(\d+)\s*(?:feet|ft)/i.exec(text);
  if (speed) monster.speed.walk = Number(speed[1]);
  for (const [short, long] of [["Str", "strength"], ["Dex", "dexterity"], ["Con", "constitution"], ["Int", "intelligence"], ["Wis", "wisdom"], ["Cha", "charisma"]] as const) {
    const mod = new RegExp(`\\b${short}\\s*([+-]\\d+)\\b`).exec(text);
    const score = new RegExp(`\\b${short}\\s*(\\d{1,2})\\b`).exec(text);
    if (mod) monster[long] = 10 + 2 * Number(mod[1]);
    else if (score) monster[long] = Number(score[1]);
  }
  let count = 0;
  for (const strike of text.matchAll(/\b(Melee|Ranged)\b[^+\-]*?([A-Za-z][A-Za-z ]{1,30}?)\s*([+-]\d+)[^,]*?(?:,\s*Damage\s*|\()(\d*d\d+(?:\s*[+-]\s*\d+)?)\s*([a-z]+)?/g)) {
    const dice = diceOf(strike[4]);
    if (!dice) continue;
    monster.actions.push(attackEntry(strike[2].trim(), Number(strike[3]), dice, strike[5] && /^[a-z]+$/.test(strike[5]) ? strike[5] : damageType(strike[2]), "", strike[1] === "Ranged"));
    count += 1;
    if (count >= 4) break;
  }
  if (count > 1) multiattack(monster, Math.min(2, count));
  return monster;
}

// Every foreign stat block in a run of blocks: a name (a heading or bold
// line) and, right after it, the stat line or lines.
export function findForeignStatBlocks(blocks: Block[], system: BookSystem): FoundStatBlock[] {
  const out: FoundStatBlock[] = [];
  if (system !== "bx" && system !== "pathfinder") return out;
  for (let index = 1; index < blocks.length; index += 1) {
    const block = blocks[index];
    const text = plain(block.text);
    const previous = blocks[index - 1];
    const nameText = plain(previous.text).replace(/[:.]$/, "");
    const named = (previous.kind === "heading" || previous.bold) && nameText.length > 1 && nameText.length <= 80;
    if (!named) continue;
    if (system === "bx" && BX_LINE.test(minus(text))) {
      const after: Block[] = [];
      for (let next = index + 1; next < blocks.length && after.length < 8 && /^\**►/.test(blocks[next].text.trim()); next += 1) after.push(blocks[next]);
      const monster = readBxLine(nameText, text, after);
      if (monster) out.push({ monster, blocks: [previous, block, ...after], page: block.page, printed: [nameText, text, ...after.map((entry) => plain(entry.text))].join("\n").slice(0, 8_000) });
    } else if (system === "pathfinder" && (/\bCreature\s*-?\d+/i.test(text) || /\bAC\s*\d+[;,]/.test(text))) {
      const lines: Block[] = [];
      for (let next = index; next < blocks.length && lines.length < 14 && !(blocks[next].kind === "heading" && next > index); next += 1) lines.push(blocks[next]);
      const monster = readPathfinder(nameText, lines.map((entry) => entry.text));
      if (monster) out.push({ monster, blocks: [previous, ...lines], page: block.page, printed: [nameText, ...lines.map((entry) => plain(entry.text))].join("\n").slice(0, 8_000) });
    }
  }
  return out;
}

// ---- Compact creature tables: one row per creature, columns such as
// "Creatures | STR DEX CON INT WIS CHA | HP | AC | Hit | Dmg | XP". The
// header names the columns; each row is a name and as many values.

const XP_TO_CR: Array<[number, number]> = [
  [10, 0], [25, 0.125], [50, 0.25], [100, 0.5], [200, 1], [450, 2], [700, 3], [1_100, 4], [1_800, 5], [2_300, 6], [2_900, 7], [3_900, 8], [5_000, 9], [5_900, 10],
  [7_200, 11], [8_400, 12], [10_000, 13], [11_500, 14], [13_000, 15], [15_000, 16], [18_000, 17], [20_000, 18], [22_000, 19], [25_000, 20],
];

export function crFromXp(xp: number): number {
  let cr = 0;
  for (const [threshold, value] of XP_TO_CR) if (xp >= threshold) cr = value;
  return cr;
}

const COLUMN = /^(str|dex|con|int|wis|cha|hp|ac|hit|atk|attack|to hit|dmg|damage|xp|cr|speed|spd|mv)$/i;

export function findCreatureTables(blocks: Block[]): FoundStatBlock[] {
  const out: FoundStatBlock[] = [];
  for (const block of blocks) {
    if (block.kind !== "table" || !block.rows?.length) continue;
    const header = block.rows[0].join(" ").split(/[\s|]+/).filter(Boolean);
    const columns = header.slice(1).map((token) => token.toLowerCase());
    if (!columns.includes("hp") || !columns.includes("ac") || !columns.every((token) => COLUMN.test(token))) continue;
    for (const row of block.rows.slice(1)) {
      const tokens = row.join(" ").split(/[\s|]+/).filter(Boolean);
      const first = tokens.findIndex((token) => /^[+-]?\d/.test(token));
      if (first < 1) continue;
      const name = tokens.slice(0, first).join(" ");
      const values = tokens.slice(first);
      if (values.length !== columns.length) continue;
      const value = (column: string) => values[columns.indexOf(column)];
      const monster = blank(name);
      monster.type = typeFromName(name);
      for (const [short, long] of [["str", "strength"], ["dex", "dexterity"], ["con", "constitution"], ["int", "intelligence"], ["wis", "wisdom"], ["cha", "charisma"]] as const) {
        const raw = value(short);
        if (raw === undefined) continue;
        const number = Number(minus(raw));
        // Modifiers ("+2") or scores ("14").
        monster[long] = /^[+-]/.test(raw) ? 10 + 2 * number : number;
      }
      monster.hit_points = Math.max(1, Number(value("hp")) || 1);
      monster.armor_class = Number(value("ac")) || 10;
      const hit = Number(minus(value("hit") ?? value("atk") ?? value("attack") ?? "0")) || 0;
      const damage = value("dmg") ?? value("damage");
      const dice = damage ? (diceOf(damage) ?? (/^\d+$/.test(damage) ? damage : null)) : null;
      if (dice) monster.actions.push(/d/.test(dice) ? attackEntry("Attack", hit, dice, "bludgeoning", "") : { name: "Attack", desc: `Melee Weapon Attack: ${hit >= 0 ? "+" : ""}${hit} to hit, reach 5 ft., one target. Hit: ${dice} bludgeoning damage.` });
      const xp = Number((value("xp") ?? "").replace(/,/g, ""));
      if (value("cr")) setCr(monster, Number(value("cr")!.includes("/") ? Number(value("cr")!.split("/")[0]) / Number(value("cr")!.split("/")[1]) : value("cr")));
      else if (xp) setCr(monster, crFromXp(xp) || 0.125);
      out.push({ monster, blocks: [block], page: block.page, printed: `${name}: ${row.join(" | ")}`, table: true });
    }
  }
  return out;
}
