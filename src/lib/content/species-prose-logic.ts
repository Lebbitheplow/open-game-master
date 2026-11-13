// What a content pack's species text grants that its trait names alone do
// not say, read into the lines and fields the engines already read.
//
// A bundled lineage (src/lib/srd/races.json) writes its rules into its trait
// lines: "Darkvision 60 ft", "Fire Resistance", "30 ft swim speed", "Bite
// (1d6 piercing unarmed strike)", and lists its skills and training in
// fields. A third-party pack row (Tome of Heroes, Open5e's own) prints the
// same rules as prose under a trait's name: "***Undead Resilience.*** You
// have resistance to necrotic damage and poison damage, you are immune to
// disease, and you have advantage on saving throws against being charmed or
// poisoned." Only the name reached the sheet, so a darakhul saw nothing in
// the dark, resisted nothing, had no bite and was proficient in nothing its
// text named. This module reads each paragraph's plain statements into the
// bundled form, and the race options (race-options.ts) add them to the row:
// the sheet carries the lines as racial features and the engines read them
// as they read a bundled lineage's.
//
// Only what a sentence states outright is read. A sentence that holds for a
// while or on a condition ("During it, you have a flying speed...", "When
// you reach 3rd level...") grants nothing here but the spells it names, and
// a choice among options (a bulleted list) stays the GM's.
//
// Pure and database-free, for the builder and the server alike.

import { ALL_SKILLS, traitHeading } from "@/lib/content/mechanics";
import { featGrantSpec, KNOWN_TOOLS } from "@/lib/srd/feat-grant-text";
import { SRD_WEAPONS } from "@/lib/srd/weapons";
import type { SpeciesSpell, SpeciesSpellGroup } from "@/lib/content/species-spells";
import { checklistSpell } from "@/lib/srd/spell-lists";

export type SpeciesProseGrants = {
  // Lines in the bundled lineages' words, read by the engines by name.
  lines: string[];
  skills: string[];
  skillChoice?: { count: number; from?: string[] };
  weapons: string[];
  armor: string[];
  tools: string[];
  toolChoice?: { count: number; from: string[] };
  weaponChoice?: { count: number; from: string[] };
  spells?: SpeciesSpellGroup;
};

const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];
const CONDITIONS = ["blinded", "charmed", "deafened", "frightened", "paralyzed", "petrified", "poisoned", "restrained", "stunned"];
const ABILITY_WORDS: Record<string, string> = {
  strength: "Strength", dexterity: "Dexterity", constitution: "Constitution",
  intelligence: "Intelligence", wisdom: "Wisdom", charisma: "Charisma",
};
const ORDINAL_LEVEL = /\b(\d+)(?:st|nd|rd|th) level\b/;

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const skillId = (words: string | undefined) =>
  words ? (ALL_SKILLS as readonly string[]).find((id) => id === words.trim().replace(/\s+/g, "_")) : undefined;

// The paragraphs of a pack's trait text, each under its heading; a bulleted
// option under a trait is a choice and is left out.
function paragraphs(text: string): Array<{ name: string; text: string }> {
  const out: Array<{ name: string; text: string }> = [];
  for (const line of String(text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || /^[*-]\s/.test(trimmed) || trimmed.startsWith("|")) {
      continue;
    }
    const head = traitHeading(trimmed);
    if (head) {
      out.push({ name: head.name, text: head.rest });
    } else if (out.length) {
      out[out.length - 1].text = `${out[out.length - 1].text} ${trimmed}`;
    }
  }
  return out;
}

const sentences = (text: string) =>
  text.replace(/[*_]/g, "").split(/(?<=[.!?])\s+(?=[A-Z])/).map((sentence) => sentence.trim()).filter(Boolean);

// A sentence that holds only for a while, on a condition, or once the
// character acts: never a standing grant.
const CONDITIONAL = /^(?:during|while|when|whenever|if|until|starting at|once|after|as an action|as a bonus action|as a reaction|you can use|for (?:1|one) minute)\b/i;

// The damage types a standing sentence resists: "You have resistance to
// necrotic damage and poison damage, you are immune to disease...".
function resisted(sentence: string): string[] {
  const at = /\bresistan(?:ce|t) (?:to|against) /i.exec(sentence);
  if (!at) {
    return [];
  }
  const rest = sentence.slice(at.index + at[0].length);
  // A resistance that holds only against some blows (nonmagical, from a
  // kind of creature) is not a standing one.
  const clause = rest.split(/;|, (?:and )?you\b|\.\s/)[0];
  if (/\bfrom\b|\bthat aren't\b|\bexcept\b/i.test(clause)) {
    return [];
  }
  return DAMAGE_TYPES.filter((type) => new RegExp(`\\b${type}\\b`, "i").test(clause));
}

// What a standing sentence gives advantage on saves against: conditions,
// poison, a damage type, or one ability's saves against spells or magic.
function saveAdvantage(sentence: string): { against: string[]; spellAbilities: string[] } {
  const out = { against: [] as string[], spellAbilities: [] as string[] };
  // "Choose Intelligence, Wisdom, or Charisma. You have advantage on saving
  // throws made with that ability score against magic" is a choice, the GM's.
  // "you make saving throws against poison with advantage" (Stoor Hardiness)
  // says the same as "advantage on saving throws against poison".
  const turned = /\bmake saving throws against ([^.;,]+?) with advantage\b/i.exec(sentence);
  const plain = /\badvantage on ((?:(?:strength|dexterity|constitution|intelligence|wisdom|charisma)(?:,? (?:and |or )?)?)*)saving throws? against ([^.;]*)/i.exec(sentence);
  const said = turned ? { abilities: "", against: turned[1] } : plain ? { abilities: plain[1], against: plain[2] } : null;
  if (!said) {
    return out;
  }
  const abilities = Object.keys(ABILITY_WORDS).filter((word) => new RegExp(`\\b${word}\\b`, "i").test(said.abilities));
  // What the advantage is against ends where the sentence turns to another
  // rule: "against being charmed, and magic can't put you to sleep".
  const what = said.against.toLowerCase().split(/,\s*(?:and|but)\b|,\s*you\b/)[0];
  if (/\b(?:spells|magic)\b/.test(what) && !/\bdeal\b/.test(what)) {
    out.spellAbilities = abilities.length ? abilities.map((word) => ABILITY_WORDS[word]) : Object.values(ABILITY_WORDS);
    return out;
  }
  if (abilities.length) {
    // An ability's saves against something else ("Dexterity saves against
    // traps") is not read here.
    return out;
  }
  for (const condition of CONDITIONS) {
    // "being charmed" and "charm" alike; "poison" is read below.
    const stem = condition === "poisoned" ? condition : condition.replace(/ed$/, "");
    if (new RegExp(`\\b(?:${condition}|${stem})\\b`).test(what)) {
      out.against.push(condition);
    }
  }
  // "against poison" is the poisoned condition and poison's other harms.
  if (/\bpoison\b/.test(what) && !out.against.includes("poisoned")) {
    out.against.push("poison");
  }
  if (/\bdisease\b/.test(what)) {
    out.against.push("disease");
  }
  // "against spells and other effects that deal cold damage" (Wooly).
  for (const type of DAMAGE_TYPES) {
    if (type !== "poison" && new RegExp(`\\b${type} damage\\b`).test(what)) {
      out.against.push(type);
    }
  }
  return out;
}

// The racial spells a paragraph teaches: "You know the vicious mockery
// cantrip. When you reach 3rd level, you can cast the enthrall spell with
// this trait, and starting at 5th level, you can cast the fear spell with
// it. ... Charisma is your spellcasting ability for these spells."
function taughtSpells(text: string): SpeciesSpellGroup | null {
  const ability = /\b(intelligence|wisdom|charisma) is your spellcasting ability\b/i.exec(text)?.[1]?.toLowerCase();
  if (!ability) {
    return null;
  }
  const spells: SpeciesSpell[] = [];
  const cantrip = /\byou know the ([a-z' ]+?) cantrip\b/i.exec(text);
  if (cantrip) {
    spells.push({ spell: titleCase(cantrip[1]), level: 1, circle: 0 });
  }
  const shortRest = /\bshort or long rest\b|\bshort rest\b/i.test(text);
  for (const sentence of sentences(text)) {
    for (const clause of sentence.split(/,\s*and\s+(?=starting|when|at)/i)) {
      const level = ORDINAL_LEVEL.exec(clause);
      const cast = /\byou can cast (?:the )?([a-z' ]+?)(?: spell)?(?: once)?(?: with (?:this trait|it)| and\b|[.,]|$)/i.exec(clause);
      if (level && cast) {
        // Once a long rest is a row's default, written as nothing.
        spells.push({ spell: titleCase(cast[1]), level: Number(level[1]), ...(shortRest ? { rest: "short" as const } : {}) });
      }
    }
  }
  // Each spell as the bundled list names it, with its own level, as a
  // workshop species stores its rows (src/lib/content/species-spells.ts).
  const named = spells.map((row) => {
    const known = checklistSpell(row.spell);
    return known ? { ...row, spell: known.name, circle: known.level } : row;
  });
  return named.length ? { ability: ability.slice(0, 3) as SpeciesSpellGroup["ability"], spells: named } : null;
}

const titleCase = (words: string) =>
  words.trim().split(/\s+/).map((word, index) => (index > 0 && /^(?:of|the|and|from|to)$/i.test(word) ? word.toLowerCase() : capital(word.toLowerCase()))).join(" ");

export function speciesProseGrants(data: { vision?: unknown; traits?: unknown }): SpeciesProseGrants {
  const out: SpeciesProseGrants = { lines: [], skills: [], weapons: [], armor: [], tools: [] };
  const add = (line: string) => {
    if (!out.lines.includes(line)) {
      out.lines.push(line);
    }
  };

  // Darkvision sits in its own field on the pack's rows.
  const vision = String(data.vision ?? "");
  const feet = /\bwithin (\d+) feet\b/i.exec(vision)?.[1];
  if (feet) {
    add(/superior darkvision/i.test(vision) ? `Superior Darkvision ${feet} ft` : `Darkvision ${feet} ft`);
  }

  const saveAgainst: string[] = [];
  const spellSaves: string[] = [];
  for (const paragraph of paragraphs(String(data.traits ?? ""))) {
    for (const sentence of sentences(paragraph.text)) {
      if (CONDITIONAL.test(sentence)) {
        continue;
      }
      for (const type of resisted(sentence)) {
        add(`${capital(type)} Resistance`);
      }
      const advantage = saveAdvantage(sentence);
      saveAgainst.push(...advantage.against.filter((entry) => !saveAgainst.includes(entry)));
      spellSaves.push(...advantage.spellAbilities.filter((entry) => !spellSaves.includes(entry)));
      if (/\byou are immune to disease\b|\bimmune to disease\b/i.test(sentence)) {
        add("Disease Immunity");
      }
      for (const [, mode, ft] of sentence.matchAll(/\b(swimming|climbing|burrowing|flying) speed of (\d+) feet\b/gi)) {
        const word = mode.toLowerCase();
        add(word === "flying" ? `Flying speed of ${ft} ft` : `${ft} ft ${word === "swimming" ? "swim" : word === "climbing" ? "climb" : "burrow"} speed`);
      }
      const hp = /\byour hit point maximum increases by (\d+), and it increases by \1 every time you gain a level\b/i.exec(sentence);
      if (hp) {
        add(`+${hp[1]} HP per level (${paragraph.name})`);
      }
    }
    // A natural weapon: "Your bite is a natural melee weapon ... your bite
    // deals piercing damage equal to 1d4 + your Strength modifier".
    const weapon = /\byour (\w+) (?:is|are) (?:a )?natural (?:melee )?weapons?\b/i.exec(paragraph.text);
    const dealt = /\b(\w+) damage equal to (\d+d\d+) \+ your strength modifier\b/i.exec(paragraph.text);
    if (weapon && dealt && DAMAGE_TYPES.includes(dealt[1].toLowerCase())) {
      add(`${capital(weapon[1].toLowerCase())} (${dealt[2]} ${dealt[1].toLowerCase()} unarmed strike)`);
    }
    // Proficiencies, read as a feat's are, and the forms a species writes
    // that a feat does not: "proficiency in the Performance skill, and ...",
    // "proficient with one martial weapon of your choice and with light
    // armor", "one of the following musical instruments: bagpipes, drum...".
    const grant = featGrantSpec(paragraph.text);
    const text = paragraph.text.toLowerCase().replace(/[‘’]/g, "'");
    const named = [...text.matchAll(/\bproficiency in the ([a-z ]+?)(?: and ([a-z ]+?))? skills?\b/g)].flatMap((hit) => [hit[1], hit[2]]).map(skillId).filter((id): id is string => Boolean(id));
    const armor = /\bproficien(?:cy|t) with\b[^.]*?\b((?:light|medium|heavy)(?:(?:,|,? and|,? or) (?:light|medium|heavy))*) armor\b/.exec(text);
    const toolList = /\bone of the following (?:musical instruments|tools|artisan's tools|gaming sets): ([^.]+)/.exec(text);
    const anyTool = /\b(?:one|a) tool (?:proficiency )?of your choice\b/.test(text);
    for (const skill of [...grant.fixedSkills, ...named]) {
      if (!out.skills.includes(skill)) out.skills.push(skill);
    }
    for (const entry of grant.fixedWeapons) {
      if (!out.weapons.includes(entry)) out.weapons.push(entry);
    }
    for (const entry of [...grant.armor, ...(armor ? armor[1].split(/,|\band\b|\bor\b/).map((word) => word.trim()).filter(Boolean) : [])]) {
      if (!out.armor.includes(entry)) out.armor.push(entry);
    }
    for (const entry of grant.fixedTools) {
      if (!out.tools.includes(entry)) out.tools.push(entry);
    }
    // "You gain proficiency with two of the following skills of your choice:
    // History, Insight, Performance, and Persuasion" (Born Leader): a feat
    // writes "in", a species also "with".
    const listed = grant.skills > 0 ? null : /\bproficiency with (one|two|three) of the following skills(?: of your choice)?: ([^.]+)/.exec(text);
    const picks = listed ? { count: { one: 1, two: 2, three: 3 }[listed[1]] ?? 1, from: ALL_SKILLS.filter((id) => new RegExp(`\\b${id.replace(/_/g, " ")}\\b`).test(listed[2])) } : null;
    if (grant.skills > 0 || picks) {
      const from = picks ? picks.from : grant.skillsFrom;
      out.skillChoice = {
        count: (out.skillChoice?.count ?? 0) + (picks ? picks.count : grant.skills),
        ...(from.length ? { from } : {}),
      };
    }
    // "you are proficient with two martial weapons of your choice": a pick
    // from that category of the SRD's weapons table.
    const weaponPick = /\bproficien(?:cy|t) with (one|two|three) (simple |martial )?weapons? of your choice\b/.exec(text);
    if (weaponPick) {
      const kind = weaponPick[2]?.trim();
      out.weaponChoice = {
        count: (out.weaponChoice?.count ?? 0) + ({ one: 1, two: 2, three: 3 }[weaponPick[1]] ?? 1),
        from: SRD_WEAPONS.filter((weapon) => (kind ? weapon.category === kind : weapon.category === "simple" || weapon.category === "martial")).map((weapon) => weapon.name),
      };
    }
    const toolsFrom = toolList
      ? toolList[1].split(/,|\bor\b|\band\b/).map((word) => word.trim()).filter((word) => KNOWN_TOOLS.includes(word))
      : anyTool ? [...KNOWN_TOOLS] : grant.tools > 0 ? grant.toolsFrom : [];
    if (toolsFrom.length) {
      out.toolChoice = { count: (out.toolChoice?.count ?? 0) + Math.max(1, toolList || anyTool ? 1 : grant.tools), from: toolsFrom };
    }
    const spells = taughtSpells(paragraph.text);
    if (spells && !out.spells) {
      out.spells = spells;
    }
  }
  if (saveAgainst.length) {
    add(`Saves with advantage against ${saveAgainst.join(", ")}`);
  }
  if (spellSaves.length) {
    add(`Saves with advantage against spells (${spellSaves.join(", ")})`);
  }
  return out;
}
