// Charge, Pounce and Trampling Charge: a creature that runs straight at its
// target and lands the hit its trait names. SRD 5.1's boar: "If the boar
// moves at least 20 ft. straight toward a target and then hits it with a tusk
// attack on the same turn, the target takes an extra 3 (1d6) slashing damage.
// If the target is a creature, it must succeed on a DC 11 Strength saving
// throw or be knocked prone." The minotaur's gore pushes too ("pushed up to
// 10 ft. away and knocked prone"); the lion's Pounce (and the triceratops'
// Trampling Charge) adds "If the target is prone, the lion can make one bite
// attack against it as a bonus action." Before this every such trait was
// listed to the GM as theirs to run by hand, and a lion's bound knocked
// nobody down.
//
// Read from the block's own trait line, so every block that prints one plays
// with its own numbers: the run, the attack (or attacks) it rides, the extra
// dice and their type, the save and its DC, the push, the bonus attack. A
// line this reader cannot read whole (a charge made only while mounted, an
// advantage instead of a save, two bonus attacks) reads as null and stays the
// GM's (monster-traits.ts manualTraits). enemy-charge.ts plays the reading.
//
// Pure.

import { textKey } from "@/lib/language/text-logic";

export type ChargeTrait = {
  name: string;
  // The run: at least this many feet straight toward the target.
  feet: number;
  // The attacks whose hit it rides, as printed ("claw", "gore"), lowercase.
  attacks: string[];
  // "An extra 9 (2d8) piercing damage"; no type is the weapon's own.
  extra?: { dice: string; type?: string };
  // The save against the fall (and the push), Strength in every block read.
  save?: { ability: "str" | "dex" | "con"; dc: number };
  prone: boolean;
  pushFeet?: number;
  // "If the target is prone, ... one bite attack against it as a bonus
  // action": the attacks it may choose from.
  bonus?: string[];
};

const DAMAGE = "acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder";
const ABILITY: Record<string, "str" | "dex" | "con"> = { strength: "str", str: "str", dexterity: "dex", dex: "dex", constitution: "con", con: "con" };

const attackList = (raw: string) =>
  raw
    .split(/\s+or\s+/i)
    .map((name) => name.replace(/^(?:a|an|its|one)\s+/i, "").replace(/\s+attacks?$/i, "").trim().toLowerCase())
    .filter(Boolean);

// One trait line, "Name: text" or "Name. text", read whole, or null.
export function readChargeTrait(line: string): ChargeTrait | null {
  const head = /^\s*(pounce|trampling charge|charge)\b(?:\s*\([^)]*\))?\s*[.:]\s*/i.exec(line);
  if (!head) {
    return null;
  }
  const text = line.slice(head[0].length).replace(/\s+/g, " ");
  // Ridden only while mounted (a black knight's): the engine keeps no mount
  // under a creature, so the GM judges it.
  if (/\bif (?:[\w\s-]+? is )?mounted\b/i.test(text)) {
    return null;
  }
  const run = /\bmoves\s+(?:at\s+least\s+)?(\d{1,3})\s*(?:ft\.?|feet|')\s*\+?\s+(?:in\s+a\s+)?straight\b/i.exec(text);
  const hit = /\bhits\s+(?:it\s+|the\s+target\s+)?(?:with\s+)?(.+?)\s+on\s+(?:the\s+)?(?:same|that)\s+turn\b/i.exec(text);
  if (!run || !hit) {
    return null;
  }
  const attacks = attackList(hit[1]);
  if (!attacks.length || attacks.some((name) => /^melee(?: weapon)?$/.test(name))) {
    return null;
  }
  const out: ChargeTrait = { name: head[1].replace(/\b\w/g, (letter) => letter.toUpperCase()), feet: Number(run[1]), attacks, prone: /\b(?:knocked|falls?)\s+prone\b/i.test(text) };
  const extra = new RegExp(`\\bextra\\s+\\d{1,3}\\s*\\(\\s*(\\d{1,2}d\\d{1,3}(?:\\s*[+-]\\s*\\d{1,3})?)\\s*\\)\\s*(?:(${DAMAGE})\\s+)?damage`, "i").exec(text);
  if (extra) {
    out.extra = { dice: extra[1].replace(/\s+/g, ""), ...(extra[2] ? { type: extra[2].toLowerCase() } : {}) };
  }
  const save = /\bDC\s*(\d{1,2})\s+(strength|dexterity|constitution|str|dex|con)\b/i.exec(text);
  if (save) {
    out.save = { ability: ABILITY[save[2].toLowerCase()], dc: Number(save[1]) };
  }
  const push = /\bpushed\s+up\s+to\s+(\d{1,3})\s*(?:ft\.?|feet)/i.exec(text);
  if (push) {
    out.pushFeet = Number(push[1]);
  }
  if (/\bbonus action\b/i.test(text)) {
    const bonus = /\bcan\s+make\s+(?:one|another|a single)\s+(?:attack\s+with\s+its\s+)?(.+?)\s+(?:against|vs\.?)\s+(?:it|the target)\b/i.exec(text);
    if (!bonus) {
      return null;
    }
    out.bonus = attackList(bonus[1]);
  }
  // A fall or a push with no save to stop it is a line misread.
  if ((out.prone || out.pushFeet) && !out.save) {
    return null;
  }
  return out.extra || out.prone ? out : null;
}

type Traits = { traits?: string[]; fullTraits?: string[] };

// The block's charges, each once: its uncut lines first, then the trimmed
// ones a block written before them keeps.
export function chargeTraitsOf(stats: Traits): ChargeTrait[] {
  const seen = new Set<string>();
  const out: ChargeTrait[] = [];
  for (const line of [...(stats.fullTraits ?? []), ...(stats.traits ?? [])]) {
    const read = readChargeTrait(line);
    if (read && !seen.has(read.name)) {
      seen.add(read.name);
      out.push(read);
    }
  }
  return out;
}

// An attack the trait names, by its whole name or its singular: the trait
// prints "a claw attack", the block "Claws"; "its tusks", the block "Tusk".
const singular = (name: string) => textKey(name).replace(/s$/, "");
const named = (list: string[], attack: string) => list.some((entry) => textKey(entry) === textKey(attack) || singular(entry) === singular(attack));

// The charge this attack's hit rides after a run of `ranFeet` straight at
// the target, or null.
export function chargeOnHit(stats: Traits, attack: string, ranFeet: number): ChargeTrait | null {
  return chargeTraitsOf(stats).find((trait) => ranFeet >= trait.feet && named(trait.attacks, attack)) ?? null;
}

// The attack a charging creature makes when none is named: its trait's, of
// the block's attacks, when the run reaches it. Null leaves the usual one.
export function chargeAttackOf<A extends { name: string }>(stats: Traits, attacks: A[], ranFeet: number): A | null {
  for (const trait of chargeTraitsOf(stats)) {
    const found = ranFeet >= trait.feet ? attacks.find((attack) => named(trait.attacks, attack.name)) : undefined;
    if (found) {
      return found;
    }
  }
  return null;
}

// The charge whose bonus attack this is, or null.
export function chargeBonusOf(stats: Traits, attack: string): ChargeTrait | null {
  return chargeTraitsOf(stats).find((trait) => trait.bonus && named(trait.bonus, attack)) ?? null;
}

// Whether a trait line is a charge the engine plays whole.
export function playsCharge(line: string): boolean {
  return readChargeTrait(line) !== null;
}
