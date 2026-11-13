// A tool proficiency the rules leave to the player ("three musical
// instruments of your choice", "one artisan's tools", "one gaming set") is a
// choice among named tools, and the sheet should name the ones chosen: a
// tool check needs a tool to be proficient with, and a sentence is none.
//
// The class and background rows keep their SRD wording; this module reads
// that wording as a pick, so the builder can offer it and the server can
// check it, and a sheet stored with the sentence still reads.

import { textKey } from "@/lib/language/text-logic";

// SRD 5.1, Equipment, Tools.
export const ARTISANS_TOOLS = [
  "alchemist's supplies",
  "brewer's supplies",
  "calligrapher's supplies",
  "carpenter's tools",
  "cartographer's tools",
  "cobbler's tools",
  "cook's utensils",
  "glassblower's tools",
  "jeweler's tools",
  "leatherworker's tools",
  "mason's tools",
  "painter's supplies",
  "potter's tools",
  "smith's tools",
  "tinker's tools",
  "weaver's tools",
  "woodcarver's tools",
];

export const MUSICAL_INSTRUMENTS = [
  "bagpipes",
  "drum",
  "dulcimer",
  "flute",
  "lute",
  "lyre",
  "horn",
  "pan flute",
  "shawm",
  "viol",
];

export const GAMING_SETS = ["dice set", "dragonchess set", "playing card set", "three-dragon ante set"];

// The SRD's other tools and kits.
export const OTHER_TOOLS = [
  "thieves' tools", "disguise kit", "forgery kit", "herbalism kit", "navigator's tools", "poisoner's kit",
  "vehicles (land)", "vehicles (water)",
];
// Every tool the SRD's equipment chapter names: what "two tools of your
// choice" picks from.
export const KNOWN_TOOLS = [...new Set([...ARTISANS_TOOLS, ...MUSICAL_INSTRUMENTS, ...GAMING_SETS, ...OTHER_TOOLS])];

// Names compared without their apostrophes and plural or possessive s, so
// "Cartographers' tools" and "Thieves' tools" find the SRD's tools.
const looseKey = (name: string) => textKey(name.replace(/['‘’`]/g, "")).replace(/s\b/g, "");
// A pack's other word for a tool the SRD names (Tome of Heroes' Desert Runner).
const TOOL_ALIASES: Record<string, string> = { [looseKey("herbalist kit")]: "herbalism kit", [looseKey("herbalist's kit")]: "herbalism kit" };
const BY_LOOSE_KEY = new Map(KNOWN_TOOLS.map((tool) => [looseKey(tool), tool]));

// The SRD's name for a tool a row spells its own way, or the entry as it
// came when it names no SRD tool (a setting's "electronics kit"). A sheet
// proficient in "Herbalist kit" was never proficient with a herbalism kit.
export function canonicalToolName(entry: string): string {
  const key = looseKey(entry);
  return BY_LOOSE_KEY.get(key) ?? TOOL_ALIASES[key] ?? entry;
}

// `optional`: a choice the player is owed but a stored sheet may lack (the
// tool in place of one given twice, below): a character made before it was
// offered still joins without it.
// `instead`: the tools a replacement stands in for.
export type ToolChoice = { count: number; from: string[]; label: string; optional?: boolean; instead?: string[] };

export const REPLACEMENT_TOOL_LABEL = "replacement tool";

// SRD 5.1, Backgrounds: "If a character would gain the same proficiency from
// two different sources, he or she can choose a different proficiency of the
// same kind instead." The tools the class, the background and the race each
// name outright (a rogue's thieves' tools and a criminal's, a druid's
// herbalism kit and a hermit's): one tool of the player's choice for each
// name given twice, from every tool none of them names. Null when none
// repeats. Without it the second grant was simply lost.
export function repeatedToolChoice(...grants: Array<string[] | undefined>): ToolChoice | null {
  const seen = new Set<string>();
  const instead: string[] = [];
  for (const list of grants) {
    const named = new Map(splitToolGrants(list ?? []).fixed.map((entry) => [textKey(entry), entry.trim()] as const));
    for (const [key, tool] of named) {
      if (!key) {
        continue;
      }
      if (seen.has(key)) {
        instead.push(tool);
      } else {
        seen.add(key);
      }
    }
  }
  if (!instead.length) {
    return null;
  }
  return {
    count: instead.length,
    from: KNOWN_TOOLS.filter((tool) => !seen.has(textKey(tool))),
    label: REPLACEMENT_TOOL_LABEL,
    optional: true,
    instead,
  };
}

const COUNTS: Record<string, number> = { one: 1, two: 2, three: 3, a: 1, any: 1 };

// The pick a tool entry stands for, or null when the entry names a tool.
export function toolChoiceOf(entry: string): ToolChoice | null {
  const text = entry.trim().toLowerCase().replace(/[‘’]/g, "'");
  // A content-pack background naming the tools it offers: "Your choice of
  // one from Thieves' Tools, Forgery Kit, or Disguise Kit".
  const named = /^(?:your )?choice of (one|two|three|a|any) (?:from|of)(?: among)? (.+?)\.?$/.exec(text);
  if (named) {
    const tools = named[2].split(/\s*,\s*(?:or\s+)?|\s+or\s+/).filter(Boolean);
    if (tools.length > 1) {
      return { count: COUNTS[named[1]], from: tools, label: "tool" };
    }
  }
  // Any tool at all: "two additional tools your choice" (Black Flag's
  // Mechanist), "two tools of your choice" (the open5e Con Artist).
  const any = /^(one|two|three|a|any) (?:additional |more |other )?tools? (?:of )?(?:your )?choice\.?$/.exec(text);
  if (any) {
    return { count: COUNTS[any[1]], from: [...KNOWN_TOOLS], label: "tool" };
  }
  const kinds: Array<[RegExp, string[], string]> = [
    [/artisan'?s? tools?/, ARTISANS_TOOLS, "artisan's tools"],
    [/musical instruments?/, MUSICAL_INSTRUMENTS, "musical instrument"],
    [/gaming sets?/, GAMING_SETS, "gaming set"],
  ];
  const from: string[] = [];
  const labels: string[] = [];
  for (const [pattern, tools, label] of kinds) {
    if (pattern.test(text)) {
      from.push(...tools);
      labels.push(label);
    }
  }
  if (!from.length) {
    return null;
  }
  // "one artisan's tools or one musical instrument": one pick from both.
  const word = /^(one|two|three|a|any)\b/.exec(text)?.[1];
  const count = word ? COUNTS[word] : /^(\d+)/.test(text) ? Number(/^(\d+)/.exec(text)![1]) : 1;
  return { count, from, label: labels.join(" or ") };
}

// A grant's tool list split into what it names and what it leaves to the
// player: ["disguise kit", "one musical instrument"] is the disguise kit and
// one pick among the instruments.
export function splitToolGrants(tools: string[]): { fixed: string[]; choices: ToolChoice[] } {
  const fixed: string[] = [];
  const choices: ToolChoice[] = [];
  for (const entry of tools) {
    const choice = toolChoiceOf(entry);
    if (choice) {
      choices.push(choice);
    } else {
      fixed.push(entry);
    }
  }
  return { fixed, choices };
}

// What is still to choose once these tools are placed on the choices they
// fit, as the sentence a player acts on, or null when every choice is
// answered. Tools that fit no open choice are passed over: this asks only
// whether anything is owed (a character made here must name its tools).
export function toolPicksOwed(choices: ToolChoice[], tools: string[]): string | null {
  const left = choices.map((choice) => choice.count);
  for (const tool of tools.map(textKey)) {
    const slot = choices.findIndex((choice, index) => left[index] > 0 && choice.from.some((entry) => textKey(entry) === tool));
    if (slot >= 0) {
      left[slot] -= 1;
    }
  }
  const owed = choices
    .map((choice, index) => ({ choice, left: left[index] }))
    .filter((entry) => entry.left > 0 && !entry.choice.optional);
  return owed.length
    ? `Choose ${owed.map((entry) => `${entry.left} ${entry.choice.label}${entry.left === 1 ? "" : "s"}`).join(" and ")} to be proficient with.`
    : null;
}

// Why these picks do not answer these choices, or null. Each pick must be a
// tool one of the choices offers, a choice takes no more picks than its
// count, and every choice is answered in full.
export function toolPickProblem(choices: ToolChoice[], picks: string[]): string | null {
  const left = choices.map((choice) => choice.count);
  const wanted = picks.map((pick) => pick.trim().toLowerCase()).filter(Boolean);
  for (const pick of wanted) {
    const slot = choices.findIndex((choice, index) => left[index] > 0 && choice.from.some((entry) => textKey(entry) === textKey(pick)));
    if (slot < 0) {
      return `${pick} is not a tool this character may choose; the choices are ${choices.map((choice) => `${choice.count} ${choice.label}`).join(" and ")}.`;
    }
    left[slot] -= 1;
  }
  const owed = choices
    .map((choice, index) => ({ choice, left: left[index] }))
    .filter((entry) => entry.left > 0 && !entry.choice.optional);
  if (owed.length) {
    return `Choose ${owed.map((entry) => `${entry.left} more ${entry.choice.label}`).join(" and ")}.`;
  }
  return null;
}
